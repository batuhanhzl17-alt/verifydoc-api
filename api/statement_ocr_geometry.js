// Row association for image-only statements using PaddleOCR's per-region boxes.
// Paddle boxes are kept in the OCR image's pixel coordinate system; dimensions
// are required only when translating a selected amount box back to PDF space.

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('tr-TR')
    .replace(/[ıİ]/g, 'i').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function moneyCents(value) {
  const raw = String(value ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!raw || !/\d/.test(raw)) return null;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  const decimalAt = Math.max(comma, dot);
  const normalized = decimalAt >= 0 && raw.length - decimalAt - 1 <= 2
    ? raw.slice(0, decimalAt).replace(/[,.]/g, '') + '.' + raw.slice(decimalAt + 1)
    : raw.replace(/[,.]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function dateKey(value) {
  const text = String(value || '').trim();
  const ymd = text.match(/(?:^|[^\d])(20\d{2})[./-](\d{1,2})[./-](\d{1,2})(?:$|[^\d])/);
  if (ymd) return `${ymd[1]}${ymd[2].padStart(2, '0')}${ymd[3].padStart(2, '0')}`;
  const dmy = text.match(/(?:^|[^\d])(\d{1,2})[./-](\d{1,2})[./-](20\d{2})(?:$|[^\d])/);
  return dmy ? `${dmy[3]}${dmy[2].padStart(2, '0')}${dmy[1].padStart(2, '0')}` : '';
}

function moneyTokens(text) {
  const matches = String(text || '').match(/[+−-]?\s*(?:(?:\d{1,3}(?:[.\s]\d{3})+)|\d+)[,.]\d{2}/g) || [];
  return matches.map(text => ({ text: text.trim(), cents: moneyCents(text) }));
}

export function normalizePaddleOcrBox(value) {
  if (!value) return null;
  // Paddle SDK versions may return rec_boxes as [x1,y1,x2,y2], as a polygon
  // [[x,y], ...], or wrapped one level deeper. Flatten point arrays before
  // deciding which representation was returned.
  if (!Array.isArray(value) && typeof value === 'object') {
    const x1 = Number(value.x1 ?? value.left), y1 = Number(value.y1 ?? value.top);
    const x2 = Number(value.x2 ?? value.right), y2 = Number(value.y2 ?? value.bottom);
    if ([x1, y1, x2, y2].every(Number.isFinite) && x2 > x1 && y2 > y1) return { x1, y1, x2, y2 };
    value = value.points ?? value.polygon ?? value.poly ?? value.box ?? value.bbox ?? null;
  }
  if (!Array.isArray(value)) return null;
  const numbers = value.flat(Infinity).map(Number);
  if (numbers.length < 4 || numbers.some(number => !Number.isFinite(number))) return null;
  let xs, ys;
  if (numbers.length === 4) {
    [xs, ys] = [[numbers[0], numbers[2]], [numbers[1], numbers[3]]];
  } else if (numbers.length >= 6 && numbers.length % 2 === 0) {
    xs = numbers.filter((_, index) => index % 2 === 0);
    ys = numbers.filter((_, index) => index % 2 === 1);
  } else return null;
  const box = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
  return box.x2 > box.x1 && box.y2 > box.y1 ? box : null;
}

// Statement uploads can have their full-document Paddle result in either slot:
// the text-layer fallback (`paddleDocumentOCR`) or the always-run forensic OCR
// (`paddleImageOCR`). Prefer whichever actually carries per-page boxes.
export function selectStatementPaddleOcr(documentOcr, imageOcr) {
  const hasRegions = value => value?.success === true && Array.isArray(value?.regions) && value.regions.length > 0;
  if (hasRegions(documentOcr)) return { result: documentOcr, source: 'paddleDocumentOCR' };
  if (hasRegions(imageOcr)) return { result: imageOcr, source: 'paddleImageOCR' };
  return { result: documentOcr || imageOcr || null, source: null };
}

function boxOf(region) {
  const box = region?.region;
  if (!box) return null;
  const x1 = Number(box.x1), y1 = Number(box.y1), x2 = Number(box.x2), y2 = Number(box.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

function clusterLines(items) {
  const sorted = [...items].sort((a, b) => a.box.cy - b.box.cy || a.box.x - b.box.x);
  const lines = [];
  for (const item of sorted) {
    const tolerance = Math.max(3, Math.min(24, item.box.height * 0.72));
    let line = lines.find(candidate => Math.abs(candidate.cy - item.box.cy) <= Math.max(tolerance, candidate.tolerance));
    if (!line) {
      line = { cy: item.box.cy, tolerance, items: [] };
      lines.push(line);
    }
    line.items.push(item);
    line.cy = line.items.reduce((sum, value) => sum + value.box.cy, 0) / line.items.length;
    line.tolerance = Math.max(line.tolerance, tolerance);
  }
  return lines;
}

function chooseColumn(items, centerX) {
  if (items.length <= 1 || !Number.isFinite(centerX)) return items;
  const ranked = items.map(item => ({ item, distance: Math.abs(item.box.cx - centerX) })).sort((a, b) => a.distance - b.distance);
  return ranked.length > 1 && ranked[1].distance - ranked[0].distance >= 8 ? [ranked[0].item] : items;
}

function pdfBox(pixelBox, pageGeometry) {
  const width = Number(pageGeometry?.width), height = Number(pageGeometry?.height);
  if (!(width > 0 && height > 0)) return null;
  // Whole-row OCR regions can associate rows but are too broad for localized ROIs.
  if (pixelBox.width / width > 0.28 || pixelBox.height / height > 0.08) return null;
  return {
    x: Math.max(0, Math.min(1, pixelBox.x / width)),
    y: Math.max(0, Math.min(1, pixelBox.y / height)),
    width: Math.max(0.0001, Math.min(1, pixelBox.width / width)),
    height: Math.max(0.0001, Math.min(1, pixelBox.height / height)),
  };
}

// A claim represents one physical OCR amount token. Do not reject a candidate
// just because its row baseline is near another row: statements often have
// tall OCR boxes and tightly packed transactions. Reuse is only likely when
// the amount token occupies the same horizontal and vertical location.
function matchesClaimedAmount(item, claims) {
  if (!Array.isArray(claims)) return false;
  const box = item?.amount?.box;
  if (!box) return false;
  return claims.some(claim => {
    const x1 = Number(claim?.x1 ?? claim?.x);
    const y1 = Number(claim?.y1 ?? claim?.y);
    const x2 = Number(claim?.x2 ?? (Number(claim?.x) + Number(claim?.width)));
    const y2 = Number(claim?.y2 ?? (Number(claim?.y) + Number(claim?.height)));
    if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) {
      // Backward-compatible interpretation for callers still supplying the
      // former {y,tolerance} shape, with a deliberately tight vertical bound.
      const oldY = Number(claim?.y);
      const oldTolerance = Number(claim?.tolerance) || 3;
      return Number.isFinite(oldY) && Math.abs(oldY - box.cy) <= Math.max(2, Math.min(5, oldTolerance * 0.35));
    }
    const ix = Math.max(0, Math.min(x2, box.x + box.width) - Math.max(x1, box.x));
    const iy = Math.max(0, Math.min(y2, box.y + box.height) - Math.max(y1, box.y));
    const horizontalOverlap = ix / Math.max(1, Math.min(x2 - x1, box.width));
    const verticalOverlap = iy / Math.max(1, Math.min(y2 - y1, box.height));
    const sameCenter = Math.abs(((x1 + x2) / 2) - box.cx) <= Math.max(4, Math.min(x2 - x1, box.width) * 0.35)
      && Math.abs(((y1 + y2) / 2) - box.cy) <= Math.max(2, Math.min(y2 - y1, box.height) * 0.45);
    return (horizontalOverlap >= 0.5 && verticalOverlap >= 0.45) || sameCenter;
  });
}

export function resolveStatementPaddleOcrRow(row, regions, pageNumber, pageGeometry = null, claimedLines = []) {
  const key = dateKey(row?.date);
  const amountRaw = row?.debitAmount != null && row?.debitAmount !== '' ? row.debitAmount
    : row?.creditAmount != null && row?.creditAmount !== '' ? row.creditAmount : null;
  const parsedAmount = moneyCents(amountRaw);
  const expectedAmount = parsedAmount == null ? null : Math.abs(parsedAmount);
  const expectedBalance = moneyCents(row?.balanceAfter);
  if (!key || expectedAmount == null) return { status: 'unresolved', source: 'paddle-ocr-geometry', reason: 'Tarih veya tutar yapılandırılmış değil.' };

  const items = (Array.isArray(regions) ? regions : []).filter(region =>
    region && Number(region.pageIndex) === Number(pageNumber) - 1 && String(region.text || '').trim() && Number(region.score) >= 0.55
  ).map(region => ({ text: String(region.text).trim(), score: Number(region.score), box: boxOf(region) }))
    .filter(item => item.box);
  if (!items.length) return { status: 'unresolved', source: 'paddle-ocr-geometry', reason: 'Bu sayfada güvenilir PaddleOCR kutusu yok.' };

  const lines = clusterLines(items);
  const dateAnchors = lines.filter(line => line.items.some(item => dateKey(item.text) === key));
  const description = normalizeText([row?.description, row?.counterparty].filter(Boolean).join(' '));
  const terms = description.split(' ').filter(term => term.length >= 4);
  const id = String(row?.transactionId || '').replace(/\D/g, '');
  const amountHeader = lines.flatMap(line => line.items).filter(item => /^(tutar|bor[cç]|alacak|debit|credit)(\s|$)/i.test(normalizeText(item.text)));
  const balanceHeader = lines.flatMap(line => line.items).filter(item => /^(bakiye|balance)(\s|$)/i.test(normalizeText(item.text)));
  const amountX = amountHeader.length ? amountHeader.reduce((sum, item) => sum + item.box.cx, 0) / amountHeader.length : null;
  const balanceX = balanceHeader.length ? balanceHeader.reduce((sum, item) => sum + item.box.cx, 0) / balanceHeader.length : null;
  const candidates = [];
  const fieldDiagnostics = [];

  for (const anchor of dateAnchors) {
    const band = lines.filter(line => Math.abs(line.cy - anchor.cy) <= Math.max(anchor.tolerance, line.tolerance) * 1.35)
      .flatMap(line => line.items);
    const lineText = normalizeText(band.map(item => item.text).join(' '));
    const descriptionHits = terms.filter(term => lineText.includes(term)).length;
    const descriptionMatched = terms.length === 0 || descriptionHits >= Math.max(1, Math.ceil(terms.length * 0.3));
    const idMatched = id.length >= 5 && lineText.replace(/\D/g, '').includes(id);
    const amountItems = chooseColumn(band.flatMap(item => moneyTokens(item.text)
      .filter(token => token.cents != null && Math.abs(token.cents) === expectedAmount)
      .map(token => ({ ...item, token }))), amountX);
    const balanceItems = expectedBalance == null ? [] : chooseColumn(band.flatMap(item => moneyTokens(item.text)
      .filter(token => token.cents === expectedBalance)
      .map(token => ({ ...item, token }))), balanceX);
    fieldDiagnostics.push({
      y: Math.round(anchor.cy),
      dateMatched: true,
      descriptionMatched,
      descriptionHits,
      amountMatched: amountItems.length > 0,
      amountCandidateCount: amountItems.length,
      amountCandidates: amountItems.slice(0, 4).map(item => item.token.text),
      balanceMatched: expectedBalance == null || balanceItems.length > 0,
      balanceCandidateCount: balanceItems.length,
      balanceCandidates: balanceItems.slice(0, 4).map(item => item.token.text),
    });
    const exactTuple = amountItems.length === 1 && (expectedBalance == null || balanceItems.length === 1);
    if (!exactTuple || (!descriptionMatched && !idMatched && expectedBalance == null)) continue;
    if (candidates.some(candidate => Math.abs(candidate.cy - anchor.cy) <= Math.max(candidate.tolerance, anchor.tolerance))) continue;
    candidates.push({ cy: anchor.cy, tolerance: anchor.tolerance, band, amount: amountItems[0], balance: balanceItems.length === 1 ? balanceItems[0] : null,
      lineText, descriptionMatched, descriptionHits, idMatched });
  }

  // Nearby date anchors can have overlapping bands and point to the same OCR financial boxes.
  // Collapse those into one visual row before deciding whether the match is ambiguous.
  const uniqueCandidates = [];
  for (const item of candidates) {
    const same = uniqueCandidates.find(existing => {
      const amountNear = Math.abs(existing.amount.box.cy - item.amount.box.cy) <= Math.max(3, existing.amount.box.height * 0.5, item.amount.box.height * 0.5);
      const columnNear = Math.abs(existing.amount.box.cx - item.amount.box.cx) <= Math.max(8, existing.amount.box.width * 0.12, item.amount.box.width * 0.12);
      const balanceNear = expectedBalance == null || (existing.balance && item.balance && Math.abs(existing.balance.box.cy - item.balance.box.cy) <= Math.max(3, existing.balance.box.height * 0.5, item.balance.box.height * 0.5));
      return amountNear && columnNear && balanceNear;
    });
    if (!same) uniqueCandidates.push(item);
    else {
      const oldScore = (same.idMatched ? 1000 : 0) + same.descriptionHits - Math.abs(same.cy - same.amount.box.cy) / 100;
      const newScore = (item.idMatched ? 1000 : 0) + item.descriptionHits - Math.abs(item.cy - item.amount.box.cy) / 100;
      if (newScore > oldScore) uniqueCandidates[uniqueCandidates.indexOf(same)] = item;
    }
  }
  const claimedCandidateLines = uniqueCandidates.filter(item => matchesClaimedAmount(item, claimedLines));
  const availableCandidates = uniqueCandidates.filter(item => !matchesClaimedAmount(item, claimedLines));
  let candidate = availableCandidates.length === 1 ? availableCandidates[0] : null;
  if (!candidate && availableCandidates.length > 1) {
    const ranked = availableCandidates.map(item => ({ item, score: (item.idMatched ? 1000 : 0) + item.descriptionHits })).sort((a,b) => b.score-a.score);
    if (ranked[0]?.score > 0 && ranked[0].score > ranked[1]?.score) candidate = ranked[0].item;
  }
  if (!candidate) return {
    status: 'unresolved', source: 'paddle-ocr-geometry', dateAnchorCount: dateAnchors.length,
    distinctCandidateLineCount: availableCandidates.length,
    claimedCandidateLineCount: claimedCandidateLines.length,
    fieldDiagnostics: {
      date: { matched: dateAnchors.length > 0, anchorCount: dateAnchors.length },
      description: { matched: fieldDiagnostics.some(item => item.descriptionMatched), matchedAnchorCount: fieldDiagnostics.filter(item => item.descriptionMatched).length },
      amount: { matched: fieldDiagnostics.some(item => item.amountMatched), matchedAnchorCount: fieldDiagnostics.filter(item => item.amountMatched).length },
      balance: { matched: expectedBalance == null || fieldDiagnostics.some(item => item.balanceMatched && item.amountMatched), expected: expectedBalance != null,
        matchedAnchorCount: fieldDiagnostics.filter(item => item.balanceMatched && item.amountMatched).length },
      anchors: fieldDiagnostics.slice(0, 12),
    },
    candidateLines: availableCandidates.slice(0,8).map(item=>({y:Math.round(item.cy),amount:item.amount?.token?.text||null,balance:item.balance?.token?.text||null,descriptionHits:item.descriptionHits,transactionIdMatched:item.idMatched})),
    reason: availableCandidates.length ? `${availableCandidates.length} PaddleOCR sat\u0131r aday\u0131 kald\u0131; g\u00fcvenli se\u00e7im yap\u0131lamad\u0131.`
      : claimedCandidateLines.length ? `Aday sat\u0131r bulundu ancak tutar kutusu ba\u015fka bir sat\u0131rla ayn\u0131 fiziksel OCR alan\u0131na denk geliyor (${claimedCandidateLines.length} aday).`
        : !dateAnchors.length ? 'PaddleOCR geometri sat\u0131rlar\u0131nda beklenen tarih bulunamad\u0131.'
          : !fieldDiagnostics.some(item => item.descriptionMatched) ? 'Tarih ankrajlar\u0131 bulundu ancak a\u00e7\u0131klama/al\u0131c\u0131 metni e\u015fle\u015fmedi.'
            : !fieldDiagnostics.some(item => item.amountMatched) ? 'Tarih ve a\u00e7\u0131klama adaylar\u0131 bulundu ancak beklenen tutar e\u015fle\u015fmedi.'
              : expectedBalance != null && !fieldDiagnostics.some(item => item.balanceMatched && item.amountMatched)
                ? 'Tarih, a\u00e7\u0131klama ve tutar bulundu ancak beklenen bakiye ayn\u0131 sat\u0131rda e\u015fle\u015fmedi.'
                : 'PaddleOCR geometri sat\u0131rlar\u0131nda tarih, tutar ve varsa bakiye tekil olarak e\u015fle\u015fmedi.',
  };

  const amountBox = pdfBox(candidate.amount.box, pageGeometry);
  const balanceBox = candidate.balance ? pdfBox(candidate.balance.box, pageGeometry) : null;
  return {
    status: 'matched', source: 'paddle-ocr-geometry', dateAnchorCount: dateAnchors.length,
    distinctCandidateLineCount: 1, reason: 'PaddleOCR kutularında tarih, işlem tutarı ve varsa bakiye aynı satır bandında tekil eşleşti.',
    amountText: candidate.amount.token.text, amountBox, balanceBox,
    geometryMappedToPdf: Boolean(amountBox),
    ocrConfidence: Math.round(Math.min(candidate.amount.score, candidate.balance?.score ?? candidate.amount.score) * 100),
    descriptionMatched: candidate.descriptionMatched, transactionIdMatched: candidate.idMatched,
    rowBand: { x: candidate.amount.box.x, y: candidate.amount.box.y, width: candidate.amount.box.width,
      height: candidate.amount.box.height, itemCount: candidate.band.length },
    claimedGeometry: { x1: candidate.amount.box.x, y1: candidate.amount.box.y,
      x2: candidate.amount.box.x + candidate.amount.box.width,
      y2: candidate.amount.box.y + candidate.amount.box.height },
  };
}


export function normalizeStatementRowCounts(transactionAnalysis) {
  const analysis = transactionAnalysis && typeof transactionAnalysis === 'object' ? transactionAnalysis : {};
  const rows = Array.isArray(analysis.rows) ? analysis.rows : [];
  const extractedRowCount = rows.filter(row =>
    Number.isInteger(Number(row?.pageNumber)) && Number.isInteger(Number(row?.rowNumber)) &&
    (moneyCents(row?.debitAmount) !== null || moneyCents(row?.creditAmount) !== null)
  ).length;
  const priorCount = Number(analysis.modelReportedTransactionCount);
  const reportedCount = Number.isFinite(priorCount) && priorCount > 0
    ? priorCount : (Number(analysis.transactionCount) || 0);
  if (reportedCount > 0 && reportedCount !== extractedRowCount && analysis.modelReportedTransactionCount == null) {
    analysis.modelReportedTransactionCount = reportedCount;
  }
  analysis.extractedRowCount = extractedRowCount;
  analysis.transactionCount = extractedRowCount;
  return { reportedCount, extractedRowCount, mismatch: reportedCount > 0 && reportedCount !== extractedRowCount };
}
