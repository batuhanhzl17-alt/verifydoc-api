import fs from "fs/promises";
import path from "path";

// =====================================================
// VERIFYDOC FONT FORENSICS v1
// =====================================================
// Amaç:
// 1) PDF içindeki gerçek text/font metadata'sını çıkarmak.
// 2) Subset prefix'lerini temizleyip karşılaştırılabilir font adları üretmek.
// 3) Referans PDF ile hedef PDF'nin font ailesi/stili/ölçüsünü karşılaştırmak.
// 4) Aynı semantic alanın label/value tarafında font değişimini ayrı sinyal
//    olarak raporlamak.
//
// Bu modül tek başına sahtecilik kararı vermez. Çıktı, VerifyDoc'un diğer
// forensic motorlarıyla birlikte değerlendirilmek üzere tasarlanmıştır.

const FONT_STYLE_PATTERNS = [
  ["black", /(?:black|heavy|ultrablack|900)$/i],
  ["bold", /(?:bold|semibold|demibold|mediumbold|700)$/i],
  ["medium", /(?:medium|500)$/i],
  ["light", /(?:light|thin|300)$/i],
  ["italic", /(?:italic|oblique)$/i],
  ["regular", /(?:regular|roman|normal|book)$/i],
];

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeFontName(value) {
  let s = clean(value);
  if (!s) return null;

  // PDF subset prefix: ABCDEF+FontName
  s = s.replace(/^[A-Z]{3,8}\+/i, "");
  s = s.replace(/^\//, "");
  s = s.replace(/\s+/g, "");
  return s || null;
}

function fontFamily(value) {
  const n = normalizeFontName(value);
  if (!n) return null;
  return n
    .replace(/[-_](?:Bold|Black|Roman|Regular|Book|Medium|Light|Thin|Italic|Oblique|Semibold|DemiBold|Heavy|Normal)(?:MT|PS)?$/i, "")
    .replace(/(?:Bold|Black|Roman|Regular|Book|Medium|Light|Thin|Italic|Oblique|Semibold|DemiBold|Heavy|Normal)(?:MT|PS)?$/i, "")
    .replace(/(?:MT|PSMT)$/i, "") || n;
}

function fontStyle(value) {
  const n = normalizeFontName(value);
  if (!n) return "unknown";
  for (const [style, re] of FONT_STYLE_PATTERNS) {
    if (re.test(n)) return style;
  }
  if (/(?:BoldMT|BoldPSMT)$/i.test(n)) return "bold";
  if (/(?:Roman|Regular|Book|Normal)(?:MT|PSMT)?$/i.test(n)) return "regular";
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

function getFontObject(page, fontName) {
  if (!page?.commonObjs || !fontName) return null;
  try {
    if (typeof page.commonObjs.has === "function" && !page.commonObjs.has(fontName)) return null;
  } catch {}
  try {
    return page.commonObjs.get(fontName) || null;
  } catch {
    return null;
  }
}

function fontDescriptor(item, page) {
  const raw = clean(item?.fontName);
  const obj = getFontObject(page, raw);
  const candidates = [
    obj?.fontFamily,
    obj?.name,
    obj?.loadedName,
    obj?.fallbackName,
    raw,
  ].filter(Boolean);

  const rawName = normalizeFontName(candidates[0]) || normalizeFontName(raw);
  const family = fontFamily(rawName || candidates[0]);
  const style = fontStyle(rawName || candidates[0]);

  return {
    rawFontName: raw || null,
    fontName: rawName || null,
    family: family || null,
    style,
    pdfFontFamily: clean(obj?.fontFamily) || null,
    loadedName: clean(obj?.loadedName) || null,
    embedded: typeof obj?.isEmbedded === "boolean" ? obj.isEmbedded : null,
    type3: Boolean(obj?.isType3Font),
    vertical: Boolean(obj?.vertical),
  };
}

const fontProfileCache = new Map();

async function extractPdfFontProfile(pdfPath, pdfjsLib, options = {}) {
  if (!pdfPath || !pdfjsLib) return null;
  const stat = await fs.stat(pdfPath);
  const cacheKey = `${pdfPath}:${stat.size}:${stat.mtimeMs}:${Number(options.maxPages) || 5}`;
  const cached = fontProfileCache.get(cacheKey);
  if (cached) return cached;
  const buffer = await fs.readFile(pdfPath);
  if (!buffer?.length) return null;

  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const maxPages = Math.min(Number(options.maxPages) || 5, pdf.numPages || 1);
  const fonts = new Map();
  const items = [];
  const pages = [];

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
        const key = [font.family || font.fontName || "unknown", font.style].join("|");
        const current = fonts.get(key) || {
          key,
          fontName: font.fontName,
          family: font.family,
          style: font.style,
          rawFontNames: new Set(),
          pdfFontFamilies: new Set(),
          itemCount: 0,
          charCount: 0,
          pages: new Set(),
          embeddedValues: new Set(),
        };
        current.itemCount++;
        current.charCount += text.length;
        current.pages.add(pageNumber);
        if (font.rawFontName) current.rawFontNames.add(font.rawFontName);
        if (font.pdfFontFamily) current.pdfFontFamilies.add(font.pdfFontFamily);
        if (font.embedded !== null) current.embeddedValues.add(font.embedded);
        fonts.set(key, current);

        const tr = Array.isArray(item.transform) ? item.transform : [];
        const x = Number(tr[4]);
        const y = Number(tr[5]);
        const width = Number(item.width) || 0;
        const height = Math.abs(Number(tr[3])) || Number(item.height) || 0;
        const row = {
          pageNumber,
          text,
          x: Number.isFinite(x) ? x : 0,
          y: Number.isFinite(y) ? y : 0,
          width,
          height,
          font,
        };
        pageItems.push(row);
        items.push(row);
      }

      pages.push({ pageNumber, width: viewport.width, height: viewport.height, itemCount: pageItems.length });
    }
  } finally {
    try { if (typeof pdf.destroy === "function") await pdf.destroy(); } catch {}
  }

  const fontList = [...fonts.values()].map(x => ({
    key: x.key,
    fontName: x.fontName,
    family: x.family,
    style: x.style,
    rawFontNames: [...x.rawFontNames].slice(0, 12),
    pdfFontFamilies: [...x.pdfFontFamilies].slice(0, 12),
    itemCount: x.itemCount,
    charCount: x.charCount,
    pages: [...x.pages].sort((a,b) => a-b),
    embedded: x.embeddedValues.size === 1 ? [...x.embeddedValues][0] : null,
  })).sort((a,b) => b.charCount - a.charCount);

  const result = {
    available: true,
    fileName: path.basename(pdfPath),
    pageCount: pdf.numPages,
    scannedPages: maxPages,
    fonts: fontList,
    fontCount: fontList.length,
    textItemCount: items.length,
    pages,
    items,
  };
  fontProfileCache.set(cacheKey, result);
  return result;
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
    if (mismatch.length) {
      fieldMismatches.push({
        field: r.field,
        labelText: r.labelText,
        referenceFonts: [...rf],
        targetFonts: [...tf],
        targetOnlyFonts: mismatch,
        referenceStyles: r.valueStyles,
        targetStyles: t.valueStyles,
      });
    }
  }

  let score = 0;
  const evidence = [];
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
  const targetExt = path.extname(targetPath).toLowerCase();
  if (targetExt !== ".pdf") {
    return {
      available: false,
      status: "unsupported",
      reason: "font-metadata-analysis-requires-pdf-text-layer",
      evidence: "JPG/PNG gibi raster belgelerde gerçek embedded PDF font adı çıkarılamaz; görsel tipografi motoru ayrı çalışır."
    };
  }

  const refs = [...new Set([referencePath, ...referencePaths].filter(Boolean))]
    .filter(p => path.extname(String(p)).toLowerCase() === ".pdf");
  if (!refs.length) return { available: false, status: "no-reference" };

  let targetProfile = null;
  try {
    targetProfile = await extractPdfFontProfile(targetPath, pdfjsLib, { maxPages });
  } catch (error) {
    return { available: false, status: "error", error: error?.message || String(error) };
  }
  if (!targetProfile) return { available: false, status: "no-target-profile" };

  const referenceProfiles = [];
  for (const refPath of refs) {
    try {
      const p = await extractPdfFontProfile(refPath, pdfjsLib, { maxPages });
      if (p) referenceProfiles.push(p);
    } catch (error) {
      console.warn("FONT REFERENCE EXTRACTION HATASI:", path.basename(refPath), error?.message || error);
    }
  }
  if (!referenceProfiles.length) return { available: false, status: "no-reference-profile", target: targetProfile };

  const comparisons = referenceProfiles.map(ref => ({
    referenceFile: ref.fileName,
    comparison: compareFontProfiles(ref, targetProfile),
  }));
  comparisons.sort((a,b) => Number(a.comparison.score) - Number(b.comparison.score));
  const best = comparisons[0];

  // Ensemble: target-only fonts are more meaningful when they are absent from
  // every trusted reference variant. Build the union of all reference families.
  const allReferenceFamilies = new Set(referenceProfiles.flatMap(p => p.fonts.map(x => x.family || x.fontName).filter(Boolean)));
  const allTargetFamilies = new Set(targetProfile.fonts.map(x => x.family || x.fontName).filter(Boolean));
  const ensembleTargetOnlyFamilies = [...allTargetFamilies].filter(x => !allReferenceFamilies.has(x));

  return {
    available: true,
    engine: "verifydoc-pdf-font-forensics-v1",
    status: "ok",
    targetFile: targetProfile.fileName,
    targetFonts: targetProfile.fonts,
    targetFontCount: targetProfile.fontCount,
    referenceFiles: referenceProfiles.map(x => x.fileName),
    referenceFontProfiles: referenceProfiles.map(x => ({
      fileName: x.fileName,
      fonts: x.fonts,
      fontCount: x.fontCount,
    })),
    targetOnlyFamiliesAcrossReferences: ensembleTargetOnlyFamilies,
    bestReference: best?.referenceFile || null,
    score: best?.comparison?.score || 0,
    severity: best?.comparison?.severity || "none",
    familySimilarity: best?.comparison?.familySimilarity || 0,
    comparisons,
    evidence: best?.comparison?.evidence || [],
    // Raw item coordinates stay internal to the module; only semantic field
    // mismatches are returned to the main result.
  };
}

export default analyzeFontForensics;
