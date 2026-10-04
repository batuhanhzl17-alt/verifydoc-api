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
  if (/^(?:ALICI|ALACAKLI)(?:(?:ADI|ADSOYAD|ADSOYADI|UNVAN|UNVANI|ISIM|ISMI))?$/.test(compact)) return 'recipientName';
  if (/^(?:BENEFICIARY|BENEFICIARYNAME|PAYEE|PAYEENAME|RECEIVER|RECEIVERNAME|LEHDAR|LEHDARADI|LEHDARUNVANI)$/.test(compact)) return 'recipientName';
  return null;
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
