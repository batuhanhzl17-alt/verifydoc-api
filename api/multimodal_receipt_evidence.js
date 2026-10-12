const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: ['string', 'null'] },
    labelText: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    location: { type: 'string' },
    semanticRelationship: { type: 'string' },
  },
  required: ['text', 'labelText', 'confidence', 'location', 'semanticRelationship'],
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
  if (field === 'amount') return text.replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.');
  return text.replace(/[çğıöşü]/g, c => ({ ç:'c', ğ:'g', ı:'i', ö:'o', ş:'s', ü:'u' })[c]).replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsDateOrTime(value) {
  const text = String(value || '');
  return /\b(?:date|time|tarih|saat)\b|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/i.test(text);
}

function labelMatchesField(field, label) {
  const text = String(label || '').normalize('NFKC').toLocaleUpperCase('tr-TR')
    .replace(/[ÇĞİÖŞÜ]/g, c => ({Ç:'C',Ğ:'G',İ:'I',Ö:'O',Ş:'S',Ü:'U'}[c]))
    .replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!text) return false;
  if (field === 'recipientName') return /^(ALICI|ALACAKLI|LEHDAR|BENEFICIARY|PAYEE|RECEIVER)( ADI| ISMI| UNVANI| AD SOYADI| NAME)?$/.test(text);
  if (field === 'recipientIBAN') return /^(ALICI|ALACAKLI|LEHDAR|BENEFICIARY|PAYEE|RECEIVER) (HESAP )?IBAN$/.test(text) || /^IBAN$/.test(text);
  if (field === 'amount') return /^(ISLEM |EFT |FAST |GIDEN FAST |TRANSFER )?(ISLEM )?TUTAR(I)?$/.test(text) || /^B A PARA CINSI TUTAR$/.test(text) || /^TUTAR$/.test(text);
  return false;
}

export async function analyzeReceiptImageEvidence({ openai, imageBuffer, mimeType = 'image/jpeg', bank = null, model = 'gpt-5.6-terra' }) {
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
            `Inspect this uploaded ${bank || 'unknown-bank'} receipt image as an independent evidence reader alongside OCR.`,
            `Bank identity supplied by the application: ${bank || 'unknown'}. Use the visible layout and labels in this image; do not assume a field location from another bank or template.`,
            'Field definitions:',
            '- amount: only the transaction amount attached to a visible amount label (such as TUTAR or İŞLEM TUTARI); never a balance, fee, commission, or unrelated amount.',
            '- recipientName: only the beneficiary/payee name attached to ALICI, ALACAKLI, LEHDAR, or an equivalent visible label; never the sender, bank, branch, or address.',
            '- recipientIBAN: only the beneficiary IBAN attached to an ALICI/ALACAKLI IBAN label; never the sender IBAN or an IBAN found elsewhere on the page.',
            'For every field, return the exact visible label in labelText. If the value is not clearly tied to the correct label, return text:null and labelText:null; do not guess.',
            'Example: a visible row "ALICI: Ayşe Yılmaz" supports recipientName="Ayşe Yılmaz" with labelText="ALICI"; it does not support amount or recipientIBAN.',
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
    if (evidence?.[field]?.text != null && !labelMatchesField(field, evidence?.[field]?.labelText)) {
      evidence[field].text = null;
      evidence[field].confidence = 0;
      evidence[field].semanticRelationship = 'label-not-validated-for-field';
    }
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

export function fuseReceiptSemanticEvidence({ evidenceResult, paddleOCR, primaryDocumentData, semanticFieldRegions = {} }) {
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
    const fieldRegion = semanticFieldRegions[field] || null;
    const ocrValue = String(fieldRegion?.text || '').trim();
    const primaryText = String(mappings[field].primary || '').trim();
    // Never search a critical value in the entire OCR transcript. A value is
    // comparable only after the bank-neutral semantic ROI resolver has tied
    // it to this field's label and returned the corresponding typed value box.
    const ocrComparable = fieldRegion?.validated === true && Boolean(ocrValue);
    const ocrAgreement = Boolean(ocrComparable && key && normalize(ocrValue, field) === key);
    const primaryAgreement = Boolean(key && primaryText && normalize(primaryText, field) === key);
    fields[field] = {
      visualEvidence: visual,
      paddleOCRAgreement: !value || !ocrComparable ? 'unavailable' : (ocrAgreement ? 'agreement' : 'disagreement'),
      paddleOCRFieldEvidence: ocrComparable ? {
        value: ocrValue,
        resolver: fieldRegion.resolver || null,
        region: fieldRegion.region || null,
        associationValidated: true,
      } : null,
      primaryAnalysisAgreement: primaryAgreement ? 'agreement' : value && primaryText ? 'disagreement' : 'unavailable',
      evidenceOnly: true,
    };
  }
  return {
    available: true,
    status: 'evidence-only',
    fields,
    fieldLocations: evidence.fieldLocations || [],
    visualObservations: evidence.visualObservations || [],
    finalAdjudicatorContext: {
      fieldStatuses: Object.fromEntries(Object.entries(fields).map(([field, row]) => [field, {
        paddleOCRAgreement: row.paddleOCRAgreement,
        primaryAnalysisAgreement: row.primaryAnalysisAgreement,
      }])),
      role: 'conservative corroborating semantic evidence only',
      affectsRiskScore: false,
      mayDeclareFraud: false,
    },
    policy: 'independent semantic evidence; disagreement is advisory; no single multimodal observation can declare fraud or change risk score',
  };
}
