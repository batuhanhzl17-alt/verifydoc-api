import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// =====================================================
// VERIFYDOC VISUAL FORENSICS HELPER v1
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

async function renderReferencePdfToPng(pdfPath, workDir) {
  const base = path.basename(pdfPath, path.extname(pdfPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const outPrefix = path.join(workDir, `__vf_${base}`);
  const outPng = `${outPrefix}-1.png`;

  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('pdftoppm', ['-f','1','-singlefile','-png','-r','110',pdfPath,outPrefix], { timeout: 20000 });
    await fs.access(outPng);
    return outPng;
  } catch {}

  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('magick', ['-density','110',`${pdfPath}[0]`,outPng], { timeout: 20000 });
    await fs.access(outPng);
    return outPng;
  } catch {}

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
