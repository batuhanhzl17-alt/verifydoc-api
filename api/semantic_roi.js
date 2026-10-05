/** Shared semantic helpers for receipt OCR fields. */

export function normalizeSemanticLabel(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/[İIı]/g, 'I')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Return the semantic name field for known recipient labels, never customer labels. */
export function recipientNameLabel(value) {
  const label = normalizeSemanticLabel(String(value ?? '').split(/[:：]/, 1)[0]);
  if (/^(MUSTERI|GONDEREN|GONDERICI)(?: |$)/.test(label)) return null;

  const compact = label.replace(/\s+/g, '');
  // Enpara/FAST variants can render the beneficiary label as "Alıcı",
  // "Alıcı Adı", "Alıcı Adı Soyadı", "Alıcı İsim/Unvan" or
  // "Alıcı Ünvanı". Do not accept "Alıcı Banka/Hesap/IBAN" here.
  if (/^(?:ALICI|ALACAKLI)(?:(?:ADI|ADISOYAD|ADISOYADI|ADSOYAD|ADSOYADI|UNVAN|UNVANI|ISIM|ISMI|ISIMUNVAN|ISIMUNVANI))?$/.test(compact)) return 'recipientName';
  if (/^(?:ALICI|ALACAKLI)(?:ADI|ADISOYAD|ADSOYAD|UNVAN|ISIM|ISIMUNVAN)(?:UNVANI|SOYADI)?$/.test(compact)) return 'recipientName';
  if (/^(?:BENEFICIARY|BENEFICIARYNAME|PAYEE|PAYEENAME|RECEIVER|RECEIVERNAME|LEHDAR|LEHDARADI|LEHDARUNVANI)$/.test(compact)) return 'recipientName';
  return null;
}

/** Only labels that explicitly identify the beneficiary/payee may own its IBAN ROI. */
export function recipientIbanLabel(value) {
  const compact = normalizeSemanticLabel(String(value ?? '').split(/[:：]/, 1)[0]).replace(/\s+/g, '');
  return /^(?:ALICI|ALACAKLI|LEHDAR)(?:(?:HESAP|BANKA)(?:IBAN|NO|NUMARASI)?|IBAN(?:NO|NUMARASI)?|HESAPNO|HESAPNUMARASI|HESABI)$/.test(compact) ||
    /^(?:BENEFICIARY|PAYEE|RECEIVER)(?:(?:ACCOUNT|BANK))?(?:IBAN|IBANNO|ACCOUNT|ACCOUNTNUMBER)$/.test(compact);
}

/** Sender and unqualified IBAN labels must never be promoted to recipientIban. */
export function senderIbanLabel(value) {
  const compact = normalizeSemanticLabel(String(value ?? '').split(/[:：]/, 1)[0]).replace(/\s+/g, '');
  return /^(?:GONDEREN|GONDERICI|SENDER|ORIGINATOR)(?:(?:HESAP|ACCOUNT))?(?:IBAN|HESAPNO|ACCOUNTNUMBER)$/.test(compact);
}

export function normalizeTurkishIban(value) {
  return String(value ?? '').toLocaleUpperCase('tr-TR').replace(/[^A-Z0-9]/g, '');
}

export function hasTurkishIbanShape(value) {
  return /^TR\d{24}$/.test(normalizeTurkishIban(value));
}

export function sameTurkishIban(a, b) {
  return hasTurkishIbanShape(a) && hasTurkishIbanShape(b) && normalizeTurkishIban(a) === normalizeTurkishIban(b);
}

export function shouldSuppressIbanLayoutMismatch(field, referenceValue, targetValue) {
  return field === 'recipientIban' && sameTurkishIban(referenceValue, targetValue);
}

function boxOf(item) {
  const r = item?.region || item;
  if (!r) return null;
  const x1 = Number(r.x1), y1 = Number(r.y1), x2 = Number(r.x2), y2 = Number(r.y2);
  return [x1, y1, x2, y2].every(Number.isFinite) && x2 > x1 && y2 > y1
    ? { x1, y1, x2, y2 }
    : null;
}



/**
 * V1.5.4: Enpara often returns the entire beneficiary block as one OCR region,
 * e.g. `ALICI UNVANI: Sudenaz Özel ALICI IBAN: TR...`.
 * A resolver that only looks at the first colon cannot recover either value.
 * Split known recipient labels inside the same OCR region and derive a tight
 * sub-box from the character span. This is geometry-first: OCR label matching
 * is used only to locate semantic anchors; the ROI itself is the value span.
 */
export function resolveRecipientInlineSegments(item) {
  const raw = String(item?.text || '').trim();
  const parent = boxOf(item);
  if (!raw || !parent) return [];

  const labelAlternatives = [
    'ALICI\\s+(?:UNVANI|UNVAN|ADI\\s+SOYADI|ADI|ISMI|ISIM\\s*[/]\\s*UNVAN)',
    'ALACAKLI\\s+(?:UNVANI|UNVAN|ADI\\s+SOYADI|ADI|ISMI|ISIM\\s*[/]\\s*UNVAN)',
    'BENEFICIARY\\s+NAME', 'PAYEE\\s+NAME', 'RECEIVER\\s+NAME',
    'ALICI\\s+(?:IBAN|HESAP(?:\\s+(?:NO|NUMARASI|IBAN))?|BANKA(?:\\s+(?:IBAN|NO|NUMARASI))?)',
    'ALACAKLI\\s+(?:IBAN|HESAP(?:\\s+(?:NO|NUMARASI|IBAN))?|BANKA(?:\\s+(?:IBAN|NO|NUMARASI))?)',
    'BENEFICIARY\\s+(?:IBAN|ACCOUNT(?:\\s+NUMBER)?|BANK(?:\\s+IBAN)?)',
    'PAYEE\\s+(?:IBAN|ACCOUNT(?:\\s+NUMBER)?|BANK(?:\\s+IBAN)?)',
    'RECEIVER\\s+(?:IBAN|ACCOUNT(?:\\s+NUMBER)?|BANK(?:\\s+IBAN)?)',
  ];
  const re = new RegExp(`(?:^|(?<=\\s))(${labelAlternatives.join('|')})(?=\\s*[:：]?)`, 'giu');
  const matches = [];
  let m;
  while ((m = re.exec(raw))) {
    const labelText = String(m[1] || '').trim();
    const normalized = normalizeSemanticLabel(labelText);
    const field = recipientIbanLabel(normalized) ? 'recipientIban'
      : recipientNameLabel(normalized) ? 'recipientName' : null;
    if (!field) continue;
    matches.push({ start: m.index + (m[0].length - m[1].length), end: re.lastIndex, labelText, field });
  }
  if (!matches.length) return [];

  const makeSubBox = (start, end) => {
    const totalW = Math.max(1, parent.x2 - parent.x1);
    const n = Math.max(1, raw.length);
    const x1 = parent.x1 + totalW * Math.max(0, Math.min(1, start / n));
    const x2 = parent.x1 + totalW * Math.max(0, Math.min(1, end / n));
    return { x1, y1: parent.y1, x2: Math.max(x1 + 2, x2), y2: parent.y2 };
  };

  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    let valueStart = current.end;
    while (valueStart < raw.length && /[\s:：]/u.test(raw[valueStart])) valueStart++;
    let valueEnd = next ? next.start : raw.length;
    while (valueEnd > valueStart && /[\s:：,;]+/u.test(raw[valueEnd - 1])) valueEnd--;
    const value = raw.slice(valueStart, valueEnd).trim();
    if (!value) continue;

    let valueText = value;
    if (current.field === 'recipientIban') {
      const normalizedIban = normalizeTurkishIban(value);
      if (!hasTurkishIbanShape(normalizedIban)) continue;
      valueText = normalizedIban;
    } else {
      // Reject transaction vocabulary or a second label accidentally absorbed
      // into the value. Names must remain human/company-name shaped.
      const words = value.split(/\s+/).filter(Boolean);
      const canonical = normalizeSemanticLabel(value);
      const action = /(?:^|\s)(?:GIDEN|FAST|EFT|HAVALE|TRANSFER|ISLEM|TUTAR|PARA|CINSI|IBAN|HESAP|BANKA|SORGU|NO)(?:$|\s)/u.test(canonical);
      const alphaTokenCount = words.filter(w => w.replace(/[^A-ZÇĞİÖŞÜa-zçğıöşü]/giu, '').length >= 2).length;
      // OCR can turn a glyph into a digit (e.g. Gök -> G6k). Once the
      // semantic label is trusted, do not reject the ROI solely because one
      // character is misrecognized. Reject only numeric/action-like content.
      if (action || alphaTokenCount < 2 || words.length < 2 || words.length > 6) continue;
    }

    // Tighten the ROI to the value characters, not the whole parent OCR line.
    // Keep a tiny horizontal padding so glyph edges are not clipped.
    const valueBox = makeSubBox(valueStart, valueEnd);
    const pad = Math.min(6, Math.max(1, (valueBox.x2 - valueBox.x1) * 0.025));
    valueBox.x1 = Math.max(parent.x1, valueBox.x1 - pad);
    valueBox.x2 = Math.min(parent.x2, valueBox.x2 + pad);
    out.push({
      text: valueText,
      valueText,
      field: current.field,
      labelText: current.labelText,
      region: valueBox,
      parentRegion: { ...parent },
      score: 180,
      criticalROI: true,
      resolver: 'semantic-inline-multi-label-v154',
    });
  }
  return out;
}

/** Resolve a line-wrapped Turkish IBAN into one logical value and union ROI. */
export function resolveSplitTurkishIban(regions, label) {
  const rows = Array.isArray(regions) ? regions : [];
  const labelBox = boxOf(label);
  if (!labelBox) return null;
  const labelText = String(label?.text && /[:：]/.test(label.text) ? label.text : (label?.labelText || label?.text || ''));
  const inlineParts = labelText.split(/[:：]/);
  const inline = inlineParts.length > 1 ? inlineParts.slice(1).join(' ') : '';
  const pool = rows
    .filter(item => item && item !== label && String(item.text || '').trim())
    .map(item => ({ item, box: boxOf(item), text: String(item.text || '').trim() }))
    .filter(row => row.box);

  const starts = [];
  if (inline && /^\s*TR/i.test(inline)) starts.push({ item: label, box: labelBox, text: inline, inline: true });
  for (const row of pool) if (/^\s*TR/i.test(row.text)) starts.push({ ...row, inline: false });

  const labelH = Math.max(6, labelBox.y2 - labelBox.y1);
  const solutions = [];
  for (const start of starts) {
    const first = normalizeTurkishIban(start.text);
    const startBox = start.box;
    const rightGap = startBox.x1 - labelBox.x2;
    const verticalOverlap = Math.min(startBox.y2, labelBox.y2) - Math.max(startBox.y1, labelBox.y1);
    const sameLine = verticalOverlap >= -labelH * 0.45 && rightGap >= -labelH * 0.25 && rightGap < Math.max(420, labelH * 18);
    const belowGap = startBox.y1 - labelBox.y2;
    const below = belowGap >= -labelH * 0.3 && belowGap < Math.max(150, labelH * 5);
    if (!sameLine && !below && !start.inline) continue;

    const initialCost = start.inline ? 0 : sameLine
      ? Math.abs(rightGap) / labelH + Math.abs((startBox.y1 + startBox.y2 - labelBox.y1 - labelBox.y2) / 2) / labelH * 0.7
      : 3 + Math.max(0, belowGap) / labelH;
    if (first.length === 26 && /^TR\d{24}$/.test(first)) {
      solutions.push({ value: first, box: startBox, cost: initialCost });
      continue;
    }
    if (!/^TR\d{2}/.test(first) || first.length >= 26) continue;

    const startH = Math.max(6, startBox.y2 - startBox.y1);
    for (const tail of pool) {
      if (tail.item === start.item || /^\s*TR/i.test(tail.text)) continue;
      const fragment = normalizeTurkishIban(tail.text);
      if (!/^\d{2,24}$/.test(fragment) || first.length + fragment.length !== 26) continue;
      const gap = tail.box.y1 - startBox.y2;
      const overlap = Math.min(tail.box.x2, startBox.x2) - Math.max(tail.box.x1, startBox.x1);
      const overlapRatio = overlap / Math.max(1, Math.min(tail.box.x2 - tail.box.x1, startBox.x2 - startBox.x1));
      const centerDelta = Math.abs((tail.box.x1 + tail.box.x2 - startBox.x1 - startBox.x2) / 2);
      if (gap < -startH * 0.3 || gap > startH * 2.8 || (overlapRatio < 0.15 && centerDelta > startH * 5)) continue;
      solutions.push({
        value: first + fragment,
        box: { x1: Math.min(startBox.x1, tail.box.x1), y1: Math.min(startBox.y1, tail.box.y1), x2: Math.max(startBox.x2, tail.box.x2), y2: Math.max(startBox.y2, tail.box.y2) },
        cost: initialCost + 2 + Math.max(0, gap) / startH + centerDelta / startH * 0.1,
      });
    }
  }
  solutions.sort((a, b) => a.cost - b.cost);
  const best = solutions[0];
  return best ? { text: best.value, region: best.box, score: 100, criticalROI: true, resolver: 'semantic-iban-line-join-v1' } : null;
}
