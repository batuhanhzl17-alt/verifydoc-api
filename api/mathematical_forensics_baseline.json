import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { pathToFileURL } from 'url';
import { extractMathematicalFingerprint, buildBaseline, inferDocumentFamily } from './api/mathematical_forensics.js';

const require = createRequire(import.meta.url);
const canvasMod = require('@napi-rs/canvas');
const createCanvas = canvasMod.createCanvas || canvasMod.default?.createCanvas;
const ImageData = canvasMod.ImageData || canvasMod.default?.ImageData;
const Path2D = canvasMod.Path2D || canvasMod.default?.Path2D;
const DOMMatrix = canvasMod.DOMMatrix || canvasMod.default?.DOMMatrix;
if (typeof globalThis.ImageData === 'undefined' && ImageData) globalThis.ImageData = ImageData;
if (typeof globalThis.Path2D === 'undefined' && Path2D) globalThis.Path2D = Path2D;
if (typeof globalThis.DOMMatrix === 'undefined' && DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/build/pdf.worker.mjs')).href;

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const REFS = path.join(ROOT, 'references');
const NEG = path.join(ROOT, 'negative_samples');
const OUT = path.join(ROOT, 'mathematical_forensics_baseline.json');

const bankAliases = [
  ['enpara','enpara'], ['garanti','garanti'], ['isbankasi','isbankasi'], ['işbankası','isbankasi'], ['vakifbank','vakifbank'],
  ['yap#u0131kredi','yapikredi'], ['yapikredi','yapikredi'], ['ziraat','ziraat'], ['akbank','akbank'], ['denizbank','denizbank'],
  ['halkbank','halkbank'], ['ing','ing'], ['kuveytturk','kuveytturk'], ['qnb','qnb'], ['teb','teb']
];
function inferBank(p) {
  const s = p.toLocaleLowerCase('tr-TR');
  for (const [needle, bank] of bankAliases) if (s.includes(needle)) return bank;
  return path.basename(path.dirname(p)).toLocaleLowerCase('tr-TR').replace(/[^a-z0-9]/g,'') || 'unknown';
}
function inferFamilyFromPath(p) { return inferDocumentFamily(path.basename(p), ''); }

async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes:true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else out.push(p);
  }
  return out;
}

async function renderPdfFirstPage(buf) {
  const pdf = await pdfjsLib.getDocument({ data:new Uint8Array(buf) }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale:1.6 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext:canvas.getContext('2d'), viewport }).promise;
  return canvas.toBuffer('image/png');
}

async function fingerprintFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const buf = await fs.readFile(filePath);
  if (ext === '.pdf') {
    const rendered = await renderPdfFirstPage(buf);
    return { fingerprint: await extractMathematicalFingerprint(rendered), renderedFromPdf:true };
  }
  return { fingerprint: await extractMathematicalFingerprint(buf), renderedFromPdf:false };
}

const samples = [];
async function addFiles(files, label) {
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!['.jpg','.jpeg','.png','.pdf'].includes(ext)) continue;
    try {
      const bank = inferBank(file);
      const family = inferFamilyFromPath(file);
      const { fingerprint, renderedFromPdf } = await fingerprintFile(file);
      samples.push({
        id: `${label}:${path.relative(ROOT,file).replaceAll(path.sep,'/')}`,
        label, bank, family,
        source: path.relative(ROOT,file).replaceAll(path.sep,'/'),
        renderedFromPdf,
        fingerprint,
      });
      console.log(`${label.padEnd(8)} ${bank.padEnd(12)} ${family.padEnd(18)} ${path.basename(file)}`);
    } catch (e) {
      console.warn('SKIP', file, e?.message || e);
    }
  }
}

const refFiles = await walk(REFS);
const negFiles = await walk(NEG);
await addFiles(refFiles, 'reference');
await addFiles(negFiles, 'negative');

const referenceSamples = samples.filter(x => x.label === 'reference');
const negativeSamples = samples.filter(x => x.label === 'negative');
const baseline = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  algorithm: 'VerifyDoc Mathematical Forensics V1',
  reference: buildBaseline(referenceSamples),
  negative: buildBaseline(negativeSamples),
  sampleInventory: samples.map(x => ({
    id:x.id, label:x.label, bank:x.bank, family:x.family, source:x.source, renderedFromPdf:x.renderedFromPdf
  }))
};
await fs.writeFile(OUT, JSON.stringify(baseline, null, 2));
console.log(`\nWROTE ${OUT}`);
console.log(`reference samples: ${referenceSamples.length}`);
console.log(`negative samples:  ${negativeSamples.length}`);
