import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// Differential Image Forensics V1
// Normal model = trusted originals. Tamper model = known-negative samples.
// This module reports repeated LOCAL physical patterns; it intentionally does
// not emit a global fake score and does not adjudicate authenticity by itself.

const COMPONENTS = ['luminance','edge','raster','chroma'];
const TILE_COLS = 8;
const TILE_ROWS = 12;
const TILE_W = 32;
const TILE_H = 32;

const clamp = (v,a=0,b=1) => Math.max(a, Math.min(b,v));
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const median = a => { if(!a.length) return 0; const b=[...a].sort((x,y)=>x-y); const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; };

async function loadRaster(filePath) {
  const ext = path.extname(String(filePath)).toLowerCase();
  if (ext === '.pdf') return null; // caller may supply rendered visual references.
  const { data, info } = await sharp(filePath).resize({ width: TILE_COLS*TILE_W, height: TILE_ROWS*TILE_H, fit:'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject:true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}

function tileFeature(img, tx, ty) {
  const vals=[]; const edges=[]; const chroma=[];
  const x0=tx*TILE_W, y0=ty*TILE_H;
  for(let y=y0;y<Math.min(y0+TILE_H,img.height);y++) for(let x=x0;x<Math.min(x0+TILE_W,img.width);x++) {
    const i=(y*img.width+x)*img.channels;
    const r=img.data[i]||0,g=img.data[i+1]||r,b=img.data[i+2]||r;
    const lum=.299*r+.587*g+.114*b; vals.push(lum); chroma.push(Math.max(r,g,b)-Math.min(r,g,b));
    if(x>x0){ const p=(y*img.width+x-1)*img.channels; const pl=.299*(img.data[p]||0)+.587*(img.data[p+1]||0)+.114*(img.data[p+2]||0); edges.push(Math.abs(lum-pl)); }
  }
  const mu=mean(vals); const variance=mean(vals.map(v=>(v-mu)**2));
  const edge=mean(edges); const chrom=mean(chroma);
  return { luminance:mu, edge, raster:Math.sqrt(variance), chroma:chrom };
}

function vector(img){
  const out=[]; for(let y=0;y<TILE_ROWS;y++) for(let x=0;x<TILE_COLS;x++) out.push(tileFeature(img,x,y)); return out;
}
function componentDistance(a,b){
  const scales={luminance:8,edge:8,raster:8,chroma:8};
  return Object.fromEntries(COMPONENTS.map(k=>[k,Math.abs(a[k]-b[k])/scales[k]]));
}
function compareVectors(a,b){
  const rows=[]; for(let i=0;i<Math.min(a.length,b.length);i++) rows.push(componentDistance(a[i],b[i])); return rows;
}

function repeatedPatterns(target, originals, negatives) {
  const result={};
  for(const component of COMPONENTS){
    let normal=[]; let neg=[]; let targetVsNormal=[]; let targetVsNegative=[];
    for(let i=0;i<target.length;i++){
      const n=originals.map(v=>v[i]?.[component]).filter(Number.isFinite);
      const f=negatives.map(v=>v[i]?.[component]).filter(Number.isFinite);
      if(n.length){ const nd=Math.abs(target[i][component]-median(n)); normal.push(nd); targetVsNormal.push(nd); }
      if(f.length){ const fd=Math.abs(target[i][component]-median(f)); neg.push(fd); targetVsNegative.push(fd); }
    }
    const normalMedian=median(normal), negativeMedian=median(neg);
    const anomalousTiles=targetVsNormal.filter((v,i)=>v>2 && targetVsNegative[i] < Math.max(1.5,v*.7)).length;
    const agreement=neg.length ? clamp(anomalousTiles/neg.length) : 0;
    result[component]={ normalMedian:Number(normalMedian.toFixed(3)), negativeMedian:Number(negativeMedian.toFixed(3)), anomalousTileCount:anomalousTiles, agreementRatio:Number(agreement.toFixed(3)) };
  }
  return result;
}

export async function runDifferentialImageForensics({ targetPath, referencePaths=[], negativeSamples=[], bank=null }={}) {
  if(!targetPath) return {available:false,status:'missing-target',version:'DIFF-IMAGE-V1'};
  const refs=(Array.isArray(referencePaths)?referencePaths:[]).filter(Boolean).slice(0,8);
  const negs=(Array.isArray(negativeSamples)?negativeSamples:[]).map(x=>typeof x==='string'?x:x?.path).filter(Boolean).slice(0,12);
  const target=await loadRaster(targetPath);
  if(!target) return {available:false,status:'target-raster-unavailable',version:'DIFF-IMAGE-V1'};
  const originalVectors=[]; const negativeVectors=[];
  for(const p of refs){ try{ const r=await loadRaster(p); if(r) originalVectors.push(vector(r)); }catch(e){} }
  for(const p of negs){ try{ const r=await loadRaster(p); if(r) negativeVectors.push(vector(r)); }catch(e){} }
  if(!originalVectors.length && !negativeVectors.length) return {available:false,status:'no-raster-population',version:'DIFF-IMAGE-V1',bank};
  const tv=vector(target);
  const patterns=repeatedPatterns(tv,originalVectors,negativeVectors);
  const corroborated=[];
  for(const c of COMPONENTS){ const p=patterns[c]; if(p.anomalousTileCount>=2 && p.agreementRatio>=.25) corroborated.push(c); }
  return {
    available:true, version:'DIFF-IMAGE-V1', bank,
    model:{normalSampleCount:originalVectors.length,tamperSampleCount:negativeVectors.length},
    components:patterns,
    corroboratedTamperPatterns:corroborated,
    tamperPatternCount:corroborated.length,
    finalPromotionAllowed:false,
    decision:'advisory-only-local-pattern-evidence',
    note:'Global similarity is intentionally omitted; negative samples are pattern references, not authenticity references.'
  };
}
