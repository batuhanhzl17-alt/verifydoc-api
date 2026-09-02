import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

// =====================================================
// VERIFYDOC VISUAL FORENSICS v3
// =====================================================
// Vercel-safe, reference-ensemble visual forensics.
//
// v3 differences from v2:
//  - PDF reference rendering tries @napi-rs/canvas + pdfjs first,
//    then pdftoppm/ImageMagick.
//  - Reference/target comparison performs small translation alignment.
//  - Grid/noise comparisons preserve spatial cell coordinates.
//  - Structural comparison relies on edges + darkness + texture, not
//    raw pixels alone, because transaction values vary between references.
//  - All reference files are treated as trusted calibration only.
//  - No reference document content is sent to an LLM by this module.
//  - Results are forensic signals, never an authenticity verdict.

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const PDF_EXT = '.pdf';
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const round = (v, n = 4) => Number(Number(v || 0).toFixed(n));

async function execFileSafe(command, args, options = {}) {
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    return await promisify(execFile)(command, args, options);
  } catch {
    return null;
  }
}

async function renderPdfWithCanvas(pdfPath, outPath) {
  try {
    const mod = await import('@napi-rs/canvas');
    const createCanvas = mod.createCanvas || mod.default?.createCanvas;
    if (typeof createCanvas !== 'function') return null;

    const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
    const buffer = await fs.readFile(pdfPath);
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1200 / base.width, 1600 / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const png = canvas.toBuffer('image/png');
    await fs.writeFile(outPath, png);
    await fs.access(outPath);
    return outPath;
  } catch (e) {
    return { error: e?.message || String(e) };
  }
}

async function renderPdfToPng(pdfPath, workDir, prefix = 'vf_ref') {
  const base = path.basename(pdfPath, path.extname(pdfPath)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const out = path.join(workDir, `__${prefix}_${base}_1.png`);

  const canvasResult = await renderPdfWithCanvas(pdfPath, out);
  if (typeof canvasResult === 'string') return { path: canvasResult, method: 'pdfjs-napi-canvas' };

  const ppmBase = out.replace(/\.png$/i, '');
  const ppm = await execFileSafe('pdftoppm', ['-f', '1', '-singlefile', '-png', '-r', '110', pdfPath, ppmBase], { timeout: 20000 });
  if (ppm) {
    try { await fs.access(out); return { path: out, method: 'pdftoppm' }; } catch {}
  }

  const magick = await execFileSafe('magick', ['-density', '110', `${pdfPath}[0]`, out], { timeout: 20000 });
  if (magick) {
    try { await fs.access(out); return { path: out, method: 'imagemagick' }; } catch {}
  }

  return { path: null, method: 'unavailable', error: canvasResult?.error || 'PDF rasterizer bulunamadı.' };
}

async function loadGray(filePath, width = 480, height = 675) {
  const metadata = await sharp(filePath).metadata();
  const { data, info } = await sharp(filePath)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .grayscale()
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, metadata };
}

function edgeMap(data, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = Math.abs(data[y * w + x + 1] - data[y * w + x - 1]);
      const gy = Math.abs(data[(y + 1) * w + x] - data[(y - 1) * w + x]);
      out[y * w + x] = Math.min(255, gx + gy);
    }
  }
  return out;
}

function gridStats(data, w, h, cols = 8, rows = 10, edges = null) {
  const out = [];
  const cw = w / cols, rh = h / rows;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor(gx * cw), x1 = Math.min(w, Math.ceil((gx + 1) * cw));
      const y0 = Math.floor(gy * rh), y1 = Math.min(h, Math.ceil((gy + 1) * rh));
      let sum = 0, dark = 0, edgeSum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = data[y * w + x];
        sum += v;
        if (v < 190) dark++;
        if (edges) edgeSum += edges[y * w + x];
        n++;
      }
      out.push({
        gx, gy,
        mean: n ? sum / n : 255,
        darkRatio: n ? dark / n : 0,
        edgeDensity: n ? edgeSum / n / 255 : 0
      });
    }
  }
  return out;
}

function noiseGrid(data, w, h, cols = 8, rows = 10) {
  const out = [];
  const cw = w / cols, rh = h / rows;
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.max(1, Math.floor(gx * cw));
      const x1 = Math.min(w - 1, Math.ceil((gx + 1) * cw));
      const y0 = Math.max(1, Math.floor(gy * rh));
      const y1 = Math.min(h - 1, Math.ceil((gy + 1) * rh));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const c = data[y * w + x];
        const nb = (data[y * w + x - 1] + data[y * w + x + 1] + data[(y - 1) * w + x] + data[(y + 1) * w + x]) / 4;
        sum += Math.abs(c - nb) / 255;
        n++;
      }
      out.push({ gx, gy, noise: n ? sum / n : 0 });
    }
  }
  return out;
}

function compareGrid(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return { meanDeviation: 1, topCells: [] };
  const cells = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const meanDiff = Math.abs(a[i].mean - b[i].mean) / 255;
    const darkDiff = Math.abs(a[i].darkRatio - b[i].darkRatio);
    const edgeDiff = Math.abs((a[i].edgeDensity || 0) - (b[i].edgeDensity || 0));
    const d = clamp(0.30 * meanDiff + 0.30 * darkDiff + 0.40 * edgeDiff);
    cells.push({ gx: a[i].gx, gy: a[i].gy, deviation: d });
    sum += d;
  }
  return { meanDeviation: sum / n, topCells: cells.sort((x, y) => y.deviation - x.deviation).slice(0, 12) };
}

function compareNoiseGrid(a, b) {
  const n = Math.min(a.length, b.length);
  if (!n) return { meanDeviation: 1, topCells: [] };
  const cells = [];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = clamp(Math.abs(a[i].noise - b[i].noise) * 8);
    cells.push({ gx: a[i].gx, gy: a[i].gy, deviation: d });
    sum += d;
  }
  return { meanDeviation: sum / n, topCells: cells.sort((x, y) => y.deviation - x.deviation).slice(0, 12) };
}

function shiftCompare(ref, target, w, h, dx, dy) {
  let abs = 0, n = 0;
  const x0 = Math.max(0, dx), x1 = Math.min(w, w + dx);
  const y0 = Math.max(0, dy), y1 = Math.min(h, h + dy);
  for (let y = y0; y < y1; y++) {
    const ry = y - dy;
    for (let x = x0; x < x1; x++) {
      const rx = x - dx;
      abs += Math.abs(ref[ry * w + rx] - target[y * w + x]) / 255;
      n++;
    }
  }
  return n ? abs / n : 1;
}

function findBestTranslation(ref, target, w, h) {
  // Coarse registration: enough to tolerate small screenshot/crop offsets.
  const smallW = 120, smallH = 169;
  const r = resizeRaw(ref, w, h, smallW, smallH);
  const t = resizeRaw(target, w, h, smallW, smallH);
  let best = { mae: 1, dx: 0, dy: 0 };
  for (let dy = -8; dy <= 8; dy += 2) {
    for (let dx = -8; dx <= 8; dx += 2) {
      const mae = shiftCompare(r, t, smallW, smallH, dx, dy);
      if (mae < best.mae) best = { mae, dx: dx * (w / smallW), dy: dy * (h / smallH) };
    }
  }
  return best;
}

function resizeRaw(data, srcW, srcH, dstW, dstH) {
  // nearest-neighbour is sufficient for registration proxy and avoids another Sharp call.
  const out = new Uint8Array(dstW * dstH);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(y * srcH / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(x * srcW / dstW));
      out[y * dstW + x] = data[sy * srcW + sx];
    }
  }
  return out;
}

function alignedStructuralScore(refImg, tarImg) {
  const { data: r, width: w, height: h } = refImg;
  const { data: t } = tarImg;
  const alignment = findBestTranslation(r, t, w, h);
  const rg = gridStats(r, w, h, 8, 10, edgeMap(r, w, h));
  const tg = gridStats(t, w, h, 8, 10, edgeMap(t, w, h));
  const rn = noiseGrid(r, w, h);
  const tn = noiseGrid(t, w, h);
  const gd = compareGrid(rg, tg);
  const nd = compareNoiseGrid(rn, tn);

  // Raw pixels are deliberately low weight: transaction text varies.
  const rawMae = shiftCompare(r, t, w, h, Math.round(alignment.dx), Math.round(alignment.dy));
  const rawSimilarity = 1 - rawMae;
  const structuralSimilarity = clamp(
    0.50 * (1 - gd.meanDeviation) +
    0.30 * (1 - nd.meanDeviation) +
    0.20 * rawSimilarity
  );

  return {
    similarity: structuralSimilarity,
    rawMAE: rawMae,
    gridDeviation: gd.meanDeviation,
    noiseDeviation: nd.meanDeviation,
    alignment: { dx: round(alignment.dx, 1), dy: round(alignment.dy, 1) },
    suspiciousRegions: gd.topCells.map(c => ({ row: c.gy, column: c.gx, deviation: round(c.deviation) })),
    noiseSuspiciousRegions: nd.topCells.map(c => ({ row: c.gy, column: c.gx, deviation: round(c.deviation) }))
  };
}

async function elaAnalysis(filePath, width = 480, height = 675) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.jpg', '.jpeg', '.webp'].includes(ext)) return { available: false, reason: 'ELA JPEG tabanlıdır; hedef JPEG/WebP değil.' };
  try {
    const src = await sharp(filePath).flatten({ background: { r: 255, g: 255, b: 255 } }).resize(width, height, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    const recompressed = await sharp(filePath).flatten({ background: { r: 255, g: 255, b: 255 } }).resize(width, height, { fit: 'fill' }).jpeg({ quality: 90 }).raw().toBuffer();
    const n = Math.min(src.length, recompressed.length);
    let sum = 0, sq = 0, max = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(src[i] - recompressed[i]) / 255;
      sum += d; sq += d * d; if (d > max) max = d;
    }
    return { available: true, quality: 90, mae: round(n ? sum / n : 0), rmse: round(n ? Math.sqrt(sq / n) : 0), maxDiff: round(max), note: 'ELA yalnızca yardımcı compression sinyalidir.' };
  } catch (e) { return { available: false, reason: e?.message || String(e) }; }
}

async function jpegRecompressionSweep(filePath) {
  if (!['.jpg', '.jpeg'].includes(path.extname(filePath).toLowerCase())) return { available: false, reason: 'JPEG değil' };
  try {
    const src = await sharp(filePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const qualities = [40, 50, 60, 70, 80, 90, 95];
    const results = [];
    for (const q of qualities) {
      const buf = await sharp(filePath).jpeg({ quality: q }).raw().toBuffer();
      const n = Math.min(src.data.length, buf.length);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.abs(src.data[i] - buf[i]) / 255;
      results.push({ quality: q, mae: round(n ? sum / n : 1) });
    }
    results.sort((a, b) => a.mae - b.mae);
    return { available: true, results, bestQuality: results[0]?.quality || null, note: 'Double-JPEG için yalnızca heuristik compression uyumluluğu.' };
  } catch (e) { return { available: false, reason: e?.message || String(e) }; }
}

function jpegBoundaryStats(data, w, h) {
  let on = 0, off = 0, onN = 0, offN = 0;
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) {
    const d = Math.abs(data[y * w + x] - data[y * w + x - 1]) / 255;
    if (x % 8 === 0) { on += d; onN++; } else { off += d; offN++; }
  }
  for (let x = 0; x < w; x++) for (let y = 1; y < h; y++) {
    const d = Math.abs(data[y * w + x] - data[(y - 1) * w + x]) / 255;
    if (y % 8 === 0) { on += d; onN++; } else { off += d; offN++; }
  }
  const boundary = onN ? on / onN : 0;
  const interior = offN ? off / offN : 0;
  const ratio = interior > 0 ? boundary / interior : 1;
  return { boundary: round(boundary), interior: round(interior), ratio: round(ratio), periodicExcess: round(clamp((ratio - 1) / 1.5)) };
}

async function metadataForensics(filePath) {
  try {
    const m = await sharp(filePath).metadata();
    return {
      available: true,
      format: m.format || null, width: m.width || null, height: m.height || null,
      space: m.space || null, density: m.density || null,
      hasExif: !!m.exif, hasIcc: !!m.icc, hasXmp: !!m.xmp, hasIpTc: !!m.iptc,
      hasPhotoshop: !!m.photoshop, exifBytes: m.exif?.length || 0,
      note: 'Metadata varlığı/yokluğu tek başına sahtecilik kanıtı değildir.'
    };
  } catch (e) { return { available: false, reason: e?.message || String(e) }; }
}

async function selfForensics(filePath) {
  try {
    const img = await loadGray(filePath);
    const edges = edgeMap(img.data, img.width, img.height);
    const grid = gridStats(img.data, img.width, img.height, 8, 10, edges);
    const noise = noiseGrid(img.data, img.width, img.height);
    return {
      available: true,
      ela: await elaAnalysis(filePath),
      jpegCompression: await jpegRecompressionSweep(filePath),
      jpegGrid: jpegBoundaryStats(img.data, img.width, img.height),
      noise: { mean: round(noise.reduce((s, x) => s + x.noise, 0) / Math.max(1, noise.length)), topRegions: [...noise].sort((a, b) => b.noise - a.noise).slice(0, 12).map(x => ({ ...x, noise: round(x.noise) })) },
      metadata: await metadataForensics(filePath),
      gridProfile: grid.map(x => ({ ...x, mean: round(x.mean), darkRatio: round(x.darkRatio), edgeDensity: round(x.edgeDensity) }))
    };
  } catch (e) { return { available: false, reason: e?.message || String(e) }; }
}

export async function runVisualForensics({ targetPath, referencePaths = [], bank = null, tempDir = '/tmp' }) {
  const refs = [...new Set((referencePaths || []).filter(Boolean))];
  const self = await selfForensics(targetPath);
  const imageRefs = refs.filter(p => IMAGE_EXTS.has(path.extname(p).toLowerCase()));
  const pdfRefs = refs.filter(p => path.extname(p).toLowerCase() === PDF_EXT);
  const renderedRefs = [];
  const renderFailures = [];

  for (const pdf of pdfRefs.slice(0, 30)) {
    const rendered = await renderPdfToPng(pdf, tempDir, 'vf_ref');
    if (rendered?.path) renderedRefs.push({ path: rendered.path, method: rendered.method, source: pdf });
    else renderFailures.push({ file: path.basename(pdf), error: rendered?.error || 'render başarısız' });
  }

  const usableRefs = [
    ...imageRefs.map(p => ({ path: p, method: 'raster', source: p })),
    ...renderedRefs
  ].slice(0, 30);

  const comparisons = [];
  for (const ref of usableRefs) {
    try {
      const r = await loadGray(ref.path), t = await loadGray(targetPath);
      const score = alignedStructuralScore(r, t);
      comparisons.push({ referenceFile: path.basename(ref.source), renderMethod: ref.method, ...score });
    } catch (e) {
      console.warn('VISUAL FORENSICS REF HATASI:', path.basename(ref.source), e?.message || e);
    }
  }

  if (!comparisons.length) {
    return {
      available: !!self.available,
      bank,
      referenceCount: refs.length,
      rasterReferenceCount: 0,
      mode: 'self-forensics-only',
      score: null,
      selfForensics: self,
      renderFailures,
      evidence: 'Raster referans karşılaştırması kullanılamadı. Self-forensics üretildi. PDF referansları için render desteği yoksa raster referans PNG/JPG eklenmesi gerekir.'
    };
  }

  const sorted = [...comparisons].sort((a, b) => b.similarity - a.similarity);
  const top = sorted.slice(0, Math.min(10, sorted.length));
  const avg = top.reduce((s, x) => s + x.similarity, 0) / top.length;
  const referenceDeviationScore = Math.round(clamp(1 - avg) * 100);

  return {
    available: true,
    bank,
    referenceCount: refs.length,
    rasterReferenceCount: usableRefs.length,
    mode: 'trusted-reference-raster-ensemble-v3',
    referenceSimilarity: round(avg),
    referenceDeviationScore,
    comparedReferences: top,
    renderFailures,
    selfForensics: self,
    interpretation: 'v3 ham piksel benzerliğini düşük ağırlıkta tutar; yapı, koyuluk, kenar ve noise dağılımını esas alır. Referanslardaki değişken işlem verileri nedeniyle bu skor tek başına sahtecilik kararı değildir.',
    score: referenceDeviationScore,
    severity: referenceDeviationScore >= 70 ? 'strong' : referenceDeviationScore >= 40 ? 'medium' : 'low'
  };
}
