import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const VERSION = 'MATH-FORENSICS-V1.2.1-16X16-CRITICAL-ROI-GATE';
const DEFAULT_SIZE = 256;
const TILE_GRID = 16;
const ROI_CANVAS_WIDTH = 256;
const ROI_CANVAS_HEIGHT = 96;

const LUMA_Q50 = [
  16,11,10,16,24,40,51,61,
  12,12,14,19,26,58,60,55,
  14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62,
  18,22,37,56,68,109,103,77,
  24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,
  72,92,95,98,112,100,103,99
];
const CHROMA_Q50 = [
  17,18,24,47,99,99,99,99,
  18,21,26,66,99,99,99,99,
  24,26,56,99,99,99,99,99,
  47,66,99,99,99,99,99,99,
  99,99,99,99,99,99,99,99,
  99,99,99,99,99,99,99,99,
  99,99,99,99,99,99,99,99,
  99,99,99,99,99,99,99,99
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0; }
function variance(a, m = mean(a)) { return a.length ? a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length : 0; }
function std(a, m = mean(a)) { return Math.sqrt(variance(a, m)); }
function median(a) {
  if (!a.length) return 0;
  const b = [...a].sort((x, y) => x - y);
  const m = Math.floor(b.length / 2);
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}
function mad(a, med = median(a)) { return median(a.map(v => Math.abs(v - med))); }
function entropyFromHistogram(hist, total) {
  if (!total) return 0;
  let e = 0;
  for (const n of hist) if (n) { const p = n / total; e -= p * Math.log2(p); }
  return e;
}

function jpegQuantizationTables(buf) {
  const tables = {};
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return tables;
  let i = 2;
  while (i + 3 < buf.length) {
    while (i < buf.length && buf[i] !== 0xff) i++;
    while (i < buf.length && buf[i] === 0xff) i++;
    if (i >= buf.length) break;
    const marker = buf[i++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 1 >= buf.length) break;
    const len = buf.readUInt16BE(i);
    if (len < 2 || i + len > buf.length) break;
    if (marker === 0xdb) {
      let p = i + 2;
      const end = i + len;
      while (p < end) {
        const info = buf[p++];
        const precision = info >> 4;
        const id = info & 0x0f;
        const count = precision === 0 ? 64 : 128;
        const values = [];
        for (let k = 0; k < count && p < end; k++) {
          values.push(precision === 0 ? buf[p++] : buf.readUInt16BE(p += 0, true));
          if (precision !== 0) p += 2;
        }
        tables[id] = { precision: precision ? 16 : 8, values: values.slice(0, 64) };
      }
    }
    i += len;
  }
  return tables;
}

function jpegQualityEstimate(tables) {
  const estimates = [];
  for (const [id, table] of Object.entries(tables || {})) {
    if (!table?.values?.length) continue;
    const base = Number(id) === 0 ? LUMA_Q50 : CHROMA_Q50;
    let bestQ = null;
    let bestErr = Infinity;
    for (let q = 1; q <= 100; q++) {
      const scale = q < 50 ? 5000 / q : 200 - 2 * q;
      let err = 0;
      const n = Math.min(64, table.values.length);
      for (let k = 0; k < n; k++) {
        const expected = clamp(Math.floor((base[k] * scale + 50) / 100), 1, 255);
        err += Math.abs(expected - table.values[k]);
      }
      err /= n;
      if (err < bestErr) { bestErr = err; bestQ = q; }
    }
    estimates.push({ id: Number(id), quality: bestQ, error: bestErr });
  }
  if (!estimates.length) return null;
  const q = estimates.reduce((s, x) => s + x.quality, 0) / estimates.length;
  const e = estimates.reduce((s, x) => s + x.error, 0) / estimates.length;
  return { estimatedQuality: q, fitError: e, tables: estimates };
}

function makeDctCos() {
  const c = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return c;
}
const DCT_COS = makeDctCos();
function dct8(block) {
  const out = new Float64Array(64);
  for (let u = 0; u < 8; u++) {
    const au = u === 0 ? Math.SQRT1_2 : 1;
    for (let v = 0; v < 8; v++) {
      const av = v === 0 ? Math.SQRT1_2 : 1;
      let s = 0;
      for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
        s += block[x * 8 + y] * DCT_COS[u][x] * DCT_COS[v][y];
      }
      out[u * 8 + v] = 0.25 * au * av * s;
    }
  }
  return out;
}

function clampBox(box, width, height) {
  if (!box) return null;
  const x1 = Number(box.x1 ?? box.x ?? 0);
  const y1 = Number(box.y1 ?? box.y ?? 0);
  const x2 = Number(box.x2 ?? (Number(box.x ?? 0) + Number(box.width ?? 0)));
  const y2 = Number(box.y2 ?? (Number(box.y ?? 0) + Number(box.height ?? 0)));
  const ax1 = Math.max(0, Math.min(width - 1, Math.round(Math.min(x1, x2))));
  const ay1 = Math.max(0, Math.min(height - 1, Math.round(Math.min(y1, y2))));
  const ax2 = Math.max(ax1 + 1, Math.min(width, Math.round(Math.max(x1, x2))));
  const ay2 = Math.max(ay1 + 1, Math.min(height, Math.round(Math.max(y1, y2))));
  if (ax2 - ax1 < 2 || ay2 - ay1 < 2) return null;
  return { x1: ax1, y1: ay1, x2: ax2, y2: ay2 };
}

function normalizeRegionBox(box, sourceWidth, sourceHeight) {
  if (!box) return null;
  const b = { ...box };
  const hasNorm = [b.xNorm, b.yNorm, b.widthNorm, b.heightNorm].every(v => Number.isFinite(Number(v)));
  if (hasNorm) {
    return clampBox({
      x1: Number(b.xNorm) * sourceWidth,
      y1: Number(b.yNorm) * sourceHeight,
      x2: (Number(b.xNorm) + Number(b.widthNorm)) * sourceWidth,
      y2: (Number(b.yNorm) + Number(b.heightNorm)) * sourceHeight,
    }, sourceWidth, sourceHeight);
  }
  return clampBox(b, sourceWidth, sourceHeight);
}

function cropRaw(data, width, height, box) {
  const b = clampBox(box, width, height);
  if (!b) return null;
  const w = b.x2 - b.x1, h = b.y2 - b.y1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const src = (b.y1 + y) * width + b.x1;
    out.set(data.subarray(src, src + w), y * w);
  }
  return { data: Buffer.from(out), width: w, height: h, box: b };
}

function resizeGrayRaw(data, width, height, outWidth, outHeight, fill = 255) {
  const out = new Uint8Array(outWidth * outHeight);
  out.fill(clamp(Math.round(fill), 0, 255));
  if (!width || !height || !outWidth || !outHeight) return { data: out, width: outWidth, height: outHeight };
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.min(height - 1, Math.floor((y + 0.5) * height / outHeight));
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(width - 1, Math.floor((x + 0.5) * width / outWidth));
      out[y * outWidth + x] = data[sy * width + sx];
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

function borderMedian(data, width, height) {
  const values = [];
  if (!width || !height) return 255;
  const stepX = Math.max(1, Math.floor(width / 64));
  const stepY = Math.max(1, Math.floor(height / 32));
  for (let x = 0; x < width; x += stepX) {
    values.push(data[x], data[(height - 1) * width + x]);
  }
  for (let y = 0; y < height; y += stepY) {
    values.push(data[y * width], data[y * width + width - 1]);
  }
  return median(values);
}

function findInkBounds(data, width, height) {
  if (!width || !height) return null;
  const bg = borderMedian(data, width, height);
  const borderDelta = Math.max(8, Math.min(34, std(data.slice(0, Math.min(data.length, Math.max(width, height) * 2)))));
  const threshold = clamp(bg - Math.max(12, borderDelta * 1.5), 80, 248);
  let x1 = width, y1 = height, x2 = -1, y2 = -1, count = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] <= threshold) {
        if (x < x1) x1 = x;
        if (y < y1) y1 = y;
        if (x > x2) x2 = x;
        if (y > y2) y2 = y;
        count++;
      }
    }
  }
  // Very sparse boxes can be OCR noise. Keep the original crop in that case.
  if (count < Math.max(4, Math.floor(width * height * 0.002)) || x2 < x1 || y2 < y1) {
    return { x1: 0, y1: 0, x2: width, y2: height, background: bg, threshold, detected: false };
  }
  const padX = Math.max(1, Math.round((x2 - x1 + 1) * 0.04));
  const padY = Math.max(1, Math.round((y2 - y1 + 1) * 0.10));
  return {
    x1: Math.max(0, x1 - padX), y1: Math.max(0, y1 - padY),
    x2: Math.min(width, x2 + 1 + padX), y2: Math.min(height, y2 + 1 + padY),
    background: bg, threshold, detected: true, inkPixels: count,
  };
}

function letterboxGrayRaw(data, width, height, outWidth, outHeight, fill = 255) {
  const out = new Uint8Array(outWidth * outHeight);
  out.fill(clamp(Math.round(fill), 0, 255));
  if (!width || !height) return { data: out, width: outWidth, height: outHeight, scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(outWidth / width, outHeight / height);
  const rw = Math.max(1, Math.min(outWidth, Math.round(width * scale)));
  const rh = Math.max(1, Math.min(outHeight, Math.round(height * scale)));
  const resized = resizeGrayRaw(data, width, height, rw, rh, fill);
  const ox = Math.floor((outWidth - rw) / 2);
  const oy = Math.floor((outHeight - rh) / 2);
  for (let y = 0; y < rh; y++) out.set(resized.data.subarray(y * rw, (y + 1) * rw), (oy + y) * outWidth + ox);
  return { data: out, width: outWidth, height: outHeight, scale, offsetX: ox, offsetY: oy, resizedWidth: rw, resizedHeight: rh };
}

function roiFingerprintFromRaster(data, width, height) {
  const inkBox = findInkBounds(data, width, height);
  const contentCrop = cropRaw(data, width, height, inkBox);
  const contentData = contentCrop?.data || data;
  const contentWidth = contentCrop?.width || width;
  const contentHeight = contentCrop?.height || height;
  const background = Number(inkBox?.background ?? borderMedian(data, width, height));
  // Preserve the text's aspect ratio. The old fit-fill normalization stretched
  // a 65x18 target box into the same 256x96 canvas as a 188x44 reference box,
  // creating artificial edge/laplacian differences. Letterboxing after ink-box
  // detection removes that scale/aspect artifact while retaining the glyph shape.
  const normalized = letterboxGrayRaw(
    contentData, contentWidth, contentHeight,
    ROI_CANVAS_WIDTH, ROI_CANVAS_HEIGHT, background
  );
  const rawNormalized = resizeGrayRaw(data, width, height, ROI_CANVAS_WIDTH, ROI_CANVAS_HEIGHT, background);
  const f = rasterFeatures(normalized.data, normalized.width, normalized.height);
  const raw = rasterFeatures(rawNormalized.data, rawNormalized.width, rawNormalized.height);
  return {
    canvas: { width: ROI_CANVAS_WIDTH, height: ROI_CANVAS_HEIGHT },
    normalization: 'content-ink-bbox-letterbox-v2',
    alignment: {
      sourceWidth: width, sourceHeight: height,
      sourceAspect: Number((width / Math.max(1, height)).toFixed(4)),
      contentBox: inkBox,
      contentWidth, contentHeight,
      contentAspect: Number((contentWidth / Math.max(1, contentHeight)).toFixed(4)),
      scale: Number((normalized.scale || 1).toFixed(5)),
      resizedWidth: normalized.resizedWidth || ROI_CANVAS_WIDTH,
      resizedHeight: normalized.resizedHeight || ROI_CANVAS_HEIGHT,
    },
    metrics: {
      luminanceMean: f.luminanceMean,
      luminanceStd: f.luminanceStd,
      entropy: f.entropy,
      edgeDensity: f.edgeDensity,
      meanGradient: f.meanGradient,
      laplacianVariance: f.laplacianVariance,
      dctLowEnergy: f.dctLowEnergy,
      dctMidEnergy: f.dctMidEnergy,
      dctHighEnergy: f.dctHighEnergy,
      dctHighRatio: f.dctHighRatio,
      blockinessHorizontal: f.blockinessHorizontal,
      blockinessVertical: f.blockinessVertical,
    },
    rawMetrics: {
      luminanceMean: raw.luminanceMean, luminanceStd: raw.luminanceStd, entropy: raw.entropy,
      edgeDensity: raw.edgeDensity, meanGradient: raw.meanGradient, laplacianVariance: raw.laplacianVariance,
      dctLowEnergy: raw.dctLowEnergy, dctMidEnergy: raw.dctMidEnergy, dctHighEnergy: raw.dctHighEnergy,
      dctHighRatio: raw.dctHighRatio, blockinessHorizontal: raw.blockinessHorizontal, blockinessVertical: raw.blockinessVertical,
    },
    tiles16x16: f.tiles,
  };
}

function buildSemanticRois(regions = {}) {
  const aliases = {
    amount: ['amount', 'tutar', 'transactionAmount'],
    recipientName: ['recipientName', 'recipient_name', 'aliciUnvani', 'aliciAdi', 'alıcıÜnvanı', 'alıcıAdı'],
    recipientIban: ['recipientIban', 'recipient_iban', 'iban', 'aliciIban', 'alıcıIban'],
  };
  const out = {};
  for (const [canonical, keys] of Object.entries(aliases)) {
    for (const key of keys) {
      if (regions?.[key]) { out[canonical] = regions[key]; break; }
    }
  }
  return out;
}

function rasterFeatures(data, width, height) {
  const n = width * height;
  const hist = new Array(256).fill(0);
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = data[i]; hist[v]++; sum += v; }
  const m = sum / Math.max(1, n);
  let s2 = 0;
  for (let i = 0; i < n; i++) s2 += (data[i] - m) ** 2;

  let edgeCount = 0;
  let gradSum = 0;
  let lapSum = 0;
  let lapSq = 0;
  const grads = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const gx = -data[p-width-1] + data[p-width+1] - 2*data[p-1] + 2*data[p+1] - data[p+width-1] + data[p+width+1];
      const gy = -data[p-width-1] - 2*data[p-width] - data[p-width+1] + data[p+width-1] + 2*data[p+width] + data[p+width+1];
      const g = Math.hypot(gx, gy) / 8;
      grads.push(g);
      gradSum += g;
      if (g > 18) edgeCount++;
      const lap = data[p-1] + data[p+1] + data[p-width] + data[p+width] - 4*data[p];
      lapSum += lap; lapSq += lap * lap;
    }
  }
  const gradN = Math.max(1, grads.length);
  const lapMean = lapSum / gradN;
  const lapVar = Math.max(0, lapSq / gradN - lapMean * lapMean);

  let dark = 0, bright = 0;
  for (let i = 0; i < n; i++) { if (data[i] < 64) dark++; if (data[i] > 240) bright++; }

  let dctLow = 0, dctMid = 0, dctHigh = 0, dctCount = 0;
  const step = 16;
  for (let y = 0; y + 8 <= height; y += step) {
    for (let x = 0; x + 8 <= width; x += step) {
      const block = new Float64Array(64);
      let bm = 0;
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) bm += data[(y+yy)*width + x+xx];
      bm /= 64;
      for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 8; xx++) block[yy*8+xx] = data[(y+yy)*width+x+xx] - bm;
      const d = dct8(block);
      for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
        if (u === 0 && v === 0) continue;
        const e = d[u*8+v] ** 2;
        if (u+v <= 2) dctLow += e;
        else if (u+v <= 5) dctMid += e;
        else dctHigh += e;
      }
      dctCount++;
    }
  }
  const dctTotal = dctLow + dctMid + dctHigh || 1;

  let blockH = 0, blockV = 0, nonH = 0, nonV = 0;
  for (let y = 0; y < height; y++) for (let x = 1; x < width; x++) {
    const d = Math.abs(data[y*width+x] - data[y*width+x-1]);
    if (x % 8 === 0) { blockH += d; } else nonH += d;
  }
  for (let y = 1; y < height; y++) for (let x = 0; x < width; x++) {
    const d = Math.abs(data[y*width+x] - data[(y-1)*width+x]);
    if (y % 8 === 0) blockV += d; else nonV += d;
  }
  const hCount = Math.max(1, height * Math.floor((width-1)/8));
  const vCount = Math.max(1, width * Math.floor((height-1)/8));
  const nhCount = Math.max(1, height * (width-1) - hCount);
  const nvCount = Math.max(1, width * (height-1) - vCount);

  const tiles = [];
  for (let ty = 0; ty < TILE_GRID; ty++) for (let tx = 0; tx < TILE_GRID; tx++) {
    const x0 = Math.floor(tx * width / TILE_GRID), x1 = Math.floor((tx+1) * width / TILE_GRID);
    const y0 = Math.floor(ty * height / TILE_GRID), y1 = Math.floor((ty+1) * height / TILE_GRID);
    const vals = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(data[y*width+x]);
    let te = 0, tl = 0, tl2 = 0, cnt = 0;
    for (let y = Math.max(y0+1,1); y < Math.min(y1-1,height-1); y++) for (let x = Math.max(x0+1,1); x < Math.min(x1-1,width-1); x++) {
      const p=y*width+x;
      const gx=-data[p-width-1]+data[p-width+1]-2*data[p-1]+2*data[p+1]-data[p+width-1]+data[p+width+1];
      const gy=-data[p-width-1]-2*data[p-width]-data[p-width+1]+data[p+width-1]+2*data[p+width]+data[p+width+1];
      if (Math.hypot(gx,gy)/8 > 18) te++;
      const lap=data[p-1]+data[p+1]+data[p-width]+data[p+width]-4*data[p];
      tl+=lap; tl2+=lap*lap; cnt++;
    }
    const lmean=tl/Math.max(1,cnt);
    tiles.push({mean:mean(vals), std:std(vals), edgeDensity:te/Math.max(1,cnt), lapVar:Math.max(0,tl2/Math.max(1,cnt)-lmean*lmean)});
  }

  return {
    luminanceMean: m,
    luminanceStd: Math.sqrt(s2 / Math.max(1,n)),
    entropy: entropyFromHistogram(hist,n),
    edgeDensity: edgeCount / gradN,
    meanGradient: gradSum / gradN,
    laplacianVariance: lapVar,
    darkPixelRatio: dark / Math.max(1,n),
    brightPixelRatio: bright / Math.max(1,n),
    dctLowEnergy: dctLow / Math.max(1,dctCount),
    dctMidEnergy: dctMid / Math.max(1,dctCount),
    dctHighEnergy: dctHigh / Math.max(1,dctCount),
    dctHighRatio: dctHigh / dctTotal,
    blockinessHorizontal: (blockH / hCount) / Math.max(0.0001, nonH / nhCount),
    blockinessVertical: (blockV / vCount) / Math.max(0.0001, nonV / nvCount),
    tiles,
  };
}

export async function extractMathematicalFingerprint(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : await fs.readFile(input);
  const meta = await sharp(buffer).metadata();
  // V1.6.3: global raster comparison must be scale/aspect invariant.
  // The previous fit:'fill' stretched documents with different source ratios
  // (e.g. QNB 673x461 vs 884x1280), creating artificial cell differences.
  // Keep aspect ratio and letterbox both rasters into the same analysis canvas.
  const globalSize = options.size || DEFAULT_SIZE;
  const rotatedBuffer = await sharp(buffer).rotate().grayscale().raw().toBuffer({ resolveWithObject: true });
  const globalBackground = borderMedian(rotatedBuffer.data, rotatedBuffer.info.width, rotatedBuffer.info.height);
  const globalNormalized = letterboxGrayRaw(
    rotatedBuffer.data,
    rotatedBuffer.info.width,
    rotatedBuffer.info.height,
    globalSize,
    globalSize,
    globalBackground
  );
  const raster = rasterFeatures(globalNormalized.data, globalNormalized.width, globalNormalized.height);
  const semanticRois = buildSemanticRois(options.regions || {});
  const roi16x16 = {};
  let roiBuffer = null;
  if (Object.keys(semanticRois).length) {
    try {
      roiBuffer = await sharp(buffer).rotate().grayscale().raw().toBuffer({ resolveWithObject: true });
    } catch (e) {
      roiBuffer = null;
    }
  }
  for (const [name, region] of Object.entries(semanticRois)) {
    const box = normalizeRegionBox(region, meta.width || 0, meta.height || 0);
    if (!box || !roiBuffer) continue;
    // Crop the semantic ROI from the native raster, then normalize that ROI to a
    // fixed canvas before its 16x16 grid is computed. This keeps ROI geometry
    // independent from the document's native resolution.
    try {
      const crop = cropRaw(roiBuffer.data, roiBuffer.info.width, roiBuffer.info.height, {
        x1: box.x1 * roiBuffer.info.width / Math.max(1, meta.width || roiBuffer.info.width),
        y1: box.y1 * roiBuffer.info.height / Math.max(1, meta.height || roiBuffer.info.height),
        x2: box.x2 * roiBuffer.info.width / Math.max(1, meta.width || roiBuffer.info.width),
        y2: box.y2 * roiBuffer.info.height / Math.max(1, meta.height || roiBuffer.info.height),
      });
      if (crop) roi16x16[name] = { sourceBox: box, ...roiFingerprintFromRaster(crop.data, crop.width, crop.height) };
    } catch (e) {
      roi16x16[name] = { sourceBox: box, error: e?.message || String(e) };
    }
  }
  const qTables = meta.format === 'jpeg' ? jpegQuantizationTables(buffer) : {};
  const jpeg = meta.format === 'jpeg' ? jpegQualityEstimate(qTables) : null;
  return {
    version: VERSION,
    source: { format: meta.format || null, width: meta.width || null, height: meta.height || null, channels: meta.channels || null, space: meta.space || null, chromaSubsampling: meta.chromaSubsampling || null, isProgressive: meta.isProgressive ?? null },
    globalNormalization: {
      method: 'aspect-preserving-letterbox-v1',
      canvas: { width: globalNormalized.width, height: globalNormalized.height },
      sourceWidth: rotatedBuffer.info.width,
      sourceHeight: rotatedBuffer.info.height,
      sourceAspect: Number((rotatedBuffer.info.width / Math.max(1, rotatedBuffer.info.height)).toFixed(6)),
      scale: Number((globalNormalized.scale || 1).toFixed(8)),
      offsetX: Number(globalNormalized.offsetX || 0),
      offsetY: Number(globalNormalized.offsetY || 0),
      resizedWidth: Number(globalNormalized.resizedWidth || globalNormalized.width),
      resizedHeight: Number(globalNormalized.resizedHeight || globalNormalized.height),
      background: Number(globalBackground)
    },
    jpeg: { available: meta.format === 'jpeg', estimatedQuality: jpeg?.estimatedQuality ?? null, quantizationFitError: jpeg?.fitError ?? null, tableCount: Object.keys(qTables).length, quantizationMeans: Object.values(qTables).map(t => mean(t.values)), quantizationStds: Object.values(qTables).map(t => std(t.values)) },
    // V1.1.1: expose the semantic ROI fingerprints to the caller. The ROI
    // extraction loop above was running correctly, but this object was omitted
    // from the returned fingerprint, so analyze.js always saw roi16x16 as null.
    roi16x16,
    raster,
  };
}

const FEATURE_KEYS = [
  'luminanceMean','luminanceStd','entropy','edgeDensity','meanGradient','laplacianVariance','darkPixelRatio','brightPixelRatio',
  'dctLowEnergy','dctMidEnergy','dctHighEnergy','dctHighRatio','blockinessHorizontal','blockinessVertical',
];

function flattenFingerprint(fp) {
  const r = fp?.raster || {};
  return FEATURE_KEYS.map(k => Number(r[k]) || 0).concat([
    Number(fp?.jpeg?.estimatedQuality) || 0,
    Number(fp?.jpeg?.quantizationFitError) || 0,
    mean(fp?.jpeg?.quantizationMeans || []),
    mean(fp?.jpeg?.quantizationStds || []),
    Number(fp?.source?.width) || 0,
    Number(fp?.source?.height) || 0,
  ]);
}

function summarize(values) {
  const med = median(values), m = mean(values), s = std(values, m), md = mad(values, med);
  return { mean:m, std:s, median:med, mad:md, min:Math.min(...values), max:Math.max(...values) };
}

export function buildBaseline(samples) {
  const byKey = new Map();
  for (const sample of samples) {
    const bank = sample.bank || 'unknown';
    const family = sample.family || 'unknown';
    const key = `${bank}::${family}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(sample);
  }
  const profiles = {};
  for (const [key, rows] of byKey) {
    const bank = rows[0].bank, family = rows[0].family;
    const featureStats = {};
    for (const fk of FEATURE_KEYS) featureStats[fk] = summarize(rows.map(x => Number(x.fingerprint.raster?.[fk]) || 0));
    const jpegQuality = rows.map(x => x.fingerprint.jpeg?.estimatedQuality).filter(Number.isFinite);
    const qMean = rows.map(x => mean(x.fingerprint.jpeg?.quantizationMeans || [])).filter(Number.isFinite);
    const qStd = rows.map(x => mean(x.fingerprint.jpeg?.quantizationStds || [])).filter(Number.isFinite);
    profiles[key] = {
      bank, family, sampleCount: rows.length,
      sourceFormats: [...new Set(rows.map(x => x.fingerprint.source?.format).filter(Boolean))],
      featureStats,
      jpeg: {
        sampleCount: jpegQuality.length,
        estimatedQuality: jpegQuality.length ? summarize(jpegQuality) : null,
        quantizationMean: qMean.length ? summarize(qMean) : null,
        quantizationStd: qStd.length ? summarize(qStd) : null,
      },
      samples: rows.map(x => ({ id:x.id, source:x.source, sourceFormat:x.fingerprint.source?.format || null })),
    };
  }
  return { version:VERSION, generatedAt:new Date().toISOString(), featureKeys:FEATURE_KEYS, profiles };
}

function robustDistance(value, stat) {
  if (!stat) return 0;
  const relativeFloor = Math.max(0.5, Math.abs(Number(stat.median) || 0) * 0.05);
  const scale = Math.max(1e-6, Number(stat.mad) * 1.4826, Number(stat.std) || 0, relativeFloor);
  return Math.abs(value - Number(stat.median)) / scale;
}

export function compareFingerprint(fingerprint, profile) {
  if (!fingerprint || !profile) return { available:false, reason:'missing-input' };
  const featureDistances = {};
  let total = 0, count = 0;
  for (const fk of FEATURE_KEYS) {
    const v = Number(fingerprint.raster?.[fk]) || 0;
    const d = robustDistance(v, profile.featureStats?.[fk]);
    featureDistances[fk] = Number(d.toFixed(3));
    total += Math.min(d, 8); count++;
  }
  const q = fingerprint.jpeg?.estimatedQuality;
  if (Number.isFinite(q) && profile.jpeg?.estimatedQuality) { total += Math.min(robustDistance(q, profile.jpeg.estimatedQuality), 8); count++; }
  const qmean = mean(fingerprint.jpeg?.quantizationMeans || []);
  if (qmean && profile.jpeg?.quantizationMean) { total += Math.min(robustDistance(qmean, profile.jpeg.quantizationMean), 8); count++; }
  const score = 100 * Math.exp(-((total / Math.max(1,count)) / 2.2));
  const anomalies = Object.entries(featureDistances).filter(([,d]) => d >= 3).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([feature,distance])=>({feature,distance}));
  const sampleCount = Number(profile.sampleCount) || 0;
  const reliability = sampleCount >= 5 ? 'high' : sampleCount >= 3 ? 'medium' : sampleCount >= 1 ? 'low' : 'insufficient';
  return { available:true, profile:{bank:profile.bank,family:profile.family,sampleCount,reliability}, similarityScore:Number(score.toFixed(2)), robustDistance:Number((total/Math.max(1,count)).toFixed(3)), featureDistances, anomalies };
}

function compareMetricObjects(target, reference) {
  const keys = ['luminanceMean','luminanceStd','entropy','edgeDensity','meanGradient','laplacianVariance','dctLowEnergy','dctMidEnergy','dctHighEnergy','dctHighRatio','blockinessHorizontal','blockinessVertical'];
  const out = {};
  let sum = 0, n = 0;
  for (const key of keys) {
    const a = Number(target?.[key]), b = Number(reference?.[key]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const scale = Math.max(Math.abs(b) * 0.05, 0.5);
    const d = Math.abs(a - b) / scale;
    out[key] = Number(d.toFixed(3));
    sum += Math.min(d, 10); n++;
  }
  return { metricDistances: out, meanDistance: Number((sum / Math.max(1,n)).toFixed(3)) };
}


function normalizedBox(box, width, height) {
  if (!box || !Number.isFinite(Number(width)) || !Number.isFinite(Number(height)) || width <= 0 || height <= 0) return null;
  const x1 = clamp(Number(box.x1), 0, width);
  const y1 = clamp(Number(box.y1), 0, height);
  const x2 = clamp(Number(box.x2), 0, width);
  const y2 = clamp(Number(box.y2), 0, height);
  if (!(x2 > x1 && y2 > y1)) return null;
  return { x1: x1 / width, y1: y1 / height, x2: x2 / width, y2: y2 / height };
}

function cellOverlapRatio(cell, box, grid = 16) {
  if (!cell || !box) return 0;
  const x1 = (cell.col - 1) / grid, y1 = (cell.row - 1) / grid;
  const x2 = cell.col / grid, y2 = cell.row / grid;
  const ix1 = Math.max(x1, box.x1), iy1 = Math.max(y1, box.y1);
  const ix2 = Math.min(x2, box.x2), iy2 = Math.min(y2, box.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const area = Math.max(1e-9, (x2 - x1) * (y2 - y1));
  return inter / area;
}

export function compareGlobal16x16(targetFingerprint, referenceFingerprint, criticalRois = {}, options = {}) {
  const targetTiles = Array.isArray(targetFingerprint?.raster?.tiles) ? targetFingerprint.raster.tiles : [];
  const referenceTiles = Array.isArray(referenceFingerprint?.raster?.tiles) ? referenceFingerprint.raster.tiles : [];
  const count = Math.min(targetTiles.length, referenceTiles.length, 256);
  if (!count) return { available:false, reason:'global-tiles-missing', grid:'16x16', cellCount:0 };

  const grid = 16;
  const differentThreshold = Number.isFinite(Number(options.differentThreshold)) ? Number(options.differentThreshold) : 3.5;
  const strongThreshold = Number.isFinite(Number(options.strongThreshold)) ? Number(options.strongThreshold) : 5;
  const minOverlap = Number.isFinite(Number(options.minOverlap)) ? Number(options.minOverlap) : 0.20;
  const cells = [];
  for (let i = 0; i < count; i++) {
    const a = targetTiles[i], b = referenceTiles[i];
    const lapScale = Math.max(Math.abs(Number(b?.lapVar) || 0) * 0.05, 0.5);
    const edgeScale = Math.max(Math.abs(Number(b?.edgeDensity) || 0) * 0.05, 0.005);
    const stdScale = Math.max(Math.abs(Number(b?.std) || 0) * 0.05, 0.5);
    const lap = Math.abs((Number(a?.lapVar)||0)-(Number(b?.lapVar)||0))/lapScale;
    const edge = Math.abs((Number(a?.edgeDensity)||0)-(Number(b?.edgeDensity)||0))/edgeScale;
    const sd = Math.abs((Number(a?.std)||0)-(Number(b?.std)||0))/stdScale;
    const distance = (Math.min(lap,10)+Math.min(edge,10)+Math.min(sd,10))/3;
    cells.push({ index:i, row:Math.floor(i/grid)+1, col:(i%grid)+1, laplacianDistance:Number(lap.toFixed(3)), edgeDistance:Number(edge.toFixed(3)), stdDistance:Number(sd.toFixed(3)), distance:Number(distance.toFixed(3)), different:distance >= differentThreshold, strong:distance >= strongThreshold });
  }

  const differentCells = cells.filter(c => c.different);
  const strongCells = cells.filter(c => c.strong);
  const roiHits = {};
  for (const [field, roi] of Object.entries(criticalRois || {})) {
    const targetBox = roi?.target || roi?.targetSourceBox || roi;
    const normalizedSource = normalizedBox(targetBox, targetFingerprint?.source?.width, targetFingerprint?.source?.height);
    if (!normalizedSource) { roiHits[field] = { available:false, reason:'target-roi-box-missing' }; continue; }
    // Global tiles live on the aspect-preserving letterboxed canvas, not the
    // native source canvas. Map the native ROI into that canvas before testing
    // cell overlap, otherwise the new normalization would break semantic ROI
    // attribution.
    const gn = targetFingerprint?.globalNormalization;
    const canvasW = Number(gn?.canvas?.width) || grid;
    const canvasH = Number(gn?.canvas?.height) || grid;
    const scale = Number(gn?.scale);
    const ox = Number(gn?.offsetX);
    const oy = Number(gn?.offsetY);
    const srcW = Number(targetFingerprint?.source?.width) || 0;
    const srcH = Number(targetFingerprint?.source?.height) || 0;
    const mapped = Number.isFinite(scale) && scale > 0 && srcW > 0 && srcH > 0
      ? {
          x1: (ox + normalizedSource.x1 * srcW * scale) / canvasW,
          y1: (oy + normalizedSource.y1 * srcH * scale) / canvasH,
          x2: (ox + normalizedSource.x2 * srcW * scale) / canvasW,
          y2: (oy + normalizedSource.y2 * srcH * scale) / canvasH
        }
      : normalizedSource;
    const normalized = mapped;
    const hits = cells.filter(cell => cellOverlapRatio(cell, normalized, grid) >= minOverlap);
    const diffHits = hits.filter(c => c.different);
    const strongHits = hits.filter(c => c.strong);
    roiHits[field] = {
      available:true,
      normalizedBox: normalized,
      sourceNormalizedBox: normalizedSource,
      overlappingCells: hits.map(c=>c.index),
      differentCells: diffHits.map(c=>c.index),
      strongDifferentCells: strongHits.map(c=>c.index),
      overlapCount:hits.length,
      differentCount:diffHits.length,
      strongDifferentCount:strongHits.length,
      maxDistance: hits.length ? Number(Math.max(...hits.map(c=>c.distance)).toFixed(3)) : 0,
      meanDistance: hits.length ? Number((hits.reduce((s,c)=>s+c.distance,0)/hits.length).toFixed(3)) : 0,
    };
  }

  return {
    available:true,
    grid:'16x16',
    cellCount:count,
    thresholds:{differentThreshold,strongThreshold,minOverlap},
    similarCount: count - differentCells.length,
    differentCount: differentCells.length,
    strongDifferentCount: strongCells.length,
    similarityRatio: Number(((count - differentCells.length) / count).toFixed(4)),
    cells,
    topDifferentCells:[...differentCells].sort((a,b)=>b.distance-a.distance).slice(0,12),
    criticalRoiHits: roiHits,
  };
}

export function compare16x16Rois(targetFingerprint, referenceFingerprint, roiNames = ['amount','recipientName','recipientIban']) {
  const result = {};
  for (const name of roiNames) {
    const t = targetFingerprint?.roi16x16?.[name];
    const r = referenceFingerprint?.roi16x16?.[name];
    if (!t?.metrics || !r?.metrics) {
      result[name] = { available: false, reason: 'roi-missing-on-one-side' };
      continue;
    }
    const metric = compareMetricObjects(t.metrics, r.metrics);
    const targetTiles = Array.isArray(t.tiles16x16) ? t.tiles16x16 : [];
    const referenceTiles = Array.isArray(r.tiles16x16) ? r.tiles16x16 : [];
    const cells = [];
    const count = Math.min(targetTiles.length, referenceTiles.length, 256);
    for (let i = 0; i < count; i++) {
      const a = targetTiles[i], b = referenceTiles[i];
      const lapScale = Math.max(Math.abs(Number(b?.lapVar) || 0) * 0.05, 0.5);
      const edgeScale = Math.max(Math.abs(Number(b?.edgeDensity) || 0) * 0.05, 0.005);
      const stdScale = Math.max(Math.abs(Number(b?.std) || 0) * 0.05, 0.5);
      const lap = Math.abs((Number(a?.lapVar)||0)-(Number(b?.lapVar)||0))/lapScale;
      const edge = Math.abs((Number(a?.edgeDensity)||0)-(Number(b?.edgeDensity)||0))/edgeScale;
      const sd = Math.abs((Number(a?.std)||0)-(Number(b?.std)||0))/stdScale;
      const distance = (Math.min(lap,10)+Math.min(edge,10)+Math.min(sd,10))/3;
      cells.push({ index:i, row:Math.floor(i/16)+1, col:(i%16)+1, laplacianDistance:Number(lap.toFixed(3)), edgeDistance:Number(edge.toFixed(3)), stdDistance:Number(sd.toFixed(3)), distance:Number(distance.toFixed(3)) });
    }
    cells.sort((a,b)=>b.distance-a.distance);
    const ta = t.alignment || {};
    const ra = r.alignment || {};
    const safeLogRatio = (a, b) => {
      const x = Number(a), y = Number(b);
      return Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 ? Math.abs(Math.log(x / y)) : null;
    };
    result[name] = {
      available: true,
      meanDistance: metric.meanDistance,
      metricDistances: metric.metricDistances,
      maxCellDistance: cells[0]?.distance || 0,
      topCells: cells.slice(0, 8),
      targetSourceBox: t.sourceBox || null,
      referenceSourceBox: r.sourceBox || null,
      normalization: t.normalization || r.normalization || null,
      alignment: {
        target: ta,
        reference: ra,
        contentAspectDistance: safeLogRatio(ta.contentAspect, ra.contentAspect),
        contentScaleRelation: safeLogRatio(ta.scale, ra.scale),
      },
      rawMetricDistances: compareMetricObjects(t.rawMetrics, r.rawMetrics).metricDistances,
      grid: '16x16',
      cellCount: cells.length,
    };
  }
  return result;
}


export function compareSemanticRoiToNegativePopulation(targetFingerprint, negativeFingerprints, roiNames = ['amount','recipientName','recipientIban'], referenceFingerprint = null) {
  const result = {};
  for (const name of roiNames) {
    const target = targetFingerprint?.roi16x16?.[name];
    if (!target?.metrics) {
      result[name] = { available:false, reason:'target-roi-missing' };
      continue;
    }
    const rows = [];
    for (const item of (Array.isArray(negativeFingerprints) ? negativeFingerprints : [])) {
      const fp = item?.fingerprint || item;
      const neg = fp?.roi16x16?.[name];
      if (!neg?.metrics) continue;
      const compared = compare16x16Rois(targetFingerprint, fp, [name])[name];
      if (!compared?.available) continue;
      const targetMetrics = target?.metrics || {};
      const negativeMetrics = neg?.metrics || {};
      const referenceMetrics = referenceFingerprint?.roi16x16?.[name]?.metrics || {};
      const patternMetrics = {};
      const metricKeys = ['luminanceMean','luminanceStd','entropy','edgeDensity','meanGradient','laplacianVariance','dctLowEnergy','dctMidEnergy','dctHighEnergy','dctHighRatio','blockinessHorizontal','blockinessVertical'];
      for (const key of metricKeys) {
        const tv = Number(targetMetrics[key]);
        const nv = Number(negativeMetrics[key]);
        const rv = Number(referenceMetrics[key]);
        if (![tv,nv,rv].every(Number.isFinite)) continue;
        const scale = Math.max(Math.abs(rv) * 0.05, 0.5);
        const targetShift = (tv - rv) / scale;
        const negativeShift = (nv - rv) / scale;
        const sameDirection = Math.abs(targetShift) >= 0.75 && Math.sign(targetShift) === Math.sign(negativeShift);
        const closeToTarget = Math.abs(tv - nv) / scale <= Math.max(0.75, Math.abs(targetShift) * 0.45);
        patternMetrics[key] = {
          targetShift: Number(targetShift.toFixed(3)),
          negativeShift: Number(negativeShift.toFixed(3)),
          sameDirection,
          closeToTarget,
          match: Boolean(sameDirection && closeToTarget)
        };
      }
      rows.push({
        sample: item?.fileName || item?.source || item?.path || null,
        meanDistance: Number(compared.meanDistance || 0),
        maxCellDistance: Number(compared.maxCellDistance || 0),
        metricDistances: compared.metricDistances || {},
        rawMetricDistances: compared.rawMetricDistances || {},
        patternMetrics,
        patternMetricKeys: Object.keys(patternMetrics).filter(k => patternMetrics[k]?.match),
      });
    }
    if (!rows.length) {
      result[name] = { available:false, reason:'negative-roi-unavailable', sampleCount:0 };
      continue;
    }
    const distances = rows.map(x => x.meanDistance).filter(Number.isFinite).sort((a,b)=>a-b);
    const medianDistance = median(distances);
    const meanDistance = mean(distances);
    const best = rows.slice().sort((a,b)=>a.meanDistance-b.meanDistance)[0];
    const metricAgreement = {};
    for (const row of rows) {
      for (const key of (row.patternMetricKeys || [])) metricAgreement[key] = (metricAgreement[key] || 0) + 1;
    }
    const policy = getAdaptiveNegativePopulationPolicy(rows.length);
    const agreedPatternMetrics = Object.entries(metricAgreement)
      .filter(([,count]) => count >= Math.min(policy.minAgreementCount, rows.length))
      .sort((a,b)=>b[1]-a[1])
      .map(([key,count]) => ({key,count}));
    const patternAgreementCount = rows.filter(r => (r.patternMetricKeys || []).length >= 2).length;
    const localPatternCorroborated = Boolean(
      agreedPatternMetrics.length >= 2 &&
      patternAgreementCount >= policy.minAgreementCount
    );
    result[name] = {
      available:true,
      sampleCount:rows.length,
      meanDistance:Number(meanDistance.toFixed(3)),
      medianDistance:Number(medianDistance.toFixed(3)),
      bestDistance:Number(best.meanDistance.toFixed(3)),
      bestSample:best.sample,
      samples:rows,
      adaptivePolicy: policy,
      agreedPatternMetrics,
      patternAgreementCount,
      localPatternCorroborated,
      finalPromotionAllowed: Boolean(localPatternCorroborated && policy.finalPromotionAllowed && !policy.advisoryOnly),
      // Positive means the target is mathematically closer to the negative
      // population than to the trusted reference ROI.
      referenceDistance:null,
      negativeAffinityDelta:null,
      // Diagnostic only: a negative population match is meaningful only when
      // it is localized to this semantic ROI and materially beats the trusted
      // reference distance. Global negative similarity is never inferred here.
      evidenceType:'localized-semantic-population',
    };
  }
  return result;
}

export function compareAgainstBaseline(fingerprint, baseline, bank, family='unknown') {
  if (!baseline?.profiles) return { available:false, reason:'baseline-missing' };
  const candidates = Object.values(baseline.profiles).filter(p => p.bank === bank);
  if (!candidates.length) return { available:false, reason:'bank-profile-missing', bank };
  const exact = candidates.find(p => p.family === family);
  const pool = exact ? [exact, ...candidates.filter(p => p !== exact)] : candidates;
  const comparisons = pool.map(p => ({...compareFingerprint(fingerprint,p), family:p.family})).filter(x=>x.available);
  comparisons.sort((a,b)=>b.similarityScore-a.similarityScore);
  const best = comparisons[0] || null;
  return { available:Boolean(best), bank, requestedFamily:family, bestMatch:best, candidates:comparisons.slice(0,8), profileCount:candidates.length };
}

export function inferDocumentFamily(name='', text='') {
  const s = `${name} ${text}`.toLocaleLowerCase('tr-TR');
  if (/hesap[-_ ]?hareket|hesap[-_ ]?ozeti/.test(s)) return 'ACCOUNT_STATEMENT';
  if (/nakit avans|kk1|kredi kart/.test(s)) return 'CREDIT_CARD';
  if (/havale|hvl/.test(s)) return 'HAVALE';
  if (/fast/.test(s)) return 'FAST';
  if (/eft/.test(s)) return 'EFT';
  if (/e[- ]?dekont|dekont/.test(s)) return 'DEKONT';
  return 'UNKNOWN';
}


/**
 * Adaptive known-negative population policy.
 * 0 samples: no negative-population evidence.
 * 1 sample: only very strong local agreement; advisory only.
 * 2 samples: require agreement across both samples; limited confidence.
 * 3+ samples: standard population comparison.
 */
export function getAdaptiveNegativePopulationPolicy(sampleCount) {
  const n = Math.max(0, Number(sampleCount) || 0);
  if (n <= 0) {
    return {
      sampleCount: 0,
      available: false,
      confidence: "insufficient",
      minStrongFields: Infinity,
      minAgreementCount: Infinity,
      maxAllowedDistance: null,
      finalPromotionAllowed: false,
    };
  }
  if (n === 1) {
    return {
      sampleCount: 1,
      available: true,
      confidence: "very-low",
      minStrongFields: 1,
      minAgreementCount: 1,
      maxAllowedDistance: 0.90,
      finalPromotionAllowed: false,
      advisoryOnly: true,
    };
  }
  if (n === 2) {
    return {
      sampleCount: 2,
      available: true,
      confidence: "low",
      minStrongFields: 1,
      minAgreementCount: 2,
      maxAllowedDistance: 0.95,
      finalPromotionAllowed: true,
      cappedPromotion: true,
    };
  }
  return {
    sampleCount: n,
    available: true,
    confidence: n >= 5 ? "high" : "medium",
    minStrongFields: 1,
    minAgreementCount: Math.max(1, Math.min(2, n)),
    maxAllowedDistance: 1.0,
    finalPromotionAllowed: true,
    advisoryOnly: false,
  };
}
