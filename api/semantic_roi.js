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
  if (/^(?:ALICI|ALACAKLI)(?:(?:ADI|ADISOYAD|ADISOYADI|ADSOYAD|ADSOYADI|UNVAN|UNVANI|ISIM|ISMI|ADIUNVANI|ADIUNVAN|ISIMUNVANI|ISIMUNVAN|ADIISIM|ADIISIMUNVANI|ADIISIMUNVAN|ADISOYADUNVANI))?$/.test(compact)) return 'recipientName';
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

/** Resolve a multi-line recipient name/title from OCR regions.
 *  Only regions immediately to the right of, or directly below, an explicit
 *  recipient label are joined. This prevents unrelated customer/sender text
 *  from becoming the recipient ROI.
 */
export function resolveSplitRecipientName(regions, label) {
  const rows = Array.isArray(regions) ? regions : [];
  const labelBox = boxOf(label);
  if (!labelBox) return null;
  const labelText = String(label?.text && /[:：]/.test(label.text) ? label.text : (label?.labelText || label?.text || ''));
  const inlineParts = labelText.split(/[:：]/);
  const inline = inlineParts.length > 1 ? inlineParts.slice(1).join(' ').trim() : '';
  const isName = (text) => {
    const s = String(text || '').trim();
    if (!s || s.length < 2 || s.length > 120) return false;
    if (/^TR\d{2}/i.test(s) || /\d{4,}/.test(s)) return false;
    if (/(?:müşterinin yaptığı işlemlere ilişkin|dekont asıllarının|işlemlere ilişkin)/i.test(s)) return false;
    const letters = (s.match(/[A-Za-zÇĞİÖŞÜçğıöşü]/g) || []).length;
    return letters >= 3;
  };
  if (inline && isName(inline)) {
    return { text: inline, region: labelBox, score: 100, criticalROI: true, resolver: 'semantic-recipient-inline-v1' };
  }

  const pool = rows
    .filter(item => item && item !== label && String(item.text || '').trim())
    .map(item => ({ item, box: boxOf(item), text: String(item.text || '').trim() }))
    .filter(x => x.box && isName(x.text));
  const labelH = Math.max(6, labelBox.y2 - labelBox.y1);
  const candidates = [];

  for (const first of pool) {
    const vertical = Math.min(first.box.y2, labelBox.y2) - Math.max(first.box.y1, labelBox.y1);
    const rightGap = first.box.x1 - labelBox.x2;
    const belowGap = first.box.y1 - labelBox.y2;
    const centerDelta = Math.abs((first.box.x1 + first.box.x2) / 2 - (labelBox.x1 + labelBox.x2) / 2);
    const sameLine = vertical >= -labelH * 0.45 && rightGap >= -labelH * 0.25 && rightGap < Math.max(420, labelH * 18);
    const below = belowGap >= -labelH * 0.3 && belowGap < Math.max(150, labelH * 5) && centerDelta < Math.max(420, labelH * 18);
    if (!sameLine && !below) continue;

    const baseCost = sameLine
      ? Math.abs(rightGap) / labelH + Math.abs((first.box.y1 + first.box.y2 - labelBox.y1 - labelBox.y2) / 2) / labelH * 0.7
      : 3 + Math.max(0, belowGap) / labelH + centerDelta / labelH * 0.12;
    candidates.push({ first, sameLine, cost: baseCost });
  }

  const joined = [];
  for (const c of candidates) {
    const parts = [c.first];
    let current = c.first;
    // Join at most two additional lines, only when the next line is vertically
    // close and horizontally aligned with the current text block.
    for (let depth = 0; depth < 2; depth++) {
      const next = pool
        .filter(x => !parts.includes(x))
        .map(x => {
          const gap = x.box.y1 - current.box.y2;
          const overlap = Math.min(x.box.x2, current.box.x2) - Math.max(x.box.x1, current.box.x1);
          const overlapRatio = overlap / Math.max(1, Math.min(x.box.x2 - x.box.x1, current.box.x2 - current.box.x1));
          const center = Math.abs((x.box.x1 + x.box.x2) / 2 - (current.box.x1 + current.box.x2) / 2);
          return { x, gap, overlapRatio, center };
        })
        .filter(x => x.gap >= -labelH * 0.3 && x.gap <= labelH * 2.8 && (x.overlapRatio >= 0.15 || x.center <= labelH * 5))
        .sort((a, b) => (a.gap + a.center * 0.08) - (b.gap + b.center * 0.08))[0];
      if (!next) break;
      parts.push(next.x);
      current = next.x;
    }
    const text = parts.map(x => x.text).join(' ').replace(/\s+/g, ' ').trim();
    const box = {
      x1: Math.min(...parts.map(x => x.box.x1)),
      y1: Math.min(...parts.map(x => x.box.y1)),
      x2: Math.max(...parts.map(x => x.box.x2)),
      y2: Math.max(...parts.map(x => x.box.y2)),
    };
    joined.push({ text, region: box, score: Math.max(0, 100 - c.cost * 8), criticalROI: true, resolver: 'semantic-recipient-line-join-v1', _cost: c.cost });
  }
  joined.sort((a, b) => a._cost - b._cost);
  const best = joined[0];
  if (!best) return null;
  delete best._cost;
  return best;
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
