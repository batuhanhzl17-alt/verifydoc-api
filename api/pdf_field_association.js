const FIELD_LABELS = {
  recipientName: [
    /^(?:ALICI\s+AD\s+SOYAD(?:\s*\/\s*UNVAN)?|ALICI\s+ADI|ALACAKLI(?:\s+ADI)?|ALICI\s+UNVANI)$/,
  ],
  recipientIBAN: [
    /^(?:ALICI|ALACAKLI)\s+(?:HESAP\s+NO\s*\/\s*)?IBAN$/,
    /^(?:ALICI|ALACAKLI)\s+HESAP\s+NUMARASI$/,
  ],
  amount: [
    /^(?:ISLEM|TRANSFER|GONDERILEN|ODEME|ANA|GIDEN(?:\s+FAST(?:\s+EFT)?)?)\s+TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    /^TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    /^PARA\s+CINSI\s+TUTAR$/,
  ],
};

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleUpperCase('tr-TR')
    .replace(/İ|I|ı/g, 'I').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/[:：]/g, ' ').replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function matchesLabel(field, value) {
  const normalized = normalizeLabel(value);
  if (!normalized || /MASRAF|KOMISYON|BSMV|VERGI|BAKIYE|TOPLAM TAHSILAT/.test(normalized)) return false;
  return (FIELD_LABELS[field] || []).some(pattern => pattern.test(normalized));
}

function normalizeIban(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function validTurkishIban(value) {
  const iban = normalizeIban(value);
  if (!/^TR\d{24}$/.test(iban)) return false;
  const reordered = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of reordered) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function validValue(field, value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (field === 'recipientIBAN') return validTurkishIban(text);
  if (field === 'amount') {
    return /^(?:[-+]?\s*)?(?:₺\s*)?\d[\d. ]*(?:,\d{1,2})?\s*(?:TL|TRY|₺)?$/i.test(text) &&
      !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text);
  }
  const clean = text.replace(/[^\p{L}'’ .-]/gu, ' ').replace(/\s+/g, ' ').trim();
  return clean.length >= 3 && clean.split(' ').filter(Boolean).length >= 2;
}

function boxForItems(items, pageWidth, pageHeight) {
  const x1 = Math.min(...items.map(item => item.x));
  const x2 = Math.max(...items.map(item => item.x + item.width));
  const top = Math.min(...items.map(item => item.top));
  const bottom = Math.max(...items.map(item => item.top + item.height));
  return {
    x: Number((x1 / pageWidth).toFixed(6)),
    y: Number((top / pageHeight).toFixed(6)),
    width: Number(((x2 - x1) / pageWidth).toFixed(6)),
    height: Number(((bottom - top) / pageHeight).toFixed(6)),
  };
}

function makeRows(items) {
  const rows = [];
  for (const item of [...items].sort((a, b) => b.baseline - a.baseline || a.x - b.x)) {
    const tolerance = Math.max(2.5, item.height * 0.55);
    let row = rows.find(candidate => Math.abs(candidate.baseline - item.baseline) <= tolerance);
    if (!row) {
      row = { baseline: item.baseline, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.baseline = row.items.reduce((sum, current) => sum + current.baseline, 0) / row.items.length;
  }
  for (const row of rows) row.items.sort((a, b) => a.x - b.x);
  return rows;
}

function labelSpans(row, field) {
  const spans = [];
  const items = row.items;
  for (let start = 0; start < items.length; start++) {
    for (let end = start; end < Math.min(items.length, start + 7); end++) {
      const group = items.slice(start, end + 1);
      const lastItem = group[group.length - 1];
      const previousItem = group[group.length - 2];
      if (previousItem && lastItem.x - (previousItem.x + previousItem.width) > Math.max(12, lastItem.height * 2.2)) break;
      const text = group.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
      if (matchesLabel(field, text)) spans.push({ text, items: group, start, end });
    }
  }
  return spans.sort((a, b) => (a.end - a.start) - (b.end - b.start));
}

function startsKnownLabel(items, index) {
  const first = normalizeLabel(items[index]?.text);
  if (/^(?:MASRAF|KOMISYON|BSMV|VERGI|SORGU NO|FIS NO|ISLEM NO|BAKIYE|TOPLAM)/.test(first)) return true;
  const tail = { items: items.slice(index, Math.min(items.length, index + 7)) };
  return Object.keys(FIELD_LABELS).some(field => labelSpans(tail, field).length > 0);
}

function resolveField(field, rows, pageWidth, pageHeight) {
  const candidates = [];
  for (const row of rows) {
    for (const label of labelSpans(row, field)) {
      const labelRight = Math.max(...label.items.map(item => item.x + item.width));
      const labelLeft = Math.min(...label.items.map(item => item.x));
      const nextLabelIndex = row.items.findIndex((_, index) => index > label.end && startsKnownLabel(row.items, index));
      const nextLabel = nextLabelIndex >= 0 ? row.items[nextLabelIndex] : null;
      const nextLabelX = nextLabel?.x ?? Infinity;
      const sameRow = row.items.slice(label.end + 1).filter(item => item.x >= labelRight - 1 && item.x < nextLabelX);
      let valueItems = sameRow;
      let valueText = sameRow.map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();

      // PDF text can split a long IBAN into neighboring lines. Only collect
      // TR-prefixed fragments in the narrow horizontal band to the right of
      // the typed recipient-IBAN label.
      if (field === 'recipientIBAN' && !validValue(field, valueText)) {
        const nearRows = rows.filter(candidate => candidate !== row && Math.abs(candidate.baseline - row.baseline) <= 1.8 * Math.max(8, ...label.items.map(item => item.height)));
        const fragments = nearRows.flatMap(candidate => candidate.items).filter(item =>
          item.x >= labelRight - 1 && item.x < Math.min(nextLabelX, labelRight + 240) &&
          /^[A-Z0-9\s-]+$/i.test(item.text) && /\d/.test(item.text) &&
          !Object.keys(FIELD_LABELS).some(key => matchesLabel(key, item.text))
        );
        if (fragments.length) {
          valueItems = [...sameRow, ...fragments].sort((a, b) => b.baseline - a.baseline || a.x - b.x);
          valueText = valueItems.map(item => item.text).join(' ');
        }
      }

      // If the label and value share one PDF text item, parse only its suffix.
      const inline = label.text.match(/[:：]\s*(.+)$/);
      if (inline?.[1] && !validValue(field, valueText)) valueText = inline[1].trim();
      if (!validValue(field, valueText)) continue;

      const labelBox = boxForItems(label.items, pageWidth, pageHeight);
      const valueBox = valueItems.length ? boxForItems(valueItems, pageWidth, pageHeight) : null;
      candidates.push({
        value: valueText,
        labelText: label.text,
        pageNumber: row.items[0]?.pageNumber || 1,
        labelBox,
        valueBox,
        resolver: 'pdf-text-layer-typed-label-coordinate-v1',
        validation: field === 'recipientIBAN' ? 'TR-IBAN-checksum' : field === 'amount' ? 'typed-amount-format' : 'typed-name-shape',
        associationValidated: true,
      });
    }
  }
  const distinct = new Map();
  for (const candidate of candidates) {
    const key = field === 'recipientIBAN'
      ? normalizeIban(candidate.value)
      : field === 'amount'
        ? candidate.value.replace(/[^0-9,.-]/g, '')
        : normalizeLabel(candidate.value);
    if (key && !distinct.has(key)) distinct.set(key, candidate);
  }
  const resolved = [...distinct.values()];
  if (resolved.length === 1) return { status: 'matched', ...resolved[0], candidateCount: 1 };
  if (resolved.length > 1) return { status: 'ambiguous', value: null, associationValidated: false, candidateCount: resolved.length, candidates: resolved };
  return { status: 'unavailable', value: null, associationValidated: false, candidateCount: 0, reason: 'typed-label-or-valid-neighbor-not-found' };
}

export async function extractPdfNativeFieldAssociations(pdf, { maxPages = 3 } = {}) {
  if (!pdf || typeof pdf.getPage !== 'function') return { available: false, status: 'pdf-unavailable', fields: {} };
  const collected = { recipientName: [], recipientIBAN: [], amount: [] };
  let pageCount = 0;
  for (let pageNumber = 1; pageNumber <= Math.min(Number(pdf.numPages) || 0, maxPages); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = Number(viewport.width) || 0;
    const pageHeight = Number(viewport.height) || 0;
    if (!(pageWidth > 0 && pageHeight > 0)) continue;
    const content = await page.getTextContent();
    const items = (content.items || []).filter(item => String(item.str || '').trim()).map(item => {
      const transform = item.transform || [];
      const x = Number(transform[4]) || 0;
      const baseline = Number(transform[5]) || 0;
      const height = Math.max(1, Number(item.height) || Number(transform[3]) || 8);
      return {
        text: String(item.str || '').trim(), x, baseline, height,
        top: Math.max(0, pageHeight - baseline - height),
        width: Math.max(0, Number(item.width) || 0), pageNumber,
      };
    });
    const rows = makeRows(items);
    for (const field of Object.keys(collected)) {
      const resolved = resolveField(field, rows, pageWidth, pageHeight);
      if (resolved.status === 'matched') collected[field].push(resolved);
      else if (resolved.status === 'ambiguous') collected[field].push(resolved);
    }
    pageCount++;
  }
  const fields = {};
  for (const field of Object.keys(collected)) {
    const rows = collected[field].filter(item => item.status === 'matched');
    const keys = new Set(rows.map(item => field === 'recipientIBAN'
      ? normalizeIban(item.value)
      : field === 'amount' ? item.value.replace(/[^0-9,.-]/g, '') : normalizeLabel(item.value)));
    if (keys.size === 1 && rows.length) fields[field] = { ...rows[0], pageMatchCount: rows.length };
    else if (keys.size > 1 || collected[field].some(item => item.status === 'ambiguous')) {
      fields[field] = { status: 'ambiguous', value: null, associationValidated: false, candidateCount: keys.size || collected[field].length, reason: 'multiple-pdf-pages-or-labeled-values' };
    } else fields[field] = { status: 'unavailable', value: null, associationValidated: false, candidateCount: 0, reason: 'typed-label-or-valid-neighbor-not-found' };
  }
  const matchedFieldCount = Object.values(fields).filter(field => field.status === 'matched').length;
  return {
    available: true,
    status: matchedFieldCount ? 'partial-or-full-match' : 'no-fields-matched',
    pageCount,
    matchedFieldCount,
    fields,
    source: 'pdf-text-layer-with-page-normalized-label-value-coordinates',
  };
}
