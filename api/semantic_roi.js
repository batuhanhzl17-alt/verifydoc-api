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
  if (/^(?:ALICI|ALACAKLI)(?:(?:ADI|ADISOYAD|ADISOYADI|ADSOYAD|ADSOYADI|UNVAN|UNVANI|ISIM|ISMI))?$/.test(compact)) return 'recipientName';
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

export function resolveRecipientInlineSegments(row) {
  const raw = String(row?.text ?? '').trim();
  const r = row?.region;
  if (!raw || !r) return [];
  const x1 = Number(r.x1), y1 = Number(r.y1), x2 = Number(r.x2), y2 = Number(r.y2);
  if (![x1,y1,x2,y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return [];

  // PaddleOCR occasionally returns the entire beneficiary line as one OCR
  // region. Split only explicit recipient-name / recipient-IBAN labels; never
  // infer an IBAN from an unqualified account number.
  const ibanRe = /(?:ALICI|ALACAKLI|LEHDAR)\s*(?:IBAN|HESAP\s*(?:NO|NUMARASI)|BANKA\s*IBAN)\s*[:：]?\s*TR\d(?:[\s\dA-Z]){20,}/i;
  const nameRe = /(?:ALICI|ALACAKLI)\s*(?:ÜNVANI|UNVANI|ADI|ADISOYADI|ADI\s*SOYADI|İSMİ|ISMI)\s*[:：]\s*/i;
  const segments = [];
  const addSegment = (field, start, end, value, labelText, score) => {
    const clean = String(value || '').trim();
    if (!clean) return;
    const safeStart = Math.max(0, Math.min(raw.length, start));
    const safeEnd = Math.max(safeStart, Math.min(raw.length, end));
    const charStart = safeStart / Math.max(1, raw.length);
    const charEnd = safeEnd / Math.max(1, raw.length);
    segments.push({
      field,
      text: clean,
      labelText,
      score,
      resolver: 'semantic-inline-segment-v164',
      parentRegion: r,
      region: {
        x1: x1 + (x2-x1) * charStart,
        y1, 
        x2: x1 + (x2-x1) * charEnd,
        y2
      }
    });
  };

  const ibanMatch = raw.match(ibanRe);
  if (ibanMatch) {
    const start = ibanMatch.index ?? 0;
    const full = ibanMatch[0];
    const trIndex = full.search(/TR\d/i);
    const ibanText = trIndex >= 0 ? full.slice(trIndex).trim() : '';
    if (hasTurkishIbanShape(ibanText)) {
      addSegment('recipientIban', start, start + full.length, ibanText, full.slice(0, Math.max(0,trIndex)).trim(), 175);
    }
  }

  const nameMatch = raw.match(nameRe);
  if (nameMatch) {
    const start = nameMatch.index ?? 0;
    const valueStart = start + nameMatch[0].length;
    const end = ibanMatch && (ibanMatch.index ?? raw.length) > valueStart
      ? (ibanMatch.index ?? raw.length)
      : raw.length;
    const value = raw.slice(valueStart, end).replace(/\s{2,}/g, ' ').trim();
    if (value && !/^TR\d/i.test(value)) {
      addSegment('recipientName', valueStart, end, value, nameMatch[0].trim(), 165);
    }
  }

  return segments;
}

export function shouldSuppressIbanLayoutMismatch(field, referenceValue, targetValue, context = {}) {
  if (field !== 'recipientIban') return false;

  // Exact logical IBAN equality is the strongest suppression rule.
  if (sameTurkishIban(referenceValue, targetValue)) return true;

  // V1.6.4 LINE-WRAP GUARD:
  // A long beneficiary name can push an inline IBAN onto the next OCR line.
  // That changes absolute Y geometry without changing the document structure.
  // Suppress only when the geometry strongly explains the shift; do not use
  // this guard when the IBAN itself is known to be different.
  const box = (v) => {
    const r = v?.region || v;
    if (!r) return null;
    const x1=Number(r.x1), y1=Number(r.y1), x2=Number(r.x2), y2=Number(r.y2);
    if (![x1,y1,x2,y2].every(Number.isFinite) || x2<=x1 || y2<=y1) return null;
    return {x1,y1,x2,y2,w:x2-x1,h:y2-y1,cx:(x1+x2)/2,cy:(y1+y2)/2};
  };

  const nt=box(context.recipientNameTarget);
  const nr=box(context.recipientNameReference);
  const it=box(context.recipientIbanTarget);
  const ir=box(context.recipientIbanReference);
  if (!nt || !nr || !it || !ir) return false;

  // If both values are known and are valid Turkish IBANs, never hide a real
  // value change behind a layout explanation.
  const refIban = normalizeTurkishIban(referenceValue);
  const tarIban = normalizeTurkishIban(targetValue);
  if (hasTurkishIbanShape(referenceValue) && hasTurkishIbanShape(targetValue) && refIban !== tarIban) return false;

  const targetNameBottom = nt.y2;
  const targetIbanTop = it.y1;
  const referenceNameBottom = nr.y2;
  const referenceIbanTop = ir.y1;
  const nameH = Math.max(6, nt.h, nr.h);

  // Target IBAN box becoming materially taller is a strong indicator that the
  // IBAN was wrapped across two OCR/image lines.
  const heightRatio = it.h / Math.max(1, ir.h);
  const likelyWrapped = heightRatio >= 1.45 || it.h >= nameH * 1.65;

  // The target IBAN begins at/just below the beneficiary-name line, while the
  // reference IBAN remains on the original inline line.
  const targetNearName = targetIbanTop >= nt.y1 - nameH * 0.35 &&
    targetIbanTop <= nt.y2 + nameH * 2.2;
  const referenceInline = Math.abs(referenceIbanTop - nr.y1) <= nameH * 1.25;

  // The relative name→IBAN relationship must remain plausible.
  const targetGap = Math.max(0, targetIbanTop - targetNameBottom);
  const referenceGap = Math.max(0, referenceIbanTop - referenceNameBottom);
  const gapDelta = Math.abs(targetGap - referenceGap);

  return Boolean(
    likelyWrapped &&
    targetNearName &&
    referenceInline &&
    gapDelta <= nameH * 2.5
  );
}

function boxOf(item) {
  const r = item?.region || item;
  if (!r) return null;
  const x1 = Number(r.x1), y1 = Number(r.y1), x2 = Number(r.x2), y2 = Number(r.y2);
  return [x1, y1, x2, y2].every(Number.isFinite) && x2 > x1 && y2 > y1
    ? { x1, y1, x2, y2 }
    : null;
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
