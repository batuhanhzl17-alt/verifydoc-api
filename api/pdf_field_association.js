const FIELD_LABELS = {
  recipientName: [
    /^(?:ALICI\s+AD\s+SOYAD(?:\s*\/\s*UNVAN)?|ALICI\s+ADI|ALACAKLI(?:\s+ADI)?|ALICI\s+UNVANI)$/,
  ],
  recipientIBAN: [
    /^(?:ALICI|ALACAKLI)\s+(?:HESAP\s+NO\s*\/\s*)?IBAN$/,
    /^(?:ALICI|ALACAKLI)\s+HESAP\s+NUMARASI$/,
    // Some banks label the beneficiary account simply "ALICI HESAP".
    // This is safe because the value must still pass the Turkish IBAN checksum.
    /^(?:ALICI|ALACAKLI)\s+HESAP(?:\s+(?:NO|NUMARASI))?$/,
  ],
  amount: [
    /^(?:ISLEM|TRANSFER|GONDERILEN|ODEME|ANA|GIDEN(?:\s+FAST(?:\s+EFT)?)?)\s+TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    // Vakifbank PDFs may omit the first glyph of the embedded-font label
    // during text extraction ("İŞLEM TUTARI" becomes "LEM TUTARI").
    /^LEM\s+TUTAR(?:I)?$/,
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
  if (field === 'recipientIBAN') {
    // PDF text extraction may lose spaces/slashes from the Vakıfbank-style
    // "ALICI HESAP NO / IBAN" label. Match its canonical form, while
    // deliberately excluding the unrelated label "ALICI BANKA".
    const compact = normalized.replace(/[^A-Z0-9]/g, '');
    if (/^(?:ALICI|ALACAKLI)(?:IBAN|IBANNO|IBANNUMARASI|HESAP|HESAPNO|HESAPNUMARASI|HESAPIBAN|HESAPNOIBAN|HESAPNUMARASIIBAN)$/.test(compact)) return true;
    if (/^(?:LEHDAR)(?:IBAN|IBANNO|HESAP|HESAPNO|HESAPNUMARASI|HESAPIBAN|HESAPNOIBAN)$/.test(compact)) return true;
  }
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

function cleanAssociatedValue(field, value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  // Separators are often exposed as standalone PDF text items between the
  // label and value. Do not leak them into the extracted field value.
  // Keep an amount's leading minus sign; it is part of the transaction value.
  text = text.replace(/^[\s:：=]+/, '').trim();
  return text;
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
      // A PDF can store "LABEL: value" in a single text item. Match only the
      // exact typed label prefix, then associate the suffix as its value.
      const inline = text.match(/^(.{2,80}?)[：:]\s*(\S[\s\S]*)$/);
      if (inline && matchesLabel(field, inline[1])) {
        spans.push({ text: inline[1].trim(), inlineValue: inline[2].trim(), items: group, start, end });
      }
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
      const sameRow = row.items.slice(label.end + 1).filter(item =>
        item.x >= labelRight - 1 && item.x < nextLabelX && !/^[:：=]+$/.test(String(item.text || '').trim())
      );
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
      if (label.inlineValue && !validValue(field, valueText)) valueText = label.inlineValue;
      const inline = label.text.match(/[:：]\s*(.+)$/);
      if (inline?.[1] && !validValue(field, valueText)) valueText = inline[1].trim();
      valueText = cleanAssociatedValue(field, valueText);
      if (!validValue(field, valueText)) continue;

      let labelBoxItems = label.items;
      if (label.inlineValue) {
        const colonIndex = label.items.findIndex(item => /[:：]/.test(String(item.text || '')));
        if (colonIndex >= 0) {
          labelBoxItems = label.items.slice(0, colonIndex + 1);
          const colonItem = labelBoxItems[labelBoxItems.length - 1];
          const colonText = String(colonItem.text || '');
          const colonPosition = colonText.search(/[:：]/);
          if (colonPosition >= 0 && colonPosition < colonText.length - 1) {
            const prefixLength = colonPosition + 1;
            labelBoxItems[labelBoxItems.length - 1] = {
              ...colonItem,
              text: colonText.slice(0, prefixLength),
              width: colonItem.width * prefixLength / Math.max(1, colonText.length),
            };
          }
        }
      }
      const labelBox = boxForItems(labelBoxItems, pageWidth, pageHeight);
      let inlineValueItems = null;
      if (label.inlineValue && validValue(field, cleanAssociatedValue(field, label.inlineValue))) {
        const colonIndex = label.items.findIndex(item => /[:：]/.test(String(item.text || '')));
        if (colonIndex >= 0) {
          const colonItem = label.items[colonIndex];
          const colonText = String(colonItem.text || '');
          const separatorIndex = colonText.search(/[:：]/);
          const suffix = separatorIndex >= 0 ? colonText.slice(separatorIndex + 1).trim() : '';
          const suffixItems = label.items.slice(colonIndex + 1);
          const suffixValueItems = [];
          if (suffix) {
            const valueStart = colonText.indexOf(suffix);
            const startRatio = valueStart / Math.max(1, colonText.length);
            const widthRatio = suffix.length / Math.max(1, colonText.length);
            suffixValueItems.push({
              ...colonItem,
              text: suffix,
              x: colonItem.x + colonItem.width * startRatio,
              width: colonItem.width * widthRatio,
            });
          }
          inlineValueItems = [...suffixValueItems, ...suffixItems];
        } else if (label.items.length === 1) {
          const item = label.items[0];
          const fullText = String(item.text || '');
          const valueStart = fullText.indexOf(label.inlineValue);
          if (valueStart >= 0 && fullText.length > 0) {
            const startRatio = valueStart / fullText.length;
            const widthRatio = label.inlineValue.length / fullText.length;
            inlineValueItems = [{
              ...item,
              text: label.inlineValue,
              x: item.x + item.width * startRatio,
              width: item.width * widthRatio,
            }];
          }
        }
      }
      const valueBox = inlineValueItems?.length
        ? boxForItems(inlineValueItems, pageWidth, pageHeight)
        : valueItems.length ? boxForItems(valueItems, pageWidth, pageHeight) : null;
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
    const view = Array.isArray(viewport.transform) && viewport.transform.length === 6
      ? viewport.transform.map(Number)
      : [1, 0, 0, 1, 0, 0];
    const content = await page.getTextContent();
    const items = (content.items || []).filter(item => String(item.str || '').trim()).map(item => {
      const transform = item.transform || [];
      // Text item matrices are in PDF user space. Apply the page viewport
      // transform (rotation + crop-box translation + scale) before comparing
      // target and reference coordinates in normalized page space.
      const a = Number(transform[0]) || 1;
      const b = Number(transform[1]) || 0;
      const c = Number(transform[2]) || 0;
      const d = Number(transform[3]) || 1;
      const e = Number(transform[4]) || 0;
      const f = Number(transform[5]) || 0;
      // PDF.js text item width/height are already expressed in page units;
      // the text matrix supplies orientation only. Applying its font scale to
      // width/height again inflated boxes (and row tolerances) beyond the page.
      const width = Math.max(0, Number(item.width) || 0);
      const height = Math.max(1, Number(item.height) || Math.hypot(c, d) || 8);
      const xAxisLength = Math.hypot(a, b) || 1;
      const yAxisLength = Math.hypot(c, d) || 1;
      const xAxis = [a / xAxisLength, b / xAxisLength];
      const yAxis = [c / yAxisLength, d / yAxisLength];
      const origin = [
        view[0] * e + view[2] * f + view[4],
        view[1] * e + view[3] * f + view[5],
      ];
      const widthVector = [
        view[0] * xAxis[0] * width + view[2] * xAxis[1] * width,
        view[1] * xAxis[0] * width + view[3] * xAxis[1] * width,
      ];
      const heightVector = [
        view[0] * yAxis[0] * height + view[2] * yAxis[1] * height,
        view[1] * yAxis[0] * height + view[3] * yAxis[1] * height,
      ];
      const corners = [
        [0, 0], widthVector, heightVector,
        [widthVector[0] + heightVector[0], widthVector[1] + heightVector[1]],
      ].map(([dx, dy]) => [origin[0] + dx, origin[1] + dy]);
      const x = Math.min(...corners.map(point => point[0]));
      const right = Math.max(...corners.map(point => point[0]));
      const top = Math.min(...corners.map(point => point[1]));
      const bottom = Math.max(...corners.map(point => point[1]));
      const baseline = origin[1];
      return {
        text: String(item.str || '').trim(), x, baseline,
        top: Math.max(0, top), height: Math.max(1, bottom - top),
        width: Math.max(0, right - x), pageNumber,
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
