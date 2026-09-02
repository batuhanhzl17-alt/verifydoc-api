import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// =====================================================
// VERIFYDOC VISUAL FORENSICS HELPER v2 - PDFJS RENDER + DIAGNOSTIC LOGS
// =====================================================
// Amaç: Güvenilen referans GÖRSELLERİ ile yeni JPG/PNG'yi
// bütün sayfa seviyesinde karşılaştırmak.
//
// Not: Bu modül OpenCV'nin native binding'ine bağımlı değildir.
// Vercel gibi ortamlarda daha güvenli olan Sharp kullanılır.
// Eğer referans PDF ise, render edilebilen ortamda pdftoppm/magick
// denenir; render edilemiyorsa mevcut PDF text/geometry motoru
// kullanılmaya devam eder.

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp']);
const PDF_EXT = '.pdf';

function clamp(v, lo=0, hi=1){ return Math.max(lo, Math.min(hi, v)); }

async function renderPdfWithCanvas(pdfPath, outPath) {
  console.log('PDF RENDER PDFJS BAŞLADI:', path.basename(pdfPath));

  try {
    const canvasMod = await import('@napi-rs/canvas');
    const createCanvas =
      canvasMod.createCanvas ||
      canvasMod.default?.createCanvas;

    if (typeof createCanvas !== 'function') {
      throw new Error('@napi-rs/canvas createCanvas bulunamadı');
    }

    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const buffer = await fs.readFile(pdfPath);

    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false
    }).promise;

    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });

    const scale = Math.min(
      1200 / baseViewport.width,
      1600 / baseViewport.height
    );

    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );

    const ctx = canvas.getContext('2d');

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    const png = canvas.toBuffer('image/png');
    await fs.writeFile(outPath, png);
    await fs.access(outPath);

    console.log('PDF RENDER PDFJS BAŞARILI:', JSON.stringify({
      file: path.basename(pdfPath),
      method: 'pdfjs-napi-canvas',
      width: Math.ceil(viewport.width),
      height: Math.ceil(viewport.height)
    }));

    return outPath;
  } catch (e) {
    console.warn('PDF RENDER PDFJS HATASI:', JSON.stringify({
      file: path.basename(pdfPath),
      error: e?.message || String(e),
      name: e?.name || null,
      stack: e?.stack ? String(e.stack).split('\n').slice(0, 4).join('\n') : null
    }));
    return null;
  }
}

async function renderReferencePdfToPng(pdfPath, workDir) {
  const base = path.basename(pdfPath, path.extname(pdfPath))
    .replace(/[^a-zA-Z0-9_-]/g, '_');

  const outPrefix = path.join(workDir, `__vf_${base}`);
  const outPng = `${outPrefix}-1.png`;

  // 1) Vercel uyumlu PDF.js + @napi-rs/canvas
  const canvasRendered = await renderPdfWithCanvas(pdfPath, outPng);
  if (canvasRendered) return canvasRendered;

  // 2) pdftoppm fallback
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    console.log('PDF RENDER PDftoppm BAŞLADI:', path.basename(pdfPath));

    await execFileAsync(
      'pdftoppm',
      ['-f', '1', '-singlefile', '-png', '-r', '110', pdfPath, outPrefix],
      { timeout: 20000 }
    );

    await fs.access(outPng);

    console.log('PDF RENDER PDftoppm BAŞARILI:', path.basename(pdfPath));
    return outPng;
  } catch (e) {
    console.warn('PDF RENDER PDftoppm HATASI:', JSON.stringify({
      file: path.basename(pdfPath),
      error: e?.message || String(e),
      code: e?.code || null,
      stderr: e?.stderr ? String(e.stderr).slice(0, 1000) : null
    }));
  }

  // 3) ImageMagick fallback
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);

    console.log('PDF RENDER MAGICK BAŞLADI:', path.basename(pdfPath));

    await execFileAsync(
      'magick',
      ['-density', '110', `${pdfPath}[0]`, outPng],
      { timeout: 20000 }
    );

    await fs.access(outPng);

    console.log('PDF RENDER MAGICK BAŞARILI:', path.basename(pdfPath));
    return outPng;
  } catch (e) {
    console.warn('PDF RENDER MAGICK HATASI:', JSON.stringify({
      file: path.basename(pdfPath),
      error: e?.message || String(e),
      code: e?.code || null,
      stderr: e?.stderr ? String(e.stderr).slice(0, 1000) : null
    }));
  }

  console.warn('PDF RENDER TAMAMEN BAŞARISIZ:', path.basename(pdfPath));
  return null;
}

async function loadNormalizedGray(filePath, width=640, height=900) {
  const { data, info } = await sharp(filePath)
    .flatten({ background: { r:255,g:255,b:255 } })
    .grayscale()
    .resize(width, height, { fit:'fill', kernel:'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject:true });
  return { data, width:info.width, height:info.height };
}

function compareArrays(a,b) {
  const n = Math.min(a.length,b.length);
  if (!n) return { mae:1, rmse:1, similarity:0 };
  let abs=0, sq=0;
  for(let i=0;i<n;i++){
    const d = Math.abs(a[i]-b[i])/255;
    abs += d;
    sq += d*d;
  }
  const mae = abs/n;
  const rmse = Math.sqrt(sq/n);
  return { mae, rmse, similarity: clamp(1 - (0.65*mae + 0.35*rmse)) };
}

function gridStats(data,w,h,cols=8,rows=10){
  const out=[];
  const cw=w/cols, rh=h/rows;
  for(let gy=0;gy<rows;gy++){
    for(let gx=0;gx<cols;gx++){
      const x0=Math.floor(gx*cw), x1=Math.min(w,Math.ceil((gx+1)*cw));
      const y0=Math.floor(gy*rh), y1=Math.min(h,Math.ceil((gy+1)*rh));
      let sum=0, dark=0, n=0;
      for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
        const v=data[y*w+x]; sum+=v; if(v<190) dark++; n++;
      }
      out.push({gx,gy,mean:n?sum/n:255,darkRatio:n?dark/n:0});
    }
  }
  return out;
}

function compareGrid(a,b){
  const cells=[];
  let sum=0;
  for(let i=0;i<Math.min(a.length,b.length);i++){
    const meanDiff=Math.abs(a[i].mean-b[i].mean)/255;
    const darkDiff=Math.abs(a[i].darkRatio-b[i].darkRatio);
    const d=clamp(0.55*meanDiff+0.45*darkDiff);
    cells.push({...a[i], deviation:d}); sum+=d;
  }
  cells.sort((x,y)=>y.deviation-x.deviation);
  return { meanDeviation:cells.length?sum/cells.length:1, topCells:cells.slice(0,10) };
}

async function imagePairScore(referencePath, targetPath) {
  const ref = await loadNormalizedGray(referencePath);
  const tar = await loadNormalizedGray(targetPath);
  const pixel = compareArrays(ref.data,tar.data);
  const grid = compareGrid(gridStats(ref.data,ref.width,ref.height), gridStats(tar.data,tar.width,tar.height));
  const similarity = clamp(0.72*pixel.similarity + 0.28*(1-grid.meanDeviation));
  return {
    referenceFile:path.basename(referencePath),
    pixelSimilarity:Number(similarity.toFixed(4)),
    pixelMAE:Number(pixel.mae.toFixed(4)),
    pixelRMSE:Number(pixel.rmse.toFixed(4)),
    gridDeviation:Number(grid.meanDeviation.toFixed(4)),
    suspiciousRegions:grid.topCells.map(c=>({row:c.gy,column:c.gx,deviation:Number(c.deviation.toFixed(4))}))
  };
}

export async function runVisualForensics({ targetPath, referencePaths=[], bank=null, tempDir='/tmp' }) {
  const refs = [...new Set((referencePaths||[]).filter(Boolean))];
  const imageRefs = refs.filter(p=>IMAGE_EXTS.has(path.extname(p).toLowerCase()));
  const pdfRefs = refs.filter(p=>path.extname(p).toLowerCase()===PDF_EXT);
  const renderedRefs=[];

  // PDF'leri yalnızca ortam destekliyorsa raster karşılaştırmaya sok.
  for (const pdf of pdfRefs.slice(0,12)) {
    const rendered = await renderReferencePdfToPng(pdf,tempDir);
    if (rendered) renderedRefs.push(rendered);
  }

  const usableRefs=[...imageRefs,...renderedRefs].slice(0,20);
  const comparisons=[];
  for(const ref of usableRefs){
    try { comparisons.push(await imagePairScore(ref,targetPath)); }
    catch(e){ console.warn('VISUAL FORENSICS REF HATASI:',path.basename(ref),e?.message||e); }
  }

  if(!comparisons.length){
    return {
      available:false,
      bank,
      referenceCount:refs.length,
      rasterReferenceCount:0,
      mode:'structural-only',
      score:0,
      similarity:null,
      evidence:'Raster referans karşılaştırması bu çalışma ortamında kullanılamadı. PDF/OCR şablon analizi ayrı katman olarak devam eder.'
    };
  }

  // En yakın birkaç gerçek referansı kullan; tek bir outlier sonucu belirlemesin.
  const sorted=[...comparisons].sort((a,b)=>b.pixelSimilarity-a.pixelSimilarity);
  const top=sorted.slice(0,Math.min(5,sorted.length));
  const avg=top.reduce((s,x)=>s+x.pixelSimilarity,0)/top.length;
  const deviation=1-avg;
  const score=Math.round(clamp(deviation*100,0,100));

  return {
    available:true,
    bank,
    referenceCount:refs.length,
    rasterReferenceCount:usableRefs.length,
    mode:'trusted-reference-raster-ensemble',
    bestSimilarity:Number(avg.toFixed(4)),
    score,
    severity: score>=70?'strong':score>=40?'medium':'low',
    comparedReferences:top,
    evidence:`Yeni belge ${top.length} güvenilir referansın en yakın görsel karşılaştırmalarıyla değerlendirildi; ortalama benzerlik ${(avg*100).toFixed(1)}%.`
  };
}
