import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const execFileAsync = promisify(execFile);


// =====================================================
// REFERANS KLASÖRÜ
// =====================================================

const REFERENCE_DIR =
path.join(process.cwd(), "references");


// =====================================================
// BANKA → REFERANS PDF MAP
// =====================================================

const REFERENCE_MAP = {
akbank: "akbank.pdf",
enpara: "enpara.pdf",
  vakifbank: "vakifbank.pdf",
  isbankasi: "isbankasi.pdf",
  ziraat: "ziraat.pdf",
};


// =====================================================
// BANKA NORMALİZASYONU
// =====================================================

function normalizeBank(bank) {

if (
!bank ||
typeof bank !== "string"
) {
return null;
}

const value =
bank
.toLowerCase()
.trim()
.replace(/\s+/g, "")
.replace(/ı/g, "i")
.replace(/İ/g, "i")
.replace(/ş/g, "s")
.replace(/Ş/g, "s")
.replace(/ğ/g, "g")
.replace(/Ğ/g, "g")
.replace(/ü/g, "u")
.replace(/Ü/g, "u")
.replace(/ö/g, "o")
.replace(/Ö/g, "o")
.replace(/ç/g, "c")
.replace(/Ç/g, "c");

if (
value === "akbank"
) {
return "akbank";
}

if (
value === "enpara" ||
value === "enparafinans"
) {
return "enpara";
}

if (
value.includes ("ziraat")
) {
return "ziraat";
}

  
return null;
}


// =====================================================
// REFERANS DOSYASI BUL
// =====================================================

function getReferenceFile(bank) {

const normalizedBank =
normalizeBank(bank);

if (!normalizedBank) {
return null;
}

const fileName =
REFERENCE_MAP[
normalizedBank
];

if (!fileName) {
return null;
}

return path.join(
REFERENCE_DIR,
fileName
);
}


// =====================================================
// REFERANS PDF OKUMA
// =====================================================

async function loadReferenceFile(bank) {

const normalizedBank =
normalizeBank(bank);

if (!normalizedBank) {

console.log(
"REFERENCE BANK TANINMADI:",
bank
);

return null;
}

const referencePath =
getReferenceFile(
normalizedBank
);

if (!referencePath) {

console.log(
"REFERENCE PATH BULUNAMADI:",
normalizedBank
);

return null;
}

try {

const buffer =
await fs.readFile(
referencePath
);

if (
!buffer?.length
) {

console.log(
"REFERENCE DOSYASI BOŞ:",
referencePath
);

return null;
}

console.log(
"REFERENCE LOADED:",
referencePath
);

return {

bank:
normalizedBank,

fileName:
path.basename(
referencePath
),

base64:
buffer.toString(
"base64"
),

};

} catch (error) {

console.error(
"REFERENCE LOAD ERROR:",
error
);

return null;
}
}


export const config = {

api: {

bodyParser: false,

},

};


// =====================================================
// OPENAI
// =====================================================

const openai =
new OpenAI({

apiKey:
process.env.OPENAI_API_KEY,

});


// =====================================================
// CHECKLER
// =====================================================

const CHECK_NAMES = [

"ocrConsistency",
"fontConsistency",
"fontSizeConsistency",
"characterSpacing",
"lineSpacing",
"textAlignment",
"baselineConsistency",
"compressionArtifacts",
"copyPasteRegions",
"editingTraces",
"photoshopArtifacts",
"aiGeneratedIndicators",
"logoConsistency",
"stampConsistency",
"signatureConsistency",
"dateConsistency",
"amountConsistency",
"currencyFormatting",
"ibanFormatting",
"swiftFormatting",
"qrBarcodeConsistency",
"layoutIntegrity",
"suspiciousElements",
"documentTypeConsistency",
"imageQuality",

];


// =====================================================
// SCHEMA
// =====================================================

const CHECK_SCHEMA =
Object.fromEntries(

CHECK_NAMES.map(
(name) => [

name,

{

type:
"object",

properties: {

status: {

type:
"string",

enum: [

"pass",
"review",
"suspicious",
"unknown",

],

},

score: {

type:
"integer",

minimum:
0,

maximum:
100,

},

evidence: {

type:
"string",

},

},

required: [

"status",
"score",
"evidence",

],

additionalProperties:
false,

},

]
)

);


const RESPONSE_SCHEMA = {

type:
"object",

properties: {

overallRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

riskLabel: {

type:
"string",

enum: [

"LOW RISK",
"MODERATE RISK",
"HIGH RISK",
"VERY HIGH RISK",

],

},

confidence: {

type:
"integer",

minimum:
0,

maximum:
100,

},

summary: {

type:
"string",

},

categories: {

type:
"object",

properties: {

visualRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

textRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

layoutRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

financialDataRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

editingRisk: {

type:
"integer",

minimum:
0,

maximum:
100,

},

},

required: [

"visualRisk",
"textRisk",
"layoutRisk",
"financialDataRisk",
"editingRisk",

],

additionalProperties:
false,

},

checks: {

type:
"object",

properties:
CHECK_SCHEMA,

required:
CHECK_NAMES,

additionalProperties:
false,

},

limitations: {

type:
"array",

items: {

type:
"string",

},

},

amountAnalysis: {

type:
"object",

properties: {

amount: {

type:
[
"string",
"null"
],

},

subtotal: {

type:
[
"number",
"null"
],

},

taxAmount: {

type:
[
"number",
"null"
],

},

totalAmount: {

type:
[
"number",
"null"
],

},

calculatedTotal: {

type:
[
"number",
"null"
],

},

difference: {

type:
[
"number",
"null"
],

},

calculationConsistent: {

type:
"boolean",

},

evidence: {

type:
"string",

},

},

required: [

"amount",
"subtotal",
"taxAmount",
"totalAmount",
"calculatedTotal",
"difference",
"calculationConsistent",
"evidence",

],

additionalProperties:
false,

},

},

required: [

"overallRisk",
"riskLabel",
"confidence",
"summary",
"categories",
"checks",
"limitations",
"amountAnalysis",

],

additionalProperties:
false,

};


// =====================================================
// FORMIDABLE
// =====================================================

function parseMultipart(req) {

return new Promise(
(resolve, reject) => {

const form =
formidable({

multiples:
false,

keepExtensions:
true,

maxFileSize:
25 * 1024 * 1024,

});

form.parse(
req,
(
err,
fields,
files
) => {

if (err) {

reject(err);

return;
}

resolve({

fields,
files,

});

}
);

}
);

}


// =====================================================
// VIDEO → FRAME ÇIKARMA
// =====================================================

async function extractVideoFrames(
videoPath
) {

const outputDir =
`/tmp/verifydoc-${Date.now()}`;

await fs.mkdir(
outputDir,
{
recursive:
true,
}
);

const outputPattern =
`${outputDir}/frame-%03d.jpg`;

await execFileAsync(
ffmpegPath,

[

"-i",
videoPath,

"-vf",
"fps=2,scale=1280:-2",

"-frames:v",
"8",

"-q:v",
"5",

outputPattern,

],

{

maxBuffer:
10 * 1024 * 1024,

}
);

const files =
await fs.readdir(
outputDir
);

const frameFiles =
files
.filter(
(file) =>
file.endsWith(".jpg")
)
.sort();

if (
!frameFiles.length
) {

throw new Error(
"Videodan analiz edilecek kare çıkarılamadı."
);

}

const frames = [];

for (
const file of frameFiles
) {

const framePath =
`${outputDir}/${file}`;

const buffer =
await fs.readFile(
framePath
);

frames.push({

file,

base64:
buffer.toString(
"base64"
),

});

}

return frames;

}


// =====================================================
// VIDEO FRAME ANALİZİ
// =====================================================

async function analyzeVideoFrames(
frames
) {

if (
!frames ||
!frames.length
) {

throw new Error(
"Analiz edilecek video karesi bulunamadı."
);

}

console.log(
"VIDEO FRAME SAYISI:",
frames.length
);

const imageMessages =
frames.map(
(frame) => ({

type:
"image_url",

image_url: {

url:
`data:image/jpeg;base64,${frame.base64}`,

detail:
"high",

},

})
);

const response =
await openai.chat.completions.create({

model:
"gpt-5-mini",

messages: [

{

role:
"system",

content: `

Sen VerifyDoc isimli belge inceleme sistemisin.

Video içerisindeki tüm kareleri birlikte analiz et.

Belgenin farklı karelerde tutarlı olup olmadığını incele.

Özellikle şunlara dikkat et:

- yazıların değişmesi
- rakamların değişmesi
- IBAN değişiklikleri
- isim değişiklikleri
- tarih değişiklikleri
- tutar değişiklikleri
- font değişiklikleri
- hizalama değişiklikleri
- yapıştırılmış bölgeler
- dijital montaj izleri
- farklı sıkıştırma bölgeleri
- görüntü üzerinde sonradan eklenmiş alanlar
- belge üzerinde oynama ihtimali
- kareler arasında görsel tutarsızlık

Video kalitesi düşükse bunu otomatik olarak sahtecilik olarak değerlendirme.

Görülemeyen veya doğrulanamayan şeyleri uydurma.

Analiz sonucunu SADECE geçerli JSON olarak döndür.

JSON:

{
"verdict": "consistent",
"confidence": 0,
"suspicious": false,
"reasons": [],
"observations": [],
"recommendation": ""
}

verdict sadece:

"consistent"
"potentially_manipulated"
"inconclusive"

olabilir.

confidence 0-100 arasında olmalıdır.

suspicious true veya false olmalıdır.

Tüm açıklamalar TÜRKÇE olmalıdır.

`,

},

{

role:
"user",

content: [

{

type:
"text",

text: `

Bu video karelerini birlikte incele.

Belgenin kareler arasında tutarlı olup olmadığını
ve dijital manipülasyon belirtisi bulunup bulunmadığını değerlendir.

`,

},

...imageMessages,

],

},

],

response_format: {

type:
"json_object",

},

});

const content =
response
?.choices?.[0]
?.message
?.content;

if (!content) {

throw new Error(
"OpenAI'dan video analiz sonucu alınamadı."
);

}

console.log(
"OPENAI VIDEO ANALYSIS:",
content
);

return JSON.parse(
content
);

}


// =====================================================
// ARRAY'DEN İLK DEĞERİ AL
// =====================================================

function first(value) {

if (
Array.isArray(value)
) {

return value[0];

}

return value;

}


// =====================================================
// DOSYA BUL
// =====================================================

function findUploadedFile(
files
) {

const possibleNames = [

"image",
"file",
"video",

];

for (
const name of possibleNames
) {

const value =
files?.[name];

if (!value) {

continue;

}

if (
Array.isArray(value)
) {

return value[0];

}

return value;

}

return null;

}


// =====================================================
// MİKRO KARAKTER / RAKAM TUTARLILIK ANALİZİ
// =====================================================

function analyzeTextCharacterConsistency(
text
) {

if (
!text ||
typeof text !== "string"
) {

return {

score:
0,

suspicious:
false,

reason:
"Analiz edilecek metin bulunamadı.",

};

}

const characters =
[...text].filter(
(char) =>
/[0-9]/.test(char)
);

if (
characters.length < 2
) {

return {

score:
0,

suspicious:
false,

reason:
"Karşılaştırma için yeterli rakam bulunamadı.",

};

}

const frequency = {};

for (
const char of characters
) {

frequency[char] =
(frequency[char] || 0) + 1;

}

const repeatedDigits =
Object.entries(
frequency
).filter(
([, count]) =>
count >= 2
);

if (
!repeatedDigits.length
) {

return {

score:
0,

suspicious:
false,

reason:
"Aynı rakamın yeterli tekrarı bulunamadı.",

};

}

return {

score:
0,

suspicious:
false,

reason:
"Rakam karakterleri mikro tutarlılık analizi için hazır.",

repeatedDigits:
repeatedDigits.map(
([digit, count]) => ({

digit,
count,

})
),

};

}


// =====================================================
// JSON RESPONSE
// =====================================================

function parseAIResponse(
text
) {

if (
!text ||
typeof text !== "string"
) {

throw new Error(
"OpenAI boş cevap döndürdü."
);

}

const cleaned =
text
.trim()
.replace(
/^```json\s*/i,
""
)
.replace(
/^```\s*/i,
""
)
.replace(
/\s*```$/,
""
);

try {

return JSON.parse(
cleaned
);

} catch {

const start =
cleaned.indexOf("{");

const end =
cleaned.lastIndexOf("}");

if (
start >= 0 &&
end > start
) {

return JSON.parse(
cleaned.slice(
start,
end + 1
)
);

}

throw new Error(
"OpenAI geçerli JSON döndürmedi."
);

}

}


// =====================================================
// PROMPT
// =====================================================

const PROMPT = `

You are VerifyDoc, an AI-assisted document forensic screening system.

IMPORTANT LANGUAGE RULE:

All analysis, summaries, evidence, findings, warnings, and limitations
MUST be written in TURKISH.

Use proper Turkish characters whenever applicable:

ç, Ç
ğ, Ğ
ı, I, İ
ö, Ö
ş, Ş
ü, Ü

Do NOT replace Turkish characters with their ASCII equivalents when the
correct Turkish spelling is known.

For example:

"Çağrı" is correct.
"Cagri" is not the preferred spelling when the Turkish character is visible.

"Şahin" is correct.
"Sahin" is not the preferred spelling when the Turkish character is visible.

"İş Bankası" is correct.
"Is Bankasi" is not the preferred spelling when the Turkish characters
are visible.

Analyze the supplied document carefully.

This is ONLY a screening assessment.

Never claim that a document is definitely authentic.

Never claim that a document is definitely fake.

Do not invent evidence.

Every finding must be based only on visible or actually available evidence.

If something cannot be reliably determined, use "unknown".

A clean-looking document does NOT prove authenticity.

Do not treat unknown checks as suspicious.

=====================================================
TURKISH TEXT AND CHARACTER ANALYSIS
=====================================================

When Turkish text is visible in the document:

1. Carefully inspect Turkish characters:
ç, ğ, ı, İ, ö, ş, ü

2. Compare visually similar characters.

3. Check whether a Turkish character appears inconsistent with the
surrounding text.

4. Check whether Turkish characters have unusual:
- shape
- spacing
- baseline
- font
- size
- alignment
- rendering quality

5. Do NOT mark a Turkish character as suspicious merely because it is
different from an ASCII character.

6. Do NOT assume a character is Turkish unless the visible evidence
supports that conclusion.

7. If the image quality is insufficient to determine whether a character
is "ı" or "i", "İ" or "I", "ş" or "s", etc., use "unknown" or mention
the limitation.

8. Never invent missing Turkish characters.

=====================================================
OCR CONSISTENCY
=====================================================

Pay special attention to OCR consistency in Turkish words.

If visible text contains names, bank names, addresses, explanations,
or other Turkish content, preserve the characters exactly when they
can be reliably read.

Examples of Turkish characters that must be preserved:

"Çağrı"
"Şahin"
"İşlem"
"Ödeme"
"Gönderici"
"Alıcı"
"Türk"
"Ücret"
"Çıkış"
"İş Bankası"

Do not normalize these to ASCII unnecessarily.

=====================================================
DOCUMENT ANALYSIS
=====================================================

Evaluate the document for signs of possible manipulation, inconsistency,
editing, compositing, unusual typography, layout problems, or suspicious
financial information.

Check these 25 areas:

1. OCR/text consistency
2. Font consistency
3. Font size consistency
4. Character spacing
5. Line spacing
6. Text alignment
7. Baseline consistency
8. Image compression artifacts
9. Copy/paste regions
10. Editing traces
11. Photoshop-like manipulation artifacts
12. AI-generated image indicators
13. Logo/branding consistency
14. Stamp consistency
15. Signature consistency
16. Date consistency
17. Amount consistency
18. Currency formatting
19. IBAN formatting if visible
20. SWIFT/BIC formatting if visible
21. QR/barcode consistency if visible
22. Overall layout integrity
23. Missing or suspicious elements
24. Document type consistency
25. Image quality limitations

For each check:

status:
- pass
- review
- suspicious
- unknown

score:
0 = no suspicious evidence detected
100 = very strong suspicious evidence

Evidence must be concise and written in Turkish.

Do not invent evidence.

=====================================================
TURKISH CHARACTER RISK
=====================================================

When evaluating OCR/text consistency, consider whether Turkish characters
are visually and typographically consistent with the surrounding document.

However:

A Turkish character being unusual or difficult to read because of image
quality MUST NOT automatically increase the fraud risk.

Only increase suspicion when there is actual visible evidence of
inconsistency or manipulation.

=====================================================
TUTAR / VERGİ / MATEMATİKSEL KONTROL
=====================================================

Belgede görünen finansal tutarları ayrıca dikkatlice incele.

Özellikle:

- ana işlem tutarı
- ara toplam
- mal/hizmet tutarı
- KDV
- diğer vergiler
- komisyon
- ücret
- indirim
- toplam tutar

alanlarını tespit et.

Ana işlem tutarını IBAN, hesap numarası, işlem numarası,
referans numarası, tarih veya başka bir finansal rakamla karıştırma.

Varsa matematiksel ilişkiyi kontrol et.

Örneğin:

ara toplam + KDV + diğer vergiler + ücret + komisyon - indirim = toplam

Belgede birden fazla vergi veya ücret varsa mümkün olduğunca
toplamını hesapla.

Görünmeyen, okunamayan veya belirsiz rakamları tahmin etme.

Ara toplam görülemiyorsa subtotal = null.

Vergi görülemiyorsa taxAmount = null.

Toplam görülemiyorsa totalAmount = null.

Hesaplanabilecek değerler varsa:

calculatedTotal

alanında matematiksel olarak hesaplanan toplamı belirt.

difference alanında:

hesaplanan toplam - belgede görünen toplam

farkını belirt.

Hesaplama için yeterli veri yoksa:

calculatedTotal = null
difference = null

kullan.

Yeterli veri yoksa calculationConsistent değerini otomatik olarak
true yapma.

Hesaplama için yeterli veri bulunmadığında calculationConsistent
değerini false olarak kullan ve nedenini evidence alanında açıkla.

Çok küçük yuvarlama farklarını tek başına şüpheli olarak değerlendirme.

Matematiksel tutarsızlık varsa bunun nedenini amountAnalysis.evidence
alanında açıkça belirt.

=====================================================
ANA TUTAR KARAKTER / FONT KONTROLÜ
=====================================================

Ana işlem tutarının karakterlerini görsel olarak incele.

Özellikle:

- karakter yüksekliği
- karakter genişliği
- font ağırlığı
- stroke kalınlığı
- karakter aralığı
- baseline
- hizalama
- kenar yapısı
- anti-aliasing
- genel render görünümü

açısından çevresindeki aynı tip metinlerle tutarlılığını değerlendir.

Farklı rakamların doğal olarak farklı şekillere sahip olduğunu unutma.

Tek başına bir karakterin diğer rakamlardan farklı görünmesi
şüpheli değildir.

Fotoğraf açısı, perspektif, ışık, JPEG sıkıştırması veya görüntü
kalitesi kaynaklı küçük farklılıkları sahtecilik olarak değerlendirme.

Yeterli görsel kanıt yoksa şüpheli sonuç üretme.

=====================================================
RISK CALCULATION
=====================================================

Calculate:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

Calculate overallRisk from 0 to 100.

Risk labels:

0-20 = LOW RISK
21-45 = MODERATE RISK
46-70 = HIGH RISK
71-100 = VERY HIGH RISK

Confidence must be 0-100.

Lower confidence if the document is:

- blurry
- cropped
- low resolution
- partially hidden
- poorly lit
- photographed from an angle
- otherwise difficult to inspect

=====================================================
IMPORTANT
=====================================================

Do not confuse language recognition with authenticity.

Correct Turkish characters do NOT prove that a document is authentic.

Incorrect or missing Turkish characters do NOT automatically prove that
a document is fake.

Only actual visible evidence should affect the risk score.

=====================================================
PDF / DOCUMENT QUALITY ANALYSIS
=====================================================

When analyzing a PDF document, DO NOT automatically describe the document
as "low resolution" simply because it is a PDF.

First determine what kind of document is available:

1. Native digital PDF:
- Text appears digitally generated/selectable.
- Characters are clean and consistent.
- No obvious rasterization or scanning artifacts.
- Treat this as potentially high-quality evidence.

2. Scanned PDF:
- Pages appear to be scanned images.
- Evaluate sharpness, character clarity, compression, noise and scan quality.

3. Image-based PDF:
- PDF contains photographs or raster images.
- Evaluate the actual visible image quality.

4. Photograph converted to PDF:
- Perspective distortion, shadows, lighting problems, glare, camera noise,
or background artifacts may be present.
- Evaluate these separately from PDF format itself.

5. Mixed PDF:
- Some content may be digital text while other content may be scanned or
rasterized.
- Evaluate each visible component separately.

IMPORTANT:

Being a PDF is NOT evidence of low resolution.

Do NOT lower confidence merely because the file is a PDF.

Only report a quality limitation when there is actual visible evidence such as:

- blurry text
- unreadable characters
- severe compression
- pixelation
- scanning noise
- image degradation
- cropping
- missing portions
- excessive shadows
- glare
- perspective distortion
- insufficient detail

If the PDF is clear enough for reliable analysis, do NOT report low image
quality simply because the document is a PDF.

If the document is digitally generated and the text is clearly readable,
recognize that as a quality advantage.

When quality is limited, explain specifically WHY it is limited.

For example:

"Belge PDF formatında olduğu için değil, sayfa görüntüsü düşük kaliteli
olduğu için bazı karakterler güvenilir şekilde doğrulanamıyor."

If the quality is sufficient, use wording similar to:

"Belge kalitesi analiz için yeterli görünüyor."

Never invent the PDF's internal structure if it cannot actually be determined.
If the distinction between native digital PDF and image-based PDF cannot be
reliably determined, use "unknown".

=====================================================
BANK / INSTITUTION TEMPLATE & STYLE ANALYSIS
=====================================================

Identify the apparent bank, financial institution, company, government
organization, or document issuer ONLY when there is sufficient visible
evidence.

If the issuer cannot be reliably identified, use "unknown".

Do NOT guess the issuer.

Analyze whether the document's visual and textual characteristics are
internally consistent with the apparent issuer and document type.

IMPORTANT:

Do NOT assume that every document from the same institution uses exactly
the same font, layout, spacing, colors, or visual design.

Different versions, channels, dates, applications, web banking systems,
mobile banking systems, PDF generators, branches, transaction types,
languages, and software versions may legitimately produce different
document designs.

Therefore:

A different font, layout, color, or spacing by itself is NOT evidence of
fraud.

Look for MULTIPLE independent inconsistencies before treating something as
suspicious.

Analyze the following:

1. Apparent issuer / institution identity
2. Logo and branding consistency
3. Header and title structure
4. Font family appearance
5. Font weight and typography consistency
6. Font size hierarchy
7. Turkish character rendering
8. Date and time formatting
9. Currency and amount formatting
10. IBAN formatting
11. SWIFT / BIC formatting if visible
12. Transaction reference formatting if visible
13. Sender / recipient field structure
14. Account information formatting
15. Alignment and spacing
16. Section ordering
17. Color and visual hierarchy
18. Footer / legal text structure if visible
19. QR / barcode placement and consistency if visible
20. Overall template coherence

TURKISH CHARACTER ANALYSIS:

Pay special attention to Turkish characters:

ç Ç
ğ Ğ
ı I İ i
ö Ö
ş Ş
ü Ü

Check whether Turkish characters appear visually consistent with the rest
of the document.

Do NOT treat normal font rendering differences as suspicious.

Only flag a character-related issue when there is visible evidence such as:

- inconsistent glyph appearance within the same text style
- unusual character spacing
- incorrect character substitution
- a character appearing to have been inserted from another font
- visibly different rendering between otherwise identical text fields

BANK / INSTITUTION TEMPLATE REASONING:

If the apparent institution is identifiable, compare the document's
different sections against each other.

For example:

- Does the header style match the transaction details?
- Does the amount field visually belong to the same document?
- Does the IBAN field use a consistent typography and spacing pattern?
- Does the date/time format remain consistent?
- Do sender and recipient fields follow the same visual structure?
- Are there isolated elements that look composited or inserted?
- Does the logo appear naturally integrated with the surrounding document?
- Are there unusual gaps, misalignments, or inconsistent text blocks?

Do NOT claim that a document is fake merely because its template differs
from another document from the same institution.

Do NOT claim that a document is authentic merely because its template looks
familiar.

If there is insufficient evidence to determine whether a particular
institutional style is normal, use "unknown" or "review".

IMPORTANT:

This is a forensic consistency check, NOT a definitive authenticity test.

A familiar-looking bank template does not prove authenticity.

An unfamiliar-looking bank template does not prove fraud.

Use the available visible evidence only.

If the issuer is identifiable, mention it in the summary only when supported
by visible evidence.

If the issuer cannot be reliably identified, do not invent a bank or
institution name.

Return ONLY the JSON object matching the supplied schema.

`;


// =====================================================
// API
// =====================================================

export default async function handler(
req,
res
) {

let result;


// ---------------------------------------------------
// CORS
// ---------------------------------------------------

res.setHeader(
"Access-Control-Allow-Origin",
"*"
);

res.setHeader(
"Access-Control-Allow-Methods",
"POST, OPTIONS"
);

res.setHeader(
"Access-Control-Allow-Headers",
"Content-Type"
);


if (
req.method === "OPTIONS"
) {

return res
.status(200)
.end();

}


if (
req.method !== "POST"
) {

return res
.status(405)
.json({

success:
false,

error:
"Method not allowed",

});

}


try {

console.log(
"=============================="
);

console.log(
"VERIFYDOC API START"
);

const startTime =
Date.now();


// -------------------------------------------------
// API KEY
// -------------------------------------------------

if (
!process.env.OPENAI_API_KEY
) {

throw new Error(
"OPENAI_API_KEY Vercel Environment Variables içinde bulunamadı."
);

}


// -------------------------------------------------
// FORM DATA
// -------------------------------------------------

const {
fields,
files,
} =
await parseMultipart(req);


console.log(
"FORM PARSED"
);


const uploadedFile =
findUploadedFile(
files
);


if (!uploadedFile) {

throw new Error(
"Dosya alınamadı. image, file veya video alanı bulunamadı."
);

}


const type =
first(
fields?.type
) ||
"document";


const fileName =
first(
fields?.fileName
) ||
uploadedFile.originalFilename ||
"document";


// =================================================
// BANKA
// =================================================

const requestedBank =
first(
fields?.bank
);


const bank =
normalizeBank(
requestedBank
);
  
console.log(
  "REFERENCE BANK GELEN:",
  bank || "YOK"
  );

console.log(
"REQUESTED BANK:",
requestedBank ||
"YOK"
);


console.log(
"NORMALIZED BANK:",
bank ||
"YOK"
);


console.log(
"FILE:",
fileName
);


console.log(
"TYPE:",
type
);


console.log(
"MIME:",
uploadedFile.mimetype
);


console.log(
"SIZE:",
uploadedFile.size
);


// =================================================
// DOSYA
// =================================================

const filePath =
uploadedFile.filepath;


if (!filePath) {

throw new Error(
"Yüklenen dosyanın yolu bulunamadı."
);

}


const buffer =
await fs.readFile(
filePath
);


if (
!buffer?.length
) {

throw new Error(
"Dosya boş."
);

}


// =================================================
// BASE64
// =================================================

const base64 =
buffer.toString(
"base64"
);


let mime =
uploadedFile.mimetype;


if (
type === "image" &&
(
!mime ||
!mime.startsWith(
"image/"
)
)
) {

const extension =
path
.extname(
fileName
)
.toLowerCase();


if (
extension === ".png"
) {

mime =
"image/png";

}

else if (
extension === ".webp"
) {

mime =
"image/webp";

}

else if (
extension === ".jpg" ||
extension === ".jpeg"
) {

mime =
"image/jpeg";

}

else {

mime =
"image/jpeg";

}

}


if (
type === "pdf" &&
(
!mime ||
!mime.includes(
"pdf"
)
)
) {

mime =
"application/pdf";

}


if (
type === "video" &&
(
!mime ||
!mime.startsWith(
"video/"
)
)
) {

mime =
"video/mp4";

}


console.log(
"FINAL MIME:",
mime
);


// =====================================================
// REFERANS DEKONT
// =====================================================

// Gelen banka bilgisine göre doğru referans seçilir.
//
// Örnek:
// akbank -> references/akbank.pdf
// enpara -> references/enpara.pdf
// vakifbank ->references/vakifbank.pdf

const reference =
await loadReferenceFile(
bank
);


console.log(
"BANK:",
bank ||
"YOK"
);


console.log(
"REFERENCE:",
reference?.fileName ||
"YOK"
);


// -------------------------------------------------
// OPENAI INPUT
// -------------------------------------------------

const imageDataUrl =
`data:${mime};base64,${base64}`;


let content;


// =================================================
// IMAGE
// =================================================

if (
type === "image"
) {

content = [

{

type:
"input_text",

text: `${PROMPT}

=====================================================
REFERANS DEKONT
=====================================================

Bu analizde ayrıca bir referans dekont sağlanmıştır.

Analiz edilen bankanın sistem tarafından belirlenen adı:
${bank || "Banka belirtilmedi"}

Referans:
${reference?.fileName || "Referans bulunamadı"}

Referans dekontu, analiz edilen dekont ile:

- belge şablonu
- yerleşim
- tipografi
- font görünümü
- alan düzeni
- logo
- tarih biçimi
- tutar biçimi
- IBAN biçimi
- genel görsel yapı

açısından karşılaştır.

Referansı belge şablonu, yerleşim, tipografi, alan düzeni,
logo, tarih, tutar, IBAN biçimi ve genel görsel yapı açısından
karşılaştırma amacıyla kullan.

Referansla birebir aynı olmamasını tek başına sahtecilik kanıtı
olarak değerlendirme.

Birden fazla bağımsız ve anlamlı tutarsızlık olmadıkça risk
artırma.

Referans dekontun kendisini analiz edilen dekontun
gerçekliği için kesin kanıt olarak kabul etme.

Filename:
${fileName}`,

},

{

type:
"input_image",

image_url:
imageDataUrl,

detail:
"auto",

},

];

}


// =================================================
// PDF
// =================================================

else if (
type === "pdf"
) {

const pdfDataUrl =
`data:application/pdf;base64,${base64}`;


content = [

{

type:
"input_text",

text: `${PROMPT}

=====================================================
REFERANS DEKONT
=====================================================

Bu analizde ayrıca bir referans dekont sağlanmıştır.

Analiz edilen bankanın sistem tarafından belirlenen adı:
${bank || "Banka belirtilmedi"}

Referans dosya:
${reference?.fileName || "Referans bulunamadı"}

Referans dekontu, analiz edilen dekont ile:

- belge şablonu
- yerleşim
- tipografi
- font görünümü
- alan düzeni
- logo
- tarih biçimi
- tutar biçimi
- IBAN biçimi
- genel görsel yapı

açısından karşılaştır.

ÇOK ÖNEMLİ:

Referans ile analiz edilen dekontun birebir aynı olması
beklenmemektedir.

Farklı uygulama sürümleri, web/mobil bankacılık,
işlem türleri ve belge versiyonları olabilir.

Bu nedenle tek bir farklılığı sahtecilik kanıtı olarak
değerlendirme.

Birden fazla bağımsız ve anlamlı tutarsızlık varsa
risk değerlendirmesine dahil et.

Referans dekontun kendisini analiz edilen dekontun
gerçekliği için kesin kanıt olarak kabul etme.

Filename:
${fileName}`,

},

{

type:
"input_file",

filename:
fileName,

file_data:
pdfDataUrl,

},

...(reference?.base64

? [

{

type:
"input_file",

filename:
reference.fileName,

file_data:
`data:application/pdf;base64,${reference.base64}`,

},

]

: []),

];

}


// =================================================
// VIDEO
// =================================================

else if (
type === "video"
) {

console.log(
"VIDEO ANALYSIS START"
);


const frames =
await extractVideoFrames(
filePath
);


console.log(
"VIDEO FRAMES EXTRACTED:",
frames.length
);


const videoResult =
await analyzeVideoFrames(
frames
);


console.log(
"VIDEO ANALYSIS COMPLETE"
);


console.log(
"VIDEO RESULT:",
videoResult
);


return res
.status(200)
.json({

success:
true,

fileName,

type,

videoAnalysis:
videoResult,

});

}


else {

throw new Error(
"Desteklenmeyen dosya türü."
);

}


// -------------------------------------------------
// OPENAI
// -------------------------------------------------

console.log(
"OPENAI REQUEST START"
);


const response =
await openai.responses.create({

model:
"gpt-5-mini",

input: [

{

role:
"user",

content,

},

],

text: {

format: {

type:
"json_schema",

name:
"verifydoc_analysis",

strict:
true,

schema:
RESPONSE_SCHEMA,

},

},

});


console.log(
"OPENAI RESPONSE RECEIVED"
);


console.log(
"OPENAI SURE:",
(
(Date.now() - startTime) /
1000
).toFixed(2),
"seconds"
);


// -------------------------------------------------
// PARSE
// -------------------------------------------------

result =
parseAIResponse(
response.output_text
);


// =====================================================
// ANA SKOR
// =====================================================

const finalScore =
Number(
result.overallRisk
) || 0;


const finalSuspicious =
finalScore >= 46;


const finalEvidence =
result?.amountAnalysis?.evidence ||
result?.summary ||
"Analiz tamamlandı.";


console.log(
"FINAL SCORE:",
finalScore
);


console.log(
"FINAL SUSPICIOUS:",
finalSuspicious
);


console.log(
"ANALYSIS SUCCESS"
);


console.log(
"TOTAL SURE:",
(
(Date.now() - startTime) /
1000
).toFixed(2),
"seconds"
);


console.log(
"=============================="
);


return res
.status(200)
.json({

success:
true,

fileName,

type,

// Kullanılan banka
bank:
bank,

// Kullanılan referans
reference:
reference?.fileName ||
null,

...result,

// ANA SKOR
score:
finalScore,

// ANA ŞÜPHE DURUMU
suspicious:
finalSuspicious,

// BİRLEŞTİRİLMİŞ KANIT
evidence:
finalEvidence,

});


}

catch (err) {

console.error(
"=============================="
);


console.error(
"VERIFYDOC API ERROR:"
);


console.error(
err
);


console.error(
"=============================="
);


return res
.status(500)
.json({

success:
false,

error:
err?.message ||
"Analysis failed",

});

}

}
