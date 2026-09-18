import fs from "fs/promises";
import path from "path";
import { inflateSync } from "zlib";

// =====================================================
// VERIFYDOC FONT FORENSICS v3
// =====================================================
// v2 fixes a critical limitation of v1:
// PDF.js item.fontName can be an internal resource name (for example g_d3_f3)
// and a simple /BaseFont regex misses names stored inside compressed/object
// streams. v2 therefore uses four evidence layers:
//   1) PDF.js text items + commonObjs
//   2) raw PDF dictionaries
//   3) FlateDecode/object-stream decompression
//   4) embedded font binary name tables (TrueType/OpenType/CFF/Type1)
//
// The module reports font evidence only. It does not decide authenticity.

const FONT_STYLE_PATTERNS = [
  ["black", /(?:black|heavy|ultrablack|900)$/i],
  ["bold", /(?:bold|semibold|demibold|demi|mediumbold|700)$/i],
  ["medium", /(?:medium|500)$/i],
  ["light", /(?:light|thin|300)$/i],
  ["italic", /(?:italic|oblique)$/i],
  ["regular", /(?:regular|roman|normal|book|plain)$/i],
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeFontName(value) {
  let s = clean(value);
  if (!s) return null;
  s = s.replace(/^\//, "");
  // PDF name hex escapes (e.g. #2B = "+") must be decoded before
  // removing the six-letter subset prefix.
  s = s.replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // PDF subset prefix: ABCDEF+FontName
  s = s.replace(/^[A-Z]{3,8}\+/i, "");
  s = s.replace(/\s+/g, "");
  if (!s || /^Identity(?:-H|-V)?$/i.test(s)) return null;
  return s;
}

function fontFamily(value) {
  const n = normalizeFontName(value);
  if (!n) return null;
  return n
    .replace(/[-_](?:Bold|Black|Roman|Regular|Book|Medium|Light|Thin|Italic|Oblique|Semibold|DemiBold|Heavy|Normal|Plain)(?:MT|PS|PSMT)?$/i, "")
    .replace(/(?:Bold|Black|Roman|Regular|Book|Medium|Light|Thin|Italic|Oblique|Semibold|DemiBold|Heavy|Normal|Plain)(?:MT|PS|PSMT)?$/i, "")
    .replace(/(?:MT|PSMT)$/i, "") || n;
}

function fontStyle(value) {
  const n = normalizeFontName(value);
  if (!n) return "unknown";
  for (const [style, re] of FONT_STYLE_PATTERNS) {
    if (re.test(n)) return style;
  }
  if (/(?:BoldMT|BoldPSMT)$/i.test(n)) return "bold";
  if (/(?:Roman|Regular|Book|Normal|Plain)(?:MT|PSMT)?$/i.test(n)) return "regular";
  if (/PSMT$/i.test(n)) return "regular";
  return "unknown";
}

function normalizeLabel(value) {
  return clean(value)
    .toLocaleUpperCase("tr-TR")
    .replace(/[İIı]/g, "I")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ş/g, "S")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function isUsefulFontName(value) {
  const n = normalizeFontName(value);
  if (!n || n.length < 2 || n.length > 180) return false;
  if (/^(unknown|none|null|undefined|g_d\d+_f\d+|font\d+)$/i.test(n)) return false;
  if (/^(Identity|ArialMT|TimesNewRomanPSMT|Helvetica|Courier)$/i.test(n)) return true;
  return /[A-Za-z]/.test(n);
}

function makeFontRecord(name, source, extra = {}) {
  const n = normalizeFontName(name);
  if (!isUsefulFontName(n)) return null;
  return {
    key: `${fontFamily(n) || n}|${fontStyle(n)}`,
    fontName: n,
    family: fontFamily(n) || n,
    style: fontStyle(n),
    rawFontNames: [n],
    pdfFontFamilies: [fontFamily(n) || n],
    itemCount: 0,
    charCount: 0,
    pages: [],
    embedded: null,
    source,
    ...extra,
  };
}

function addName(set, name) {
  const n = normalizeFontName(name);
  if (isUsefulFontName(n)) set.add(n);
}

// -----------------------------------------------------
// PDF raw + compressed stream extraction
// -----------------------------------------------------
function scanFontTokens(text, names) {
  if (!text) return;
  const source = String(text);
  const patterns = [
    /\/BaseFont\s*\/([A-Za-z0-9._+\-#]+)/g,
    /\/FontName\s*\/([A-Za-z0-9._+\-#]+)/g,
    /\/Family\s*\/([A-Za-z0-9._+\-#]+)/g,
    /\/Substitute\s*\/([A-Za-z0-9._+\-#]+)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source))) addName(names, m[1]);
  }
}

function parsePdfFilterNames(dictionary) {
  const m = String(dictionary || '').match(/\/Filter\s+(\[[^\]]+\]|\/[^\s<>\[\]]+)/i);
  if (!m) return [];
  const raw = m[1];
  const names = [];
  const re = /\/([A-Za-z0-9]+)/g;
  let x;
  while ((x = re.exec(raw))) names.push(x[1]);
  return names;
}

function findPdfStreams(buffer) {
  const streams = [];
  const ascii = buffer.toString('latin1');
  let pos = 0;
  while (true) {
    const start = ascii.indexOf('stream', pos);
    if (start < 0) break;

    // Only accept the PDF stream keyword, not occurrences inside arbitrary text.
    const before = start > 0 ? ascii[start - 1] : '';
    const afterChar = ascii[start + 6] || '';
    if ((before && !/[\s\r\n]/.test(before)) || (afterChar && !/[\s\r\n]/.test(afterChar))) {
      pos = start + 6;
      continue;
    }

    const headerStart = Math.max(0, ascii.lastIndexOf('obj', start));
    const dictStart = ascii.lastIndexOf('<<', start);
    const dictEnd = ascii.lastIndexOf('>>', start);
    if (dictStart < headerStart || dictEnd < dictStart) {
      pos = start + 6;
      continue;
    }

    let dataStart = start + 6;
    if (ascii.startsWith('\r\n', dataStart)) dataStart += 2;
    else if (ascii.startsWith('\n', dataStart)) dataStart += 1;

    // Prefer /Length when it is a literal integer. This avoids accidentally
    // stopping at the byte sequence "endstream" inside compressed data.
    const dictionary = ascii.slice(dictStart, dictEnd + 2);
    let dataEnd = -1;
    const lenMatch = dictionary.match(/\/Length\s+(\d+)/i);
    if (lenMatch) {
      const length = Number(lenMatch[1]);
      if (Number.isSafeInteger(length) && length >= 0 && dataStart + length <= buffer.length) {
        dataEnd = dataStart + length;
      }
    }
    if (dataEnd < 0) {
      dataEnd = ascii.indexOf('endstream', dataStart);
      if (dataEnd < 0) break;
    }

    streams.push({
      dataStart,
      dataEnd,
      dictionary,
      filters: parsePdfFilterNames(dictionary),
    });
    pos = Math.max(dataEnd + 1, start + 6);
  }
  return streams;
}

function asciiHexDecode(data) {
  const src = Buffer.from(data || []).toString('latin1').replace(/\s+/g, '');
  const end = src.indexOf('>');
  const body = (end >= 0 ? src.slice(0, end) : src).replace(/[^0-9A-Fa-f]/g, '');
  const even = body.length % 2 ? body + '0' : body;
  try { return Buffer.from(even, 'hex'); } catch { return null; }
}

function ascii85Decode(data) {
  const src = Buffer.from(data || []).toString('latin1').replace(/\s+/g, '');
  let text = src;
  if (text.startsWith('<~')) text = text.slice(2);
  const end = text.indexOf('~>');
  if (end >= 0) text = text.slice(0, end);
  const out = [];
  let group = [];
  const flush = (g, partial = false) => {
    if (!g.length) return;
    const originalLen = g.length;
    while (g.length < 5) g.push('u');
    let value = 0;
    for (const ch of g) value = value * 85 + (ch === 'z' ? 0 : ch.charCodeAt(0) - 33);
    const bytes = [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
    const take = partial ? Math.max(0, originalLen - 1) : 4;
    for (let i = 0; i < take; i++) out.push(bytes[i]);
  };
  for (const ch of text) {
    if (ch === 'z' && group.length === 0) {
      out.push(0,0,0,0);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 117) continue;
    group.push(ch);
    if (group.length === 5) { flush(group); group = []; }
  }
  if (group.length) flush(group, true);
  return Buffer.from(out);
}

function decodePdfStream(data, filters = []) {
  let current = Buffer.from(data || []);
  for (const filter of filters) {
    const f = String(filter || '').toLowerCase();
    try {
      if (f === 'flatedecode' || f === 'fl') current = inflateSync(current);
      else if (f === 'asciihexdecode' || f === 'ahx') current = asciiHexDecode(current) || current;
      else if (f === 'ascii85decode' || f === 'a85') current = ascii85Decode(current);
      else return null;
    } catch {
      return null;
    }
  }
  return current;
}

async function extractRawPdfFontNames(pdfPath) {
  const names = new Set();
  try {
    const buf = await fs.readFile(pdfPath);
    if (!buf?.length) return [];
    const latin = buf.toString('latin1');
    scanFontTokens(latin, names);

    // Scan every PDF stream using its declared filter chain. This catches
    // font dictionaries stored inside compressed /ObjStm objects, which a
    // plain byte regex cannot see.
    for (const stream of findPdfStreams(buf)) {
      const raw = buf.subarray(stream.dataStart, stream.dataEnd);
      const decoded = stream.filters?.length ? decodePdfStream(raw, stream.filters) : raw;
      if (!decoded) continue;
      scanFontTokens(decoded.toString('latin1'), names);
    }
  } catch (error) {
    console.warn('RAW PDF FONT EXTRACTION HATASI:', path.basename(pdfPath), error?.message || error);
  }
  return [...names];
}


// -----------------------------------------------------
// PDF indirect-object graph font extraction (v3.1)
// -----------------------------------------------------
// v3.1 keeps v3's approach intact and adds one narrow layer for PDFs where
// /Font -> /FontDescriptor -> /FontFile references are indirect objects.
// This is intentionally deterministic: it does not rasterize the document.
function pdfIndirectRef(value) {
  const m = String(value || '').match(/(\d+)\s+(\d+)\s+R/);
  return m ? `${m[1]} ${m[2]}` : null;
}

function parsePdfIndirectObjects(buffer) {
  const objects = new Map();
  const text = Buffer.from(buffer || []).toString('latin1');
  const re = /(?:^|\r?\n|\s)(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(text))) {
    const key = `${m[1]} ${m[2]}`;
    const bodyStart = re.lastIndex;
    const end = text.indexOf('endobj', bodyStart);
    if (end < 0) break;
    const body = text.slice(bodyStart, end);
    const streamPos = body.indexOf('stream');
    let dictionary = body;
    let stream = null;
    if (streamPos >= 0) {
      dictionary = body.slice(0, streamPos);
      let dataStart = bodyStart + streamPos + 6;
      if (text.startsWith('\r\n', dataStart)) dataStart += 2;
      else if (text.startsWith('\n', dataStart)) dataStart += 1;
      const lenMatch = dictionary.match(/\/Length\s+(\d+)\s+\d+\s+R/i) || dictionary.match(/\/Length\s+(\d+)/i);
      let dataEnd = -1;
      if (lenMatch && /^\d+$/.test(lenMatch[1])) {
        const n = Number(lenMatch[1]);
        if (Number.isSafeInteger(n) && dataStart + n <= buffer.length) dataEnd = dataStart + n;
      }
      if (dataEnd < 0) {
        const localEnd = body.indexOf('endstream', streamPos + 6);
        if (localEnd >= 0) dataEnd = bodyStart + localEnd;
      }
      if (dataEnd >= 0) stream = buffer.subarray(dataStart, dataEnd);
    }
    objects.set(key, { key, objectNumber:Number(m[1]), generation:Number(m[2]), dictionary, stream });
    re.lastIndex = end + 6;
  }
  return objects;
}

function pdfDictRef(dictionary, key) {
  const re = new RegExp(`\\/${key}\\s+(\\d+)\\s+(\\d+)\\s+R`, 'i');
  const m = String(dictionary || '').match(re);
  return m ? `${m[1]} ${m[2]}` : null;
}

function pdfDictName(dictionary, key) {
  const re = new RegExp(`\\/${key}\\s+\\/([A-Za-z0-9._+#-]+)`, 'i');
  const m = String(dictionary || '').match(re);
  return m ? m[1] : null;
}

function pdfDictRefsInMap(dictionary) {
  const out = new Map();
  const re = /\/(F\d+|[A-Za-z][A-Za-z0-9._-]*)\s+(\d+)\s+(\d+)\s+R/g;
  let m;
  while ((m = re.exec(String(dictionary || '')))) out.set(m[1], `${m[2]} ${m[3]}`);
  return out;
}

function parsePdfObjectStreams(objects) {
  const embedded = new Map(objects);
  for (const obj of objects.values()) {
    if (!/\/Type\s+\/ObjStm\b/i.test(obj.dictionary) || !obj.stream) continue;
    const filters = parsePdfFilterNames(obj.dictionary);
    const decoded = filters.length ? decodePdfStream(obj.stream, filters) : obj.stream;
    if (!decoded) continue;
    const nMatch = obj.dictionary.match(/\/N\s+(\d+)/i);
    const firstMatch = obj.dictionary.match(/\/First\s+(\d+)/i);
    if (!nMatch || !firstMatch) continue;
    const n = Number(nMatch[1]);
    const first = Number(firstMatch[1]);
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(first) || n <= 0 || first < 0 || first >= decoded.length) continue;
    const head = decoded.subarray(0, first).toString('latin1').trim().split(/\s+/);
    if (head.length < n * 2) continue;
    for (let i = 0; i < n; i++) {
      const objNum = Number(head[i * 2]);
      const offset = Number(head[i * 2 + 1]);
      const nextOffset = i + 1 < n ? Number(head[(i + 1) * 2 + 1]) : decoded.length - first;
      if (!Number.isInteger(objNum) || !Number.isInteger(offset) || !Number.isInteger(nextOffset) || offset < 0 || nextOffset <= offset) continue;
      const a = first + offset;
      const b = Math.min(decoded.length, first + nextOffset);
      if (a >= b || a >= decoded.length) continue;
      embedded.set(`${objNum} 0`, { key:`${objNum} 0`, objectNumber:objNum, generation:0, dictionary:decoded.subarray(a,b).toString('latin1'), stream:null, fromObjectStream:obj.key });
    }
  }
  return embedded;
}

function extractPdfObjectGraphFontNamesFromBuffer(buffer) {
  const names = new Set();
  const descriptorNames = new Set();
  const embeddedFontFiles = new Set();
  const objects = parsePdfObjectStreams(parsePdfIndirectObjects(buffer));
  const visited = new Set();
  const add = (value, target = names) => addName(target, value);

  const inspectFont = (fontRef, depth = 0) => {
    if (!fontRef || depth > 8 || visited.has(`font:${fontRef}`)) return;
    visited.add(`font:${fontRef}`);
    const font = objects.get(fontRef);
    if (!font) return;
    add(pdfDictName(font.dictionary, 'BaseFont'));
    const descRef = pdfDictRef(font.dictionary, 'FontDescriptor');
    if (descRef) inspectDescriptor(descRef, depth + 1);
    const descendants = pdfDictRef(font.dictionary, 'DescendantFonts');
    if (descendants) {
      const dObj = objects.get(descendants);
      if (dObj) {
        const refs = [...dObj.dictionary.matchAll(/(\d+)\s+(\d+)\s+R/g)].map(x => `${x[1]} ${x[2]}`);
        for (const r of refs.slice(0, 8)) inspectFont(r, depth + 1);
      }
    }
  };

  const inspectDescriptor = (ref, depth = 0) => {
    if (!ref || depth > 8 || visited.has(`desc:${ref}`)) return;
    visited.add(`desc:${ref}`);
    const desc = objects.get(ref);
    if (!desc) return;
    const fontName = pdfDictName(desc.dictionary, 'FontName');
    if (fontName) { add(fontName, names); add(fontName, descriptorNames); }
    const fileKeys = ['FontFile','FontFile2','FontFile3'];
    for (const key of fileKeys) {
      const fileRef = pdfDictRef(desc.dictionary, key);
      if (!fileRef) continue;
      embeddedFontFiles.add(fileRef);
      const fileObj = objects.get(fileRef);
      if (!fileObj?.stream) continue;
      const filters = parsePdfFilterNames(fileObj.dictionary);
      const decoded = filters.length ? decodePdfStream(fileObj.stream, filters) : fileObj.stream;
      if (!decoded) continue;
      for (const n of parseSfntNames(decoded)) add(n, names);
      for (const n of parseCffNames(decoded)) add(n, names);
      for (const n of parseType1Names(decoded)) add(n, names);
    }
  };

  // Inspect page resource dictionaries. Page-tree inheritance is handled by
  // also examining any object with /Font or /Resources containing /Font refs.
  for (const obj of objects.values()) {
    const resourceRef = pdfDictRef(obj.dictionary, 'Resources');
    const resources = resourceRef && objects.get(resourceRef) ? objects.get(resourceRef) : obj;
    const fontRef = resources ? pdfDictRef(resources.dictionary, 'Font') : null;
    if (fontRef) {
      const fontObj = objects.get(fontRef);
      if (fontObj) {
        const refs = pdfDictRefsInMap(fontObj.dictionary);
        for (const ref of refs.values()) inspectFont(ref);
      }
    }
    if (/\/Type\s+\/Font\b/i.test(obj.dictionary)) {
      inspectFont(obj.key);
    }
  }

  return {
    names:[...names],
    descriptorNames:[...descriptorNames],
    embeddedFontFiles:[...embeddedFontFiles],
    objectCount:objects.size,
  };
}

async function extractPdfObjectGraphFontNames(pdfPath) {
  try {
    const buffer = await fs.readFile(pdfPath);
    return extractPdfObjectGraphFontNamesFromBuffer(buffer);
  } catch (error) {
    console.warn('PDF OBJECT GRAPH FONT EXTRACTION HATASI:', path.basename(pdfPath), error?.message || error);
    return { names:[], descriptorNames:[], embeddedFontFiles:[], objectCount:0 };
  }
}

// -----------------------------------------------------
// Embedded font binary name extraction
// -----------------------------------------------------
function decodeUtf16BE(buf) {
  if (!buf || buf.length < 2) return "";
  let out = "";
  for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
  return out.replace(/\0/g, "").trim();
}

function decodeMacRomanLoose(buf) {
  // Font names are overwhelmingly ASCII/Latin in bank PDFs. Keep bytes intact
  // for ASCII and replace unsupported high bytes rather than inventing names.
  let out = "";
  for (const b of buf || []) out += b < 128 ? String.fromCharCode(b) : "?";
  return out.replace(/\0/g, "").trim();
}

function parseSfntNames(data) {
  const buf = Buffer.from(data || []);
  if (buf.length < 12) return [];
  const tag = buf.toString("ascii", 0, 4);
  const isSfnt = tag === "\0\x01\0\0" || tag === "OTTO" || tag === "true" || tag === "typ1";
  if (!isSfnt) return [];
  const names = new Set();
  try {
    const numTables = buf.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      if (off + 16 > buf.length) break;
      const tableTag = buf.toString("ascii", off, off + 4);
      const tableOffset = buf.readUInt32BE(off + 8);
      const tableLength = buf.readUInt32BE(off + 12);
      if (tableTag !== "name" || tableOffset + tableLength > buf.length || tableLength < 6) continue;
      const p = tableOffset;
      const count = buf.readUInt16BE(p + 2);
      const stringOffset = buf.readUInt16BE(p + 4);
      for (let j = 0; j < count; j++) {
        const r = p + 6 + j * 12;
        if (r + 12 > buf.length) break;
        const platform = buf.readUInt16BE(r);
        const nameId = buf.readUInt16BE(r + 6);
        const len = buf.readUInt16BE(r + 8);
        const rel = buf.readUInt16BE(r + 10);
        if (![1, 2, 4, 6].includes(nameId)) continue;
        const s = p + stringOffset + rel;
        if (s < 0 || s + len > buf.length) continue;
        const raw = buf.subarray(s, s + len);
        const decoded = platform === 3 || platform === 0 ? decodeUtf16BE(raw) : decodeMacRomanLoose(raw);
        if (decoded && decoded.length < 180) addName(names, decoded);
      }
    }
  } catch {}
  return [...names];
}

function parseCffNames(data) {
  const buf = Buffer.from(data || []);
  if (buf.length < 4 || buf[0] !== 1 || (buf[1] < 0 || buf[1] > 10)) return [];
  const names = new Set();
  try {
    const headerSize = buf[2];
    let p = headerSize;
    const count = buf.readUInt16BE(p); p += 2;
    if (!count) return [];
    const offSize = buf[p++];
    if (![1,2,3,4].includes(offSize)) return [];
    const offsets = [];
    for (let i = 0; i <= count; i++) {
      let v = 0;
      for (let k = 0; k < offSize; k++) v = (v << 8) | buf[p++];
      offsets.push(v);
    }
    const dataStart = p;
    for (let i = 0; i < count; i++) {
      const a = dataStart + offsets[i] - 1;
      const b = dataStart + offsets[i + 1] - 1;
      if (a >= 0 && b > a && b <= buf.length) addName(names, buf.subarray(a, b).toString("latin1"));
    }
  } catch {}
  return [...names];
}

function parseType1Names(data) {
  const text = Buffer.from(data || []).toString("latin1");
  const names = new Set();
  const patterns = [
    /\/FontName\s*\/([A-Za-z0-9._+\-#]+)/g,
    /\/FullName\s*\(([^)]+)\)/g,
    /\/FamilyName\s*\(([^)]+)\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text))) addName(names, m[1]);
  }
  return [...names];
}

function embeddedFontNamesFromObject(obj) {
  const names = new Set();
  const binaries = [];
  const seen = new Set();
  const pushBinary = (value) => {
    if (!value) return;
    let b = null;
    if (value instanceof Uint8Array || Buffer.isBuffer(value)) b = Buffer.from(value);
    else if (value instanceof ArrayBuffer) b = Buffer.from(new Uint8Array(value));
    else if (ArrayBuffer.isView(value)) b = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    if (!b || b.length < 16 || b.length > 50 * 1024 * 1024) return;
    const key = `${b.length}:${b.subarray(0, 16).toString("hex")}`;
    if (seen.has(key)) return;
    seen.add(key);
    binaries.push(b);
  };

  // PDF.js Font objects and their descriptors can expose the embedded bytes
  // under different properties depending on version/build.
  pushBinary(obj?.data);
  pushBinary(obj?.file?.data);
  pushBinary(obj?.fontData);
  pushBinary(obj?.properties?.data);
  pushBinary(obj?.properties?.file?.data);
  pushBinary(obj?.dict?.data);
  pushBinary(obj?.dict?.file?.data);

  for (const b of binaries) {
    for (const n of parseSfntNames(b)) addName(names, n);
    for (const n of parseCffNames(b)) addName(names, n);
    for (const n of parseType1Names(b)) addName(names, n);
  }
  return [...names];
}

function getFontObject(page, fontName) {
  if (!page?.commonObjs || !fontName) return null;
  try { return page.commonObjs.get(fontName) || null; } catch { return null; }
}

function collectObjectFontNames(obj) {
  const names = new Set();
  const candidates = [
    obj?.fontFamily, obj?.name, obj?.loadedName, obj?.fallbackName,
    obj?.properties?.fontFamily, obj?.properties?.name,
    obj?.properties?.loadedName, obj?.properties?.fallbackName,
    obj?.properties?.baseFont, obj?.properties?.BaseFont,
    obj?.properties?.fontName, obj?.properties?.FontName,
    obj?.dict?.fontName, obj?.dict?.FontName, obj?.dict?.baseFont,
  ];
  for (const c of candidates) addName(names, c);
  for (const c of embeddedFontNamesFromObject(obj)) addName(names, c);
  return [...names];
}

function fontDescriptor(item, page) {
  const raw = clean(item?.fontName);
  const obj = getFontObject(page, raw);
  const objectNames = collectObjectFontNames(obj);
  // Prefer an actual object/embedded name. Never treat g_d3_f3-style resource
  // names as the canonical font family.
  const preferred = objectNames.find(n => !/^g_d\d+_f\d+$/i.test(n)) || null;
  const canonical = preferred || (isUsefulFontName(raw) ? normalizeFontName(raw) : null);
  return {
    rawFontName: raw || null,
    fontName: canonical,
    family: fontFamily(canonical),
    style: fontStyle(canonical),
    pdfFontFamilies: objectNames.map(x => fontFamily(x) || x).slice(0, 12),
    embedded: typeof obj?.isEmbedded === "boolean" ? obj.isEmbedded : null,
    type3: Boolean(obj?.isType3Font),
    vertical: Boolean(obj?.vertical),
    objectFontNames: objectNames.slice(0, 20),
  };
}

const fontProfileCache = new Map();

function mergeFontRecord(map, rec) {
  if (!rec?.fontName) return;
  const key = rec.key || `${rec.family || rec.fontName}|${rec.style || "unknown"}`;
  const current = map.get(key) || {
    key,
    fontName: rec.fontName,
    family: rec.family || fontFamily(rec.fontName) || rec.fontName,
    style: rec.style || fontStyle(rec.fontName),
    rawFontNames: new Set(),
    pdfFontFamilies: new Set(),
    itemCount: 0,
    charCount: 0,
    pages: new Set(),
    embeddedValues: new Set(),
    sources: new Set(),
  };
  if (rec.rawFontName) current.rawFontNames.add(rec.rawFontName);
  for (const n of rec.rawFontNames || []) current.rawFontNames.add(n);
  for (const n of rec.pdfFontFamilies || []) current.pdfFontFamilies.add(n);
  if (rec.source) current.sources.add(rec.source);
  if (rec.pageNumber) current.pages.add(rec.pageNumber);
  current.itemCount += Number(rec.itemCount) || 0;
  current.charCount += Number(rec.charCount) || 0;
  if (rec.embedded !== null && rec.embedded !== undefined) current.embeddedValues.add(rec.embedded);
  map.set(key, current);
}

async function extractPdfFontProfile(pdfPath, pdfjsLib, options = {}) {
  if (!pdfPath || !pdfjsLib) return null;
  const stat = await fs.stat(pdfPath);
  const cacheKey = `${pdfPath}:${stat.size}:${stat.mtimeMs}:${Number(options.maxPages) || 5}:v31`;
  if (fontProfileCache.has(cacheKey)) return fontProfileCache.get(cacheKey);

  const buffer = await fs.readFile(pdfPath);
  if (!buffer?.length) return null;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: true }).promise;
  const maxPages = Math.min(Number(options.maxPages) || 5, pdf.numPages || 1);
  const fonts = new Map();
  const items = [];
  const pages = [];
  const pdfObjectNames = new Set();

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({ disableCombineTextItems: false });
      const pageItems = [];

      for (const item of content.items || []) {
        const text = clean(item?.str);
        if (!text || !item?.fontName) continue;
        const font = fontDescriptor(item, page);
        for (const n of font.objectFontNames || []) addName(pdfObjectNames, n);

        // If canonical name is unavailable, keep the resource name as an
        // internal observation but do NOT expose it as a reference font family.
        if (font.fontName) {
          mergeFontRecord(fonts, {
            ...font,
            source: font.objectFontNames?.length ? "pdfjs-font-object" : "pdfjs-text-layer",
            pageNumber,
            itemCount: 1,
            charCount: text.length,
          });
        }

        const tr = Array.isArray(item.transform) ? item.transform : [];
        const x = Number(tr[4]);
        const y = Number(tr[5]);
        const width = Number(item.width) || 0;
        const height = Math.abs(Number(tr[3])) || Number(item.height) || 0;
        const row = { pageNumber, text, x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0, width, height, font };
        pageItems.push(row);
        items.push(row);
      }
      pages.push({ pageNumber, width: viewport.width, height: viewport.height, itemCount: pageItems.length });
    }
  } finally {
    try { if (typeof pdf.destroy === "function") await pdf.destroy(); } catch {}
  }

  // Add names found in dictionaries and decompressed object streams.
  const rawFontNames = await extractRawPdfFontNames(pdfPath);
  for (const n of rawFontNames) addName(pdfObjectNames, n);

  // v3.1: resolve indirect /Font -> /FontDescriptor -> /FontFile references.
  const objectGraph = await extractPdfObjectGraphFontNames(pdfPath);
  for (const n of objectGraph.names || []) addName(pdfObjectNames, n);
  for (const n of objectGraph.descriptorNames || []) addName(pdfObjectNames, n);

  for (const n of [...new Set([...(rawFontNames || []), ...(objectGraph.names || []), ...(objectGraph.descriptorNames || [])])]) {
    if (!fontsHasCanonical(fonts, n)) {
      const rec = makeFontRecord(n, "pdf-dictionary-or-object-stream");
      if (rec) mergeFontRecord(fonts, rec);
    }
  }

  const fontList = [...fonts.values()].map(x => ({
    key: x.key,
    fontName: x.fontName,
    family: x.family,
    style: x.style,
    rawFontNames: [...x.rawFontNames].slice(0, 20),
    pdfFontFamilies: [...x.pdfFontFamilies].slice(0, 20),
    itemCount: x.itemCount,
    charCount: x.charCount,
    pages: [...x.pages].sort((a,b) => a-b),
    embedded: x.embeddedValues.size === 1 ? [...x.embeddedValues][0] : null,
    sources: [...x.sources],
  })).filter(x => isUsefulFontName(x.fontName)).sort((a,b) => b.charCount - a.charCount);

  const result = {
    available: true,
    fileName: path.basename(pdfPath),
    pageCount: pdf.numPages,
    scannedPages: maxPages,
    fonts: fontList,
    fontCount: fontList.length,
    rawPdfFontNames: rawFontNames,
    pdfObjectFontNames: [...pdfObjectNames],
    pdfObjectGraph: {
      objectCount: objectGraph.objectCount || 0,
      descriptorFonts: objectGraph.descriptorNames || [],
      embeddedFontFiles: objectGraph.embeddedFontFiles || [],
    },
    textItemCount: items.length,
    pages,
    items,
  };
  fontProfileCache.set(cacheKey, result);
  return result;
}

function fontsHasCanonical(map, name) {
  const n = normalizeFontName(name);
  if (!n) return true;
  return [...map.values()].some(x => normalizeFontName(x.fontName) === n || normalizeFontName(x.family) === n);
}

function isLikelyLabel(text) {
  const t = normalizeLabel(text);
  if (!t || t.length > 45) return false;
  return /(?:GONDEREN|GONDERICI|ALICI|HESAP|IBAN|TUTAR|ISLEM|TARIH|SAAT|ACIKLAMA|SUBE|VERGI|TCKN|VKN|SORGU|REFERANS|ETTN|DOKUMAN|MESAJ|BANKA|ADRES|VALOR)/.test(t);
}

function sameRow(a, b) {
  const ay = Number(a?.y) || 0;
  const by = Number(b?.y) || 0;
  const ah = Math.max(5, Number(a?.height) || 10);
  return Math.abs(ay - by) <= Math.max(8, ah * 1.5);
}

function fieldValueFontProfiles(profile) {
  const labels = profile.items.filter(x => isLikelyLabel(x.text));
  const rows = [];
  for (const label of labels) {
    const candidates = profile.items
      .filter(x => x.pageNumber === label.pageNumber && x !== label && sameRow(label, x) && x.x >= label.x + label.width - 2)
      .sort((a,b) => a.x - b.x);
    if (!candidates.length) continue;
    const values = candidates.slice(0, 12).filter(x => !isLikelyLabel(x.text));
    if (!values.length) continue;
    const fontKeys = [...new Set(values.map(x => x.font.family || x.font.fontName).filter(Boolean))];
    if (!fontKeys.length) continue;
    rows.push({
      pageNumber: label.pageNumber,
      field: normalizeLabel(label.text),
      labelText: label.text,
      valueFonts: fontKeys,
      valueStyles: [...new Set(values.map(x => x.font.style).filter(Boolean))],
      valueItemCount: values.length,
    });
  }
  return rows;
}

function compareFontProfiles(reference, target) {
  const refFonts = Array.isArray(reference?.fonts) ? reference.fonts : [];
  const tarFonts = Array.isArray(target?.fonts) ? target.fonts : [];
  const refFamilies = new Set(refFonts.map(x => x.family || x.fontName).filter(Boolean));
  const tarFamilies = new Set(tarFonts.map(x => x.family || x.fontName).filter(Boolean));
  const refStyles = new Set(refFonts.map(x => x.style).filter(x => x && x !== "unknown"));
  const tarStyles = new Set(tarFonts.map(x => x.style).filter(x => x && x !== "unknown"));
  const familyOnlyTarget = [...tarFamilies].filter(x => !refFamilies.has(x));
  const familyOnlyReference = [...refFamilies].filter(x => !tarFamilies.has(x));
  const sharedFamilies = [...tarFamilies].filter(x => refFamilies.has(x));
  const styleOnlyTarget = [...tarStyles].filter(x => !refStyles.has(x));
  const familyDenom = Math.max(1, new Set([...refFamilies, ...tarFamilies]).size);
  const familySimilarity = Math.round((sharedFamilies.length / familyDenom) * 100);

  const refField = fieldValueFontProfiles(reference);
  const tarField = fieldValueFontProfiles(target);
  const targetByField = new Map(tarField.map(x => [x.field, x]));
  const fieldMismatches = [];
  for (const r of refField) {
    const t = targetByField.get(r.field);
    if (!t) continue;
    const rf = new Set(r.valueFonts);
    const tf = new Set(t.valueFonts);
    const mismatch = [...tf].filter(x => !rf.has(x));
    if (mismatch.length) fieldMismatches.push({
      field: r.field,
      labelText: r.labelText,
      referenceFonts: [...rf],
      targetFonts: [...tf],
      targetOnlyFonts: mismatch,
      referenceStyles: r.valueStyles,
      targetStyles: t.valueStyles,
    });
  }

  let score = 0;
  const evidence = [];
  if (!refFonts.length) {
    return {
      available: false,
      score: 0,
      severity: "unknown",
      referenceFamilies: [],
      targetFamilies: [...tarFamilies],
      sharedFamilies: [],
      targetOnlyFamilies: [],
      referenceOnlyFamilies: [],
      referenceStyles: [],
      targetStyles: [...tarStyles],
      targetOnlyStyles: [],
      familySimilarity: null,
      fieldMismatches: [],
      evidence: ["Referans PDF'den güvenilir font profili çıkarılamadı; font farkı skoru üretilmedi."],
    };
  }

  if (familyOnlyTarget.length) {
    score += Math.min(45, familyOnlyTarget.length * 15);
    evidence.push(`Referansta bulunmayan ${familyOnlyTarget.length} font ailesi hedef PDF'de görüldü.`);
  }
  if (styleOnlyTarget.length) {
    score += Math.min(20, styleOnlyTarget.length * 7);
    evidence.push(`Hedef PDF'de referansta olmayan ${styleOnlyTarget.length} font stili görüldü.`);
  }
  if (fieldMismatches.length) {
    score += Math.min(45, fieldMismatches.length * 15);
    evidence.push(`${fieldMismatches.length} semantic alanda referans-hedef font farkı bulundu.`);
  }
  score = Math.min(100, score);
  return {
    available: true,
    score,
    severity: score >= 70 ? "strong" : score >= 40 ? "medium" : score >= 18 ? "low" : "none",
    referenceFamilies: [...refFamilies],
    targetFamilies: [...tarFamilies],
    sharedFamilies,
    targetOnlyFamilies: familyOnlyTarget,
    referenceOnlyFamilies: familyOnlyReference,
    referenceStyles: [...refStyles],
    targetStyles: [...tarStyles],
    targetOnlyStyles: styleOnlyTarget,
    familySimilarity,
    fieldMismatches: fieldMismatches.slice(0, 30),
    evidence,
  };
}

export async function analyzeFontForensics({ targetPath, referencePath, referencePaths = [], pdfjsLib, maxPages = 5 }) {
  if (!targetPath || !pdfjsLib) return { available: false, reason: "missing-target-or-pdf-engine" };
  if (path.extname(targetPath).toLowerCase() !== ".pdf") {
    return { available: false, status: "unsupported", reason: "font-metadata-analysis-requires-pdf", evidence: "JPG/PNG gibi raster belgelerde gerçek embedded PDF font adı çıkarılamaz; görsel tipografi motoru ayrı çalışır." };
  }
  const refs = [...new Set([referencePath, ...referencePaths].filter(Boolean))]
    .filter(p => path.extname(String(p)).toLowerCase() === ".pdf");
  if (!refs.length) return { available: false, status: "no-reference" };

  let targetProfile;
  try { targetProfile = await extractPdfFontProfile(targetPath, pdfjsLib, { maxPages }); }
  catch (error) { return { available: false, status: "error", error: error?.message || String(error) }; }
  if (!targetProfile) return { available: false, status: "no-target-profile" };

  const referenceProfiles = [];
  for (const refPath of refs) {
    try {
      const p = await extractPdfFontProfile(refPath, pdfjsLib, { maxPages });
      if (p && p.fonts?.length) {
        referenceProfiles.push(p);
        console.log("FONT REFERENCE PROFILE READY:", path.basename(refPath), { fonts:p.fonts.map(x => x.fontName), graph:p.pdfObjectGraph || null });
      } else console.warn("FONT REFERENCE PROFILE EMPTY:", path.basename(refPath));
    } catch (error) {
      console.warn("FONT REFERENCE EXTRACTION HATASI:", path.basename(refPath), error?.message || error);
    }
  }

  if (!referenceProfiles.length) {
    return {
      available: true,
      engine: "verifydoc-pdf-font-forensics-v3.1",
      status: "reference-font-profile-unavailable",
      targetFile: targetProfile.fileName,
      targetFonts: targetProfile.fonts,
      targetFontCount: targetProfile.fontCount,
      referenceFiles: refs.map(x => path.basename(x)),
      referenceFontProfiles: [],
      score: 0,
      severity: "unknown",
      familySimilarity: null,
      comparisons: [],
      evidence: ["Referans PDF mevcut ancak güvenilir gerçek font profili çıkarılamadı. Hedef fontları referanssız karşılaştırmak yerine font skoru devre dışı bırakıldı."],
    };
  }

  const comparisons = referenceProfiles.map(ref => ({ referenceFile: ref.fileName, comparison: compareFontProfiles(ref, targetProfile) }));
  comparisons.sort((a,b) => Number(a.comparison.score) - Number(b.comparison.score));
  const best = comparisons[0];
  const allReferenceFamilies = new Set(referenceProfiles.flatMap(p => p.fonts.map(x => x.family || x.fontName).filter(Boolean)));
  const allTargetFamilies = new Set(targetProfile.fonts.map(x => x.family || x.fontName).filter(Boolean));
  const ensembleTargetOnlyFamilies = [...allTargetFamilies].filter(x => !allReferenceFamilies.has(x));

  return {
    available: true,
    engine: "verifydoc-pdf-font-forensics-v3.1",
    status: "ok",
    targetFile: targetProfile.fileName,
    targetFonts: targetProfile.fonts,
    targetFontCount: targetProfile.fontCount,
    referenceFiles: referenceProfiles.map(x => x.fileName),
    referenceFontProfiles: referenceProfiles.map(x => ({ fileName: x.fileName, fonts: x.fonts, fontCount: x.fontCount, rawPdfFontNames: x.rawPdfFontNames })),
    targetOnlyFamiliesAcrossReferences: ensembleTargetOnlyFamilies,
    bestReference: best?.referenceFile || null,
    score: best?.comparison?.score || 0,
    severity: best?.comparison?.severity || "none",
    familySimilarity: best?.comparison?.familySimilarity ?? null,
    comparisons,
    evidence: best?.comparison?.evidence || [],
  };
}

export { extractPdfFontProfile, compareFontProfiles, normalizeFontName, fontFamily, fontStyle };
export default analyzeFontForensics;
