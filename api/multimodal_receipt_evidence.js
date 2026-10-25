import {
  recipientNameLabel,
  recipientIbanLabel,
  resolveRecipientInlineSegments,
  resolveSplitTurkishIban,
  hasTurkishIbanShape,
  normalizeTurkishIban,
} from './semantic_roi.js';

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    location: { type: 'string' },
    semanticRelationship: { type: 'string' },
  },
  required: ['text', 'confidence', 'location', 'semanticRelationship'],
  additionalProperties: false,
};

const EVIDENCE_SCHEMA = {
  type: 'object',
  properties: {
    recipientName: FIELD_SCHEMA,
    recipientIBAN: FIELD_SCHEMA,
    amount: FIELD_SCHEMA,
    fieldLocations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['recipientName', 'recipientIBAN', 'amount'] },
          labelText: { type: ['string', 'null'] },
          relationship: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['field', 'labelText', 'relationship', 'confidence'],
        additionalProperties: false,
      },
    },
    visualObservations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          region: { type: 'string' },
          observation: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['region', 'observation', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipientName', 'recipientIBAN', 'amount', 'fieldLocations', 'visualObservations'],
  additionalProperties: false,
};

function normalize(value, field) {
  let text = String(value ?? '').normalize('NFKC').toLocaleLowerCase('tr-TR');
  if (field === 'recipientIBAN') return text.replace(/[^a-z0-9]/g, '').toUpperCase();
  if (field === 'amount') {
    let raw = text.replace(/[^0-9,+.-]/g, '');
    if (!raw) return '';
    // TEB statement rows write debits with a trailing minus (`5.000,00-`),
    // while other sources and our native-field resolver use a leading minus
    // (`-5.000,00`). Normalize both to the same signed numeric value.
    const leadingSign = /^[+-]/.test(raw) ? raw[0] : '';
    const trailingSign = /[+-]$/.test(raw) ? raw.at(-1) : '';
    if (leadingSign && trailingSign) return '';
    const sign = leadingSign === '-' || trailingSign === '-' ? '-' : '';
    const body = raw.replace(/^[+-]/, '').replace(/[+-]$/, '');
    if (!body || !/^[\d.,]+$/.test(body)) return '';
    const comma = body.lastIndexOf(',');
    const dot = body.lastIndexOf('.');
    const decimalAt = Math.max(comma, dot);
    let integerPart = body;
    let fractionPart = '';
    if (decimalAt >= 0 && body.length - decimalAt - 1 <= 2 && body.length - decimalAt - 1 >= 1) {
      integerPart = body.slice(0, decimalAt);
      fractionPart = body.slice(decimalAt + 1);
      if (integerPart.includes(body[decimalAt])) return '';
    }
    // A grouping separator must form three digit groups. Reject malformed
    // OCR such as 1,000,00 rather than silently turning it into 1000.00.
    const groupingSeparators = integerPart.match(/[,.]/g) || [];
    if (groupingSeparators.length) {
      const groups = integerPart.split(/[,.]/);
      if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(group => !/^\d{3}$/.test(group))) return '';
    }
    const integerDigits = integerPart.replace(/\D/g, '');
    if (!integerDigits) return '';
    return `${sign}${integerDigits.replace(/^0+(?=\d)/, '')}.${fractionPart.padEnd(2, '0') || '00'}`;
  }
  return text.replace(/[çğıöşü]/g, c => ({ ç:'c', ğ:'g', ı:'i', ö:'o', ş:'s', ü:'u' })[c]).replace(/[^a-z0-9]+/g, ' ').trim();
}

function valuesAgree(left, right, field) {
  const leftKey = normalize(left, field);
  const rightKey = normalize(right, field);
  if (!leftKey || !rightKey) return false;
  if (field !== 'amount') return leftKey === rightKey;
  if (leftKey === rightKey) return true;

  // Some transaction extractors report only the amount magnitude while the
  // PDF prints a debit sign (including TEB's trailing-minus notation). A
  // missing sign is not contradictory evidence. Explicit, opposing signs
  // remain a real disagreement.
  const signOf = (value) => {
    const raw = String(value ?? '').normalize('NFKC').replace(/[^0-9,+.-]/g, '');
    const leading = raw.match(/^([+-])/u)?.[1] || '';
    const trailing = raw.match(/([+-])$/u)?.[1] || '';
    if (leading && trailing) return null;
    if (leading === '-' || trailing === '-') return -1;
    if (leading === '+' || trailing === '+') return 1;
    return null;
  };
  const leftMagnitude = leftKey.replace(/^[+-]/u, '');
  const rightMagnitude = rightKey.replace(/^[+-]/u, '');
  if (leftMagnitude !== rightMagnitude) return false;
  const leftSign = signOf(left);
  const rightSign = signOf(right);
  return leftSign == null || rightSign == null || leftSign === rightSign;
}

function boxOf(row) {
  const r = row?.region || row;
  const b = { x1: Number(r?.x1), y1: Number(r?.y1), x2: Number(r?.x2), y2: Number(r?.y2) };
  return Object.values(b).every(Number.isFinite) && b.x2 > b.x1 && b.y2 > b.y1 ? b : null;
}

function validTurkishIban(value) {
  const iban = normalizeTurkishIban(value);
  if (!hasTurkishIbanShape(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

function fieldLabel(field, text) {
  const raw = String(text || '').trim();
  const prefix = raw.split(/[:：]/, 1)[0].trim();
  const compact = prefix.toLocaleUpperCase('tr-TR').replace(/[^A-ZÇĞİÖŞÜ]/g, '');
  if (field === 'recipientName') return Boolean(recipientNameLabel(prefix));
  if (field === 'recipientIBAN') return Boolean(recipientIbanLabel(prefix));
  if (field === 'amount') {
    const normalized = raw.toLocaleUpperCase('tr-TR')
      .replace(/[İIı]/g, 'I').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
      .replace(/Ş/g, 'S').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
      .replace(/[():.]/g, ' ').replace(/\s+/g, ' ').trim();
    // Section headings such as "TUTAR BILGILERI" are not amount labels.
    // Accept only known primary-amount labels, never fees, totals or balances.
    return /^(?:TUTAR|TUTARI|ISLEM TUTAR|ISLEM TUTARI|ISLEM TUTAR TL|ISLEM TUTARI TL|ISLEM TUTAR TRY|ISLEM TUTARI TRY|ANA TUTAR|ANA TUTARI|GIDEN TUTAR|GIDEN TUTARI|GIDEN FAST TUTAR|GIDEN FAST TUTARI|GIDEN FAST EFT TUTAR|GIDEN FAST EFT TUTARI|GONDERILEN TUTAR|GONDERILEN TUTARI|GONDERILEN FAST TUTAR|GONDERILEN FAST TUTARI|TRANSFER TUTAR|TRANSFER TUTARI|ODEME TUTAR|ODEME TUTARI|PARA CINSI TUTAR|B A PARA CINSI TUTAR)$/.test(normalized);
  }
  return false;
}

function candidateValid(field, value) {
  const text = String(value || '').trim();
  if (field === 'recipientIBAN') return validTurkishIban(text);
  if (field === 'amount') return Boolean(normalize(text, field)) && /\d/.test(text) && !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(text);
  if (field === 'recipientName') {
    const clean = text.replace(/[^\p{L}'’ .-]/gu, ' ').replace(/\s+/g, ' ').trim();
    return clean.length >= 3 && clean.split(/\s+/).length >= 2 && !/^(?:müşteri|gönderen|alıcı|alacaklı)$/i.test(clean);
  }
  return false;
}

function resolveOcrField(field, paddleOCR) {
  const rows = Array.isArray(paddleOCR?.regions) ? paddleOCR.regions.filter(r => r?.region && String(r.text || '').trim()) : [];
  if (!rows.length) return { status: 'unavailable', reason: 'ocr-regions-unavailable', candidates: [] };
  const candidates = [];
  const add = (value, labelText, region, resolver, cost = 0) => {
    const text = String(value || '').trim();
    if (!candidateValid(field, text)) return;
    candidates.push({ text, labelText: String(labelText || ''), region: region || null, resolver, cost });
  };

  // Paddle can return a complete beneficiary block as one region. Split its
  // explicitly labeled name and IBAN before considering nearby OCR boxes.
  if (field !== 'amount') {
    for (const row of rows) {
      for (const segment of resolveRecipientInlineSegments(row)) {
        if (segment.field === field) add(segment.text, segment.labelText, segment.region, segment.resolver, -10);
      }
    }
  }

  const labels = rows.filter(row => fieldLabel(field, row.text) && boxOf(row));
  for (const label of labels) {
    const labelBox = boxOf(label);
    const raw = String(label.text || '').trim();
    const parts = raw.split(/[:：]/);
    if (parts.length > 1) add(parts.slice(1).join(':').trim(), parts[0], labelBox, 'explicit-inline-label', -20);
    if (field === 'recipientIBAN') {
      const split = resolveSplitTurkishIban(rows, label);
      if (split) add(split.text, raw, split.region, split.resolver, -15);
    }
    const labelHeight = Math.max(6, labelBox.y2 - labelBox.y1);
    for (const row of rows) {
      if (row === label) continue;
      const b = boxOf(row);
      if (!b) continue;
      const text = String(row.text || '').trim();
      if (!candidateValid(field, text)) continue;
      const overlapY = Math.min(labelBox.y2, b.y2) - Math.max(labelBox.y1, b.y1);
      const gapX = b.x1 - labelBox.x2;
      const gapY = b.y1 - labelBox.y2;
      const sameLine = overlapY >= -labelHeight * 0.4 && gapX >= -labelHeight * 0.25 && gapX <= Math.max(220, labelHeight * 24);
      const below = gapY >= -labelHeight * 0.25 && gapY <= Math.max(110, labelHeight * 4) && b.x2 >= labelBox.x1 - labelHeight * 2;
      if (!sameLine && !below) continue;
      const cost = sameLine ? Math.abs(gapX) / labelHeight : 4 + Math.max(0, gapY) / labelHeight;
      add(text, raw, b, 'typed-label-neighbor', cost);
    }
  }

  const distinct = new Map();
  for (const candidate of candidates.sort((a, b) => a.cost - b.cost)) {
    const key = normalize(candidate.text, field);
    if (key && !distinct.has(key)) distinct.set(key, candidate);
  }
  const resolved = [...distinct.values()];
  if (resolved.length === 1) return { status: 'matched', ...resolved[0], candidates: resolved };
  if (resolved.length > 1) return { status: 'ambiguous', reason: 'multiple-labeled-candidates', candidates: resolved };
  return { status: 'unavailable', reason: labels.length ? 'no-valid-value-near-typed-label' : 'typed-label-not-found', candidates: [] };
}

function containsDateOrTime(value) {
  const text = String(value || '');
  return /\b(?:date|time|tarih|saat)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/i.test(text);
}

export async function analyzeReceiptImageEvidence({ openai, imageBuffer, mimeType = 'image/jpeg', model = 'gpt-6-luna' }) {
  if (!openai || !Buffer.isBuffer(imageBuffer) || !imageBuffer.length) {
    return { available: false, status: 'missing-client-or-image' };
  }
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const response = await openai.responses.create({
    model,
    reasoning: { effort: 'low' },
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'Inspect this uploaded receipt image as an independent evidence reader alongside OCR.',
            'Return only the structured fields in the schema: recipientName, recipientIBAN, amount, fieldLocations/semantic relationships, and visualObservations.',
            'Do not inspect, extract, mention, or return any date or time.',
            'Read only what is visibly present. Use null for unreadable values and describe uncertainty in confidence.',
            'For each value, describe whether it is beside the correct recipient/name, recipient IBAN, or transaction amount label.',
            'Visual observations must describe visible image properties only; never label the document real, fake, fraudulent, or authentic, and never recommend a verdict.',
          ].join('\n'),
        },
        { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
      ],
    }],
    text: { format: { type: 'json_schema', name: 'receipt_visual_evidence', strict: true, schema: EVIDENCE_SCHEMA } },
  });
  const evidence = JSON.parse(response.output_text || '{}');
  // Defensive output filter: even though date/time is excluded by the prompt
  // and schema, do not let date-like content escape in a value or observation.
  for (const field of ['recipientName', 'recipientIBAN', 'amount']) {
    if (containsDateOrTime(evidence?.[field]?.text)) evidence[field].text = null;
    if (containsDateOrTime(evidence?.[field]?.location)) evidence[field].location = '';
    if (containsDateOrTime(evidence?.[field]?.semanticRelationship)) evidence[field].semanticRelationship = '';
  }
  evidence.fieldLocations = (evidence.fieldLocations || []).filter(row =>
    !containsDateOrTime(row?.labelText) && !containsDateOrTime(row?.relationship));
  evidence.visualObservations = (evidence.visualObservations || []).filter(row =>
    !containsDateOrTime(row?.region) && !containsDateOrTime(row?.observation));
  return { available: true, status: 'ok', model: response.model || model, evidence };
}

export function fuseReceiptSemanticEvidence({ evidenceResult, paddleOCR, primaryDocumentData, pdfNativeFields = null }) {
  if (evidenceResult?.available !== true || !evidenceResult.evidence) {
    return { available: false, status: evidenceResult?.status || 'multimodal-unavailable', fields: {} };
  }
  const evidence = evidenceResult.evidence;
  const primary = primaryDocumentData || {};
  const mappings = {
    recipientName: { primary: primary.recipientName },
    recipientIBAN: { primary: primary.recipientIban },
    amount: { primary: primary.amount },
  };
  const fields = {};
  for (const field of Object.keys(mappings)) {
    const visual = evidence[field] || {};
    const value = String(visual.text || '').trim();
    const key = normalize(value, field);
    const ocr = resolveOcrField(field, paddleOCR);
    const primaryText = String(mappings[field].primary || '').trim();
    const pdfNative = pdfNativeFields?.fields?.[field] || null;
    const nativeMatched = pdfNative?.status === 'matched' && pdfNative?.associationValidated === true;
    const nativeOcrCorroboration = Boolean(
      nativeMatched && ocr.status === 'matched' &&
      valuesAgree(pdfNative.value, ocr.text, field)
    );
    // A coordinate-associated PDF text value and a separate OCR value from
    // the rendered page form the strongest available visible-field consensus.
    // Use that consensus as the comparison value so an isolated vision-model
    // transcription error does not create a false source conflict.
    const comparisonValue = nativeOcrCorroboration
      ? String(pdfNative.value || '').trim()
      : value ||
        (nativeMatched ? String(pdfNative.value || '').trim() : '') ||
        (ocr.status === 'matched' ? String(ocr.text || '').trim() : '');
    const comparisonKey = normalize(comparisonValue, field);
    const ocrAgreement = Boolean(comparisonKey && ocr.status === 'matched' && valuesAgree(ocr.text, comparisonValue, field));
    const primaryAgreement = Boolean(comparisonKey && primaryText && valuesAgree(primaryText, comparisonValue, field));
    const visualAgreement = Boolean(comparisonKey && value && valuesAgree(value, comparisonValue, field));
    const pdfNativeAgreement = Boolean(
      pdfNative?.status === 'matched' && pdfNative?.associationValidated === true &&
      primaryText && valuesAgree(primaryText, pdfNative.value, field)
    );
    const nonVisualReadings = [
      ocr.status === 'matched' ? ocr.text : '',
      nativeMatched ? pdfNative.value : '',
      primaryText,
    ].filter(item => normalize(item, field));
    const nonVisualDisagreement = nonVisualReadings.some((item, index) =>
      nonVisualReadings.slice(index + 1).some(other => !valuesAgree(item, other, field))
    );
    const visualDisagreement = Boolean(value && comparisonKey && !valuesAgree(value, comparisonValue, field));
    // Preserve genuine disagreement among the field-associated OCR, PDF text,
    // and primary extraction. Ignore only an isolated secondary visual-reader
    // outlier when both the native label/value association and rendered OCR
    // independently agree.
    const sourceDisagreement = nonVisualDisagreement ||
      (visualDisagreement && !nativeOcrCorroboration);
    fields[field] = {
      visualEvidence: visual,
      visualEvidenceAgreement: value ? (visualAgreement ? 'agreement' : 'disagreement') : 'unavailable',
      independentOcrCorroboration: nativeOcrCorroboration,
      sourceOutlier: nativeOcrCorroboration && visualDisagreement ? 'secondary-visual-reader' : null,
      paddleOCRAgreement: ocr.status === 'matched'
        ? (ocrAgreement ? 'agreement' : comparisonKey ? 'disagreement' : 'unavailable')
        : 'unavailable',
      paddleOCRResolver: ocr.status === 'matched' ? ocr.resolver : null,
      paddleOCRLabelText: ocr.labelText || null,
      paddleOCRRegion: ocr.region || null,
      paddleOCRStatus: ocr.status,
      paddleOCRReason: ocr.reason || null,
      associationValidated: ocr.status === 'matched' || nativeMatched,
      // Native PDF text is kept as an independent, coordinate-backed
      // association. It does not silently turn a failed OCR/vision check into
      // a fully corroborated field; the final review remains conservative.
      pdfNativeAssociation: pdfNative,
      pdfNativeAgreement: pdfNativeAgreement ? 'agreement' : pdfNative?.status === 'matched' && primaryText ? 'disagreement' : 'unavailable',
      primaryAnalysisAgreement: primaryAgreement ? 'agreement' : comparisonValue && primaryText ? 'disagreement' : 'unavailable',
      sourceDisagreement,
      evidenceOnly: true,
    };
  }
  // The user's fraud checks focus on the beneficiary IBAN and transaction
  // amount. A name-resolution failure is retained as evidence, but it must
  // not block these two critical fields or dominate the review status.
  const criticalFields = ['recipientIBAN', 'amount'].map(field => fields[field]);
  const requiresControl = criticalFields.some(row =>
    !row?.associationValidated ||
    row.primaryAnalysisAgreement !== 'agreement' ||
    row.sourceDisagreement ||
    (row.paddleOCRStatus === 'matched' && row.paddleOCRAgreement !== 'agreement') ||
    (row.visualEvidence?.text && row.pdfNativeAssociation?.status === 'matched' &&
      !row.independentOcrCorroboration &&
      normalize(row.visualEvidence.text, row === fields.recipientIBAN ? 'recipientIBAN' : 'amount') !==
      normalize(row.pdfNativeAssociation.value, row === fields.recipientIBAN ? 'recipientIBAN' : 'amount'))
  );
  return {
    available: true,
    status: 'evidence-only',
    reviewStatus: requiresControl ? 'CONTROL_REQUIRED' : 'FIELDS_CORROBORATED',
    reviewMessage: requiresControl
      ? 'Kontrol gerekli: kritik alanlardan en az biri etiketli OCR kutusuyla doğrulanmadı veya kaynaklar uyuşmadı.'
      : 'Kritik alanlar etiketli OCR kutuları ve bağımsız çıkarımlarla doğrulandı.',
    fields,
    fieldLocations: evidence.fieldLocations || [],
    visualObservations: evidence.visualObservations || [],
    finalAdjudicatorContext: {
      fieldStatuses: Object.fromEntries(Object.entries(fields).map(([field, row]) => [field, {
        paddleOCRAgreement: row.paddleOCRAgreement,
        paddleOCRStatus: row.paddleOCRStatus,
        associationValidated: row.associationValidated,
        primaryAnalysisAgreement: row.primaryAnalysisAgreement,
      }])),
      role: 'field-level corroboration; only label-associated Paddle OCR boxes count as a match',
      affectsRiskScore: false,
      mayDeclareFraud: false,
    },
    policy: 'whole-page OCR substring matches are not accepted; unresolved or ambiguous field boxes require review; semantic evidence does not independently change risk score',
  };
}
