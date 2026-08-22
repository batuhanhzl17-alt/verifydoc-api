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
// REFERANS KLAS�R�
// =====================================================

const REFERENCE_DIR =
path.join(process.cwd(), "references");


// =====================================================
// BANKA ? REFERANS PDF MAP
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


// =====================================================
// BANKA NORMAL?ZASYONU
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
.replace(/?/g, "i")
.replace(/?/g, "i")
.replace(/?/g, "s")
.replace(/?/g, "s")
.replace(/?/g, "g")
.replace(/?/g, "g")
.replace(/�/g, "u")
.replace(/�/g, "u")
.replace(/�/g, "o")
.replace(/�/g, "o")
.replace(/�/g, "c")
.replace(/�/g, "c");


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
"REFERENCE DOSYASI BO?:",
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
// 25 KONTROL� KATEGOR?LERE DA?IT
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
// KATEGOR? SKORU HESAPLA
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


// UNKNOWN ? R?SK EKLEME

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
// R?SK ET?KET?
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
// N?HA? R?SK HESAPLA
// =====================================================

function calculateOverallRisk(
result
) {

const checks =
result?.checks ||
{};


// -----------------------------------------------------
// KATEGOR?LER? 25 KONTROLDEN HESAPLA
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
// A?IRLIKLI ANA SKOR
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
// MATEMAT?KSEL TUTARSIZLIK BONUSU
// -----------------------------------------------------
//
// Yeterli veri varsa ve matematik tutmuyorsa
// finansal riski ayr?ca art?r.
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
// YEN? KATEGOR?LER? D�ND�R
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
// KULLANICI TARAFINDAN VERİLEN DEKONT BİLGİLERİ
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
.replace(/\s+/g, " ");
}

function normalizeName(value) {

return normalizeComparisonText(value)
.replace(/[^\p{L}\p{N} ]/gu, "")
.replace(/\s+/g, " ")
.trim();
}

function normalizeIban(value) {

return String(value || "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "");
}

function normalizeAmount(value) {

if (
value === null ||
value === undefined ||
value === ""
) {
return null;
}

const raw = String(value)
.trim()
.replace(/₺/g, "")
.replace(/TL/gi, "")
.replace(/TRY/gi, "")
.replace(/\s/g, "");

if (!raw) {
return null;
}

let normalized = raw;

// Türkçe sayı biçimi: 1.234,56
if (
normalized.includes(",") &&
normalized.includes(".")
) {
normalized = normalized
.replace(/\./g, "")
.replace(",", ".");
}
else if (
normalized.includes(",")
) {
normalized = normalized.replace(",", ".");
}
else if (
/^\d{1,3}(\.\d{3})+$/.test(normalized)
) {
normalized = normalized.replace(/\./g, "");
}

const number = Number(normalized);

return Number.isFinite(number)
? number
: null;
}

function parseUserProvidedInfo(value) {

if (
!value ||
typeof value !== "string"
) {
return {
senderName: null,
recipientName: null,
amount: null,
iban: null,
};
}

const result = {
senderName: null,
recipientName: null,
amount: null,
iban: null,
};

const lines = value
.split(/\r?\n/)
.map((line) => line.trim())
.filter(Boolean);

for (const line of lines) {

const match = line.match(
/^\s*(gönderen|gonderen|alıcı|alici|tutar|miktar|iban)\s*[:=-]\s*(.+?)\s*$/iu
);

if (!match) {
continue;
}

const key = match[1]
.toLocaleLowerCase("tr-TR");
const val = match[2].trim();

if (key === "gönderen" || key === "gonderen") {
result.senderName = val;
}
else if (key === "alıcı" || key === "alici") {
result.recipientName = val;
}
else if (key === "tutar" || key === "miktar") {
result.amount = val;
}
else if (key === "iban") {
result.iban = val;
}
}

return result;
}

function compareProvidedInfoWithDocument(
provided,
documentInfo
) {

const warnings = [];

const comparison = {

available: false,

sender: {
provided: provided?.senderName || null,
document: documentInfo?.senderName || null,
status: "unknown",
},

recipient: {
provided: provided?.recipientName || null,
document: documentInfo?.recipientName || null,
status: "unknown",
},

amount: {
provided: provided?.amount || null,
document: documentInfo?.amount || null,
status: "unknown",
},

iban: {
provided: provided?.iban || null,
document: documentInfo?.iban || null,
status: "unknown",
},

warnings,
};

const hasProvided =
Boolean(
provided?.senderName ||
provided?.recipientName ||
provided?.amount ||
provided?.iban
);

comparison.available = hasProvided;

if (!hasProvided) {
return comparison;
}

if (provided?.senderName) {

if (!documentInfo?.senderName) {
comparison.sender.status = "unknown";
warnings.push(
`Gönderen bilgisi kullanıcı tarafından verildi (${provided.senderName}) ancak dekontta güvenilir şekilde okunamadı.`
);
}
else if (
normalizeName(provided.senderName) ===
normalizeName(documentInfo.senderName)
) {
comparison.sender.status = "match";
}
else {
comparison.sender.status = "mismatch";
warnings.push(
`Gönderen bilgisi uyuşmuyor: verilen "${provided.senderName}", dekontta görünen "${documentInfo.senderName}".`
);
}
}

if (provided?.recipientName) {

if (!documentInfo?.recipientName) {
comparison.recipient.status = "unknown";
warnings.push(
`Alıcı bilgisi kullanıcı tarafından verildi (${provided.recipientName}) ancak dekontta güvenilir şekilde okunamadı.`
);
}
else if (
normalizeName(provided.recipientName) ===
normalizeName(documentInfo.recipientName)
) {
comparison.recipient.status = "match";
}
else {
comparison.recipient.status = "mismatch";
warnings.push(
`Alıcı bilgisi uyuşmuyor: verilen "${provided.recipientName}", dekontta görünen "${documentInfo.recipientName}".`
);
}
}

if (provided?.amount) {

const providedAmount = normalizeAmount(provided.amount);
const documentAmount = normalizeAmount(documentInfo?.amount);

if (
providedAmount === null
) {
comparison.amount.status = "unknown";
warnings.push(
`Verilen tutar (${provided.amount}) güvenilir şekilde sayısal değere dönüştürülemedi.`
);
}
else if (
 documentAmount === null
) {
comparison.amount.status = "unknown";
warnings.push(
`Tutar bilgisi kullanıcı tarafından verildi (${provided.amount}) ancak dekontta güvenilir şekilde okunamadı.`
);
}
else if (
Math.abs(providedAmount - documentAmount) < 0.01
) {
comparison.amount.status = "match";
}
else {
comparison.amount.status = "mismatch";
warnings.push(
`Tutar bilgisi uyuşmuyor: verilen "${provided.amount}", dekontta görünen "${documentInfo.amount}".`
);
}
}

if (provided?.iban) {

const providedIban = normalizeIban(provided.iban);
const documentIban = normalizeIban(documentInfo?.iban);

if (!providedIban) {
comparison.iban.status = "unknown";
}
else if (!documentIban) {
comparison.iban.status = "unknown";
warnings.push(
`IBAN bilgisi kullanıcı tarafından verildi ancak dekontta güvenilir şekilde okunamadı.`
);
}
else if (providedIban === documentIban) {
comparison.iban.status = "match";
}
else {
comparison.iban.status = "mismatch";
warnings.push(
`IBAN bilgisi uyuşmuyor: verilen "${provided.iban}", dekontta görünen "${documentInfo.iban}".`
);
}
}

return comparison;
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

transactionDetails: {

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

iban: {
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

},

required: [
"senderName",
"recipientName",
"iban",
"amount",
"currency",
],

additionalProperties:
false,

},

verificationWarning: {

type:
"object",

properties: {

available: {
type:
"boolean",
},

warnings: {
type:
"array",
items: {
type:
"string",
},
},

},

required: [
"available",
"warnings",
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
"transactionDetails",
"verificationWarning",
"limitations",
"amountAnalysis",

],

additionalProperties:
false,

};


// =====================================================
// HESAP �ZET? RESPONSE SCHEMA
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
// VIDEO ? FRAME �IKARMA
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
"Videodan analiz edilecek kare �?kar?lamad?."
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
// VIDEO FRAME ANAL?Z?
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
"Analiz edilecek video karesi bulunamad?."
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
V?DEO ANAL?Z?
=====================================================

Bu belge bir video i�erisinden �?kar?lm??
${frames.length} ayr? kare �zerinden analiz edilmektedir.

�OK �NEML?:

Bu video analizinde REFERANS DEKONT KULLANMA.

Banka referans PDF'i,
referans ?ablon,
referans belge
veya ba?ka bir referans dosya
video analizine dahil edilmemelidir.

Yaln?zca video karelerinde ger�ekten g�r�lebilen
bilgilere dayan.

T�m video karelerini birlikte de?erlendir.

=====================================================
KARELER ARASI TUTARLILIK
=====================================================

�zellikle kareler aras?nda ?u bilgilerin de?i?ip
de?i?medi?ini kontrol et:

- isim
- soy isim
- g�nderici
- al?c?
- IBAN
- hesap numaras?
- i?lem numaras?
- referans numaras?
- tarih
- saat
- tutar
- para birimi
- a�?klama
- banka ad?
- logo
- QR kod
- barkod
- metin
- rakamlar

Ayr?ca:

- sonradan eklenmi? alan
- sonradan silinmi? alan
- yap??t?r?lm?? b�lge
- dijital montaj
- farkl? font
- farkl? karakter kalitesi
- farkl? s?k??t?rma
- farkl? keskinlik
- farkl? g�r�nt� yap?s?
- hareket s?ras?nda ortaya �?kan tutars?zl?k
- ekran �zerinde sonradan de?i?tirilmi? alan

olup olmad???n? kontrol et.

=====================================================
DO?AL V?DEO DE????KL?KLER?
=====================================================

A?a??daki durumlar? tek ba??na sahtecilik kan?t?
olarak de?erlendirme:

- kamera hareketi
- zoom
- odak de?i?imi
- ???k de?i?imi
- perspektif de?i?imi
- g�r�nt� titremesi
- JPEG s?k??t?rmas?
- video s?k??t?rmas?
- hafif bulan?kl?k
- farkl? karelerde farkl? parlakl?k
- do?al g�lge de?i?imleri

Bunlar tek ba??na risk skorunu y�kseltmemelidir.

=====================================================
V?DEO MAN?P�LASYON KONTROL�
=====================================================

Belgenin farkl? karelerinde ayn? alanlar? m�mk�n
oldu?unca kar??la?t?r.

�rne?in:

Bir karede tutar:

"25.000 TL"

iken ba?ka bir karede:

"35.000 TL"

g�r�l�yorsa bunu �nemli bir tutars?zl?k olarak
de?erlendir.

Ayn? ?ekilde:

IBAN de?i?iyorsa,
isim de?i?iyorsa,
tarih de?i?iyorsa,
al?c? de?i?iyorsa,
i?lem numaras? de?i?iyorsa

bunu a�?k�a evidence alan?nda belirt.

Ancak g�r�nt� kalitesi nedeniyle bir bilginin
okunamad??? durumda de?er tahmin etme.

=====================================================
TUTAR KONTROL�
=====================================================

Videoda g�r�nen finansal tutarlar? ayr?ca kontrol et.

Ana i?lem tutar?n?:

- IBAN
- hesap numaras?
- i?lem numaras?
- referans numaras?
- tarih
- saat

gibi di?er rakamlarla kar??t?rma.

E?er ara toplam, vergi, �cret, komisyon veya
toplam tutar g�r�n�yorsa matematiksel olarak
kontrol et.

Yeterli veri yoksa de?erleri tahmin etme.

=====================================================
V?DEO KAL?TES?
=====================================================

Video kalitesi d�?�kse otomatik olarak sahtecilik
karar? verme.

E?er baz? karelerde belge okunam?yorsa bunu
limitations alan?nda belirt.

E?er kalite yeterliyse bunu a�?k�a belirt.

=====================================================
R?SK
=====================================================

Kareler aras?nda ger�ek ve anlaml? bir tutars?zl?k
bulunmad?k�a risk skorunu gereksiz ?ekilde art?rma.

Tek ba??na video kalitesinin d�?�k olmas?:

HIGH RISK

veya

VERY HIGH RISK

anlam?na gelmez.

Belirsiz durumlarda confidence de?erini d�?�r.

=====================================================
SONU�
=====================================================

Sonu� normal VerifyDoc analiz format?yla
uyumlu olmal?d?r.

?u alanlar?n tamam?n? doldur:

overallRisk
riskLabel
confidence
summary
categories
checks
limitations
amountAnalysis

25 kontrol�n tamam?n? de?erlendir.

Kesin olarak "sahte" veya "ger�ek" deme.

Bu yaln?zca otomatik �n incelemedir.

SONUCU SADECE JSON OLARAK D�ND�R.

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
"OpenAI'dan video analiz sonucu al?namad?."
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
"Video analiz sonucu ge�ersiz."
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
// ARRAY'DEN ?LK DE?ER? AL
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
// M?KRO KARAKTER / RAKAM TUTARLILIK ANAL?Z?
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
"Analiz edilecek metin bulunamad?.",

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
"Kar??la?t?rma i�in yeterli rakam bulunamad?.",

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
"Ayn? rakam?n yeterli tekrar? bulunamad?.",

};

}


return {

score:
0,

suspicious:
false,

reason:
"Rakam karakterleri mikro tutarl?l?k analizi i�in haz?r.",

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
"OpenAI bo? cevap d�nd�rd�."
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
"OpenAI ge�erli JSON d�nd�rmedi."
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

�, �
?, ?
?, I, ?
�, �
?, ?
�, �

Do NOT replace Turkish characters with their ASCII equivalents when the
correct Turkish spelling is known.

For example:

"�a?r?" is correct.
"Cagri" is not the preferred spelling when the Turkish character is visible.

"?ahin" is correct.
"Sahin" is not the preferred spelling when the Turkish character is visible.

"?? Bankas?" is correct.
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
�, ?, ?, ?, �, ?, �

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
is "?" or "i", "?" or "I", "?" or "s", etc., use "unknown" or mention
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

"�a?r?"
"?ahin"
"??lem"
"�deme"
"G�nderici"
"Al?c?"
"T�rk"
"�cret"
"�?k??"
"?? Bankas?"

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
TUTAR / VERG? / MATEMAT?KSEL KONTROL
=====================================================

Belgede g�r�nen finansal tutarlar? ayr?ca dikkatlice incele.

�zellikle:

- ana i?lem tutar?
- ara toplam
- mal/hizmet tutar?
- KDV
- di?er vergiler
- komisyon
- �cret
- indirim
- toplam tutar

alanlar?n? tespit et.

Ana i?lem tutar?n? IBAN, hesap numaras?, i?lem numaras?,
referans numaras?, tarih veya ba?ka bir finansal rakamla kar??t?rma.

Varsa matematiksel ili?kiyi kontrol et.

�rne?in:

ara toplam + KDV + di?er vergiler + �cret + komisyon - indirim = toplam

Belgede birden fazla vergi veya �cret varsa m�mk�n oldu?unca
toplam?n? hesapla.

G�r�nmeyen, okunamayan veya belirsiz rakamlar? tahmin etme.

Ara toplam g�r�lemiyorsa subtotal = null.

Vergi g�r�lemiyorsa taxAmount = null.

Toplam g�r�lemiyorsa totalAmount = null.

Hesaplanabilecek de?erler varsa:

calculatedTotal

alan?nda matematiksel olarak hesaplanan toplam? belirt.

difference alan?nda:

hesaplanan toplam - belgede g�r�nen toplam

fark?n? belirt.

Hesaplama i�in yeterli veri yoksa:

calculatedTotal = null
difference = null

kullan.

Yeterli veri yoksa calculationConsistent de?erini otomatik olarak
true yapma.

Hesaplama i�in yeterli veri bulunmad???nda calculationConsistent
de?erini false olarak kullan ve nedenini evidence alan?nda a�?kla.

�ok k���k yuvarlama farklar?n? tek ba??na ?�pheli olarak de?erlendirme.

Matematiksel tutars?zl?k varsa bunun nedenini amountAnalysis.evidence
alan?nda a�?k�a belirt.

=====================================================
ANA TUTAR KARAKTER / FONT KONTROL�
=====================================================

Ana i?lem tutar?n?n karakterlerini g�rsel olarak incele.

�zellikle:

- karakter y�ksekli?i
- karakter geni?li?i
- font a??rl???
- stroke kal?nl???
- karakter aral???
- baseline
- hizalama
- kenar yap?s?
- anti-aliasing
- genel render g�r�n�m�

a�?s?ndan �evresindeki ayn? tip metinlerle tutarl?l???n? de?erlendir.

Farkl? rakamlar?n do?al olarak farkl? ?ekillere sahip oldu?unu unutma.

Tek ba??na bir karakterin di?er rakamlardan farkl? g�r�nmesi
?�pheli de?ildir.

Foto?raf a�?s?, perspektif, ???k, JPEG s?k??t?rmas? veya g�r�nt�
kalitesi kaynakl? k���k farkl?l?klar? sahtecilik olarak de?erlendirme.

Yeterli g�rsel kan?t yoksa ?�pheli sonu� �retme.

=====================================================
İŞLEM BİLGİLERİNİ YAPISAL OLARAK ÇIKAR
=====================================================

Dekontta güvenilir şekilde görülebilen şu bilgileri ayrıca transactionDetails
alanına çıkar:

- senderName: gönderen adı/soyadı
- recipientName: alıcı adı/soyadı
- iban: dekontta görünen ilgili IBAN. Gönderici ve alıcı IBAN'ları birlikte
  görünüyorsa işlemin ana karşı tarafına ait IBAN'ı mümkün olduğunca doğru
  şekilde belirle; belirsizse null kullan.
- amount: ana işlem tutarı. IBAN, hesap numarası, işlem numarası, tarih veya
  saat gibi başka rakamları tutar olarak kullanma.
- currency: para birimi

Bilgi güvenilir şekilde okunamıyorsa null kullan.
Tahmin etme.

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

"Belge PDF format?nda oldu?u i�in de?il, sayfa g�r�nt�s� d�?�k kaliteli
oldu?u i�in baz? karakterler g�venilir ?ekilde do?rulanam?yor."

If the quality is sufficient, use wording similar to:

"Belge kalitesi analiz i�in yeterli g�r�n�yor."

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

� �
? ?
? I ? i
� �
? ?
� �

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
// HESAP �ZET? PROMPT
// REFERANS KULLANILMAZ
// =====================================================

const STATEMENT_PROMPT = `

Sen VerifyDoc isimli AI destekli belge inceleme sistemisin.

Bu belge bir banka hesap �zeti / hesap ekstresi olarak
incelenmektedir.

�OK �NEML?:

Bu analizde banka referans PDF'i KULLANMA.

Referans ?ablon kullanma.

Referans belge kullanma.

Ba?ka banka belgesi ile kar??la?t?rma yapma.

Yaln?zca g�nderilen hesap �zeti �zerinden analiz yap.

Bu analiz kesin ger�eklik veya sahtecilik karar? de?ildir.

Kesin olarak "ger�ek" deme.

Kesin olarak "sahte" deme.

Yaln?zca ger�ekten g�r�lebilen veya g�venilir ?ekilde
hesaplanabilen bilgiler �zerinden de?erlendirme yap.

G�r�lemeyen bilgileri tahmin etme.

=====================================================
HESAP �ZET? TANIMLAMA
=====================================================

Belgenin hesap �zeti / hesap ekstresi niteli?inde olup
olmad???n? de?erlendir.

G�r�lebiliyorsa:

- banka
- hesap sahibi
- IBAN
- hesap numaras?
- hesap d�nemi
- para birimi
- a�?l?? bakiyesi
- kapan?? bakiyesi

bilgilerini incele.

Banka ad? kesin olarak g�r�lemiyorsa banka ad? uydurma.

=====================================================
??LEM SATIRLARI
=====================================================

G�r�nen i?lem sat?rlar?n? incele.

�zellikle:

- i?lem tarihi
- i?lem a�?klamas?
- para giri?i
- para �?k???
- i?lem tutar?
- i?lem sonras? bakiye
- g�nderen
- al?c?
- i?lem/ref numaras?

alanlar?n? kontrol et.

Bir rakam?n ne oldu?u kesin de?ilse tahmin etme.

=====================================================
BAK?YE MATEMAT???
=====================================================

Yeterli veri varsa:

�nceki bakiye
+
para giri?leri
-
para �?k??lar?
=
sonraki bakiye

ili?kisini kontrol et.

Birden fazla i?lem varsa m�mk�n oldu?unca ard???k
bakiyeleri kontrol et.

�rne?in:

Ba?lang?� bakiyesi: 10.000 TL

Giri?: 2.000 TL

�?k??: 500 TL

Beklenen bakiye: 11.500 TL

Belgede farkl? bir bakiye g�r�n�yorsa bunu a�?k�a belirt.

Ancak:

- �cret
- komisyon
- faiz
- kur fark?
- bloke
- otomatik tahsilat
- ba?ka finansal hareket

gibi g�r�n�r kalemleri de hesaba kat.

Yeterli veri yoksa matematiksel tutarl?l?k hakk?nda
kesin sonu� verme.

=====================================================
TOPLAM G?R?? / �IKI?
=====================================================

Belgede toplam giri? ve �?k?? tutarlar? g�r�n�yorsa
i?lem sat?rlar?yla kar??la?t?r.

Hesaplanabiliyorsa:

- toplam giri?
- toplam �?k??
- net hareket
- hesaplanan kapan?? bakiyesi

de?erlerini hesapla.

Eksik veri varsa tahmin etme.

=====================================================
TAR?H KONTROL�
=====================================================

??lem tarihlerini kontrol et.

�zellikle:

- hesap d�nemi
- i?lem tarihleri
- tarih s?ralamas?
- d�nem d??? i?lem
- imkans?z veya ?�pheli tarih
- farkl? tarih formatlar?

incelenmelidir.

Farkl? tarih format? tek ba??na sahtecilik kan?t? de?ildir.

=====================================================
BAK?YE DEVAMLILI?I
=====================================================

Bir i?lem sonras? bakiye ile sonraki i?lem �ncesi
bakiye aras?nda tutarl?l?k varsa kontrol et.

Sayfalar aras?nda bakiye devaml?l??? varsa ayr?ca
kontrol et.

Birinci sayfan?n son bakiyesi ile ikinci sayfan?n
ba?lang?�/devam bakiyesi aras?nda tutars?zl?k varsa
a�?k�a belirt.

=====================================================
TEKRARLAYAN ??LEMLER
=====================================================

Ayn?:

- tarih
- tutar
- a�?klama
- g�nderen/al?c?

kombinasyonlar?n?n ola?and??? tekrar edip etmedi?ini
incele.

Tekrar tek ba??na sahtecilik kan?t? de?ildir.

=====================================================
G�RSEL MAN?P�LASYON
=====================================================

Hesap �zetinde:

- font farkl?l???
- font boyutu farkl?l???
- karakter aral???
- baseline
- hizalama
- farkl? s?k??t?rma
- kopyala-yap??t?r b�lgeleri
- sonradan eklenmi? alan
- sonradan silinmi? alan
- farkl? keskinlik
- farkl? render
- dijital montaj
- Photoshop benzeri d�zenleme
- yapay olarak de?i?tirilmi? rakamlar
- sayfalar aras? g�rsel tutars?zl?k

olup olmad???n? incele.

G�r�nt� kalitesinden kaynaklanan k���k farkl?l?klar?
otomatik olarak sahtecilik kabul etme.

=====================================================
SAYFALAR ARASI KONTROL
=====================================================

Birden fazla sayfa varsa:

- hesap sahibi
- IBAN
- hesap numaras?
- hesap d�nemi
- para birimi
- i?lem s?ras?
- bakiye devaml?l???
- sayfa numaras?

alanlar?n? kar??la?t?r.

Farkl? sayfalarda ayn? bilgiler farkl? g�r�n�yorsa
bunu incele.

Ancak normal PDF olu?turma farkl?l?klar?n? otomatik
olarak manip�lasyon olarak de?erlendirme.

=====================================================
PDF KAL?TES?
=====================================================

PDF olmas? tek ba??na d�?�k kalite de?ildir.

Belge okunabiliyorsa bunu olumlu kalite g�stergesi
olarak de?erlendir.

Yaln?zca ger�ekten:

- bulan?kl?k
- pikselizasyon
- okunamayan rakam
- k?rp?lma
- ciddi s?k??t?rma
- tarama g�r�lt�s�
- g�lge
- parlama
- perspektif bozulmas?

varsa limitation belirt.

=====================================================
R?SK HESAPLAMA
=====================================================

?unlar? hesapla:

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

Confidence 0-100 aras?nda olmal?d?r.

Matematiksel bakiye tutars?zl??? varsa
financialDataRisk'i art?r.

G�rsel manip�lasyon kan?t? varsa
editingRisk'i art?r.

Yaln?zca belirsizlik varsa confidence d�?�r.

Belirsizli?i otomatik olarak HIGH RISK yapma.

=====================================================
SONU�
=====================================================

Sonu� yaln?zca ge�erli JSON olmal?d?r.

T�m a�?klamalar T�RK�E olmal?d?r.

?u alanlar?n tamam?n? d�nd�r:

overallRisk
riskLabel
confidence
summary
categories
balanceAnalysis
transactionAnalysis
limitations
evidence

Kesin ger�ek veya kesin sahte karar? verme.

`;


// =====================================================
// HESAP �ZET? ANAL?Z FONKS?YONU
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
"HESAP �ZET? ANAL?Z? BA?LADI"
);

console.log(
"HESAP �ZET? REFERANS KULLANILMAYACAK"
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
"HESAP �ZET? OPENAI RESPONSE RECEIVED"
);


const output =
response?.output_text;


if (
!output
) {

throw new Error(
"OpenAI'dan hesap �zeti analiz sonucu al?namad?."
);

}


console.log(
"HESAP �ZET? ANAL?Z SONUCU:",
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
"Hesap �zeti analiz sonucu ge�ersiz."
);

}


return result;

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
"OPENAI_API_KEY Vercel Environment Variables i�inde bulunamad?."
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
"Dosya al?namad?. image, file veya video alan? bulunamad?."
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
"Y�klenen dosyan?n yolu bulunamad?."
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
"Dosya bo?."
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
// HESAP �ZET?
// =====================================================

// �OK �NEML?:
//
// Hesap �zeti analizinde referans y�klenmez.
//
// Bu b�l�m normal referans sisteminden tamamen ba??ms?zd?r.

if (
type === "statement"
) {

console.log(
"HESAP �ZET? MODU"
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
"HESAP �ZET? R?SK:",
statementScore
);


console.log(
"HESAP �ZET? ?�PHE:",
statementSuspicious
);


console.log(
"HESAP �ZET? ANAL?Z TAMAMLANDI"
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

// Video analizinde kullan?lmayacak.
// Hesap �zetinde de kullan?lmayacak.
//
// Sadece normal image/pdf dekont analizlerinde kullan?l?r.

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

Bu analizde ayr?ca bir referans dekont sa?lanm??t?r.

Analiz edilen bankan?n sistem taraf?ndan belirlenen ad?:
${bank || "Banka belirtilmedi"}

Referans:
${reference?.fileName || "Referans bulunamad?"}

Referans dekontu, analiz edilen dekont ile:

- belge ?ablonu
- yerle?im
- tipografi
- font g�r�n�m�
- alan d�zeni
- logo
- tarih bi�imi
- tutar bi�imi
- IBAN bi�imi
- genel g�rsel yap?

a�?s?ndan kar??la?t?r.

Referans? belge ?ablonu, yerle?im, tipografi, alan d�zeni,
logo, tarih, tutar, IBAN bi�imi ve genel g�rsel yap? a�?s?ndan
kar??la?t?rma amac?yla kullan.

Referansla birebir ayn? olmamas?n? tek ba??na sahtecilik kan?t?
olarak de?erlendirme.

Birden fazla ba??ms?z ve anlaml? tutars?zl?k olmad?k�a risk
art?rma.

Referans dekontun kendisini analiz edilen dekontun
ger�ekli?i i�in kesin kan?t olarak kabul etme.

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

Bu analizde ayr?ca bir referans dekont sa?lanm??t?r.

Analiz edilen bankan?n sistem taraf?ndan belirlenen ad?:
${bank || "Banka belirtilmedi"}

Referans dosya:
${reference?.fileName || "Referans bulunamad?"}

Referans dekontu, analiz edilen dekont ile:

- belge ?ablonu
- yerle?im
- tipografi
- font g�r�n�m�
- alan d�zeni
- logo
- tarih bi�imi
- tutar bi�imi
- IBAN bi�imi
- genel g�rsel yap?

a�?s?ndan kar??la?t?r.

�OK �NEML?:

Referans ile analiz edilen dekontun birebir ayn? olmas?
beklenmemektedir.

Farkl? uygulama s�r�mleri, web/mobil bankac?l?k,
i?lem t�rleri ve belge versiyonlar? olabilir.

Bu nedenle tek bir farkl?l??? sahtecilik kan?t? olarak
de?erlendirme.

Birden fazla ba??ms?z ve anlaml? tutars?zl?k varsa
risk de?erlendirmesine dahil et.

Referans dekontun kendisini analiz edilen dekontun
ger�ekli?i i�in kesin kan?t olarak kabul etme.

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
"Video analizi tamamland?.";


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
"Desteklenmeyen dosya t�r�."
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
// KULLANICI BİLGİLERİ İLE DEKONT KARŞILAŞTIRMASI
// =====================================================
// Bu karşılaştırma risk skoruna dahil edilmez.
// Sadece ayrı bir uyarı olarak döndürülür.

const providedInfoText =
first(fields?.providedInfo) ||
first(fields?.documentInfo) ||
first(fields?.claim) ||
"";

const providedInfo =
parseUserProvidedInfo(
providedInfoText
);

const documentInfo =
result?.transactionDetails || {};

const verificationComparison =
compareProvidedInfoWithDocument(
providedInfo,
documentInfo
);

result.verificationWarning = {
available:
verificationComparison.available,
warnings:
verificationComparison.warnings,
};

console.log(
"PROVIDED INFO:",
providedInfo
);

console.log(
"DOCUMENT INFO:",
documentInfo
);

console.log(
"VERIFICATION WARNINGS:",
verificationComparison.warnings
);



// =====================================================
// DETERMINISTIK R?SK MOTORU
// =====================================================

const calculatedRisk =
calculateOverallRisk(
result
);


// AI'?n overallRisk de?erini kullanma.
// Nihai skor JavaScript risk motorundan gelir.

result.overallRisk =
calculatedRisk.overallRisk;

result.riskLabel =
calculatedRisk.riskLabel;

result.categories =
calculatedRisk.categories;  

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
"Analiz tamamland?.";


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

verificationWarning:
result.verificationWarning,

verificationComparison,
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
