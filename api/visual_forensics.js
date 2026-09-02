import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// =====================================================
// VERIFYDOC VISUAL FORENSICS HELPER v2
// =====================================================
// Vercel-safe Sharp tabanlı görsel forensics katmanı.
// Amaç: referans ensemble + JPEG/ELA + noise + 8x8 grid
// + metadata sinyallerini AYRI ayrı ölçmek.
// Bu modül "sahte" kararı vermez; ölçümleri raporlar.

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp']);
const PDF_EXT = '.pdf';
const clamp = (v, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
const round = (v, n=4) => Number(Number(v || 0).toFixed(n));

async function execFileSafe(command, args, options={}) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    return await promisify(execFile)(command, args, options);
  } catch { return null; }
}

async function renderPdfToPng(pdfPath, workDir, prefix='vf') {
  const base = path.basename(pdfPath, path.extname(pdfPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const out = path.join(workDir, `__${prefix}_${base}_1.png`);
  const a = await execFileSafe('pdftoppm', ['-f','1','-singlefile','-png','-r','110',pdfPath,out.replace(/\.png$/,'')], { timeout:20000 });
  if (a) { try { await fs.access(out); return out; } catch {} }
  const b = await execFileSafe('magick', ['-density','110',`${pdfPath}[0]`,out], { timeout:20000 });
  if (b) { try { await fs.access(out); return out; } catch {} }
  return null;
}

async function loadGray(filePath, width=640, height=900) {
  const input = await sharp(filePath).metadata();
  const { data, info } = await sharp(filePath)
    .flatten({ background:{r:255,g:255,b:255} })
    .grayscale()
    .resize(width,height,{fit:'fill',kernel:'lanczos3'})
    .raw()
    .toBuffer({resolveWithObject:true});
  return { data, width:info.width, height:info.height, metadata:input };
}

function compareArrays(a,b) {
  const n=Math.min(a.length,b.length);
  if(!n) return {mae:1,rmse:1,similarity:0};
  let abs=0,sq=0;
  for(let i=0;i<n;i++){
    const d=Math.abs(a[i]-b[i])/255;
    abs+=d; sq+=d*d;
  }
  const mae=abs/n, rmse=Math.sqrt(sq/n);
  return {mae,rmse,similarity:clamp(1-(0.65*mae+0.35*rmse))};
}

function gridStats(data,w,h,cols=8,rows=10){
  const out=[]; const cw=w/cols,rh=h/rows;
  for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols;gx++){
    const x0=Math.floor(gx*cw),x1=Math.min(w,Math.ceil((gx+1)*cw));
    const y0=Math.floor(gy*rh),y1=Math.min(h,Math.ceil((gy+1)*rh));
    let sum=0,dark=0,n=0;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){
      const v=data[y*w+x]; sum+=v; if(v<190) dark++; n++;
    }
    out.push({gx,gy,mean:n?sum/n:255,darkRatio:n?dark/n:0});
  }
  return out;
}

function compareGrid(a,b){
  const cells=[]; let sum=0;
  for(let i=0;i<Math.min(a.length,b.length);i++){
    const meanDiff=Math.abs(a[i].mean-b[i].mean)/255;
    const darkDiff=Math.abs(a[i].darkRatio-b[i].darkRatio);
    const d=clamp(0.55*meanDiff+0.45*darkDiff);
    cells.push({...a[i],deviation:d}); sum+=d;
  }
  cells.sort((x,y)=>y.deviation-x.deviation);
  return {meanDeviation:cells.length?sum/cells.length:1,topCells:cells.slice(0,10)};
}

function noiseResidual(data,w,h,blurRadius=2){
  // Sharp'tan ham piksel geldiği için burada basit yüksek frekans proxy'si:
  // merkez piksel ile 4-komşu ortalaması arasındaki fark.
  let sum=0,sq=0,n=0;
  const grid=[];
  const cols=8,rows=10,cw=w/cols,rh=h/rows;
  for(let gy=0;gy<rows;gy++) for(let gx=0;gx<cols;gx++){
    const x0=Math.floor(gx*cw),x1=Math.min(w,Math.ceil((gx+1)*cw));
    const y0=Math.floor(gy*rh),y1=Math.min(h,Math.ceil((gy+1)*rh));
    let gs=0,gn=0;
    for(let y=Math.max(1,y0);y<Math.min(h-1,y1);y++) for(let x=Math.max(1,x0);x<Math.min(w-1,x1);x++){
      const center=data[y*w+x];
      const nb=(data[y*w+x-1]+data[y*w+x+1]+data[(y-1)*w+x]+data[(y+1)*w+x])/4;
      const r=Math.abs(center-nb)/255;
      gs+=r; gn++; sum+=r; sq+=r*r; n++;
    }
    grid.push({gx,gy,noise:gn?gs/gn:0});
  }
  grid.sort((a,b)=>b.noise-a.noise);
  return {mean:n?sum/n:0,rmse:n?Math.sqrt(sq/n):0,top:grid.slice(0,10),blurRadius};
}

function noiseGridDeviation(a,b){
  if(!a?.length || !b?.length) return 1;
  let s=0,n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++) s+=Math.abs(a[i].noise-b[i].noise);
  return clamp(s/n*8);
}

function jpegBoundaryStats(data,w,h){
  // 8x8 DCT sınırlarında komşu farklarını, diğer iç sınırlardaki farklarla kıyaslar.
  let on=0,off=0,onN=0,offN=0;
  for(let y=0;y<h;y++) for(let x=1;x<w;x++){
    const d=Math.abs(data[y*w+x]-data[y*w+x-1])/255;
    if(x%8===0){on+=d;onN++;} else {off+=d;offN++;}
  }
  for(let x=0;x<w;x++) for(let y=1;y<h;y++){
    const d=Math.abs(data[y*w+x]-data[(y-1)*w+x])/255;
    if(y%8===0){on+=d;onN++;} else {off+=d;offN++;}
  }
  const boundary=onN?on/onN:0, interior=offN?off/offN:0;
  const ratio=interior>0?boundary/interior:1;
  return {boundary,interior,ratio,periodicExcess:clamp((ratio-1)/1.5)};
}

async function elaAnalysis(filePath, width=640, height=900){
  const ext=path.extname(filePath).toLowerCase();
  if(!['.jpg','.jpeg','.webp'].includes(ext)) return {available:false,reason:'ELA JPEG tabanlıdır; hedef JPEG değil.'};
  try{
    const original=await sharp(filePath).flatten({background:{r:255,g:255,b:255}}).resize(width,height,{fit:'fill'}).removeAlpha().jpeg({quality:95}).toBuffer();
    const recompressed=await sharp(original).raw().toBuffer();
    const src=await sharp(filePath).flatten({background:{r:255,g:255,b:255}}).resize(width,height,{fit:'fill'}).removeAlpha().raw().toBuffer();
    const n=Math.min(src.length,recompressed.length); let sum=0,sq=0,max=0;
    for(let i=0;i<n;i++){const d=Math.abs(src[i]-recompressed[i])/255;sum+=d;sq+=d*d;if(d>max)max=d;}
    const mae=n?sum/n:0,rmse=n?Math.sqrt(sq/n):0;
    return {available:true,quality:95,mae:round(mae),rmse:round(rmse),maxDiff:round(max),note:'ELA skoru tek başına sahtecilik kanıtı değildir.'};
  }catch(e){ return {available:false,reason:e?.message||String(e)}; }
}

async function jpegRecompressionSweep(filePath){
  const ext=path.extname(filePath).toLowerCase();
  if(!['.jpg','.jpeg'].includes(ext)) return {available:false,reason:'JPEG değil'};
  try{
    const src=await sharp(filePath).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const qualities=[40,50,60,70,80,90,95];
    const results=[];
    for(const q of qualities){
      const buf=await sharp(filePath).jpeg({quality:q}).raw().toBuffer();
      const n=Math.min(src.data.length,buf.length); let sum=0;
      for(let i=0;i<n;i++) sum+=Math.abs(src.data[i]-buf[i])/255;
      results.push({quality:q,mae:round(n?sum/n:1)});
    }
    results.sort((a,b)=>a.mae-b.mae);
    return {available:true,results,bestQuality:results[0]?.quality||null,note:'Bu yalnızca yeniden-sıkıştırma uyumluluğu heuristiğidir; tek başına double-JPEG kanıtı değildir.'};
  }catch(e){return {available:false,reason:e?.message||String(e)};}
}

async function metadataForensics(filePath){
  try{
    const m=await sharp(filePath).metadata();
    const software=m?.exif?.toString?.() || null;
    return {
      available:true,
      format:m.format||null,
      width:m.width||null,
      height:m.height||null,
      space:m.space||null,
      density:m.density||null,
      hasExif:!!m.exif,
      hasIcc:!!m.icc,
      hasXmp:!!m.xmp,
      hasIpTc:!!m.iptc,
      hasPhotoshop:!!m.photoshop,
      exifBytes:m.exif?.length||0,
      softwareHint:software && /photoshop|gimp|adobe|affinity|paint/i.test(software) ? 'possible-editor-marker' : null,
      note:'Metadata yokluğu gerçeklik kanıtı değildir; metadata varlığı da tek başına sahtecilik kanıtı değildir.'
    };
  }catch(e){return {available:false,reason:e?.message||String(e)};}
}

async function selfForensics(filePath){
  try{
    const img=await loadGray(filePath);
    const grid=gridStats(img.data,img.width,img.height);
    const noise=noiseResidual(img.data,img.width,img.height);
    const jpegGrid=jpegBoundaryStats(img.data,img.width,img.height);
    const ela=await elaAnalysis(filePath);
    const jpegSweep=await jpegRecompressionSweep(filePath);
    const meta=await metadataForensics(filePath);
    return {
      available:true,
      ela,
      jpegCompression:jpegSweep,
      jpegGrid,
      noise:{mean:round(noise.mean),rmse:round(noise.rmse),topRegions:noise.top.map(x=>({...x,noise:round(x.noise)}))},
      metadata:meta,
      gridProfile:grid.map(x=>({...x,mean:round(x.mean),darkRatio:round(x.darkRatio)})),
      interpretation:'Self-forensics yalnızca anomali sinyalleri üretir. Karar için referans ensemble ve OCR/veri tutarlılığıyla birlikte kullanılmalıdır.'
    };
  }catch(e){return {available:false,reason:e?.message||String(e)};}
}

async function imagePairScore(referencePath,targetPath){
  const ref=await loadGray(referencePath),tar=await loadGray(targetPath);
  const pixel=compareArrays(ref.data,tar.data);
  const grid=compareGrid(gridStats(ref.data,ref.width,ref.height),gridStats(tar.data,tar.width,tar.height));
  const refNoise=noiseResidual(ref.data,ref.width,ref.height);
  const tarNoise=noiseResidual(tar.data,tar.width,tar.height);
  const noiseDev=noiseGridDeviation(refNoise.top,tarNoise.top);
  const similarity=clamp(0.62*pixel.similarity+0.23*(1-grid.meanDeviation)+0.15*(1-noiseDev));
  return {
    referenceFile:path.basename(referencePath),
    pixelSimilarity:round(similarity),pixelMAE:round(pixel.mae),pixelRMSE:round(pixel.rmse),
    gridDeviation:round(grid.meanDeviation),noiseDeviation:round(noiseDev),
    suspiciousRegions:grid.topCells.map(c=>({row:c.gy,column:c.gx,deviation:round(c.deviation)}))
  };
}

export async function runVisualForensics({targetPath,referencePaths=[],bank=null,tempDir='/tmp'}){
  const refs=[...new Set((referencePaths||[]).filter(Boolean))];
  const self=await selfForensics(targetPath);
  const imageRefs=refs.filter(p=>IMAGE_EXTS.has(path.extname(p).toLowerCase()));
  const pdfRefs=refs.filter(p=>path.extname(p).toLowerCase()===PDF_EXT);
  const renderedRefs=[];
  for(const pdf of pdfRefs.slice(0,20)){
    const rendered=await renderPdfToPng(pdf,tempDir,'vf_ref');
    if(rendered) renderedRefs.push(rendered);
  }
  const usableRefs=[...imageRefs,...renderedRefs].slice(0,30);
  const comparisons=[];
  for(const ref of usableRefs){
    try{comparisons.push(await imagePairScore(ref,targetPath));}
    catch(e){console.warn('VISUAL FORENSICS REF HATASI:',path.basename(ref),e?.message||e);}
  }

  if(!comparisons.length){
    return {
      available:!!self.available,bank,referenceCount:refs.length,rasterReferenceCount:0,
      mode:'self-forensics-only',score:null,selfForensics:self,
      evidence:'Raster referans karşılaştırması kullanılamadı. ELA/JPEG/noise/metadata self-forensics sonuçları ayrıca üretildi.'
    };
  }

  const sorted=[...comparisons].sort((a,b)=>b.pixelSimilarity-a.pixelSimilarity);
  const top=sorted.slice(0,Math.min(7,sorted.length));
  const avg=top.reduce((s,x)=>s+x.pixelSimilarity,0)/top.length;
  const deviation=1-avg;
  const referenceDeviationScore=Math.round(clamp(deviation*100));
  const selfSignals={
    elaRmse:self?.ela?.rmse ?? null,
    jpegGridPeriodicExcess:self?.jpegGrid?.periodicExcess ?? null,
    noiseRmse:self?.noise?.rmse ?? null,
    bestRecompressionQuality:self?.jpegCompression?.bestQuality ?? null,
    metadataEditorHint:self?.metadata?.softwareHint ?? null
  };

  return {
    available:true,bank,referenceCount:refs.length,rasterReferenceCount:usableRefs.length,
    mode:'trusted-reference-raster-ensemble-v2',
    referenceSimilarity:round(avg),referenceDeviationScore,
    comparedReferences:top,
    selfForensics:self,
    selfSignals,
    score:referenceDeviationScore,
    severity:referenceDeviationScore>=70?'strong':referenceDeviationScore>=40?'medium':'low',
    evidence:`Hedef belge ${top.length} güvenilir raster referansla karşılaştırıldı. Ortalama görsel benzerlik ${(avg*100).toFixed(1)}%. JPEG/ELA/noise/metadata sinyalleri ayrıca raporlandı; bunlar tek başına sahtecilik kararı değildir.`
  };
}
