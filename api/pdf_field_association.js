const FIELD_LABELS = {
  recipientName: [
    /^(?:ALICI\s+AD\s+SOYAD(?:\s*\/\s*UNVAN)?|ALICI\s+ADI|ALACAKLI(?:\s+ADI)?|ALICI\s+UNVANI|LEHDAR(?:\s+ADI)?|FAYDALANICI(?:\s+ADI)?)$/,
  ],
  recipientIBAN: [
    /^(?:ALICI|ALACAKLI)\s+(?:HESAP\s+NO\s*\/\s*)?IBAN$/,
    /^(?:ALICI|ALACAKLI)\s+HESAP\s+NUMARASI$/,
    // Some banks label the beneficiary account simply "ALICI HESAP".
    // This is safe because the value must still pass the Turkish IBAN checksum.
    /^(?:ALICI|ALACAKLI)\s+HESAP(?:\s+(?:NO|NUMARASI))?$/,
    /^(?:LEHDAR|FAYDALANICI)\s+(?:HESAP(?:\s*(?:NO|NUMARASI))?\s*)?IBAN$/,
  ],
  amount: [
    /^(?:ISLEM|TRANSFER|GONDERILEN|ODEME|ANA|GIDEN(?:\s+FAST(?:\s+EFT)?)?)\s+TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    // Vakifbank PDFs may omit the first glyph of the embedded-font label
    // during text extraction ("İŞLEM TUTARI" becomes "LEM TUTARI").
    /^LEM\s+TUTAR(?:I)?$/,
    /^TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    /^PARA\s+CINSI\s+TUTAR$/,
    // Enpara receipts label the amount column "B/A Para Cinsi Tutar".
    // Accept both the slash form and text extraction that separates B and A.
    /^B\s*\/?\s*A\s+PARA\s+CINSI\s+TUTAR$/,
    /^(?:FAST|FAST\s+ISLEM|FAST\s+TRANSFER|FAST\s+ODEME|FAST\s+GONDERIM|ISLEM|TRANSFER|GONDERIM|GONDERILEN|ALICIYA\s+GIDEN)\s+TUTAR(?:I)?(?:\s+(?:TL|TRY))?$/,
    /^(?:ISLEM|TRANSFER|FAST|GIDEN\s+FAST)\s+TUTAR(?:I)?\s*\(\s*(?:TL|TRY)\s*\)$/,
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
    if (/^(?:FAYDALANICI)(?:IBAN|IBANNO|HESAP|HESAPNO|HESAPNUMARASI|HESAPIBAN)$/.test(compact)) return true;
  }
  return (FIELD_LABELS[field] || []).some(pattern => pattern.test(normalized));
}

export function matchesPdfFieldLabel(field, value) {
  return matchesLabel(field, value);
}

function normalizeIban(value) {
  return String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function turkishIbanSpan(value) {
  const source = String(value || '');
  const startAt = source.search(/TR(?=\s*[0-9])/i);
  if (startAt < 0) return null;
  let compact = '';
  let end = startAt;
  for (let index = startAt; index < source.length && compact.length < 26; index++) {
    const char = source[index];
    if (/[a-z0-9]/i.test(char)) compact += char.toUpperCase();
    end = index + 1;
  }
  if (!validTurkishIban(compact)) return null;
  return { value: compact, start: startAt, end };
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
  if (field === 'recipientIBAN') return Boolean(turkishIbanSpan(text));
  if (field === 'amount') {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const amountPattern = /^(?:[-+]?\s*)?(?:₺\s*)?(?:(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:TL|TRY|₺)?$/i;
    return amountPattern.test(normalized) && !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(normalized);
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
  const trace = { typedLabelCandidates: 0, multilineJoinAttempts: 0, checksumValidValues: 0 };
  for (const row of rows) {
    for (const label of labelSpans(row, field)) {
      let usedAmountHeaderNextRow = false;
      trace.typedLabelCandidates++;
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

      // Enpara receipts place the "B/A Para Cinsi Tutar" heading on the
      // table-header row, while the transaction amount sits directly below it.
      // Associate only a unique, amount-shaped text item in the next lower row
      // and within the header's column; never guess when multiple values fit.
      if (field === 'amount' && !validValue(field, valueText)) {
        const labelHeight = Math.max(1, ...label.items.map(item => item.height));
        const belowRows = rows
          .filter(candidate => candidate !== row && candidate.baseline > row.baseline + 1 &&
            candidate.baseline - row.baseline <= Math.max(20, labelHeight * 4.5))
          .sort((a, b) => a.baseline - b.baseline);
        const nextRow = belowRows[0];
        if (nextRow) {
          const labelLeft = Math.min(...label.items.map(item => item.x));
          const labelRight = Math.max(...label.items.map(item => item.x + item.width));
          const columnRight = labelRight + Math.max(30, (labelRight - labelLeft) * 0.75);
          const amountCandidates = nextRow.items.filter(item =>
            item.x < columnRight && item.x + item.width > labelLeft && validValue(field, item.text)
          );
          const distinctAmounts = new Map(amountCandidates.map(item => [
            String(item.text).replace(/[^0-9,.-]/g, ''), item
          ]));
          if (distinctAmounts.size === 1) {
            valueItems = [distinctAmounts.values().next().value];
            valueText = valueItems[0].text;
            usedAmountHeaderNextRow = true;
          }
        }
      }

      // PDF text can split a long IBAN into neighboring lines. Only collect
      // TR-prefixed fragments in the narrow horizontal band to the right of
      // the typed recipient-IBAN label.
      if (field === 'recipientIBAN' && !validValue(field, valueText)) {
        trace.multilineJoinAttempts++;
        const nearRows = rows.filter(candidate => candidate !== row && Math.abs(candidate.baseline - row.baseline) <= 1.8 * Math.max(8, ...label.items.map(item => item.height)));
        const fragments = nearRows.flatMap(candidate => candidate.items).filter(item =>
          item.x >= labelRight - 1 && item.x < Math.min(nextLabelX, labelRight + 240) &&
          /^[A-Z0-9\s-]+$/i.test(item.text) && /\d/.test(item.text) &&
          !Object.keys(FIELD_LABELS).some(key => matchesLabel(key, item.text))
        );
        if (fragments.length) {
          // `baseline` is measured after the PDF.js viewport transform, where
          // Y grows down the page. Reading order is therefore top-to-bottom
          // (ascending baseline). Sorting descending silently reversed
          // multi-line IBANs such as `TR31 ... 0268` + `6128 ... 01`, causing
          // an otherwise valid IBAN to fail shape/checksum validation.
          valueItems = [...new Set([...sameRow, ...fragments])]
            .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
          valueText = valueItems.map(item => item.text).join(' ');
        }
      }

      // If the label and value share one PDF text item, parse only its suffix.
      if (label.inlineValue && !validValue(field, valueText)) valueText = label.inlineValue;
      const inline = label.text.match(/[:：]\s*(.+)$/);
      if (inline?.[1] && !validValue(field, valueText)) valueText = inline[1].trim();
      valueText = cleanAssociatedValue(field, valueText);
      const recipientIbanSpan = field === 'recipientIBAN' ? turkishIbanSpan(valueText) : null;
      if (recipientIbanSpan) valueText = recipientIbanSpan.value;
      if (!validValue(field, valueText)) continue;
      if (field === 'recipientIBAN') trace.checksumValidValues++;

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
      const rawInlineValue = label.inlineValue ? cleanAssociatedValue(field, label.inlineValue) : '';
      const inlineIbanSpan = field === 'recipientIBAN' ? turkishIbanSpan(rawInlineValue) : null;
      if (label.inlineValue && validValue(field, rawInlineValue)) {
        const colonIndex = label.items.findIndex(item => /[:：]/.test(String(item.text || '')));
        if (colonIndex >= 0) {
          const colonItem = label.items[colonIndex];
          const colonText = String(colonItem.text || '');
          const separatorIndex = colonText.search(/[:：]/);
          const suffix = separatorIndex >= 0 ? colonText.slice(separatorIndex + 1).trim() : '';
          const suffixItems = label.items.slice(colonIndex + 1).map(item => {
            if (field !== 'recipientIBAN') return item;
            const itemText = String(item.text || '');
            const itemIbanSpan = turkishIbanSpan(itemText);
            if (!itemIbanSpan || !itemText.length) return item;
            const startRatio = itemIbanSpan.start / itemText.length;
            const widthRatio = (itemIbanSpan.end - itemIbanSpan.start) / itemText.length;
            return {
              ...item,
              text: itemIbanSpan.value,
              x: item.x + item.width * startRatio,
              width: item.width * widthRatio,
            };
          });
          const suffixValueItems = [];
          if (suffix) {
            const suffixSpan = field === 'recipientIBAN' ? turkishIbanSpan(suffix) : null;
            const visibleValue = suffixSpan ? suffix.slice(suffixSpan.start, suffixSpan.end) : suffix;
            const valueStart = colonText.indexOf(suffix) + (suffixSpan?.start || 0);
            const valueLength = visibleValue.length;
            const startRatio = valueStart / Math.max(1, colonText.length);
            const widthRatio = valueLength / Math.max(1, colonText.length);
            suffixValueItems.push({
              ...colonItem,
              text: visibleValue,
              x: colonItem.x + colonItem.width * startRatio,
              width: Math.max(0, colonItem.width * widthRatio),
            });
          }
          inlineValueItems = [...suffixValueItems, ...suffixItems];
        } else if (label.items.length === 1) {
          const item = label.items[0];
          const fullText = String(item.text || '');
          const valueStart = fullText.indexOf(label.inlineValue);
          if (valueStart >= 0 && fullText.length > 0) {
            const start = valueStart + (inlineIbanSpan?.start || 0);
            const length = inlineIbanSpan ? inlineIbanSpan.end - inlineIbanSpan.start : label.inlineValue.length;
            const startRatio = start / fullText.length;
            const widthRatio = length / fullText.length;
            inlineValueItems = [{
              ...item,
              text: inlineIbanSpan?.value || label.inlineValue,
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
        resolver: field === 'recipientIBAN'
          ? 'pdf-text-layer-typed-label-coordinate-v2-top-down-iban-join'
          : usedAmountHeaderNextRow
            ? 'pdf-text-layer-typed-amount-header-next-row-column-v1'
            : 'pdf-text-layer-typed-label-coordinate-v1',
        validation: field === 'recipientIBAN' ? 'TR-IBAN-checksum' : field === 'amount' ? 'typed-amount-format' : 'typed-name-shape',
        associationValidated: true,
        ...(field === 'recipientIBAN' ? { associationTrace: trace } : {}),
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
  if (resolved.length > 1) return { status: 'ambiguous', value: null, associationValidated: false, candidateCount: resolved.length, candidates: resolved,
    ...(field === 'recipientIBAN' ? { associationTrace: trace } : {}) };
  return { status: 'unavailable', value: null, associationValidated: false, candidateCount: 0, typedLabelCandidates: trace.typedLabelCandidates, reason: trace.typedLabelCandidates ? 'typed-label-found-valid-value-not-found' : 'typed-label-not-found',
    ...(field === 'recipientIBAN' ? { associationTrace: trace } : {}) };
}

export async function extractPdfNativeFieldAssociations(pdf, { maxPages = 3 } = {}) {
  if (!pdf || typeof pdf.getPage !== 'function') return { available: false, status: 'pdf-unavailable', fields: {} };
  const collected = { recipientName: [], recipientIBAN: [], amount: [] };
  const labelTrace = { recipientName: 0, recipientIBAN: 0, amount: 0 };
  const ibanPageTrace = [];
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
      labelTrace[field] += rows.reduce((sum, row) => sum + labelSpans(row, field).length, 0);
      const resolved = resolveField(field, rows, pageWidth, pageHeight);
      if (field === 'recipientIBAN') ibanPageTrace.push({
        pageNumber,
        status: resolved.status,
        ...(resolved.associationTrace || {}),
      });
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
    } else {
      const labelCount = labelTrace[field];
      fields[field] = { status: 'unavailable', value: null, associationValidated: false, candidateCount: 0, typedLabelCandidates: labelCount, reason: labelCount ? 'typed-label-found-valid-value-not-found' : 'typed-label-not-found' };
    }
    if (field === 'recipientIBAN') fields[field].associationTrace = {
      pages: ibanPageTrace,
      totalTypedLabelCandidates: ibanPageTrace.reduce((sum, item) => sum + (item.typedLabelCandidates || 0), 0),
      totalMultilineJoinAttempts: ibanPageTrace.reduce((sum, item) => sum + (item.multilineJoinAttempts || 0), 0),
      totalChecksumValidValues: ibanPageTrace.reduce((sum, item) => sum + (item.checksumValidValues || 0), 0),
    };
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

// Apply the same typed-label and value validation to positioned OCR regions
// when a PDF has no usable text layer. OCR coordinates are mapped back into
// PDF page units, so they can be compared with native reference coordinates.
export async function extractPdfOcrFieldAssociations(pdf, ocr, { imageWidth, imageHeight, maxPages = 3 } = {}) {
  if (!pdf || typeof pdf.getPage !== 'function' || !Array.isArray(ocr?.regions) || !ocr.regions.some(region => region?.region && String(region.text || '').trim()) || !(imageWidth > 0 && imageHeight > 0)) {
    return { available: false, status: 'ocr-geometry-unavailable', fields: {} };
  }
  const collected = { recipientName: [], recipientIBAN: [], amount: [] };
  const labelTrace = { recipientName: 0, recipientIBAN: 0, amount: 0 };
  let pageCount = 0;
  for (let pageNumber = 1; pageNumber <= Math.min(Number(pdf.numPages) || 0, maxPages); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = Number(viewport.width) || 0;
    const pageHeight = Number(viewport.height) || 0;
    if (!(pageWidth > 0 && pageHeight > 0)) continue;
    const sx = pageWidth / imageWidth;
    const sy = pageHeight / imageHeight;
    const items = ocr.regions.filter(region =>
      region?.region && String(region.text || '').trim() &&
      (Number(region.pageIndex) === pageNumber - 1 || region.pageIndex == null)
    ).map(region => {
      const r = region.region;
      const x = Number(r.x1) * sx;
      const top = Number(r.y1) * sy;
      const right = Number(r.x2) * sx;
      const bottom = Number(r.y2) * sy;
      return {
        text: String(region.text || '').trim(), x, top,
        width: Math.max(0, right - x), height: Math.max(1, bottom - top),
        baseline: bottom, pageNumber,
      };
    }).filter(item => Number.isFinite(item.x) && Number.isFinite(item.top) && item.width > 0 && item.height > 0);
    const rows = makeRows(items);
    for (const field of Object.keys(collected)) {
      labelTrace[field] += rows.reduce((sum, row) => sum + labelSpans(row, field).length, 0);
      const resolved = resolveField(field, rows, pageWidth, pageHeight);
      if (resolved.status === 'matched' || resolved.status === 'ambiguous') collected[field].push(resolved);
    }
    pageCount++;
  }
  const fields = {};
  for (const field of Object.keys(collected)) {
    const matches = collected[field].filter(item => item.status === 'matched');
    const typedLabelCandidates = labelTrace[field];
    const keyOf = item => field === 'recipientIBAN' ? normalizeIban(item.value)
      : field === 'amount' ? item.value.replace(/[^0-9,.-]/g, '') : normalizeLabel(item.value);
    const distinct = new Map(matches.map(item => [keyOf(item), item]));
    if (distinct.size === 1) fields[field] = { ...[...distinct.values()][0], typedLabelCandidates, source: 'paddle-ocr-label-value-geometry', resolver: `paddle-ocr-${[...distinct.values()][0].resolver}`, pageMatchCount: matches.length };
    else if (distinct.size > 1 || collected[field].some(item => item.status === 'ambiguous')) fields[field] = { status: 'ambiguous', value: null, associationValidated: false, typedLabelCandidates, candidateCount: distinct.size || collected[field].length, reason: 'multiple-ocr-pages-or-labeled-values', source: 'paddle-ocr-label-value-geometry' };
    else fields[field] = { status: 'unavailable', value: null, associationValidated: false, candidateCount: 0, typedLabelCandidates, reason: typedLabelCandidates ? 'ocr-typed-label-found-valid-value-not-found' : 'ocr-typed-label-not-found', source: 'paddle-ocr-label-value-geometry' };
  }
  const matchedFieldCount = Object.values(fields).filter(field => field.status === 'matched').length;
  const overallConfidence = Number(ocr.confidence) || 0;
  return {
    available: true,
    status: matchedFieldCount ? 'partial-or-full-match' : 'no-fields-matched',
    pageCount,
    matchedFieldCount,
    fields,
    coverageAdequate: ocr.regions.length >= 5 && String(ocr.text || '').trim().length >= 30 && overallConfidence >= 60,
    confidence: overallConfidence,
    source: 'paddle-ocr-label-value-geometry-mapped-to-normalized-pdf-page',
  };
}

export function mergePdfFieldAssociationsWithOcr(nativeResult, ocrResult) {
  if (!nativeResult?.available) return ocrResult || nativeResult || { available: false, fields: {} };
  if (!ocrResult?.available) {
    const fields = Object.fromEntries(Object.entries(nativeResult.fields || {}).map(([field, item]) => [field, {
      ...item,
      referencePresence: item?.status === 'matched' || item?.status === 'ambiguous' || (item?.typedLabelCandidates || 0) > 0 ? 'present' : 'unknown',
      ocrAssociation: null,
      crossSourceConflict: false,
    }]));
    return { ...nativeResult, fields, sources: ['pdf-text-layer'] };
  }
  const amountKey = value => {
    let raw = String(value || '').replace(/[^0-9,.-]/g, '');
    const negative = raw.startsWith('-');
    raw = raw.replace(/-/g, '');
    const separator = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
    let whole = raw, fraction = '';
    if (separator >= 0 && raw.length - separator - 1 > 0 && raw.length - separator - 1 <= 2) {
      whole = raw.slice(0, separator);
      fraction = raw.slice(separator + 1);
    }
    return `${negative ? '-' : ''}${whole.replace(/\D/g, '').replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0') || '00'}`;
  };
  const fields = {};
  for (const field of Object.keys(nativeResult.fields || {})) {
    const nativeField = nativeResult.fields[field];
    const ocrField = ocrResult.fields?.[field];
    const referencePresence = nativeField?.status === 'matched' || nativeField?.status === 'ambiguous' || (nativeField?.typedLabelCandidates || 0) > 0 ||
      ocrField?.status === 'matched' || ocrField?.status === 'ambiguous' || (ocrField?.typedLabelCandidates || 0) > 0
      ? 'present'
      : (nativeResult.available && ocrResult.coverageAdequate === true ? 'absent' : 'unknown');
    if (nativeField?.status === 'matched') {
      fields[field] = {
        ...nativeField,
        referencePresence,
        ocrAssociation: ocrField?.status === 'matched' ? ocrField : null,
        crossSourceConflict: Boolean(ocrField?.status === 'matched' &&
          (field === 'recipientIBAN' ? normalizeIban(nativeField.value) !== normalizeIban(ocrField.value)
            : field === 'amount' ? amountKey(nativeField.value) !== amountKey(ocrField.value)
              : normalizeLabel(nativeField.value) !== normalizeLabel(ocrField.value))),
      };
    } else if (nativeField?.status === 'ambiguous') {
      fields[field] = { ...nativeField, referencePresence, ocrAssociation: ocrField?.status === 'matched' ? ocrField : null, crossSourceConflict: Boolean(ocrField?.status === 'matched') };
    } else if (ocrField?.status === 'matched') {
      fields[field] = { ...ocrField, referencePresence, nativeAssociation: nativeField || null, fallbackUsed: true };
    } else {
      fields[field] = { ...nativeField, referencePresence, ocrAssociation: ocrField || null };
    }
  }
  return {
    ...nativeResult,
    status: Object.values(fields).some(field => field.status === 'matched') ? 'partial-or-full-match' : nativeResult.status,
    fields,
    sources: ['pdf-text-layer', 'paddle-ocr-label-value-geometry'],
  };
}
