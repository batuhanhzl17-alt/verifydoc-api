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
  return {
    x: Math.max(0, Math.min(1, pixelBox.x / width)),
    y: Math.max(0, Math.min(1, pixelBox.y / height)),
    width: Math.max(0.0001, Math.min(1, pixelBox.width / width)),
    height: Math.max(0.0001, Math.min(1, pixelBox.height / height)),
  };
}

export function resolveStatementPaddleOcrRow(row, regions, pageNumber, pageGeometry = null) {
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
    const exactTuple = amountItems.length === 1 && (expectedBalance == null || balanceItems.length === 1);
    if (!exactTuple || (!descriptionMatched && !idMatched && expectedBalance == null)) continue;
    if (candidates.some(candidate => Math.abs(candidate.cy - anchor.cy) <= Math.max(candidate.tolerance, anchor.tolerance))) continue;
    candidates.push({ cy: anchor.cy, tolerance: anchor.tolerance, band, amount: amountItems[0], balance: balanceItems.length === 1 ? balanceItems[0] : null,
      lineText, descriptionMatched, idMatched });
  }

  if (candidates.length !== 1) return {
    status: 'unresolved', source: 'paddle-ocr-geometry', dateAnchorCount: dateAnchors.length,
    distinctCandidateLineCount: candidates.length,
    reason: candidates.length ? `${candidates.length} PaddleOCR satır adayı kaldı; güvenli seçim yapılamadı.`
      : 'PaddleOCR geometri satırlarında tarih, tutar ve varsa bakiye tekil olarak eşleşmedi.',
  };

  const candidate = candidates[0];
  const amountBox = pdfBox(candidate.amount.box, pageGeometry);
  const balanceBox = candidate.balance ? pdfBox(candidate.balance.box, pageGeometry) : null;
  return {
    status: 'matched', source: 'paddle-ocr-geometry', dateAnchorCount: dateAnchors.length,
    distinctCandidateLineCount: 1, reason: 'PaddleOCR kutularında tarih, işlem tutarı ve varsa bakiye aynı satır bandında tekil eşleşti.',
    amountText: candidate.amount.token.text, amountBox, balanceBox,
    geometryMappedToPdf: Boolean(amountBox),
    ocrConfidence: Math.round(Math.min(candidate.amount.score, candidate.balance?.score ?? candidate.amount.score) * 100),
    descriptionMatched: candidate.descriptionMatched, transactionIdMatched: candidate.idMatched,
    rowBand: { y: candidate.cy, itemCount: candidate.band.length },
  };
}
