const DEFAULT_MAX_PAGES = 20;

const OPS_GROUPS = {
  textShow: ['showText', 'showSpacedText'],
  imagePaint: [
    'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject',
    'paintImageMaskXObjectGroup', 'paintJpegXObject', 'paintSolidColorImageMask',
  ],
  vectorPath: ['constructPath'],
};

/**
 * Collect PDF.js structural observations. PDF.js maps Tj and TJ to distinct
 * showText and showSpacedText operators. The quote shorthand operators are
 * reported separately because they are not Tj/TJ.
 */
export async function analyzePdfStructure({ pdf, buffer, pdfjsLib, maxPages = DEFAULT_MAX_PAGES }) {
  if (!pdf || !buffer?.length || !pdfjsLib?.OPS) {
    return { available: false, status: 'missing-pdf-input' };
  }

  const inspectedCount = Math.min(Number(pdf.numPages) || 0, maxPages);
  const opNameById = new Map(Object.entries(pdfjsLib.OPS).map(([name, id]) => [id, name]));
  const totals = {
    textShow: 0,
    textTj: 0,
    textTJ: 0,
    nextLineShowText: 0,
    nextLineSetSpacingShowText: 0,
    imagePaint: 0,
    vectorPath: 0,
    operatorCount: 0,
    annotationCount: 0,
  };
  const pages = [];
  const fontNames = new Set();

  for (let pageNumber = 1; pageNumber <= inspectedCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const [text, operators, annotations] = await Promise.all([
      page.getTextContent(),
      page.getOperatorList(),
      page.getAnnotations({ intent: 'display' }).catch(() => []),
    ]);
    const counts = {
      textShow: 0,
      textTj: 0,
      textTJ: 0,
      nextLineShowText: 0,
      nextLineSetSpacingShowText: 0,
      imagePaint: 0,
      vectorPath: 0,
      operatorCount: operators.fnArray.length,
    };
    for (const item of text.items || []) {
      if (item.fontName) fontNames.add(String(item.fontName));
    }
    for (const fn of operators.fnArray || []) {
      const name = opNameById.get(fn);
      if (!name) continue;
      if (name === 'showText') { counts.textShow++; counts.textTj++; }
      if (name === 'showSpacedText') { counts.textShow++; counts.textTJ++; }
      if (name === 'nextLineShowText') counts.nextLineShowText++;
      if (name === 'nextLineSetSpacingShowText') counts.nextLineSetSpacingShowText++;
      if (OPS_GROUPS.imagePaint.includes(name)) counts.imagePaint++;
      if (OPS_GROUPS.vectorPath.includes(name)) counts.vectorPath++;
    }
    totals.textShow += counts.textShow;
    totals.textTj += counts.textTj;
    totals.textTJ += counts.textTJ;
    totals.nextLineShowText += counts.nextLineShowText;
    totals.nextLineSetSpacingShowText += counts.nextLineSetSpacingShowText;
    totals.imagePaint += counts.imagePaint;
    totals.vectorPath += counts.vectorPath;
    totals.operatorCount += counts.operatorCount;
    totals.annotationCount += annotations.length;
    pages.push({ pageNumber, textItemCount: (text.items || []).length, ...counts, annotationCount: annotations.length });
  }

  const header = Buffer.from(buffer).subarray(0, 32).toString('latin1');
  return {
    available: true,
    status: 'observed',
    engine: 'pdfjs-dist-4.10.38',
    fileBytes: buffer.length,
    pdfVersion: header.match(/%PDF-(\d\.\d)/)?.[1] || null,
    pageCount: pdf.numPages,
    pagesInspected: inspectedCount,
    truncatedPageScan: inspectedCount < pdf.numPages,
    normalizedOperatorCounts: totals,
    pdfJsFontResourceNames: [...fontNames].slice(0, 80),
    pageDetails: pages,
    notes: [
      'PDF.js maps Tj to showText and TJ to showSpacedText; counts are reported separately.',
      'The single-quote and double-quote text-show shorthand operators are counted separately and are not included in Tj/TJ.',
      'Counts are from PDF.js parsed page operator lists, not a byte-level search of compressed content streams.',
      'Counts describe PDF structure; different export software can produce different structures without tampering.',
      'This inventory is a review aid and does not decide authenticity or affect risk scoring.',
    ],
  };
}
