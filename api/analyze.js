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
denizbank: "denizbank.pdf",
halkbank: "halkbank.pdf",
yapikredi: "yapikredi.pdf",
};

function normalizeTurkishText(value) {

if (
!value ||
typeof value !== "string"
) {

return "";

}

return value
.toLocaleLowerCase("tr-TR")
.replace(/\s+/g, " ")
.trim()
.replace(/ı/g, "i")
.replace(/İ/g, "i");

}


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
value.includes("vakifbank")
) {
return "vakifbank";
}


if (
value.includes("isbankasi") ||
value.includes("isbank")
) {
return "isbankasi";
}


if (
value.includes("ziraat")
) {
return "ziraat";
}


if (
value.includes("garanti")
) {
return "garanti";
}


if (
value.includes("denizbank")
) {
return "denizbank";
}


if (
value.includes("halkbank")
) {
return "halkbank";
}


if (
value.includes("yapikredi")
) {
return "yapikredi";
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

bodyParser:
false,

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
// CHECK SCHEMA
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


// =====================================================
// VERIFYDOC DETERMINISTIK RISK MOTORU
// =====================================================

const RISK_CATEGORY_WEIGHTS = {

visualRisk: 0.15,

textRisk: 0.15,

layoutRisk: 0.15,

financialDataRisk: 0.25,

editingRisk: 0.30,

};


// -----------------------------------------------------
// 25 KONTROLÜ KATEGORİLERE DAĞIT
// -----------------------------------------------------

const RISK_CHECK_MAP = {

visualRisk: {

compressionArtifacts: 1.0,

aiGeneratedIndicators: 1.0,

logoConsistency: 1.0,

stampConsistency: 0.8,

signatureConsistency: 0.8,

imageQuality: 0.7,

},

textRisk: {

ocrConsistency: 1.0,

fontConsistency: 1.0,

fontSizeConsistency: 0.9,

characterSpacing: 0.8,

lineSpacing: 0.7,

textAlignment: 0.7,

baselineConsistency: 0.8,

dateConsistency: 0.8,

currencyFormatting: 0.8,

ibanFormatting: 0.8,

swiftFormatting: 0.7,

},

layoutRisk: {

textAlignment: 0.8,

baselineConsistency: 0.7,

logoConsistency: 0.8,

qrBarcodeConsistency: 0.7,

layoutIntegrity: 1.0,

documentTypeConsistency: 0.9,

},

financialDataRisk: {

dateConsistency: 0.8,

amountConsistency: 1.0,

currencyFormatting: 0.8,

ibanFormatting: 0.8,

swiftFormatting: 0.7,

qrBarcodeConsistency: 0.5,

suspiciousElements: 0.8,

},

editingRisk: {

copyPasteRegions: 1.0,

editingTraces: 1.0,

photoshopArtifacts: 1.0,

aiGeneratedIndicators: 0.8,

suspiciousElements: 1.0,

fontConsistency: 0.6,

fontSizeConsistency: 0.5,

characterSpacing: 0.5,

baselineConsistency: 0.5,

},

};


// =====================================================
// KATEGORİ SKORU HESAPLA
// =====================================================

function calculateCategoryRisk(
checks,
mapping
) {

if (
!checks ||
typeof checks !== "object"
) {

return 0;

}

let weightedTotal = 0;

let totalWeight = 0;

for (
const [
checkName,
weight
]
of Object.entries(mapping)
) {

const check =
checks?.[checkName];

if (
!check ||
typeof check !== "object"
) {

continue;

}


// UNKNOWN → RİSK EKLEME

if (
check.status === "unknown"
) {

continue;

}


const score =
Number(check.score);


if (
!Number.isFinite(score)
) {

continue;

}


const safeScore =
Math.max(
0,
Math.min(
100,
score
)
);


weightedTotal +=
safeScore * weight;

totalWeight +=
weight;

}


if (
totalWeight === 0
) {

return 0;

}


return Math.round(
weightedTotal /
totalWeight
);

}


// =====================================================
// RİSK ETİKETİ
// =====================================================

function getRiskLabel(
score
) {

if (
score <= 20
) {

return "LOW RISK";

}

if (
score <= 45
) {

return "MODERATE RISK";

}

if (
score <= 70
) {

return "HIGH RISK";

}

return "VERY HIGH RISK";

}


// =====================================================
// NİHAİ RİSK HESAPLA
// =====================================================

function calculateOverallRisk(
result
) {

const checks =
result?.checks ||
{};


// -----------------------------------------------------
// KATEGORİLERİ 25 KONTROLDEN HESAPLA
// -----------------------------------------------------

const calculatedCategories = {

visualRisk:
calculateCategoryRisk(
checks,
RISK_CHECK_MAP.visualRisk
),

textRisk:
calculateCategoryRisk(
checks,
RISK_CHECK_MAP.textRisk
),

layoutRisk:
calculateCategoryRisk(
checks,
RISK_CHECK_MAP.layoutRisk
),

financialDataRisk:
calculateCategoryRisk(
checks,
RISK_CHECK_MAP.financialDataRisk
),

editingRisk:
calculateCategoryRisk(
checks,
RISK_CHECK_MAP.editingRisk
),

};


// -----------------------------------------------------
// AĞIRLIKLI ANA SKOR
// -----------------------------------------------------

let score =

calculatedCategories.visualRisk *
RISK_CATEGORY_WEIGHTS.visualRisk

+

calculatedCategories.textRisk *
RISK_CATEGORY_WEIGHTS.textRisk

+

calculatedCategories.layoutRisk *
RISK_CATEGORY_WEIGHTS.layoutRisk

+

calculatedCategories.financialDataRisk *
RISK_CATEGORY_WEIGHTS.financialDataRisk

+

calculatedCategories.editingRisk *
RISK_CATEGORY_WEIGHTS.editingRisk;


// -----------------------------------------------------
// MATEMATİKSEL TUTARSIZLIK BONUSU
// -----------------------------------------------------
//
// Yeterli veri varsa ve matematik tutmuyorsa
// finansal riski ayrıca artır.
// -----------------------------------------------------

const amountAnalysis =
result?.amountAnalysis;


if (
amountAnalysis &&
amountAnalysis.calculationConsistent === false &&
amountAnalysis.calculatedTotal !== null &&
amountAnalysis.totalAmount !== null
) {

const difference =
Number(
amountAnalysis.difference
);

if (
Number.isFinite(difference) &&
Math.abs(difference) > 0.01
) {

score += 10;

}

}


// -----------------------------------------------------
// SKORU 0-100 ARASINDA TUT
// -----------------------------------------------------

score =
Math.round(
Math.max(
0,
Math.min(
100,
score
)
)
);


// -----------------------------------------------------
// YENİ KATEGORİLERİ DÖNDÜR
// -----------------------------------------------------

return {

overallRisk:
score,

riskLabel:
getRiskLabel(score),

categories:
calculatedCategories,

};

}


// =====================================================
// NORMAL DEKONT RESPONSE SCHEMA
// =====================================================

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

documentData: {

type:
"object",

properties: {

senderName: {
type:
["string", "null"],
},

recipientName: {
type:
["string", "null"],
},

amount: {
type:
["string", "null"],
},

currency: {
type:
["string", "null"],
},

iban: {
type:
["string", "null"],
},

},

required: [
"senderName",
"recipientName",
"amount",
"currency",
"iban",
],

additionalProperties:
false,

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
"documentData",
"categories",
"checks",
"limitations",
"amountAnalysis",

],

additionalProperties:
false,

};


// =====================================================
// HESAP ÖZETİ RESPONSE SCHEMA
// =====================================================

const STATEMENT_RESPONSE_SCHEMA = {

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

balanceAnalysis: {

type:
"object",

properties: {

openingBalance: {

type:
[
"number",
"null"
],

},

totalIncoming: {

type:
[
"number",
"null"
],

},

totalOutgoing: {

type:
[
"number",
"null"
],

},

calculatedClosingBalance: {

type:
[
"number",
"null"
],

},

documentClosingBalance: {

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

"openingBalance",
"totalIncoming",
"totalOutgoing",
"calculatedClosingBalance",
"documentClosingBalance",
"difference",
"calculationConsistent",
"evidence",

],

additionalProperties:
false,

},

transactionAnalysis: {

type:
"object",

properties: {

transactionCount: {

type:
"integer",

minimum:
0,

},

dateConsistency: {

type:
"string",

},

duplicateTransactions: {

type:
"array",

items: {

type:
"string",

},

},

suspiciousTransactions: {

type:
"array",

items: {

type:
"string",

},

},

},

required: [

"transactionCount",
"dateConsistency",
"duplicateTransactions",
"suspiciousTransactions",

],

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

evidence: {

type:
"array",

items: {

type:
"string",

},

},

},

required: [

"overallRisk",
"riskLabel",
"confidence",
"summary",
"categories",
"balanceAnalysis",
"transactionAnalysis",
"limitations",
"evidence",

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
// REFERANS KULLANILMAZ
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
"input_image",

image_url:
`data:image/jpeg;base64,${frame.base64}`,

detail:
"high",

})
);


const videoPrompt = `

${PROMPT}

=====================================================
VİDEO ANALİZİ
=====================================================

Bu belge bir video içerisinden çıkarılmış
${frames.length} ayrı kare üzerinden analiz edilmektedir.

ÇOK ÖNEMLİ:

Bu video analizinde REFERANS DEKONT KULLANMA.

Banka referans PDF'i,
referans şablon,
referans belge
veya başka bir referans dosya
video analizine dahil edilmemelidir.

Yalnızca video karelerinde gerçekten görülebilen
bilgilere dayan.

Tüm video karelerini birlikte değerlendir.

=====================================================
KARELER ARASI TUTARLILIK
=====================================================

Özellikle kareler arasında şu bilgilerin değişip
değişmediğini kontrol et:

- isim
- soy isim
- gönderici
- alıcı
- IBAN
- hesap numarası
- işlem numarası
- referans numarası
- tarih
- saat
- tutar
- para birimi
- açıklama
- banka adı
- logo
- QR kod
- barkod
- metin
- rakamlar

Ayrıca:

- sonradan eklenmiş alan
- sonradan silinmiş alan
- yapıştırılmış bölge
- dijital montaj
- farklı font
- farklı karakter kalitesi
- farklı sıkıştırma
- farklı keskinlik
- farklı görüntü yapısı
- hareket sırasında ortaya çıkan tutarsızlık
- ekran üzerinde sonradan değiştirilmiş alan

olup olmadığını kontrol et.

=====================================================
DOĞAL VİDEO DEĞİŞİKLİKLERİ
=====================================================

Aşağıdaki durumları tek başına sahtecilik kanıtı
olarak değerlendirme:

- kamera hareketi
- zoom
- odak değişimi
- ışık değişimi
- perspektif değişimi
- görüntü titremesi
- JPEG sıkıştırması
- video sıkıştırması
- hafif bulanıklık
- farklı karelerde farklı parlaklık
- doğal gölge değişimleri

Bunlar tek başına risk skorunu yükseltmemelidir.

=====================================================
VİDEO MANİPÜLASYON KONTROLÜ
=====================================================

Belgenin farklı karelerinde aynı alanları mümkün
olduğunca karşılaştır.

Örneğin:

Bir karede tutar:

"25.000 TL"

iken başka bir karede:

"35.000 TL"

görülüyorsa bunu önemli bir tutarsızlık olarak
değerlendir.

Aynı şekilde:

IBAN değişiyorsa,
isim değişiyorsa,
tarih değişiyorsa,
alıcı değişiyorsa,
işlem numarası değişiyorsa

bunu açıkça evidence alanında belirt.

Ancak görüntü kalitesi nedeniyle bir bilginin
okunamadığı durumda değer tahmin etme.

=====================================================
TUTAR KONTROLÜ
=====================================================

Videoda görünen finansal tutarları ayrıca kontrol et.

Ana işlem tutarını:

- IBAN
- hesap numarası
- işlem numarası
- referans numarası
- tarih
- saat

gibi diğer rakamlarla karıştırma.

Eğer ara toplam, vergi, ücret, komisyon veya
toplam tutar görünüyorsa matematiksel olarak
kontrol et.

Yeterli veri yoksa değerleri tahmin etme.

=====================================================
VİDEO KALİTESİ
=====================================================

Video kalitesi düşükse otomatik olarak sahtecilik
kararı verme.

Eğer bazı karelerde belge okunamıyorsa bunu
limitations alanında belirt.

Eğer kalite yeterliyse bunu açıkça belirt.

=====================================================
RİSK
=====================================================

Kareler arasında gerçek ve anlamlı bir tutarsızlık
bulunmadıkça risk skorunu gereksiz şekilde artırma.

Tek başına video kalitesinin düşük olması:

HIGH RISK

veya

VERY HIGH RISK

anlamına gelmez.

Belirsiz durumlarda confidence değerini düşür.

=====================================================
SONUÇ
=====================================================

Sonuç normal VerifyDoc analiz formatıyla
uyumlu olmalıdır.

Şu alanların tamamını doldur:

overallRisk
riskLabel
confidence
summary
categories
checks
limitations
amountAnalysis

25 kontrolün tamamını değerlendir.

Kesin olarak "sahte" veya "gerçek" deme.

Bu yalnızca otomatik ön incelemedir.

SONUCU SADECE JSON OLARAK DÖNDÜR.

`;


console.log(
"OPENAI VIDEO REQUEST START"
);


const response =
await openai.responses.create({

model:
"gpt-5-mini",

input: [

{

role:
"user",

content: [

{

type:
"input_text",

text:
videoPrompt,

},

...imageMessages,

],

},

],

text: {

format: {

type:
"json_schema",

name:
"verifydoc_video_analysis",

strict:
true,

schema:
RESPONSE_SCHEMA,

},

},

});


console.log(
"OPENAI VIDEO RESPONSE RECEIVED"
);


const content =
response?.output_text;


if (
!content
) {

throw new Error(
"OpenAI'dan video analiz sonucu alınamadı."
);

}


console.log(
"OPENAI VIDEO ANALYSIS:",
content
);


const result =
parseAIResponse(
content
);


if (
!result ||
typeof result !== "object"
) {

throw new Error(
"Video analiz sonucu geçersiz."
);

}


console.log(
"VIDEO OVERALL RISK:",
result.overallRisk
);


console.log(
"VIDEO RISK LABEL:",
result.riskLabel
);


console.log(
"VIDEO CONFIDENCE:",
result.confidence
);


return result;

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
// HESAP ÖZETİ PROMPT
// REFERANS KULLANILMAZ
// =====================================================

const STATEMENT_PROMPT = `

Sen VerifyDoc isimli AI destekli belge inceleme sistemisin.

Bu belge bir banka hesap özeti / hesap ekstresi olarak
incelenmektedir.

ÇOK ÖNEMLİ:

Bu analizde banka referans PDF'i KULLANMA.

Referans şablon kullanma.

Referans belge kullanma.

Başka banka belgesi ile karşılaştırma yapma.

Yalnızca gönderilen hesap özeti üzerinden analiz yap.

Bu analiz kesin gerçeklik veya sahtecilik kararı değildir.

Kesin olarak "gerçek" deme.

Kesin olarak "sahte" deme.

Yalnızca gerçekten görülebilen veya güvenilir şekilde
hesaplanabilen bilgiler üzerinden değerlendirme yap.

Görülemeyen bilgileri tahmin etme.

=====================================================
HESAP ÖZETİ TANIMLAMA
=====================================================

Belgenin hesap özeti / hesap ekstresi niteliğinde olup
olmadığını değerlendir.

Görülebiliyorsa:

- banka
- hesap sahibi
- IBAN
- hesap numarası
- hesap dönemi
- para birimi
- açılış bakiyesi
- kapanış bakiyesi

bilgilerini incele.

Banka adı kesin olarak görülemiyorsa banka adı uydurma.

=====================================================
İŞLEM SATIRLARI
=====================================================

Görünen işlem satırlarını incele.

Özellikle:

- işlem tarihi
- işlem açıklaması
- para girişi
- para çıkışı
- işlem tutarı
- işlem sonrası bakiye
- gönderen
- alıcı
- işlem/ref numarası

alanlarını kontrol et.

Bir rakamın ne olduğu kesin değilse tahmin etme.

=====================================================
BAKİYE MATEMATİĞİ
=====================================================

Yeterli veri varsa:

önceki bakiye
+
para girişleri
-
para çıkışları
=
sonraki bakiye

ilişkisini kontrol et.

Birden fazla işlem varsa mümkün olduğunca ardışık
bakiyeleri kontrol et.

Örneğin:

Başlangıç bakiyesi: 10.000 TL

Giriş: 2.000 TL

Çıkış: 500 TL

Beklenen bakiye: 11.500 TL

Belgede farklı bir bakiye görünüyorsa bunu açıkça belirt.

Ancak:

- ücret
- komisyon
- faiz
- kur farkı
- bloke
- otomatik tahsilat
- başka finansal hareket

gibi görünür kalemleri de hesaba kat.

Yeterli veri yoksa matematiksel tutarlılık hakkında
kesin sonuç verme.

=====================================================
TOPLAM GİRİŞ / ÇIKIŞ
=====================================================

Belgede toplam giriş ve çıkış tutarları görünüyorsa
işlem satırlarıyla karşılaştır.

Hesaplanabiliyorsa:

- toplam giriş
- toplam çıkış
- net hareket
- hesaplanan kapanış bakiyesi

değerlerini hesapla.

Eksik veri varsa tahmin etme.

=====================================================
TARİH KONTROLÜ
=====================================================

İşlem tarihlerini kontrol et.

Özellikle:

- hesap dönemi
- işlem tarihleri
- tarih sıralaması
- dönem dışı işlem
- imkansız veya şüpheli tarih
- farklı tarih formatları

incelenmelidir.

Farklı tarih formatı tek başına sahtecilik kanıtı değildir.

=====================================================
BAKİYE DEVAMLILIĞI
=====================================================

Bir işlem sonrası bakiye ile sonraki işlem öncesi
bakiye arasında tutarlılık varsa kontrol et.

Sayfalar arasında bakiye devamlılığı varsa ayrıca
kontrol et.

Birinci sayfanın son bakiyesi ile ikinci sayfanın
başlangıç/devam bakiyesi arasında tutarsızlık varsa
açıkça belirt.

=====================================================
TEKRARLAYAN İŞLEMLER
=====================================================

Aynı:

- tarih
- tutar
- açıklama
- gönderen/alıcı

kombinasyonlarının olağandışı tekrar edip etmediğini
incele.

Tekrar tek başına sahtecilik kanıtı değildir.

=====================================================
GÖRSEL MANİPÜLASYON
=====================================================

Hesap özetinde:

- font farklılığı
- font boyutu farklılığı
- karakter aralığı
- baseline
- hizalama
- farklı sıkıştırma
- kopyala-yapıştır bölgeleri
- sonradan eklenmiş alan
- sonradan silinmiş alan
- farklı keskinlik
- farklı render
- dijital montaj
- Photoshop benzeri düzenleme
- yapay olarak değiştirilmiş rakamlar
- sayfalar arası görsel tutarsızlık

olup olmadığını incele.

Görüntü kalitesinden kaynaklanan küçük farklılıkları
otomatik olarak sahtecilik kabul etme.

=====================================================
SAYFALAR ARASI KONTROL
=====================================================

Birden fazla sayfa varsa:

- hesap sahibi
- IBAN
- hesap numarası
- hesap dönemi
- para birimi
- işlem sırası
- bakiye devamlılığı
- sayfa numarası

alanlarını karşılaştır.

Farklı sayfalarda aynı bilgiler farklı görünüyorsa
bunu incele.

Ancak normal PDF oluşturma farklılıklarını otomatik
olarak manipülasyon olarak değerlendirme.

=====================================================
PDF KALİTESİ
=====================================================

PDF olması tek başına düşük kalite değildir.

Belge okunabiliyorsa bunu olumlu kalite göstergesi
olarak değerlendir.

Yalnızca gerçekten:

- bulanıklık
- pikselizasyon
- okunamayan rakam
- kırpılma
- ciddi sıkıştırma
- tarama gürültüsü
- gölge
- parlama
- perspektif bozulması

varsa limitation belirt.

=====================================================
RİSK HESAPLAMA
=====================================================

Şunları hesapla:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

overallRisk:

0-20 LOW RISK
21-45 MODERATE RISK
46-70 HIGH RISK
71-100 VERY HIGH RISK

Confidence 0-100 arasında olmalıdır.

Matematiksel bakiye tutarsızlığı varsa
financialDataRisk'i artır.

Görsel manipülasyon kanıtı varsa
editingRisk'i artır.

Yalnızca belirsizlik varsa confidence düşür.

Belirsizliği otomatik olarak HIGH RISK yapma.

=====================================================
SONUÇ
=====================================================

Sonuç yalnızca geçerli JSON olmalıdır.

Tüm açıklamalar TÜRKÇE olmalıdır.

Şu alanların tamamını döndür:

overallRisk
riskLabel
confidence
summary
categories
balanceAnalysis
transactionAnalysis
limitations
evidence

Kesin gerçek veya kesin sahte kararı verme.

`;


// =====================================================
// HESAP ÖZETİ ANALİZ FONKSİYONU
// REFERANS KULLANILMAZ
// =====================================================

async function analyzeStatement(
base64,
mime,
fileName
) {

console.log(
"================================================"
);

console.log(
"HESAP ÖZETİ ANALİZİ BAŞLADI"
);

console.log(
"HESAP ÖZETİ REFERANS KULLANILMAYACAK"
);

console.log(
"FILE:",
fileName
);

console.log(
"MIME:",
mime
);

console.log(
"================================================"
);


let fileContent;


if (
mime === "application/pdf" ||
mime.includes("pdf")
) {

fileContent = {

type:
"input_file",

filename:
fileName,

file_data:
`data:application/pdf;base64,${base64}`,

};

}

else {

fileContent = {

type:
"input_image",

image_url:
`data:${mime};base64,${base64}`,

detail:
"high",

};

}


const response =
await openai.responses.create({

model:
"gpt-5-mini",

input: [

{

role:
"user",

content: [

{

type:
"input_text",

text:
STATEMENT_PROMPT,

},

fileContent,

],

},

],

text: {

format: {

type:
"json_schema",

name:
"verifydoc_statement_analysis",

strict:
true,

schema:
STATEMENT_RESPONSE_SCHEMA,

},

},

});


console.log(
"HESAP ÖZETİ OPENAI RESPONSE RECEIVED"
);


const output =
response?.output_text;


if (
!output
) {

throw new Error(
"OpenAI'dan hesap özeti analiz sonucu alınamadı."
);

}


console.log(
"HESAP ÖZETİ ANALİZ SONUCU:",
output
);


const result =
parseAIResponse(
output
);


if (
!result ||
typeof result !== "object"
) {

throw new Error(
"Hesap özeti analiz sonucu geçersiz."
);

}


return result;

}


// =====================================================
// KULLANICININ VERDİĞİ DEKONT BİLGİLERİ
// =====================================================
//
// Bu bilgiler RİSK SKORUNA DAHİL EDİLMEZ.
// Yalnızca dekonttan çıkarılan bilgilerle karşılaştırılır.
// =====================================================

function normalizeComparisonText(value) {

if (
value === null ||
value === undefined
) {

return "";

}

return String(value)
.toLocaleLowerCase("tr-TR")
.trim()
.replace(/\s+/g, " ")
.replace(/[.,;:()\-_/\\]+/g, " ")
.replace(/\s+/g, " ")
.trim();

}


function normalizeIBAN(value) {

if (
value === null ||
value === undefined
) {

return "";

}

return String(value)
.toUpperCase()
.replace(/\s+/g, "")
.replace(/[^A-Z0-9]/g, "");

}


function parseComparisonAmount(value) {

if (
value === null ||
value === undefined
) {

return null;

}

if (
typeof value === "number" &&
Number.isFinite(value)
) {

return value;

}

let raw =
String(value)
.trim()
.replace(/\s/g, "")
.replace(/[₺]/g, "")
.replace(/TL/gi, "")
.replace(/TRY/gi, "");

if (!raw) {

return null;

}

if (
raw.includes(",") &&
raw.includes(".")
) {

raw =
raw.replace(/\./g, "")
.replace(",", ".");

}

else if (
raw.includes(",")
) {

raw =
raw.replace(",", ".");

}

else {

const parts =
raw.split(".");

if (
parts.length === 2 &&
parts[1].length === 3
) {

raw =
raw.replace(/\./g, "");

}

}

const number =
Number(raw);

return Number.isFinite(number)
? number
: null;

}


function normalizeProvidedInfo(value) {

if (
!value ||
typeof value !== "object"
) {

return null;

}

const normalized = {

senderName:
value.senderName ??
value.sender ??
null,

recipientName:
value.recipientName ??
value.recipient ??
null,

amount:
value.amount ??
null,

currency:
value.currency ??
null,

iban:
value.iban ??
null,

};

const hasValue =
Object.values(normalized)
.some(
item =>
item !== null &&
item !== undefined &&
String(item).trim() !== ""
);

return hasValue
? normalized
: null;

}


function compareProvidedInfoWithDocument(
providedInfo,
documentData
) {

const provided =
normalizeProvidedInfo(
providedInfo
);

if (!provided) {

return {

enabled:
false,

matches:
{},

warnings:
[],

provided:
null,

document:
documentData ||
null,

};

}

const document =
documentData ||
{};

const matches = {};
const warnings = [];


if (
provided.senderName
) {

if (
!document.senderName
) {

matches.senderName =
"unknown";

warnings.push(
"Gönderen adı kontrol edilemedi: dekonttan gönderen adı güvenilir şekilde okunamadı."
);

}

else {

const expected =
normalizeTurkishText(
normalizeComparisonText(
provided.senderName
)
);

const actual =
normalizeTurkishText(
normalizeComparisonText(
document.senderName
)
);

matches.senderName =
expected === actual
? "match"
: "mismatch";

if (
expected !== actual
) {

warnings.push(
`Gönderen adı uyuşmuyor. Beklenen: "${provided.senderName}", dekontta görülen: "${document.senderName}".`
);

}

}

}


if (
provided.recipientName
) {

if (
!document.recipientName
) {

matches.recipientName =
"unknown";

warnings.push(
"Alıcı adı kontrol edilemedi: dekonttan alıcı adı güvenilir şekilde okunamadı."
);

}

else {

const expected =
normalizeComparisonText(
provided.recipientName
);

const actual =
normalizeComparisonText(
document.recipientName
);

matches.recipientName =
expected === actual
? "match"
: "mismatch";

if (
expected !== actual
) {

warnings.push(
`Alıcı adı uyuşmuyor. Beklenen: "${provided.recipientName}", dekontta görülen: "${document.recipientName}".`
);

}

}

}


if (
provided.iban
) {

if (
!document.iban
) {

matches.iban =
"unknown";

warnings.push(
"IBAN kontrol edilemedi: dekonttan IBAN güvenilir şekilde okunamadı."
);

}

else {

const expected =
normalizeIBAN(
provided.iban
);

const actual =
normalizeIBAN(
document.iban
);

matches.iban =
expected === actual
? "match"
: "mismatch";

if (
expected !== actual
) {

warnings.push(
`IBAN uyuşmuyor. Beklenen: "${provided.iban}", dekontta görülen: "${document.iban}".`
);

}

}

}


if (
provided.amount !== null &&
provided.amount !== undefined &&
String(provided.amount).trim() !== ""
) {

const expected =
parseComparisonAmount(
provided.amount
);

const actual =
parseComparisonAmount(
document.amount
);

if (
expected === null
) {

matches.amount =
"unknown";

warnings.push(
"Tutar kontrolü yapılamadı: gönderilen beklenen tutar okunabilir bir sayıya dönüştürülemedi."
);

}

else if (
actual === null
) {

matches.amount =
"unknown";

warnings.push(
"Tutar kontrol edilemedi: dekonttan ana işlem tutarı güvenilir şekilde okunamadı."
);

}

else {

const difference =
Math.abs(
expected - actual
);

matches.amount =
difference <= 0.01
? "match"
: "mismatch";

if (
difference > 0.01
) {

warnings.push(
`Tutar uyuşmuyor. Beklenen: "${provided.amount}", dekontta görülen: "${document.amount}".`
);

}

}

}

return {

enabled:
true,

matches,

warnings,

provided,

document,

};

}


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
files
} =
await parseMultipart(req);


console.log(
"FORM PARSED"
);


const uploadedFile =
findUploadedFile(
files
);


if (
!uploadedFile
) {

throw new Error(
"Dosya alınamadı. image, file veya video alanı bulunamadı."
);

}


const rawType =
first(
fields?.type
) ||
"document";

const statementMode =
first(
fields?.statementMode
) === "true";

const type =
statementMode
? "statement"
: rawType;

const fileName =
first(
fields?.fileName
) ||
uploadedFile.originalFilename ||
"document";


// =================================================
// KULLANICININ VERDİĞİ KARŞILAŞTIRMA BİLGİLERİ
// =================================================

let providedInfo =
null;

const rawProvidedInfo =
first(
fields?.providedInfo
);

if (
rawProvidedInfo
) {

try {

providedInfo =
normalizeProvidedInfo(
JSON.parse(
rawProvidedInfo
)
);

}

catch (error) {

console.warn(
"providedInfo JSON okunamadı:",
error
);

providedInfo =
null;

}

}


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
bank ||
"YOK"
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


if (
!filePath
) {

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


// =================================================
// IMAGE MIME
// =================================================

if (
(
type === "image" ||
type === "statement"
) &&
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


// =================================================
// PDF MIME
// =================================================

if (
(
type === "pdf" ||
type === "statement"
) &&
(
!mime ||
!mime.includes(
"pdf"
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
extension === ".pdf"
) {

mime =
"application/pdf";

}

}


// =================================================
// VIDEO MIME
// =================================================

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
// HESAP ÖZETİ
// =====================================================

// ÇOK ÖNEMLİ:
//
// Hesap özeti analizinde referans yüklenmez.
//
// Bu bölüm normal referans sisteminden tamamen bağımsızdır.

if (
type === "statement"
) {

console.log(
"HESAP ÖZETİ MODU"
);

console.log(
"REFERANS: KULLANILMIYOR"
);


const statementResult =
await analyzeStatement(
base64,
mime,
fileName
);


const statementScore =
Number(
statementResult?.overallRisk
) || 0;


const statementSuspicious =
statementScore >= 46;


const statementEvidence =
Array.isArray(
statementResult?.evidence
)
?
statementResult.evidence
:
[];


console.log(
"HESAP ÖZETİ RİSK:",
statementScore
);


console.log(
"HESAP ÖZETİ ŞÜPHE:",
statementSuspicious
);


console.log(
"HESAP ÖZETİ ANALİZ TAMAMLANDI"
);


return res
.status(200)
.json({

success:
true,

fileName,

type:
"statement",

bank:
bank ||
null,

reference:
null,

...statementResult,

score:
statementScore,

suspicious:
statementSuspicious,

evidence:
statementEvidence,

});

}


// =====================================================
// REFERANS DEKONT
// =====================================================

// Video analizinde kullanılmayacak.
// Hesap özetinde de kullanılmayacak.
//
// Sadece normal image/pdf dekont analizlerinde kullanılır.

let reference =
null;


if (
type !== "video" &&
type !== "statement"
) {

reference =
await loadReferenceFile(
bank
);

}


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

=====================================================
DEKONT BİLGİLERİNİ YAPILANDIRILMIŞ OLARAK ÇIKAR
=====================================================

Normal dekont analizinde aşağıdaki alanları mümkün olduğunca dekontun
üzerinden doğrudan çıkar:

documentData.senderName
documentData.recipientName
documentData.amount
documentData.currency
documentData.iban

Kurallar:

- Yalnızca gerçekten görülebilen bilgileri yaz.
- Güvenilir şekilde okunamıyorsa null kullan.
- IBAN'ı mümkünse standart biçimde yaz.
- amount alanında dekontta görülen ana işlem tutarını kullan.
- IBAN, hesap numarası, işlem numarası, referans numarası veya tarih
  gibi diğer rakamları amount olarak kullanma.
- Gönderen ve alıcıyı alan etiketlerine göre ayırt et.
- Açıklama alanındaki isimleri gönderen/alıcı yerine kullanma.
- Bu bilgiler daha sonra kullanıcı tarafından verilen bilgilerle
  karşılaştırılacaktır.
- Bu karşılaştırma risk skoruna dahil edilmeyecektir.

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

=====================================================
DEKONT BİLGİLERİNİ YAPILANDIRILMIŞ OLARAK ÇIKAR
=====================================================

Normal dekont analizinde aşağıdaki alanları mümkün olduğunca dekontun
üzerinden doğrudan çıkar:

documentData.senderName
documentData.recipientName
documentData.amount
documentData.currency
documentData.iban

Kurallar:

- Yalnızca gerçekten görülebilen bilgileri yaz.
- Güvenilir şekilde okunamıyorsa null kullan.
- IBAN'ı mümkünse standart biçimde yaz.
- amount alanında dekontta görülen ana işlem tutarını kullan.
- IBAN, hesap numarası, işlem numarası, referans numarası veya tarih
  gibi diğer rakamları amount olarak kullanma.
- Gönderen ve alıcıyı alan etiketlerine göre ayırt et.
- Açıklama alanındaki isimleri gönderen/alıcı yerine kullanma.
- Bu bilgiler daha sonra kullanıcı tarafından verilen bilgilerle
  karşılaştırılacaktır.
- Bu karşılaştırma risk skoruna dahil edilmeyecektir.

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

...(
reference?.base64

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

: []
),

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


const videoScore =
Number(
videoResult?.overallRisk
) || 0;


const videoSuspicious =
videoScore >= 46;


const videoEvidence =
videoResult?.amountAnalysis?.evidence ||
videoResult?.summary ||
"Video analizi tamamlandı.";


return res
.status(200)
.json({

success:
true,

fileName,

type,

bank:
bank,

reference:
null,

videoFrames:
frames.length,

...videoResult,

score:
videoScore,

suspicious:
videoSuspicious,

evidence:
videoEvidence,

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
// DETERMINISTIK RİSK MOTORU
// =====================================================

const calculatedRisk =
calculateOverallRisk(
result
);


// AI'ın overallRisk değerini kullanma.
// Nihai skor JavaScript risk motorundan gelir.

result.overallRisk =
calculatedRisk.overallRisk;

result.riskLabel =
calculatedRisk.riskLabel;

result.categories =
calculatedRisk.categories;

// =====================================================
// KULLANICI BİLGİLERİ ↔ DEKONT KARŞILAŞTIRMASI
// =====================================================
//
// ÖNEMLİ:
// Bu kontrol risk skorunu değiştirmez.
// Sadece ayrı bir uyarı olarak döndürülür.

const informationCheck =
compareProvidedInfoWithDocument(
providedInfo,
result?.documentData
);

result.informationCheck =
informationCheck;

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
"INFORMATION CHECK:",
JSON.stringify(
informationCheck
)
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

bank:
bank,

reference:
reference?.fileName ||
null,

...result,

score:
finalScore,

suspicious:
finalSuspicious,

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
