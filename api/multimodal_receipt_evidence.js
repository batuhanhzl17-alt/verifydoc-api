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
    transactionDate: FIELD_SCHEMA,
    fieldLocations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', enum: ['recipientName', 'recipientIBAN', 'amount', 'transactionDate'] },
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
  required: ['recipientName', 'recipientIBAN', 'amount', 'transactionDate', 'fieldLocations', 'visualObservations'],
  additionalProperties: false,
};

// Explicit per-bank guidance. These descriptions orient the reader but never
// substitute for a visible label; unknown/variant layouts stay label-driven.
const BANK_GUIDES = {
  garanti: 'Garanti BBVA: FAST/EFT dekontlarında üstte müşteri ve alıcı kutuları, ortada işlem ayrıntıları, alt sağda ayrı TUTAR kutusu bulunabilir. Alıcı adı ALACAKLI/ALICI, alıcı IBAN ALACAKLI IBAN/ALICI IBAN etiketine bağlı olmalıdır.',
  enpara: 'Enpara: İşlem tablosunda B/A, Para Cinsi, Tutar sütunları bulunabilir; tutar bu tablodaki işlem satırından alınır. Alttaki GİDEN FAST EFT açıklamasındaki EFT TUTARI veya ücret satırını tablo tutarıyla karıştırma.',
  ziraat: 'Ziraat Bankası: Hesaptan FAST/EFT dekontlarında üstte şube/işlem bilgisi, alıcı bilgileri ve altta işlem açıklamaları bulunabilir. İşlem tutarını yalnız görünür İşlem Tutarı/Tutar etiketinden; alıcı IBAN’ını Alıcı Hesap/Alıcı IBAN alanından al.',
  denizbank: 'DenizBank: FAST/EFT dekontlarında işlem tutarı ve bakiye/devir değerleri birlikte bulunabilir. Yalnız İşlem Tutarı/Tutar etiketine bağlı değeri al; bakiye veya kullanılabilir bakiye tutar değildir.',
  akbank: 'Akbank: Görseldeki işlem özeti ve alıcı alanlarını oku. Tutarı yalnız İşlem Tutarı/Tutar etiketinden; IBAN ve adı yalnız Alıcı/Alıcı IBAN/Alıcı Adı etiketlerinden bağla.',
  vakifbank: 'VakıfBank: FAST/EFT işlem dekontu düzeni kullanılıyor olabilir. Tutar, tarih, alıcı adı ve IBAN için yalnız ilgili satırın görünür etiketlerini kullan; bakiye ve masrafı işlem tutarı sayma.',
  isbankasi: 'İş Bankası: İşlem bilgileri ile alıcı alanları ayrı bölümlerde olabilir. Tutar ve alıcı değerlerini yalnız kendi görünür etiketleriyle ilişkilendir; gönderen ve alıcı alanlarını karıştırma.',
  halkbank: 'Halkbank: FAST/EFT dekontunda özet, alıcı ve işlem detayları bulunabilir. Tutarı yalnız işlem tutarı etiketiyle, IBAN’ı yalnız alıcı hesap/IBAN etiketiyle eşleştir.',
  qnb: 'QNB: Transfer dekontunda işlem özeti ve alıcı bilgileri farklı satırlarda olabilir. Tutarı komisyon/masraf/bakiyeden ayır; IBAN ve adı alıcı etiketlerine bağla.',
  yapikredi: 'Yapı Kredi: Havale/EFT/FAST dekont düzeni değişebilir. Yalnız açıkça görünen işlem tutarı, alıcı adı, alıcı IBAN ve işlem tarihi etiketlerini kullan.',
  ing: 'ING: Transfer dekontunda bakiye, ücret ve işlem tutarı birlikte görünebilir. Sadece işlem tutarı etiketiyle ilişkilendirilen rakamı al; alıcı alanlarını gönderen alanlarıyla karıştırma.',
  teb: 'TEB: FAST/EFT dekontunda her alanı kendi görünür etiketiyle eşleştir. İşlem tutarı; bakiye, masraf ve komisyon değildir.',
  kuveytturk: 'Kuveyt Türk: Transfer dekontunda işlem bilgileri ve alıcı bölümü olabilir. Yalnız görünür etiketle doğrulanan alıcı adı, alıcı IBAN, işlem tutarı ve işlem tarihini çıkar.',
};
const BANK_EXAMPLES = {
  garanti: 'Few-shot Garanti örneği: “ALACAKLI: Ayşe Yılmaz”, “ALACAKLI IBAN: TR..” ve alt sağ kutuda “TUTAR: -1.500,00 TL” görünüyorsa ad, IBAN ve tutarı yalnız bu etiketlere bağla; tutar değeri dinamiktir.',
  enpara: 'Few-shot Enpara örneği: tabloda “B/A | Para Cinsi | Tutar” başlığının altında “B | TL | 3.000,00” varsa amount yalnız 3.000,00’dır. Açıklama bölümündeki EFT TUTARI/ücret satırını tablo tutarı yerine kullanma; alıcı adı veya IBAN için açık alan etiketi yoksa null döndür.',
  ziraat: 'Few-shot Ziraat örneği: “İşlem Tutarı: 1.200,00 TRY”, “Alıcı Hesap: TR..” ve “Sayın: Ayşe Yılmaz” görülüyorsa yalnız bu açık bağları kullan; başlık/hesap sahibi bilgisini alıcı adı yerine koyma.',
  denizbank: 'Few-shot DenizBank örneği: “İşlem Tutarı: 1.200,00 TL” işlem tutarıdır; “Bakiye: 4.500,00 TL” amount değildir. Alıcı adı ve IBAN etiketleri görünmüyorsa null döndür.',
  akbank: 'Few-shot Akbank örneği: “Alıcı Adı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” satırlarını alanlarına bağla; başka satırdaki hesabı/ücreti taşıma.',
  vakifbank: 'Few-shot VakıfBank örneği: “Alıcı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” açık etiketliyse eşleştir; bakiye ve masrafı tutar yapma.',
  isbankasi: 'Few-shot İş Bankası örneği: “Alıcı Ünvanı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” değerlerini yalnız ilgili etiketlerinden al.',
  halkbank: 'Few-shot Halkbank örneği: “Alıcı Adı: Ayşe Yılmaz”, “Alıcı Hesap/IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” doğrudan alan bağlarıdır; başka bölümdeki IBAN veya bakiye kullanılamaz.',
  qnb: 'Few-shot QNB örneği: “Alıcı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” açık etiketlerinden oku; komisyon ve masrafı dışarıda bırak.',
  yapikredi: 'Few-shot Yapı Kredi örneği: “Alıcı Adı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” alanlarını ayrı ayrı etiketlerine bağla.',
  ing: 'Few-shot ING örneği: “Alıcı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” açıkça görünüyorsa eşleştir; hesap bakiyesi amount değildir.',
  teb: 'Few-shot TEB örneği: “Alıcı Ünvanı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” yalnız bu etiketlerle eşleşir.',
  kuveytturk: 'Few-shot Kuveyt Türk örneği: “Alıcı Adı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL” açık bağları kullanılabilir; belirsiz alan null olmalıdır.',
};

function bankGuideFor(bank) {
  const key = String(bank || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const aliases = { garanti:'garanti', garantibbva:'garanti', garantibankasi:'garanti', enparabankasi:'enpara', isbank:'isbankasi', isbankasi:'isbankasi', turkiyeisbankasi:'isbankasi', ykbank:'yapikredi', yapikredi:'yapikredi', ingbank:'ing', ziraatbankasi:'ziraat', turkiyecumhuriyetiziraatbankasi:'ziraat', vakifbankasi:'vakifbank', denizbankasi:'denizbank', halkbankasi:'halkbank', kuveytturkbankasi:'kuveytturk' };
  return BANK_GUIDES[aliases[key] || key] || `${bank || 'Bilinmeyen banka'}: Dekont düzeni/şablon varyantı değişebilir. Konumu tahmin etme; değeri yalnızca görüntüde hemen yanında veya aynı satırında bulunan açık etiketle ilişkilendir.`;
}

function bankExampleFor(bank) {
  const key = String(bank || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]/g, '');
  const aliases = { garantibbva:'garanti', garantibankasi:'garanti', enparabankasi:'enpara', isbank:'isbankasi', turkiyeisbankasi:'isbankasi', ziraatbankasi:'ziraat', vakifbankasi:'vakifbank', ykbank:'yapikredi', ingbank:'ing', denizbankasi:'denizbank', halkbankasi:'halkbank' };
  return BANK_EXAMPLES[aliases[key] || key] || 'Few-shot örneği: “Alıcı Adı: Ayşe Yılmaz”, “Alıcı IBAN: TR..”, “İşlem Tutarı: 1.200,00 TL”, “İşlem Tarihi: 12.10.2026” görünüyorsa her değeri yalnız kendi etiketine bağla. Etiket yoksa null.';
}

function normalizeLabel(value) {
  return String(value || '').normalize('NFKC').toLocaleUpperCase('tr-TR')
    .replace(/[ÇĞİÖŞÜ]/g, c => ({ Ç:'C', Ğ:'G', İ:'I', Ö:'O', Ş:'S', Ü:'U' })[c])
    .replace(/[^A-Z0-9]+/g, ' ').trim();
}

function labelMatchesField(field, label) {
  const text = normalizeLabel(label);
  if (!text) return false;
  if (field === 'recipientName') return /^(ALICI|ALACAKLI|LEHDAR|BENEFICIARY|PAYEE|RECEIVER)( ADI| ISMI| UNVANI| AD SOYADI| NAME)?$/.test(text);
  if (field === 'recipientIBAN') return /^(ALICI|ALACAKLI|LEHDAR|BENEFICIARY|PAYEE|RECEIVER) (HESAP )?(IBAN|HESAP|HESAP NO|HESAP NUMARASI)$/.test(text);
  if (field === 'amount') return /^(ISLEM |EFT |FAST |GIDEN FAST |TRANSFER )?(ISLEM )?TUTAR(I)?$/.test(text) || /^B A PARA CINSI TUTAR$/.test(text) || /^PARA CINSI TUTAR$/.test(text) || /^TUTAR$/.test(text);
  if (field === 'transactionDate') return /^(ISLEM )?TARIH(I)?( VE SAATI)?$/.test(text) || /^DATE$/.test(text);
  return false;
}

function normalizeIBAN(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validateIBAN(value) {
  const iban = normalizeIBAN(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return { valid: false, reason: 'format-invalid' };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return { valid: remainder === 1, reason: remainder === 1 ? 'checksum-valid' : 'checksum-invalid' };
}

function normalizeDate(value) {
  const text = String(value || '').match(/\b(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})\b/);
  if (!text) return null;
  let year, month, day;
  if (text[1].length === 4) [, year, month, day] = text;
  else [, day, month, year] = text;
  year = Number(year); month = Number(month); day = Number(day);
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeAmount(value) {
  let text = String(value || '').replace(/(?:TL|TRY|₺|EUR|USD|GBP)/gi, '').replace(/\s/g, '');
  if (!/^[+-]?[\d.,]+$/.test(text)) return null;
  const unsigned = text.replace(/^[+-]/, '');
  const tr = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/;
  const en = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
  if (!tr.test(unsigned) && !en.test(unsigned)) return null;
  const lastComma = text.lastIndexOf(','), lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    text = /,\d{1,2}$/.test(text) ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (lastDot >= 0 && !/\.\d{1,2}$/.test(text)) text = text.replace(/\./g, '');
  const number = Number(text);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

function resolvePaddleTransactionDate(paddleOCR) {
  const regions = Array.isArray(paddleOCR?.regions) ? paddleOCR.regions.filter(r => r?.region && String(r.text || '').trim()) : [];
  const dateRe = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\b/;
  const labelRe = /^(?:ISLEM\s*)?TARIH(?:I)?(?:\s*VE\s*SAATI)?$|^DATE$/;
  const candidates = [];
  for (const labelRow of regions) {
    const raw = String(labelRow.text || '').trim();
    const split = raw.search(/[:：]/);
    const label = normalizeLabel(split >= 0 ? raw.slice(0, split) : raw);
    if (!labelRe.test(label) || /DUZENLENME|VALOR|BELGE/.test(label)) continue;
    const lr = labelRow.region, lh = Math.max(6, Number(lr.y2) - Number(lr.y1));
    for (const valueRow of regions) {
      const vr = valueRow.region;
      const match = String(valueRow.text || '').match(dateRe);
      if (!match) continue;
      const inline = valueRow === labelRow && split >= 0 && raw.slice(split + 1).match(dateRe);
      const sameLine = valueRow !== labelRow && Math.abs(((Number(vr.y1)+Number(vr.y2))/2)-((Number(lr.y1)+Number(lr.y2))/2)) <= Math.max(lh, Number(vr.y2)-Number(vr.y1))*1.1 && Number(vr.x1) >= Number(lr.x1)-lh && Number(vr.x1)-Number(lr.x2) <= lh*12;
      const below = valueRow !== labelRow && Number(vr.y1)-Number(lr.y2) >= -lh*.2 && Number(vr.y1)-Number(lr.y2) <= lh*1.2 && (Math.min(Number(vr.x2),Number(lr.x2))-Math.max(Number(vr.x1),Number(lr.x1))>0 || Math.abs((Number(vr.x1)+Number(vr.x2)-Number(lr.x1)-Number(lr.x2))/2)<=lh*2);
      if (!inline && !sameLine && !below) continue;
      const normalized = normalizeDate(match[0]);
      if (!normalized) continue;
      candidates.push({ value: match[0], normalized, label: raw.slice(0, split >= 0 ? split : raw.length), region: vr, score: inline ? 30 : sameLine ? 20 : 10 });
    }
  }
  candidates.sort((a,b) => b.score - a.score);
  const best = candidates[0];
  if (!best) return null;
  const competitor = candidates.find(x => x.normalized !== best.normalized && x.score >= best.score - 5);
  return competitor ? null : { text: best.value, normalized: best.normalized, labelText: best.label, region: best.region, resolver: 'paddle-explicit-transaction-date-label' };
}

function normalizeForField(value, field) {
  if (field === 'recipientIBAN') return normalizeIBAN(value);
  if (field === 'amount') return normalizeAmount(value);
  if (field === 'transactionDate') return normalizeDate(value);
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, c => ({ ç:'c', ğ:'g', ı:'i', ö:'o', ş:'s', ü:'u' })[c])
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function analyzeReceiptImageEvidence({ openai, imageBuffer, mimeType = 'image/jpeg', bank = null, model = 'gpt-5.6-terra' }) {
  if (!openai || !Buffer.isBuffer(imageBuffer) || !imageBuffer.length) return { available: false, status: 'missing-client-or-image' };
  const guide = bankGuideFor(bank);
  const example = bankExampleFor(bank);
  const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const response = await openai.responses.create({
    model,
    reasoning: { effort: 'low' },
    input: [{ role: 'user', content: [
      { type: 'input_text', text: [
        `Bağımsız dekont okuyucususun. Banka: ${bank || 'belirsiz'}.`, guide,
        'Her alanı ayrı değerlendir ve aşağıdaki kesin tanımları uygula:',
        '- amount: dekontun işlem özeti/tablosundaki ana işlem tutarı; yalnız TUTAR, İŞLEM TUTARI veya bankaya özgü açık işlem tutarı etiketine bağlı sayı. Bakiye, kullanılabilir bakiye, masraf, komisyon, BSMV veya ücret değil.',
        '- recipientName: yalnız ALICI, ALACAKLI, LEHDAR veya açık eşdeğer etiketin yanındaki alıcı adı/unvanı. Gönderen, banka adı, şube ve adres değil.',
        '- recipientIBAN: yalnız ALICI/ALACAKLI/LEHDAR IBAN veya alıcı hesap etiketiyle ilişkilendirilmiş IBAN. Gönderen IBAN’ı, komisyon hesabı IBAN’ı veya sayfanın başka yerindeki IBAN değil.',
        '- transactionDate: yalnız İŞLEM TARİHİ veya eşdeğer açık işlem tarihi etiketi. Düzenlenme tarihi, valör tarihi, yükleme tarihi veya saat tek başına değil.',
        'Her alan için labelText içine görüntüde okuduğun etiketi aynen yaz. Etiket açık değilse, değer etiketin hemen yanında/aynı satırında değilse veya birden fazla aday varsa text ve labelText için null döndür; tahmin etme.',
        example,
        'Sadece görünür içeriği kullan; referans veya başka alanlardan değer tamamlama. JSON şemasına harfiyen uy.',
        'Visual observations yalnız görüntüdeki nitelikleri anlatsın; belgeye sahte/gerçek hükmü verme ve dolandırıcılık kararı önerme.',
      ].join('\n') },
      { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
    ] }],
    text: { format: { type: 'json_schema', name: 'receipt_visual_evidence', strict: true, schema: EVIDENCE_SCHEMA } },
  });
  const evidence = JSON.parse(response.output_text || '{}');
  for (const field of ['recipientName', 'recipientIBAN', 'amount', 'transactionDate']) {
    const row = evidence?.[field];
    if (row?.text != null && !labelMatchesField(field, row?.labelText)) {
      row.text = null; row.confidence = 0; row.semanticRelationship = 'label-not-validated-for-field';
    }
  }
  return { available: true, status: 'ok', model: response.model || model, evidence };
}

export function fuseReceiptSemanticEvidence({ evidenceResult, paddleOCR, primaryDocumentData, semanticFieldRegions = {} }) {
  if (evidenceResult?.available !== true || !evidenceResult.evidence) return { available: false, status: evidenceResult?.status || 'multimodal-unavailable', fields: {} };
  const evidence = evidenceResult.evidence, primary = primaryDocumentData || {};
  const mappings = {
    recipientName: { primary: primary.recipientName },
    recipientIBAN: { primary: primary.recipientIban },
    amount: { primary: primary.amount },
    transactionDate: { primary: primary.transactionDate || primary.date },
  };
  const fields = {};
  const controlReasons = [];
  for (const field of Object.keys(mappings)) {
    const visual = evidence[field] || {}, value = String(visual.text || '').trim();
    const key = normalizeForField(value, field);
    const fieldRegion = field === 'transactionDate' ? resolvePaddleTransactionDate(paddleOCR) : semanticFieldRegions[field] || null;
    const ocrValue = String(fieldRegion?.text || '').trim();
    const primaryText = String(mappings[field].primary || '').trim();
    const ocrComparable = field === 'transactionDate' ? Boolean(fieldRegion?.normalized) : fieldRegion?.validated === true && Boolean(ocrValue);
    const ocrKey = field === 'transactionDate' ? fieldRegion?.normalized : normalizeForField(ocrValue, field);
    const ocrAgreement = Boolean(ocrComparable && key != null && ocrKey != null && ocrKey === key);
    const primaryKey = normalizeForField(primaryText, field);
    const primaryAgreement = Boolean(key != null && primaryKey != null && primaryKey === key);
    let valueValidation = { status: value ? 'not-applicable' : 'no-vision-value' };
    if (field === 'recipientIBAN') valueValidation = value ? validateIBAN(value) : valueValidation;
    if (field === 'transactionDate') valueValidation = value ? { valid: normalizeDate(value) !== null, reason: normalizeDate(value) ? 'date-format-valid' : 'date-format-invalid' } : valueValidation;
    if (field === 'amount') valueValidation = value ? { valid: normalizeAmount(value) !== null, reason: normalizeAmount(value) !== null ? 'amount-format-valid' : 'amount-format-invalid' } : valueValidation;
    let paddleValidation = { status: ocrComparable ? 'not-applicable' : 'unavailable' };
    if (ocrComparable && field === 'recipientIBAN') paddleValidation = validateIBAN(ocrValue);
    if (ocrComparable && field === 'transactionDate') paddleValidation = { valid: Boolean(ocrKey), reason: ocrKey ? 'date-format-valid' : 'date-format-invalid' };
    if (ocrComparable && field === 'amount') paddleValidation = { valid: ocrKey !== null, reason: ocrKey !== null ? 'amount-format-valid' : 'amount-format-invalid' };
    const paddleStatus = !value || !ocrComparable ? 'unavailable' : ocrAgreement ? 'agreement' : 'disagreement';
    const primaryStatus = primaryAgreement ? 'agreement' : value && primaryText ? 'disagreement' : 'unavailable';
    if (!value) controlReasons.push(`${field}:vision-value-unresolved`);
    if (!ocrComparable) controlReasons.push(`${field}:paddle-typed-roi-unavailable`);
    if (paddleStatus === 'disagreement') controlReasons.push(`${field}:vision-paddle-disagreement`);
    if (primaryStatus === 'disagreement') controlReasons.push(`${field}:vision-primary-disagreement`);
    if (valueValidation.valid === false) controlReasons.push(`${field}:${valueValidation.reason || 'vision-validation-failed'}`);
    if (paddleValidation.valid === false) controlReasons.push(`${field}:paddle-${paddleValidation.reason || 'validation-failed'}`);
    fields[field] = {
      visualEvidence: visual,
      paddleOCRAgreement: paddleStatus,
      paddleOCRFieldEvidence: ocrComparable ? { value: ocrValue, normalizedValue: ocrKey, labelText: fieldRegion.labelText || null, resolver: fieldRegion.resolver || null, region: fieldRegion.region || null, associationValidated: true } : null,
      primaryAnalysisAgreement: primaryStatus,
      validation: valueValidation,
      paddleValidation,
      evidenceOnly: true,
    };
  }
  return {
    available: true, status: 'evidence-only', fields,
    fieldLocations: evidence.fieldLocations || [], visualObservations: evidence.visualObservations || [],
    reviewStatus: controlReasons.length ? 'CONTROL_REQUIRED' : 'NO_CONFLICT_DETECTED',
    reviewMessage: controlReasons.length ? 'Kontrol gerekli: kritik alanların etiketli OCR ROI, Vision okuması veya biçim/checksum doğrulaması eksik ya da uyuşmuyor.' : null,
    controlReasons,
    finalAdjudicatorContext: {
      fieldStatuses: Object.fromEntries(Object.entries(fields).map(([field, row]) => [field, { paddleOCRAgreement: row.paddleOCRAgreement, primaryAnalysisAgreement: row.primaryAnalysisAgreement, validation: row.validation, paddleValidation: row.paddleValidation }])),
      role: 'conservative corroborating semantic evidence only', affectsRiskScore: false, mayDeclareFraud: false,
    },
    policy: 'Vision/Paddle/primary disagreement is advisory and requires review; no single multimodal observation declares fraud or changes risk score',
  };
}
