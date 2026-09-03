import OpenAI from "openai"
import formidable from "formidable"
import fs from "fs/promises"
import path from "path"
import { createHash } from "crypto"
import { execFile } from "child_process"
import { promisify } from "util"
import ffmpegPath from "ffmpeg-static"
import sharp from "sharp"
import { runVisualForensics } from "./visual_forensics.js";
import { createWorker } from "tesseract.js"
import { Model, PaddleOCRClient } from "@paddleocr/api-sdk"
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs"
import { createRequire } from "module"
import { pathToFileURL } from "url"
const require = createRequire(import.meta.url);

// Vercel/ESM ortamında @napi-rs/canvas named export her zaman düzgün gelmeyebilir.
// createRequire ile CommonJS yükleyerek createCanvas erişimini sabitliyoruz.
let napiCanvas = null;
try {
  napiCanvas = require("@napi-rs/canvas");
} catch (error) {
  console.warn("NAPI CANVAS LOAD HATASI:", error?.message || error);
}

const createCanvas =
  napiCanvas?.createCanvas ||
  napiCanvas?.default?.createCanvas;

const ImageData =
  napiCanvas?.ImageData ||
  napiCanvas?.default?.ImageData;

const pdfWorkerPath = require.resolve(
"pdfjs-dist/build/pdf.worker.mjs"
);

pdfjsLib.GlobalWorkerOptions.workerSrc =
pathToFileURL(pdfWorkerPath).href;



const execFileAsync = promisify(execFile);
const amountForensicsStrongCache = new Map();
const referenceAmountAnchorCache = new Map();

// =====================================================
// PADDLEOCR CLIENT
// =====================================================

let paddleOCRClient = null;

function getPaddleOCRClient() {

if (
!process.env.PADDLEOCR_ACCESS_TOKEN
) {

console.warn(
"PADDLEOCR_ACCESS_TOKEN bulunamadı."
);

return null;

}

if (
!paddleOCRClient
) {

paddleOCRClient =
new PaddleOCRClient({

token:
process.env.PADDLEOCR_ACCESS_TOKEN,

requestTimeout:
300000,

pollTimeout:
600000,

});

}

return paddleOCRClient;

}

// =====================================================
// PADDLEOCR OCR
// =====================================================
//
// Yerel dosyayı PaddleOCR resmi API'ye gönderir.
// Token Vercel Environment Variables üzerinden gelir.
//
// PADDLEOCR_ACCESS_TOKEN
//
// PP-OCRv6 kullanılır.
// =====================================================

async function runPaddleOCR(
filePath
) {

if (
!filePath
) {

console.warn(
"PADDLEOCR: filePath bulunamadı."
);

return {
text:
"",
confidence:
0,
success:
false,
regions:
[],
};

}

const client =
getPaddleOCRClient();

if (
!client
) {

return {
text:
"",
confidence:
0,
success:
false,
regions:
[],
};

}

try {

console.log(
"================================================"
);

console.log(
"PADDLEOCR BAŞLADI"
);

console.log(
"DOSYA:",
filePath
);

console.log(
"MODEL: PP-OCRv6"
);

console.log(
"================================================"
);

const result =
await client.ocr({
filePath:
filePath,
model:
Model.PPOCRv6,
});

const pages =
Array.isArray(
result?.pages
)
?
result.pages
:
[];

const allTexts = [];
const allScores = [];
const allRegions = [];

for (
let pageIndex = 0;
pageIndex < pages.length;
pageIndex++
) {

const page = pages[pageIndex];
const pruned =
page?.prunedResult ||
page?.pruned_result ||
{};

const texts =
Array.isArray(
pruned?.rec_texts
)
?
pruned.rec_texts
:
[];

const scores =
Array.isArray(
pruned?.rec_scores
)
?
pruned.rec_scores
:
[];

const boxes =
Array.isArray(
pruned?.rec_boxes
)
?
pruned.rec_boxes
:
[];

const polys =
Array.isArray(
pruned?.rec_polys
)
?
pruned.rec_polys
:
[];

for (
let textIndex = 0;
textIndex < texts.length;
textIndex++
) {

const text =
texts[textIndex];

if (
text !== null &&
text !== undefined &&
String(text).trim()
) {

const cleanText =
String(text).trim();

allTexts.push(
cleanText
);

const score =
Number(scores[textIndex]);

if (
Number.isFinite(score)
) {
allScores.push(score);
}

let region = null;

if (
Array.isArray(boxes[textIndex]) &&
boxes[textIndex].length >= 4
) {

const box =
boxes[textIndex]
.map(Number);

if (
box.every(Number.isFinite)
) {

region = {

type:
"box",

x1:
Math.min(box[0], box[2]),

y1:
Math.min(box[1], box[3]),

x2:
Math.max(box[0], box[2]),

y2:
Math.max(box[1], box[3]),
};

}

}
else if (
Array.isArray(polys[textIndex])
) {

const points =
polys[textIndex]
.flat(Infinity)
.map(Number)
.filter(Number.isFinite);

if (
points.length >= 8
) {

const xs = [];
const ys = [];

for (
let i = 0;
i + 1 < points.length;
i += 2
) {

xs.push(points[i]);
ys.push(points[i + 1]);

}

if (
xs.length &&
ys.length
) {

region = {
type:
"polygon",

x1:
Math.min(...xs),

y1:
Math.min(...ys),

x2:
Math.max(...xs),

y2:
Math.max(...ys),
};

}

}

}

allRegions.push({
pageIndex,
text:
cleanText,
score:
Number.isFinite(score)
?
score
:
0,
region,
});

}

}

}

const text =
allTexts.join(
"\n"
);

const confidence =
allScores.length
?
Math.round(
(
allScores.reduce(
(
sum,
value
) =>
sum + value,
0
) /
allScores.length
) * 100
)
:
0;

console.log(
"PADDLEOCR TAMAMLANDI"
);

console.log(
"PADDLEOCR SAYFA:",
pages.length
);

console.log(
"PADDLEOCR METİN:",
text.length,
"karakter"
);

console.log(
"PADDLEOCR CONFIDENCE:",
confidence
);

console.log(
"PADDLEOCR REGION SAYISI:",
allRegions.length
);

return {
text,
confidence,
success:
true,
pages:
pages.length,
regions:
allRegions,
raw:
result,
};

}

catch (
error
) {

console.error(
"================================================"
);

console.error(
"PADDLEOCR HATASI:"
);

console.error(
error
);

console.error(
"================================================"
);

return {
text:
"",
confidence:
0,
success:
false,
regions:
[],
error:
error?.message ||
"Unknown PaddleOCR error",
};

}

}
let ocrWorker = null;
async function getOCRWorker() {
if (!ocrWorker) {
ocrWorker = await createWorker("tur+eng");
}

return ocrWorker;
}
async function runOCR(imagePath) {
const worker = await getOCRWorker();
const { data } = await worker.recognize(imagePath);

return {
text: data.text || "",
confidence: Number(data.confidence) || 0,
};
}




function extractPaddleOCRText(result) {

if (!result) {
return {
text: "",
confidence: 0,
pages: 0,
};
}

const pages = Array.isArray(result.pages)
? result.pages
: [];
const textParts = [];
const confidenceValues = [];

for (const page of pages) {

const raw = page?.raw || {};
const pruned =
page?.prunedResult ||
raw?.prunedResult ||
{};

const texts =
Array.isArray(pruned?.rec_texts)
? pruned.rec_texts
: [];

const scores =
Array.isArray(pruned?.rec_scores)
? pruned.rec_scores
: [];
for (let i = 0; i < texts.length; i++) {

const text =
typeof texts[i] === "string"
? texts[i].trim()
: ""
if (!text) {
continue;
}

textParts.push(text);

const score =
Number(scores[i]);
if (Number.isFinite(score)) {
confidenceValues.push(score);
}
}
// Bazı SDK sürümlerinde sayfa metni doğrudan bulunabilir.
if (!texts.length && typeof page?.text === "string") {

const directText = page.text.trim();
if (directText) {
textParts.push(directText);
}

}
}

const confidence =
confidenceValues.length
? Math.round(
(
confidenceValues.reduce(
(sum, value) => sum + value,
0
) /
confidenceValues.length
) * 100
)
: 0;
return {

text:
textParts.join("\n"),
confidence,

pages:
pages.length,

};
}

// =====================================================
// PDF → IMAGE — OCR FALLBACK
// =====================================================

async function pdfToImg(buffer, options = {}) {
const scale = options.scale || 2;

const pdf = await pdfjsLib.getDocument({
data: new Uint8Array(buffer),
}).promise;

const images = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
const page = await pdf.getPage(pageNumber);
const viewport = page.getViewport({
scale,
});

if (typeof createCanvas !== "function") {
  throw new Error("PDF_TO_IMAGE_CANVAS_UNAVAILABLE");
}
const canvas = createCanvas(
Math.ceil(viewport.width),
Math.ceil(viewport.height)
);
const context = canvas.getContext("2d");
await page.render({
canvasContext: context,
viewport,
}).promise;

images.push(
canvas.toBuffer("image/png")
);
}
return {
async *[Symbol.asyncIterator]() {
for (const image of images) {
yield image;
}
},
async destroy() {
images.length = 0;
},
};
}
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
garanti: "garanti.pdf",
};
function normalizeTurkishText(value) {
if (
!value ||
typeof value !== "string"
) {
return ""
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
return "akbank"
}

if (
value === "enpara" ||
value === "enparafinans"
) {
return "enpara"
}

if (
value.includes("vakifbank")
) {
return "vakifbank"
}

if (
value.includes("isbankasi") ||
value.includes("isbank")
) {
return "isbankasi"
}
if (
value.includes("ziraat")
) {
return "ziraat"
}


if (
value.includes("garanti")
) {
return "garanti"
}

if (
value.includes("denizbank")
) {
return "denizbank"
}


if (
value.includes("halkbank")
) {
return "halkbank"
}
if (
value.includes("yapikredi")
) {
return "yapikredi"
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

path:
referencePath,

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
"fail",
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
const RISK_CATEGORY_WEIGHTS = Object.freeze({
visualRisk: 15,
textRisk: 15,
layoutRisk: 15,
financialDataRisk: 25,
editingRisk: 30,
});

const MAX_RISK_SCORE = 100;

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

const status =
String(check.status || "")
.trim()
.toLowerCase();

// Kontrolün kendi sayısal skorunu kullan. Böylece tek bir fail,
// bütün kategoriyi otomatik 100'e kilitlemez.
if (status !== "pass" && status !== "fail") {
continue;
}

const rawCheckScore = Number(check.score);
const safeScore = Number.isFinite(rawCheckScore)
? Math.max(0, Math.min(100, rawCheckScore))
: (status === "fail" ? 60 : 0);


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
return "LOW RISK"

}

if (
score <= 45
) {

return "MODERATE RISK"

}

if (
score <= 70
) {
return "HIGH RISK"
}

return "VERY HIGH RISK"

}


// =====================================================
// NİHAİ RİSK HESAPLA
// =====================================================

function calculateDeterministicForensicRisk(result, forensic = {}) {
  const visualScore = Number(forensic?.visualForensics?.score);
  const layoutScore = Number(forensic?.layoutForensics?.score);
  const ocrConfidence = Number(forensic?.paddleImageOCR?.confidence);
  const amount = forensic?.amountForensics || null;
  const doc = result?.documentData || {};
  const template = forensic?.referenceTemplateAnalysis || null;

  // These scores are derived only from deterministic/local evidence.
  // AI-generated check scores are deliberately excluded from the final risk.
  const visualRisk = Number.isFinite(visualScore)
    ? Math.max(0, Math.min(100, Math.round(visualScore)))
    : 0;

  const layoutRisk = Number.isFinite(layoutScore)
    ? Math.max(0, Math.min(100, Math.round(layoutScore)))
    : 0;

  let textRisk = 0;
  if (Number.isFinite(ocrConfidence)) {
    if (ocrConfidence < 50) textRisk = 80;
    else if (ocrConfidence < 65) textRisk = 60;
    else if (ocrConfidence < 75) textRisk = 40;
    else if (ocrConfidence < 85) textRisk = 25;
    else if (ocrConfidence < 92) textRisk = 10;
  }

  // Reference field geometry is a deterministic structural signal. Keep it
  // capped here so a single OCR placement error cannot dominate the score.
  if (template?.available) {
    const strong = Number(template.strongGeometryCount) || 0;
    const missing = Number(template.missingFieldCount) || 0;
    textRisk = Math.max(textRisk, Math.min(45, strong * 6 + missing * 4));
  }

  let financialDataRisk = 0;
  const amountText = String(amount?.amountText || doc.amount || '').trim();
  if (!amountText) financialDataRisk = Math.max(financialDataRisk, 45);
  if (amount?.status === 'warning') {
    financialDataRisk = Math.max(
      financialDataRisk,
      amount?.severity === 'strong' ? 85 : 35
    );
  }

  // Validate any visible IBAN deterministically. This does not prove that an
  // IBAN belongs to the named recipient; it only detects checksum/format errors.
  const ibanCandidates = [doc.recipientIban, doc.iban].filter(Boolean);
  for (const candidate of ibanCandidates) {
    try {
      const check = validateIBANMod97(candidate);
      if (check && check.valid === false) financialDataRisk = Math.max(financialDataRisk, 70);
    } catch {}
  }

  // No AI editing score is trusted. Until an independent local edit detector
  // reports a strong signal, editingRisk remains neutral rather than random.
  const editingRisk = 0;

  const categories = {
    visualRisk,
    textRisk,
    layoutRisk,
    financialDataRisk,
    editingRisk,
  };

  const overallRisk = Math.round((
    categories.visualRisk * RISK_CATEGORY_WEIGHTS.visualRisk +
    categories.textRisk * RISK_CATEGORY_WEIGHTS.textRisk +
    categories.layoutRisk * RISK_CATEGORY_WEIGHTS.layoutRisk +
    categories.financialDataRisk * RISK_CATEGORY_WEIGHTS.financialDataRisk +
    categories.editingRisk * RISK_CATEGORY_WEIGHTS.editingRisk
  ) / 100);

  return {
    overallRisk: Math.max(0, Math.min(100, overallRisk)),
    riskLabel: getRiskLabel(overallRisk),
    categories,
    source: 'deterministic-local-forensics',
  };
}

function calculateOverallRisk(result) {
  if (result?.deterministicRisk && typeof result.deterministicRisk === 'object') {
    return {
      overallRisk: Number(result.deterministicRisk.overallRisk) || 0,
      riskLabel: result.deterministicRisk.riskLabel || getRiskLabel(Number(result.deterministicRisk.overallRisk) || 0),
      categories: result.deterministicRisk.categories || {
        visualRisk: 0, textRisk: 0, layoutRisk: 0, financialDataRisk: 0, editingRisk: 0,
      },
    };
  }

const checks = result?.checks || {};


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

// Kategori skorları 0-100, kategori ağırlıkları toplam 100'dür.
// Ağırlıklı ortalama için her kategori katkısı /100 ile normalize edilir.
// Örn. layoutRisk=4 ve ağırlık=15 => toplam skora yalnızca 0.6 puan katkı yapar;
// 4*15=60 şeklinde doğrudan çarpılması hatalıdır.
let score = (
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
RISK_CATEGORY_WEIGHTS.editingRisk
) / 100;

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
amountAnalysis.totalAmount !== null &&
amountAnalysis.calculatedTotal !== null
) {
const totalAmount = Number(
amountAnalysis.totalAmount
);
const calculatedTotal = Number(
amountAnalysis.calculatedTotal
);
if (
Number.isFinite(totalAmount) &&
Number.isFinite(calculatedTotal)
) {
const difference = Math.abs(
totalAmount - calculatedTotal
);
console.log("===== TUTAR DEBUG =====");
console.log("totalAmount:", totalAmount);
console.log("calculatedTotal:", calculatedTotal);
console.log("difference:", difference);
console.log("=======================");

if (difference > 0.01) {
// AmountAnalysis is advisory; do not inject a hidden +10 risk bonus.
// Financial inconsistency must be represented by an explicit check.
console.log("TUTAR FARKI GÖZLENDİ; GİZLİ RİSK BONUSU UYGULANMADI:", difference);
}
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

recipientIban: {
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
"recipientIban",
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
"fps=1,scale=1280:-2",

"-frames:v",
"4",
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
framePath,
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

// =====================================================
// VIDEO FRAME PADDLEOCR
// =====================================================

const videoOCRResults = await Promise.all(
frames.map(async (frame, index) => {

console.log(
`VIDEO FRAME ${index + 1}/${frames.length} PADDLEOCR`
);

try {

const ocrResult =
await runPaddleOCR(frame.framePath);

return {
frame: index + 1,
file: frame.file,
text: ocrResult?.text || "",
confidence:
Number(ocrResult?.confidence) || 0,
success:
Boolean(ocrResult?.success),
};

} catch (error) {

console.error(
`FRAME ${index + 1} PADDLEOCR HATASI:`,
error
);

return {
frame: index + 1,
file: frame.file,
text: "",
confidence: 0,
success: false,
error:
error?.message ||
"PaddleOCR başarısız.",
};

}

})
);

console.log(
"VIDEO PADDLEOCR TAMAMLANDI"
);


console.log(
"VIDEO PADDLEOCR TAMAMLANDI"
);

const videoOCRText =
videoOCRResults
.map((item) => {

return `
KARE ${item.frame}
DOSYA: ${item.file}
OCR BAŞARILI: ${item.success}
OCR CONFIDENCE: ${item.confidence}/100

OCR METNİ:
${item.text || "Metin okunamadı."}
`;

})
.join("\n");
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

Sen VerifyDoc video analiz sistemisin.

TÜM ANALİZ TÜRKÇE OLMALIDIR.

Bu belge bir video içerisinden çıkarılmış
${frames.length} ayrı kare üzerinden analiz edilmektedir.

Tüm kareleri birlikte değerlendir.

Bu analiz yalnızca otomatik ön incelemedir.
Belgenin kesin olarak gerçek veya sahte olduğunu söyleme.

=====================================================
ANA AMAÇ
=====================================================

Videodaki belgeyi genel olarak analiz et.

Kareler arasındaki tutarlılığı kontrol et.

Özellikle:

- gönderen
- alıcı
- IBAN
- işlem tutarı
- para birimi
- tarih
- saat
- işlem numarası
- açıklama
- banka
- logo
- QR
- barkod
- belge üzerindeki metin ve rakamlar

üzerinde değişiklik olup olmadığını incele.

=====================================================
VİDEO HAREKETLERİ
=====================================================

Kamera hareketi, zoom, odak değişimi, perspektif,
ışık değişimi, titreme, JPEG/video sıkıştırması veya
hafif bulanıklığı tek başına manipülasyon olarak
değerlendirme.

=====================================================
MANİPÜLASYON
=====================================================

Aşağıdakileri yalnızca gerçekten görünüyorsa değerlendir:

- sonradan ekleme
- sonradan silme
- kesme
- kırpma
- yapıştırma
- dijital montaj
- farklı font
- farklı karakter yapısı
- farklı görüntü kalitesi
- kareler arasında değişen belge alanı

Somut kanıt yoksa şüpheli sonuç üretme.

=====================================================
TUTAR
=====================================================

Videoda görünen ana işlem tutarını belirle.

Farklı karelerde tutarın değişip değişmediğini kontrol et.

IBAN, hesap numarası, işlem numarası, tarih veya saat
gibi rakamları işlem tutarıyla karıştırma.

Yeterli veri yoksa tahmin etme.

=====================================================
ALICI VE IBAN
=====================================================

Alıcı adı ve IBAN'ı kareler arasında karşılaştır.

Değişiklik varsa açıkça belirt.

Okunamıyorsa tahmin etme.

=====================================================
TARİH / SAAT
=====================================================

Görünen tarih ve saat bilgilerini kareler arasında
karşılaştır.

Gerçek bir değişiklik görülmüyorsa değişiklik varmış
gibi yorumlama.

=====================================================
GENEL SUMMARY
=====================================================

summary alanı kullanıcıya gösterilecek ana sonuçtur.

summary:

- TEK BİR PARAGRAF olmalıdır.
- Türkçe olmalıdır.
- Doğal bir analiz dili kullanılmalıdır.
- Kare kare anlatım yapılmamalıdır.
- "Tutar:", "Alıcı:", "IBAN:", "Oynama:" gibi ayrı
başlıklar kullanılmamalıdır.
- Önemli bulgular tek bir genel analiz içerisinde
birleştirilmelidir.

Örneğin belge tutarlıysa:

"Belge, video içerisinden alınan farklı kareler üzerinden
incelenmiştir. Kareler arasında işlem tutarı, alıcı bilgileri,
IBAN ve tarih/saat açısından belirgin bir tutarsızlık
görülmemiştir. Görüntü hareketleri doğal video koşullarıyla
uyumlu değerlendirilmiş ve belirgin bir sonradan ekleme,
silme veya montaj belirtisi tespit edilmemiştir."

Bu yalnızca örnektir.

Gerçek summary yalnızca videoda görülen kanıtlara göre
oluşturulmalıdır.

Eğer önemli bir tutarsızlık varsa bunu aynı paragraf
içerisinde açıkça anlat.

=====================================================
DİĞER ALANLAR
=====================================================

documentData alanlarını yalnızca videoda gerçekten
okunabilen bilgilerle doldur.

Okunamayan değerleri null yap.

amountAnalysis alanında yeterli veri yoksa null kullan.

limitations alanında video nedeniyle gerçekten
oluşan sınırlamaları belirt.

checks alanındaki 25 kontrolü:

pass = sorun görülmedi
fail = somut sorun/tutarsızlık görüldü
unknown = güvenilir şekilde değerlendirilemedi

olarak doldur.

Risk skorunu kendin hesaplama.

overallRisk, riskLabel ve categories değerleri
backend tarafından deterministik risk motoruyla
hesaplanacaktır.

SONUCU SADECE JSON OLARAK DÖNDÜR.

=====================================================
PADDLEOCR VİDEO KARE SONUÇLARI
=====================================================

Aşağıdaki OCR sonuçları videodan çıkarılan JPG
karelerinin her biri üzerinde ayrı ayrı çalıştırılmıştır.

ÇOK ÖNEMLİ:

OCR yalnızca yardımcı veridir.

ASIL KAYNAK:
video karelerinin gerçek görüntüsüdür.

OCR sonucu görüntüyle çelişirse görüntüyü esas al.

OCR tarafından tahmin edilmiş veya yanlış okunmuş
değerleri gerçek belge bilgisi olarak kabul etme.

KARELER ARASI OCR KARŞILAŞTIRMASI YAP.

Özellikle:

- alıcı adı
- IBAN
- tutar
- tarih
- saat
- işlem numarası
- açıklama

alanlarının kareler arasında değişip değişmediğini kontrol et.

${videoOCRText}

=====================================================
`;

console.log(
"OPENAI VIDEO REQUEST START"
);

const response =
await openai.responses.create({
model:
"gpt-5.6-terra",

reasoning: {
effort: "medium",
},

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

console.log("KULLANILAN OPENAI MODEL:", response.model);

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
// BANKA ŞABLONU — TUTAR ALANI KALİBRASYONU
// Referans PDF, yalnızca OpenAI bağlamı olarak değil, bankaya özgü tutar
// konumunu belirlemek için de kullanılır. Sabit piksel yerine normalize konum kullanılır.
async function getReferenceAmountAnchor(bank) {
  const normalizedBank = normalizeBank(bank);
  if (!normalizedBank) return null;
  const cacheKey = `amount-anchor:${normalizedBank}`;
  if (referenceAmountAnchorCache.has(cacheKey)) return referenceAmountAnchorCache.get(cacheKey);

  try {
    const profile = await buildReferenceTemplateProfile(normalizedBank);
    const amountField = profile?.fields?.amount;
    if (!amountField) {
      referenceAmountAnchorCache.set(cacheKey, null);
      return null;
    }

    const anchor = {
      bank: normalizedBank,
      pageNumber: Number(amountField.pageNumber) || 1,
      xNorm: Number(amountField.xNorm) || null,
      yNorm: Number(amountField.yNorm) || null,
      widthNorm: Number(amountField.widthNorm) || null,
      heightNorm: Number(amountField.heightNorm) || null,
      // SECURITY: Referansın gerçek metni/tutarı kesinlikle taşınmaz.
      // Yalnızca şablon koordinatı kullanılır.
      referenceCount: Number(amountField.referenceCount) || 1,
      spread: amountField.spread || null,
      source: 'trusted-reference-ensemble',
    };
    referenceAmountAnchorCache.set(cacheKey, anchor);
    console.log('REFERENCE AMOUNT ANCHOR ENSEMBLE (SAFE):', JSON.stringify({
      bank: anchor.bank, pageNumber: anchor.pageNumber,
      xNorm: anchor.xNorm, yNorm: anchor.yNorm,
      widthNorm: anchor.widthNorm, heightNorm: anchor.heightNorm,
      referenceCount: anchor.referenceCount, source: anchor.source
    }));
    return anchor;
  } catch (error) {
    console.warn('REFERENCE AMOUNT ANCHOR ENSEMBLE HATASI:', normalizedBank, error?.message || error);
    referenceAmountAnchorCache.set(cacheKey, null);
    return null;
  }
}

// =====================================================
// REFERANS ŞABLON PROFİLİ V2
// =====================================================
// Referans PDF'ler artık yalnızca OpenAI'ye gösterilen görseller değildir.
// Banka bazında alan konumları + alan geometrisi + render yoğunluğu kalibre edilir.
// Referanstaki gerçek işlem değerleri hiçbir zaman gerçek dekont verisi olarak kullanılmaz.
const referenceTemplateProfileCache = new Map();
const referenceRasterOcrCache = new Map();

const REFERENCE_FIELD_RULES = [
  { key: "senderName", patterns: [/gönderen\s*(?:adı|adi|ad[ıi]\s*soyad[ıi]?)/i, /gönderici\s*(?:adı|adi|ad[ıi]\s*soyad[ıi]?)/i, /gonderen\s*(?:adi|ad[ıi]\s*soyad[ıi]?)/i] },
  { key: "recipientName", patterns: [/alıcı\s*(?:adı|adi|ad[ıi]\s*soyad[ıi]?)/i, /alici\s*(?:adi|ad[ıi]\s*soyadi)/i, /alacaklı\s*(?:adı|adi|ad[ıi]\s*soyad[ıi]?)/i] },
  { key: "senderAddress", patterns: [/gönderen\s*adres/i, /gönderici\s*adres/i, /gonderen\s*adres/i, /gonderici\s*adres/i] },
  { key: "recipientAddress", patterns: [/alıcı\s*adres/i, /alici\s*adres/i, /alacaklı\s*adres/i, /alacakli\s*adres/i] },
  { key: "address", patterns: [/\badres\b/i] },
  { key: "iban", patterns: [/\biban\b/i] },
  { key: "amount", patterns: [/giden\s*fast\s*tutar/i, /gönderilen\s*(?:fast\s*)?tutar/i, /transfer\s*tutar/i, /işlem\s*tutar/i, /ana\s*tutar/i, /\btutar\b/i, /\bamount\b/i] },
  { key: "date", patterns: [/işlem\s*tarihi/i, /islem\s*tarihi/i, /tarih/i, /date/i] },
  { key: "time", patterns: [/saat/i, /time/i] },
  { key: "transactionNo", patterns: [/işlem\s*(?:no|numarası|numarasi)/i, /islem\s*(?:no|numarasi)/i, /fiş\s*no/i, /fis\s*no/i, /referans\s*(?:no|numarası|numarasi)/i, /sorgu\s*no/i] },
  { key: "accountNo", patterns: [/hesap\s*no/i, /hesap\s*numarası/i, /hesap\s*numarasi/i, /müşteri\s*no/i, /musteri\s*no/i] },
  { key: "branch", patterns: [/şube/i, /sube/i] },
  { key: "taxNo", patterns: [/vergi\s*no/i, /vergi\s*numarası/i, /vergi\s*numarasi/i, /tckn/i] },
  { key: "description", patterns: [/açıklama/i, /aciklama/i, /description/i] },
];

function classifyReferenceTemplateRole(field, text) {
  const t = String(text || "").toLocaleLowerCase("tr-TR");
  if (field === "amount") {
    if (/giden\s*fast\s*tutar[ıi]?/.test(t) || /gönderilen\s*(?:fast\s*)?tutar/.test(t) || /transfer\s*tutar/.test(t) || /işlem\s*tutar/.test(t) || /ana\s*tutar/.test(t) || /giden\s*tutar/.test(t)) return "primaryAmount";
    if (/vergi|komisyon|ücret|masraf|toplam\s*(?:işlem|tahsilat)|tahsilat\s*tutar/.test(t)) return "secondaryAmount";
    return "amountOther";
  }
  return "fieldValue";
}

function referenceFieldRuleForText(text) {
  const value = String(text || "").toLocaleLowerCase("tr-TR");
  for (const rule of REFERENCE_FIELD_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(value))) return rule;
  }
  return null;
}

function groupPdfTextLines(items, viewport) {
  const rows = [];
  const sorted = [...items].sort((a, b) => {
    const ay = viewport.height - a.y - a.height;
    const by = viewport.height - b.y - b.height;
    if (Math.abs(ay - by) > 4) return ay - by;
    return a.x - b.x;
  });
  for (const item of sorted) {
    const top = viewport.height - item.y - item.height;
    let row = rows.find((r) => Math.abs(r.top - top) <= Math.max(3, item.height * 0.35));
    if (!row) {
      row = { top, items: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    row.text = row.items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim();
    row.x1 = Math.min(...row.items.map((x) => x.x));
    row.x2 = Math.max(...row.items.map((x) => x.x + x.width));
    row.y1 = Math.min(...row.items.map((x) => viewport.height - x.y - x.height));
    row.y2 = Math.max(...row.items.map((x) => viewport.height - x.y));
  }
  return rows.sort((a, b) => a.top - b.top);
}

async function renderPdfPagePng(pdf, pageNumber, scale = 1) {
  if (typeof createCanvas !== "function") {
    console.warn("REFERENCE PDF RENDER: createCanvas kullanılamıyor; referans metin/konum/font metadata profiliyle devam ediliyor.");
    return null;
  }
  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;
    return { buffer: canvas.toBuffer("image/png"), width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) };
  } catch (error) {
    console.warn("REFERENCE PDF RENDER HATASI:", error?.message || error);
    return null;
  }
}

async function calculateReferenceStyleMetrics(buffer, box, width, height) {
  if (!buffer || !box || !width || !height) return null;
  const left = Math.max(0, Math.floor(box.xNorm * width));
  const top = Math.max(0, Math.floor(box.yNorm * height));
  const cropWidth = Math.min(width - left, Math.max(1, Math.ceil(box.widthNorm * width)));
  const cropHeight = Math.min(height - top, Math.max(1, Math.ceil(box.heightNorm * height)));
  if (cropWidth < 3 || cropHeight < 3) return null;
  try {
    const raw = await sharp(buffer).grayscale().extract({ left, top, width: cropWidth, height: cropHeight }).raw().toBuffer({ resolveWithObject: true });
    let ink = 0;
    let dark = 0;
    let edges = 0;
    let pixels = 0;
    for (let y = 0; y < raw.info.height; y++) {
      for (let x = 0; x < raw.info.width; x++) {
        const value = raw.data[y * raw.info.width + x];
        pixels++;
        if (value < 220) ink++;
        if (value < 185) dark += 255 - value;
        if (y > 0) edges += Math.abs(value - raw.data[(y - 1) * raw.info.width + x]);
      }
    }
    return {
      inkRatio: pixels ? ink / pixels : 0,
      darkness: pixels ? dark / pixels : 0,
      edgeDensity: pixels ? edges / pixels : 0,
    };
  } catch {
    return null;
  }
}


// =====================================================
// REFERANS / HEDEF YAPISAL GEOMETRİ FORENSICS
// =====================================================
// Referansın gerçek değerleri kullanılmaz. Sadece PDF'nin çizgisel/layout
// fingerprint'i ile hedef görüntünün fiziksel yerleşimi karşılaştırılır.
const referenceLayoutForensicsCache = new Map();

async function extractLongLineFingerprint(buffer) {
  if (!buffer) return null;
  try {
    const raw = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = raw.info;
    const threshold = 180;
    const rowCounts = new Array(height).fill(0);
    const colCounts = new Array(width).fill(0);

    for (let y = 0; y < height; y++) {
      let rc = 0;
      const off = y * width;
      for (let x = 0; x < width; x++) {
        if (raw.data[off + x] < threshold) {
          rc++;
          colCounts[x]++;
        }
      }
      rowCounts[y] = rc;
    }

    function clusterIndices(indices) {
      const out = [];
      let start = null;
      let prev = null;
      for (const idx of indices) {
        if (start === null) start = idx;
        if (prev !== null && idx > prev + 1) {
          out.push([start, prev]);
          start = idx;
        }
        prev = idx;
      }
      if (start !== null) out.push([start, prev]);
      return out;
    }

    const horizontalRuns = clusterIndices(
      rowCounts.map((v, i) => v >= width * 0.65 ? i : -1).filter(i => i >= 0)
    );
    const verticalRuns = clusterIndices(
      colCounts.map((v, i) => v >= height * 0.50 ? i : -1).filter(i => i >= 0)
    );

    const horizontal = horizontalRuns.map(([a,b]) => {
      const y = Math.round((a+b)/2);
      const darkXs = [];
      for (let x=0;x<width;x++) {
        if (raw.data[y*width+x] < threshold) darkXs.push(x);
      }
      if (!darkXs.length) return null;
      return {
        yNorm: y/height,
        x1Norm: darkXs[0]/width,
        x2Norm: darkXs[darkXs.length-1]/width,
        lengthNorm: (darkXs[darkXs.length-1]-darkXs[0]+1)/width,
      };
    }).filter(Boolean);

    const vertical = verticalRuns.map(([a,b]) => ({
      xNorm: ((a+b)/2)/width,
      lengthNorm: Math.max(...colCounts.slice(a,b+1))/height,
    }));

    return { width, height, horizontal, vertical };
  } catch (error) {
    return null;
  }
}

async function runReferenceLayoutForensics(targetPath, bank) {
  const normalizedBank = normalizeBank(bank);
  if (!normalizedBank || !targetPath) return null;
  const cacheKey = `layout:${normalizedBank}`;

  try {
    const targetBuffer = await fs.readFile(targetPath);
    const targetFingerprint = await extractLongLineFingerprint(targetBuffer);
    if (!targetFingerprint) return null;

    let ensemble = referenceLayoutForensicsCache.get(cacheKey);
    if (!ensemble) {
      const referencePaths = await getReferenceFiles(normalizedBank);
      if (!referencePaths.length) return null;

      const fingerprints = [];
      for (const referencePath of referencePaths) {
        try {
          const ext = path.extname(referencePath).toLowerCase();
          let refBuffer = await fs.readFile(referencePath);
          if (ext === '.pdf') {
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(refBuffer) }).promise;
            const rendered = await renderPdfPagePng(pdf, 1, 1.6);
            if (!rendered?.buffer) continue;
            refBuffer = rendered.buffer;
          }
          const fp = await extractLongLineFingerprint(refBuffer);
          if (fp) fingerprints.push({ file: path.basename(referencePath), fingerprint: fp });
        } catch (error) {
          console.warn('REFERENCE LAYOUT TEK DOSYA ATLANDI:', path.basename(referencePath), error?.message || error);
        }
      }
      if (!fingerprints.length) return null;
      ensemble = { fingerprints, referenceFiles: referencePaths.map(x => path.basename(x)) };
      referenceLayoutForensicsCache.set(cacheKey, ensemble);
    }

    function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
    function median(values) {
      const a = values.filter(Number.isFinite).sort((x,y)=>x-y);
      if (!a.length) return null;
      const m = Math.floor(a.length/2);
      return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
    }
    function lineSimilarity(a,b) {
      if (!a || !b) return 0;
      const dy = Math.abs(a.yNorm-b.yNorm);
      const dl = Math.abs(a.lengthNorm-b.lengthNorm);
      return Math.max(0, 1 - (dy/0.035)*0.65 - (dl/0.10)*0.35);
    }
    function bestReferenceFingerprint() {
      const targetLines = targetFingerprint.horizontal.filter(x => x.lengthNorm >= 0.65);
      let best = null;
      for (const entry of ensemble.fingerprints) {
        const refLines = entry.fingerprint.horizontal.filter(x => x.lengthNorm >= 0.65);
        if (!refLines.length) continue;
        let score = 0;
        for (const r of refLines) {
          const nearest = targetLines.reduce((p,t) => !p || lineSimilarity(r,t) > lineSimilarity(r,p) ? t : p, null);
          score += nearest ? lineSimilarity(r,nearest) : 0;
        }
        score /= Math.max(refLines.length, 1);
        if (!best || score > best.score) best = { ...entry, score };
      }
      return best;
    }

    const best = bestReferenceFingerprint();
    if (!best) return null;
    const ref = best.fingerprint;
    const refH = ref.horizontal.filter(x => x.lengthNorm >= 0.65);
    const tarH = targetFingerprint.horizontal.filter(x => x.lengthNorm >= 0.65);

    // Sayısal çizgi adedi artık ana risk kriteri değildir. Önce tüm çizgiler
    // y-konumu ve uzunluk açısından en yakın eşleşmelerle hizalanır.
    const matched = [];
    const used = new Set();
    for (const r of refH) {
      let bestIdx = -1, bestCost = Infinity;
      for (let i=0;i<tarH.length;i++) {
        if (used.has(i)) continue;
        const t=tarH[i];
        const cost = Math.abs(r.yNorm-t.yNorm)/0.045 + Math.abs(r.lengthNorm-t.lengthNorm)/0.14;
        if (cost < bestCost) { bestCost=cost; bestIdx=i; }
      }
      if (bestIdx >= 0 && bestCost <= 2.0) {
        used.add(bestIdx);
        matched.push({reference:r,target:tarH[bestIdx],cost:bestCost});
      }
    }

    const yDeltas = matched.map(x => x.target.yNorm-x.reference.yNorm);
    const globalOffset = median(yDeltas) || 0;
    const adjusted = matched.map(x => ({
      ...x,
      adjustedDy: Math.abs((x.target.yNorm-globalOffset)-x.reference.yNorm),
      lengthDelta: Math.abs(x.target.lengthNorm-x.reference.lengthNorm),
    }));

    const strongY = adjusted.filter(x => x.adjustedDy > 0.045).length;
    const mediumY = adjusted.filter(x => x.adjustedDy > 0.025).length;
    const strongLength = adjusted.filter(x => x.lengthDelta > 0.10).length;
    const unmatchedRef = Math.max(0, refH.length-matched.length);
    const unmatchedTarget = Math.max(0, tarH.length-matched.length);

    // Ana kutu sınırlarını, çizgi sırasına körü körüne bağlamak yerine
    // üst yarıdaki en güçlü eşleşmelerden çıkar.
    const refMain = refH.slice(0, Math.min(6, refH.length));
    const tarMain = tarH.slice(0, Math.min(6, tarH.length));
    function boxMetrics(lines) {
      if (lines.length < 2) return [];
      const boxes=[];
      for(let i=0;i+1<lines.length;i+=2){
        const a=lines[i], b=lines[i+1];
        if (b.yNorm <= a.yNorm) continue;
        boxes.push({top:a.yNorm,bottom:b.yNorm,height:b.yNorm-a.yNorm,widthA:a.lengthNorm,widthB:b.lengthNorm,width:(a.lengthNorm+b.lengthNorm)/2});
      }
      return boxes;
    }
    const rb=boxMetrics(refMain), tb=boxMetrics(tarMain);
    const boxPairs=[];
    for(let i=0;i<Math.min(rb.length,tb.length);i++){
      boxPairs.push({
        reference:rb[i], target:tb[i],
        heightRatio:tb[i].height/Math.max(.001,rb[i].height),
        widthRatio:tb[i].width/Math.max(.001,rb[i].width),
      });
    }
    const boxHeightOutliers = boxPairs.filter(x => Math.abs(x.heightRatio-1)>0.16).length;
    const boxWidthOutliers = boxPairs.filter(x => Math.abs(x.widthRatio-1)>0.10).length;

    // Referans kümesi içinde ortak şablon yoksa bile tek referansın çizgi sayısı
    // yüzünden fail üretme; yalnızca bağımsız geometrik sinyaller birleşirse güçlü say.
    const independentSignals = [
      strongY >= 2,
      strongLength >= 2,
      boxHeightOutliers >= 1,
      boxWidthOutliers >= 1,
      unmatchedRef >= 3 || unmatchedTarget >= 3,
    ].filter(Boolean).length;

    let score = 0;
    score += Math.min(28, strongY*9 + mediumY*3);
    score += Math.min(24, strongLength*8);
    score += Math.min(24, boxHeightOutliers*12 + boxWidthOutliers*10);
    score += Math.min(14, Math.max(unmatchedRef,unmatchedTarget)*4);
    score += Math.min(10, Math.abs(tarH.length-refH.length)*2);
    score = Math.round(Math.max(0, Math.min(100, score)));

    // Küçük fotoğraf/perspektif/render farklarını tolere et.
    const strong = independentSignals >= 2 && score >= 55;
    const medium = !strong && score >= 25;

    return {
      available:true,
      bank:normalizedBank,
      referenceFiles:ensemble.referenceFiles,
      referenceCount:ensemble.fingerprints.length,
      selectedReference:best.file,
      referenceLineCount:refH.length,
      targetLineCount:tarH.length,
      lineCountDelta:Math.abs(refH.length-tarH.length),
      globalYOffset:globalOffset,
      matchedLineCount:matched.length,
      unmatchedReferenceLines:unmatchedRef,
      unmatchedTargetLines:unmatchedTarget,
      strongYDiscrepancies:strongY,
      strongLengthDiscrepancies:strongLength,
      boxHeightOutliers,
      boxWidthOutliers,
      independentSignals,
      boxPairs,
      score,
      severity: strong ? 'strong' : medium ? 'medium' : 'low',
      check: {
        status: strong ? 'fail' : medium ? 'unknown' : 'pass',
        score,
        evidence: strong
          ? `Referans kümesindeki ${ensemble.fingerprints.length} şablona göre bağımsız kutu/çizgi geometrisi sinyalleri birlikte sapma gösteriyor.`
          : medium
            ? `Referans kümesiyle karşılaştırmada bazı küçük/orta düzey geometrik farklar bulundu; tek başına manipülasyon kanıtı sayılmadı.`
            : `Referans kümesindeki şablonlarla ana kutu geometrisi uyumlu; küçük çizgi/render farkları tolere edildi.`
      },
      evidence: strong
        ? `Yapısal geometri, ${ensemble.fingerprints.length} referansın en uyumlu şablonuyla ve hizalama sonrası karşılaştırıldı; ${independentSignals} bağımsız sapma sinyali bulundu.`
        : medium
          ? `Yapısal geometri referans kümesiyle karşılaştırıldı; küçük/orta farklar perspektif ve render toleransı içinde değerlendirildi.`
          : `Yapısal geometri referans kümesiyle karşılaştırıldı; belirgin bağımsız sapma bulunmadı.`,
    };
  } catch (error) {
    console.warn('REFERENCE LAYOUT FORENSICS HATASI:', error?.message || error);
    return null;
  }
}

async function getReferenceFiles(bank) {
  const normalizedBank = normalizeBank(bank);
  if (!normalizedBank) return [];

  const files = [];
  try {
    const entries = await fs.readdir(REFERENCE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      const normalizedName = normalizeTurkishText(path.basename(entry.name, ext)).replace(/[^a-z0-9]/g, '');
      if (normalizedName.includes(normalizedBank)) {
        files.push(path.join(REFERENCE_DIR, entry.name));
      }
    }
  } catch (error) {
    console.warn('REFERENCE KLASORU OKUNAMADI:', error?.message || error);
  }

  // Önerilen yapı: references/yapikredi/*
  const bankDir = path.join(REFERENCE_DIR, normalizedBank);
  try {
    const entries = await fs.readdir(bankDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.pdf', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;
      files.push(path.join(bankDir, entry.name));
    }
  } catch {}

  // Eski tek-referans yapısı bozulmasın.
  const canonical = getReferenceFile(bank);
  if (canonical) files.push(canonical);

  return [...new Set(files)];
}

function aggregateReferenceField(entries) {
  if (!entries.length) return null;
  const median = (values) => {
    const v = values.filter(Number.isFinite).sort((a,b)=>a-b);
    if (!v.length) return 0;
    const m = Math.floor(v.length/2);
    return v.length % 2 ? v[m] : (v[m-1] + v[m]) / 2;
  };
  const representative = [...entries].sort((a,b) => {
    const da = Math.abs(a.xNorm - median(entries.map(x=>x.xNorm))) + Math.abs(a.yNorm - median(entries.map(x=>x.yNorm)));
    const db = Math.abs(b.xNorm - median(entries.map(x=>x.xNorm))) + Math.abs(b.yNorm - median(entries.map(x=>x.yNorm)));
    return da-db;
  })[0];
  return {
    ...representative,
    xNorm: median(entries.map(x=>x.xNorm)),
    yNorm: median(entries.map(x=>x.yNorm)),
    widthNorm: median(entries.map(x=>x.widthNorm)),
    heightNorm: median(entries.map(x=>x.heightNorm)),
    referenceCount: entries.length,
    variants: entries.map(x => ({...x})),
    spread: {
      x: Math.max(...entries.map(x=>x.xNorm)) - Math.min(...entries.map(x=>x.xNorm)),
      y: Math.max(...entries.map(x=>x.yNorm)) - Math.min(...entries.map(x=>x.yNorm)),
      width: Math.max(...entries.map(x=>x.widthNorm)) - Math.min(...entries.map(x=>x.widthNorm)),
      height: Math.max(...entries.map(x=>x.heightNorm)) - Math.min(...entries.map(x=>x.heightNorm)),
    },
  };
}

async function extractReferenceTemplateProfile(referencePath, normalizedBank) {
  const ext = path.extname(referencePath).toLowerCase();
  const fields = {};

  if (ext !== '.pdf') {
    // Görsel referanslar OCR olmadan alan koordinatı üretemez; dosyayı yine de
    // trusted reference setinde tutuyoruz. PDF'ler alan kalibrasyonunun ana kaynağıdır.
    return { bank: normalizedBank, referenceFile: path.basename(referencePath), fields, fieldCount: 0, referenceType: 'image' };
  }

  const buffer = await fs.readFile(referencePath);
  if (!buffer?.length) return null;
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 5); pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const items = textContent.items.map((item) => {
      const tr = Array.isArray(item?.transform) ? item.transform : [];
      const x = Number(tr[4]);
      const y = Number(tr[5]);
      const height = Math.abs(Number(tr[3])) || Number(item?.height) || 0;
      return {
        str: String(item?.str || '').trim(), x, y,
        width: Number(item?.width) || 0, height,
        fontName: item?.fontName || null, hasEOL: Boolean(item?.hasEOL),
      };
    }).filter((x) => x.str && Number.isFinite(x.x) && Number.isFinite(x.y));

    const rows = groupPdfTextLines(items, viewport);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rule = referenceFieldRuleForText(row.text);
      if (!rule) continue;

      const labelItemIndex = row.items.findIndex((item) => referenceFieldRuleForText(item.str)?.key === rule.key);
      const labelItem = labelItemIndex >= 0 ? row.items[labelItemIndex] : row.items[0];
      let valueItems = row.items.slice(Math.max(0, labelItemIndex + 1));
      if (!valueItems.length) {
        const next = rows[rowIndex + 1];
        if (next && next.top - row.top <= Math.max(55, row.y2 - row.y1 + 30)) valueItems = next.items.slice(0, 20);
      }
      valueItems = valueItems.filter((item) => !referenceFieldRuleForText(item.str));
      if (!valueItems.length) continue;

      const x1 = Math.min(...valueItems.map((x) => x.x));
      const x2 = Math.max(...valueItems.map((x) => x.x + x.width));
      const y1 = Math.min(...valueItems.map((x) => viewport.height - x.y - x.height));
      const y2 = Math.max(...valueItems.map((x) => viewport.height - x.y));
      const chars = valueItems.reduce((sum, x) => sum + Math.max(1, String(x.str || '').length), 0);
      const avgFontHeight = valueItems.length ? valueItems.reduce((sum,x)=>sum+(Number(x.height)||0),0)/valueItems.length : 0;
      const avgCharWidth = chars ? valueItems.reduce((sum,x)=>sum+(Number(x.width)||0),0)/chars : 0;
      const fontNames = [...new Set(valueItems.map(x=>x.fontName).filter(Boolean))];

      const box = {
        xNorm: x1 / viewport.width,
        yNorm: y1 / viewport.height,
        widthNorm: Math.max(0.001, (x2-x1)/viewport.width),
        heightNorm: Math.max(0.001, (y2-y1)/viewport.height),
        pageNumber,
        labelKey: rule.key,
        label: String(row.text || ''),
        labelPresent: Boolean(labelItem),
        valueTextLength: chars,
        templateRole: classifyReferenceTemplateRole(rule.key, row.text),
        style: { source:'pdf-text-metadata', fontNames, avgFontHeight, avgCharWidth, itemCount:valueItems.length },
        referenceFile: path.basename(referencePath),
      };
      (fields[rule.key] ||= []).push(box);
    }
  }

  // Image-only/scanned reference PDFs (for example Enpara/Akbank) often have
  // no PDF text layer. In that case, rasterize the reference once and run the
  // same OCR engine used for targets. The result is cached per reference file
  // and is used only for geometry/style calibration, never as document data.
  if (Object.keys(fields).length === 0) {
    try {
      const stat = await fs.stat(referencePath);
      const cacheKey = `ref-ocr:${referencePath}:${stat.size}:${stat.mtimeMs}`;
      let ocr = referenceRasterOcrCache.get(cacheKey);
      let rendered = null;
      if (!ocr) {
        rendered = await renderPdfPagePng(pdf, 1, 1.6);
        if (rendered?.buffer) {
          const tempPath = path.join('/tmp', `verifydoc-ref-${normalizedBank}-${Math.random().toString(36).slice(2)}.png`);
          await fs.writeFile(tempPath, rendered.buffer);
          ocr = await runPaddleOCR(tempPath);
          try { await fs.unlink(tempPath); } catch {}
          referenceRasterOcrCache.set(cacheKey, ocr || null);
        }
      }

      if (!rendered) rendered = await renderPdfPagePng(pdf, 1, 1.6);
      if (ocr?.success && Array.isArray(ocr.regions)) {
        const regions = ocr.regions
          .filter(x => x?.region && String(x.text || '').trim())
          .map(x => ({
            ...x,
            text: String(x.text || '').trim(),
            region: {
              x1: Number(x.region.x1) || 0,
              y1: Number(x.region.y1) || 0,
              x2: Number(x.region.x2) || 0,
              y2: Number(x.region.y2) || 0,
            },
          }));
        const width = Number(rendered?.width) || 0;
        const height = Number(rendered?.height) || 0;

        function addRasterField(key, labelRegion, valueRegion, labelText) {
          if (!width || !height || !valueRegion) return;
          const r = valueRegion;
          const box = {
            xNorm: r.x1 / width,
            yNorm: r.y1 / height,
            widthNorm: Math.max(0.001, (r.x2-r.x1)/width),
            heightNorm: Math.max(0.001, (r.y2-r.y1)/height),
            pageNumber: 1,
            labelKey: key,
            labelPresent: true,
            templateRole: classifyReferenceTemplateRole(key, labelText),
            style: { source:'reference-raster-ocr', fontNames:[], avgFontHeight:Math.max(1,r.y2-r.y1), avgCharWidth:0, itemCount:1 },
            referenceFile: path.basename(referencePath),
          };
          (fields[key] ||= []).push(box);
        }

        for (const label of regions) {
          const rule = referenceFieldRuleForText(label.text);
          if (!rule) continue;
          const lr = label.region;
          const lh = Math.max(8, lr.y2-lr.y1);
          const candidates = regions.filter(v => v !== label).map(v => {
            const vr=v.region;
            const vh=Math.max(8,vr.y2-vr.y1);
            const verticalOverlap=Math.min(lr.y2,vr.y2)-Math.max(lr.y1,vr.y1);
            const rightGap=vr.x1-lr.x2;
            const belowGap=vr.y1-lr.y2;
            let cost=Infinity;
            if (rightGap >= -lh*0.25 && rightGap <= Math.max(180,lh*8) && verticalOverlap >= -lh*0.55) {
              cost = Math.abs(rightGap)/Math.max(1,lh) + Math.abs(((vr.y1+vr.y2)/2)-((lr.y1+lr.y2)/2))/Math.max(1,lh)*0.5;
            } else if (belowGap >= -lh*0.25 && belowGap <= Math.max(120,lh*6) && Math.abs(((vr.x1+vr.x2)/2)-((lr.x1+lr.x2)/2)) <= Math.max(260,lh*10)) {
              cost = 3 + Math.abs(belowGap)/Math.max(1,lh);
            }
            return { v, cost };
          }).filter(x => Number.isFinite(x.cost));

          candidates.sort((a,b)=>a.cost-b.cost);
          const value = candidates[0]?.v;
          if (!value) continue;

          // Primary amount fields must contain a numeric/currency value. For
          // other fields any nearby value is acceptable as a geometry anchor.
          if (rule.key === 'amount' && !/(?:\d|TL|TRY|₺|EUR|USD|GBP)/i.test(String(value.text || ''))) continue;
          addRasterField(rule.key, lr, value.region, label.text);
        }
      }
    } catch (error) {
      console.warn('REFERENCE RASTER OCR FALLBACK HATASI:', path.basename(referencePath), error?.message || error);
    }
  }

  return {
    bank: normalizedBank,
    referenceFile: path.basename(referencePath),
    fields,
    fieldCount: Object.keys(fields).length,
    referenceType: 'pdf',
  };
}

async function buildReferenceTemplateProfile(bank) {
  const normalizedBank = normalizeBank(bank);
  if (!normalizedBank) return null;
  const referencePaths = await getReferenceFiles(normalizedBank);
  const statParts = [];
  for (const referencePath of referencePaths) {
    try { const st = await fs.stat(referencePath); statParts.push(`${referencePath}:${st.mtimeMs}:${st.size}`); } catch {}
  }
  const cacheKey = `${normalizedBank}|${statParts.sort().join('|')}`;
  if (referenceTemplateProfileCache.has(cacheKey)) return referenceTemplateProfileCache.get(cacheKey);

  if (!referencePaths.length) {
    console.warn('REFERENCE ENSEMBLE BULUNAMADI:', normalizedBank);
    referenceTemplateProfileCache.set(cacheKey, null);
    return null;
  }

  try {
    const extracted = [];
    for (const referencePath of referencePaths) {
      try {
        const profile = await extractReferenceTemplateProfile(referencePath, normalizedBank);
        if (profile) extracted.push(profile);
      } catch (error) {
        console.warn('REFERENCE TEK DOSYA HATASI:', path.basename(referencePath), error?.message || error);
      }
    }

    const fieldBuckets = {};
    for (const profile of extracted) {
      for (const [field, values] of Object.entries(profile.fields || {})) {
        if (!Array.isArray(values)) continue;
        (fieldBuckets[field] ||= []).push(...values);
      }
    }

    const fields = {};
    for (const [field, entries] of Object.entries(fieldBuckets)) {
      const pageOne = entries.filter(x => Number(x.pageNumber) === 1);
      let usableEntries = pageOne.length ? pageOne : entries;
      if (field === "amount") {
        // ANA TUTAR = yalnızca "GİDEN FAST TUTARI" / eşdeğer açık ana
        // işlem tutarı etiketi. Vergi, komisyon, toplam tahsilat ve
        // açıklama satırları amount alanına kesinlikle giremez.
        const primary = usableEntries.filter(x =>
          x?.templateRole === "primaryAmount" ||
          /giden\s*fast\s*tutar|gönderilen\s*(?:fast\s*)?tutar|transfer\s*tutar|işlem\s*tutar|ana\s*tutar|gönderim\s*tutar|giden\s*tutar/i.test(String(x?.label || ""))
        );
        if (primary.length) {
          usableEntries = primary;
        } else {
          // Açık ana tutar etiketi yoksa referans tutar anchor'ı üretme.
          // Böylece komisyon/toplam gibi sayılar ana tutar konumu olarak
          // yanlış kalibre edilmez.
          usableEntries = [];
        }
      }
      if (!usableEntries.length) continue;
      fields[field] = aggregateReferenceField(usableEntries);
    }

    // SECURITY BOUNDARY: extracted reference PDF text is used only while
    // constructing geometry/style. Do not retain reference document values
    // (names, IBANs, amounts, account/ref numbers) in the final profile.
    for (const field of Object.keys(fields)) {
      const f = fields[field];
      if (!f || typeof f !== 'object') continue;
      delete f.label;
      delete f.valueTextLength;
      if (Array.isArray(f.variants)) {
        f.variants = f.variants.map(v => {
          const safe = { ...v };
          delete safe.label;
          delete safe.valueTextLength;
          return safe;
        });
      }
    }

    const profile = {
      bank: normalizedBank,
      referenceFiles: referencePaths.map(x=>path.basename(x)),
      referenceCount: referencePaths.length,
      usablePdfReferenceCount: extracted.filter(x=>x.referenceType==='pdf' && x.fieldCount>0).length,
      fields,
      fieldCount: Object.keys(fields).length,
      referenceMode: 'trusted-ensemble',
      styleSource: 'pdf-text-metadata',
    };

    referenceTemplateProfileCache.set(cacheKey, profile);
    console.log('REFERENCE TEMPLATE ENSEMBLE:', JSON.stringify({
      bank: normalizedBank,
      referenceCount: profile.referenceCount,
      usablePdfReferenceCount: profile.usablePdfReferenceCount,
      files: profile.referenceFiles,
      fields: Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{referenceCount:v.referenceCount,spread:v.spread}]))
    }));
    return profile;
  } catch (error) {
    console.warn('REFERENCE TEMPLATE ENSEMBLE HATASI:', normalizedBank, error?.message || error);
    referenceTemplateProfileCache.set(cacheKey, null);
    return null;
  }
}

function normalizeRegionBox(region, size) {
  if (!region || !size?.width || !size?.height) return null;
  const x1 = Number(region.x1), y1 = Number(region.y1), x2 = Number(region.x2), y2 = Number(region.y2);
  if (![x1,y1,x2,y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return null;
  return {
    xNorm: x1 / size.width,
    yNorm: y1 / size.height,
    widthNorm: Math.max(0.001, (x2 - x1) / size.width),
    heightNorm: Math.max(0.001, (y2 - y1) / size.height),
  };
}

function normalizeFieldTextForMatch(text) {
  return String(text || "")
    .toLocaleUpperCase("tr-TR")
    .replace(/[İIı]/g, "I")
    .replace(/Ğ/g, "G")
    .replace(/Ü/g, "U")
    .replace(/Ş/g, "S")
    .replace(/Ö/g, "O")
    .replace(/Ç/g, "C")
    .replace(/\s+/g, " ")
    .trim();
}

// OCR kutusu bazen değeri değil, değerin etiketini yakalar.
// Bu tür idari/alan başlığı metinlerinin herhangi bir gerçek alana
// değer olarak atanmasını özellikle engelliyoruz.
function isAdministrativeLabelText(text) {
  const t = normalizeFieldTextForMatch(text);
  if (!t) return true;

  const labelOnly = [
    "BELGE TARIHI", "ISLEM TARIHI", "ISLEM TARTHI", "TARIH", "SAAT", "TIME",
    "ALICI BANKA", "GONDEREN BANKA", "BANKA", "SUBE", "ALICI SUBE",
    "ACIKLAMA", "ETTN", "SORGU NO", "SIRA NO", "SIRA NO/ID",
    "MUSTERI NO", "HESAP NO", "ALICI HESAP", "GONDEREN HESAP",
    "ALICI", "GONDEREN", "GONDERICI", "ALICI ADI", "GONDEREN ADI",
    "ALICI UNVAN", "GONDEREN UNVAN", "VERGI NO", "TCKN", "VKN",
    "TUTAR", "ISLEM TUTARI", "GIDEN FAST TUTARI", "TOPLAM ISLEM TUTARI",
    "TOPLAM TAHSILAT TUTARI", "MESAJ", "MESAJ TURU"
  ];
  if (labelOnly.includes(t)) return true;

  // Etiket + değer içeren uzun satırlar: gerçek değer çıkarılmadan
  // doğrudan başka alana atanmasın.
  const labelWords = /(BELGE|ISLEM|TARIH|TARH|ALICI|GONDEREN|GONDERICI|BANKA|SUBE|HESAP|MUSTERI|TCKN|VKN|VERGI|SORGU|SIRA|ACIKLAMA|ETTN|TUTARI|TUTAR|MESAJ|FAST)/;
  const labelHits = (t.match(new RegExp(labelWords.source, "g")) || []).length;
  const digitCount = (t.match(/\d/g) || []).length;
  const letters = (t.match(/[A-Z]/g) || []).length;
  if (labelHits >= 2 && (digitCount > 0 || letters > 8)) return true;

  return false;
}

function fieldLabelStrength(field, text) {
  const t = normalizeFieldTextForMatch(text);
  const labels = {
    accountNo: /(HESAP|IBAN|GONDEREN HESAP|ALICI HESAP)/,
    taxNo: /(TCKN|VKN|VERGI|VERGI NO|SIRA NO|SIRA NO\/ID)/,
    date: /(TARIH|ISLEM TARIHI|TARIHI|DATE)/,
    amount: /(TUTAR|TAHSILAT|FAST TUTARI|ISLEM TUTARI|GIDEN FAST|GONDERILEN.*TUTARI|TOPLAM.*TUTARI)/,
    senderName: /(GONDEREN|GONDERICI|GONDEREN AD|GONDEREN UNVAN)/,
    recipientName: /(ALICI|ALICI AD|ALICI UNVAN|ALACAKLI)/,
    transactionNo: /(ISLEM NO|REFERANS|REF NO|ETTN|TRANSACTION|UUID|SORGU NO)/,
    address: /(ADRES|ADDRESS)/,
    description: /(ACIKLAMA|DESCRIPTION|NOT)/,
  };
  const re = labels[field];
  return re && re.test(t) ? 100 : 0;
}

function nearbyFieldLabelScore(field, item, regions) {
  const ir = item?.region;
  if (!ir) return 0;
  const wanted = {
    accountNo: /(HESAP|IBAN)/,
    taxNo: /(TCKN|VKN|VERGI|SIRA NO)/,
    date: /(TARIH|TARIHI)/,
    amount: /(TUTAR|TAHSILAT)/,
    senderName: /(GONDEREN|GONDERICI)/,
    recipientName: /(ALICI|ALACAKLI)/,
    transactionNo: /(ISLEM NO|SORGU NO|REFERANS|ETTN|UUID)/,
    address: /(ADRES)/,
    description: /(ACIKLAMA|DESCRIPTION|NOT)/,
  }[field];
  if (!wanted) return 0;

  const iy = (Number(ir.y1) + Number(ir.y2)) / 2;
  const ih = Math.max(8, Number(ir.y2) - Number(ir.y1));
  let best = 0;
  for (const other of regions) {
    if (other === item || !other?.region) continue;
    const t = normalizeFieldTextForMatch(other.text);
    if (!wanted.test(t)) continue;
    const or = other.region;
    const oy = (Number(or.y1) + Number(or.y2)) / 2;
    const sameLine = Math.abs(oy - iy) <= Math.max(18, ih * 1.8);
    const gapRight = Number(ir.x1) >= Number(or.x2) ? Number(ir.x1) - Number(or.x2) : Infinity;
    const gapLeft = Number(or.x1) >= Number(ir.x2) ? Number(or.x1) - Number(ir.x2) : Infinity;
    const near = Math.min(gapRight, gapLeft);
    if (sameLine && near <= Math.max(260, ih * 14)) best = Math.max(best, 120);
  }
  return best;
}

function referenceValueCompatible(field, text, item = null, regions = []) {
  const t = normalizeFieldTextForMatch(text);
  if (!t || referenceFieldRuleForText(text) || isAdministrativeLabelText(t)) return false;

  switch (field) {
    case "accountNo": {
      const hasIban = /\bTR\s*\d{2}(?:\s*\d){20,}\b/i.test(t) || /TR\d{2}[0-9A-Z]{10,}/i.test(t);
      const hasAccountLabel = nearbyFieldLabelScore(field, item, regions) > 0 || /HESAP\s*NO/i.test(t);
      // Çıplak 6-11 haneli sayı müşteri no/sıra no olabilir.
      // Hesap no olarak ancak yanında açık hesap/IBAN bağlamı varsa kabul et.
      const bareAccount = /^\d{6,11}$/.test(t.replace(/\s/g, ""));
      return hasIban || (hasAccountLabel && !bareAccount) || (!bareAccount && /\d{6,}/.test(t));
    }
    case "taxNo":
      return /\b\d{10,11}\b/.test(t) || /\b\d{3}[- ]\d{7,12}\b/.test(t);
    case "date":
      return /\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\b/.test(t) && !/^[A-Z ]+$/.test(t);
    case "amount":
      return /[-+]?\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?\s*(?:TL|TRY)?\b/i.test(t) || /[-+]?\d+(?:[.,]\d{1,2})\b/.test(t);
    case "senderName":
    case "recipientName": {
      if (isAdministrativeLabelText(t)) return false;
      if (/(BANKA|TARIH|TARH|ACIKLAMA|HESAP|SUBE|TUTAR|SORGU|ETTN|MESAJ|FAST)/.test(t)) return false;
      const words = t.split(/\s+/).filter(Boolean);
      return words.length >= 2 && words.some(w => /[A-ZÇĞİÖŞÜ]{3,}/.test(w)) && !/\d{3,}/.test(t);
    }
    case "transactionNo":
      return /[0-9a-f]{8}-[0-9a-f-]{20,}/i.test(t) ||
        (/(REFERANS|REF|ETTN|ISLEM|SORGU)/i.test(t) && /[A-Z0-9]{6,}/i.test(t));
    case "address":
      return /\b(MAH|MAHALLESI|CAD|CADDESI|SOK|SOKAK|NO[:.]|APT|APARTMANI|BLOK|PK|POSTA|IL|ILCE)\b/i.test(t) && !/^(ALICI|GONDEREN)\s+(HESAP|BANKA|SUBE)/i.test(t);
    case "description":
      if (isAdministrativeLabelText(t)) return false;
      if (/^TR\s*\d{2}[0-9\s]+$/i.test(t)) return false;
      if (/^[-+]?\d[\d.,\s]*\s*(TL|TRY)?$/i.test(t)) return false;
      if (/^\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/.test(t)) return false;
      return t.length >= 4 && /[A-ZÇĞİÖŞÜ]/.test(t);
    default:
      return true;
  }
}

function referenceFieldTargetCandidates(field, ref, regions, size) {
  const candidates = [];
  const referenceVariants = Array.isArray(ref?.variants) && ref.variants.length ? ref.variants : [ref];

  for (const item of regions) {
    const text = String(item.text || "").trim();
    const box = normalizeRegionBox(item.region, size);
    if (!box) continue;
    if (referenceFieldRuleForText(text)) continue;

    const semantic = referenceValueCompatible(field, text, item, regions);
    if (!semantic) continue;

    const labelStrength = fieldLabelStrength(field, text);
    const nearbyLabel = nearbyFieldLabelScore(field, item, regions);

    const variantDistances = referenceVariants.map((rv) => {
      const rcx = Number(rv.xNorm || 0) + Number(rv.widthNorm || 0) / 2;
      const rcy = Number(rv.yNorm || 0) + Number(rv.heightNorm || 0) / 2;
      const cx = box.xNorm + box.widthNorm / 2;
      const cy = box.yNorm + box.heightNorm / 2;
      const dx = Math.abs(cx - rcx);
      const dy = Math.abs(cy - rcy);
      return { dx, dy, distance: Math.sqrt(dx * dx + dy * dy), ref: rv };
    }).sort((a,b) => a.distance - b.distance);

    const nearestVariant = variantDistances[0];
    const positionDistance = nearestVariant?.distance ?? Infinity;

    // Etiketsiz semantik eşleşme çok uzaktaysa reddet.
    if (labelStrength === 0 && nearbyLabel === 0 && positionDistance > 0.11) continue;

    let score = Math.min(60, Number(item.score || 0) * 25);
    score += Math.max(labelStrength, nearbyLabel);
    score += Math.max(0, 120 - Math.min(120, positionDistance * 360));
    score += 140; // semantik tip uyumu zorunlu

    // Alan etiketi aynı satırda/yanında ise güçlü bonus.
    if (nearbyLabel > 0) score += 80;

    candidates.push({
      item,
      box,
      score,
      nearestReferenceDistance: positionDistance,
      semanticMatch: true,
      labelScore: Math.max(labelStrength, nearbyLabel),
    });
  }

  const seen = new Set();
  return candidates.filter((x) => {
    const key = `${x.item.pageIndex || 0}:${x.item.region?.x1}:${x.item.region?.y1}:${x.item.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => b.score - a.score);
}

// =====================================================
// REFERANS DEĞER İZOLASYONU
// =====================================================
// Referans dekont yalnızca şablon/geometri/stil sinyali sağlar.
// Gerçek isim, IBAN, tutar, müşteri no, sorgu no vb. referans değerleri
// model context'ine veya API sonucuna taşınmaz.
function sanitizeReferenceTemplateForOutput(analysis) {
  if (!analysis || typeof analysis !== "object") return analysis;
  const safeFields = Array.isArray(analysis.fields) ? analysis.fields.map((f) => ({
    field: f.field,
    status: f.status,
    reference: f.reference ? {
      xNorm: f.reference.xNorm,
      yNorm: f.reference.yNorm,
      widthNorm: f.reference.widthNorm,
      heightNorm: f.reference.heightNorm,
      pageNumber: f.reference.pageNumber,
      style: f.reference.style ? {
        source: f.reference.style.source,
        fontNames: Array.isArray(f.reference.style.fontNames) ? f.reference.style.fontNames : [],
        avgFontHeight: f.reference.style.avgFontHeight,
        avgCharWidth: f.reference.style.avgCharWidth,
        itemCount: f.reference.style.itemCount,
      } : undefined,
      referenceCount: f.reference.referenceCount,
      spread: f.reference.spread,
    } : undefined,
    target: f.target ? {
      xNorm: f.target.xNorm,
      yNorm: f.target.yNorm,
      widthNorm: f.target.widthNorm,
      heightNorm: f.target.heightNorm,
      pageIndex: f.target.pageIndex,
      text: f.target.text,
      ocrScore: f.target.ocrScore,
    } : undefined,
    matchScore: f.matchScore,
    geometryScore: f.geometryScore,
    styleSignals: f.styleSignals,
  })).map((f) => {
    if (f.reference && "label" in f.reference) delete f.reference.label;
    return f;
  }) : [];

  return {
    bank: analysis.bank,
    referenceFile: analysis.referenceFile,
    referenceFiles: analysis.referenceFiles,
    referenceCount: analysis.referenceCount,
    referenceFieldCount: analysis.referenceFieldCount,
    matchedFieldCount: analysis.matchedFieldCount,
    missingFieldCount: analysis.missingFieldCount,
    strongGeometryCount: analysis.strongGeometryCount,
    weakPlacementCount: analysis.weakPlacementCount,
    strongStyleCount: analysis.strongStyleCount,
    styleComparisonNote: analysis.styleComparisonNote,
    fields: safeFields,
    evidence: analysis.evidence,
  };
}

async function analyzeReferenceTemplateAgainstDocument(filePath, mime, bank, ocrResult) {
  const profile = await buildReferenceTemplateProfile(bank);
  if (!profile || !Object.keys(profile.fields || {}).length || !ocrResult?.success) return null;

  const regions = Array.isArray(ocrResult.regions)
    ? ocrResult.regions.filter((x) => x?.region && String(x.text || "").trim())
    : [];
  if (!regions.length) return null;

  const pageSizes = new Map();
  let imageBuffer = null;
  if (mime && mime.startsWith("image/")) {
    const meta = await sharp(filePath).metadata();
    pageSizes.set(0, { width:Number(meta.width)||0, height:Number(meta.height)||0 });
    imageBuffer = await fs.readFile(filePath);
  } else if (mime === "application/pdf" || String(filePath).toLowerCase().endsWith(".pdf")) {
    const pdfBuffer = await fs.readFile(filePath);
    const pdf = await pdfjsLib.getDocument({data:new Uint8Array(pdfBuffer)}).promise;
    for (const pageIndex of new Set(regions.map(x => Number(x.pageIndex)||0))) {
      const page = await pdf.getPage(pageIndex+1);
      const viewport = page.getViewport({scale:1});
      pageSizes.set(pageIndex,{width:viewport.width,height:viewport.height});
    }
  }

  const matches = [];
  for (const [field, ref] of Object.entries(profile.fields)) {
    const size = pageSizes.get(0);
    if (!size?.width || !size?.height) continue;

    const candidates = referenceFieldTargetCandidates(field, ref, regions, size);
    if (!candidates.length) {
      matches.push({ field, status:"missing", reference:{...ref} });
      continue;
    }

    const best = candidates[0];
    const target = best.box;
    const variants = Array.isArray(ref?.variants) && ref.variants.length ? ref.variants : [ref];
    const nearestRef = [...variants].sort((a,b) => {
      const da = Math.sqrt(
        Math.pow((target.xNorm + target.widthNorm/2) - (a.xNorm + a.widthNorm/2), 2) +
        Math.pow((target.yNorm + target.heightNorm/2) - (a.yNorm + a.heightNorm/2), 2)
      );
      const db = Math.sqrt(
        Math.pow((target.xNorm + target.widthNorm/2) - (b.xNorm + b.widthNorm/2), 2) +
        Math.pow((target.yNorm + target.heightNorm/2) - (b.yNorm + b.heightNorm/2), 2)
      );
      return da-db;
    })[0] || ref;
    const dx = Math.abs((target.xNorm + target.widthNorm/2) - (nearestRef.xNorm + nearestRef.widthNorm/2));
    const dy = Math.abs((target.yNorm + target.heightNorm/2) - (nearestRef.yNorm + nearestRef.heightNorm/2));
    const dw = Math.abs(Math.log(Math.max(.001,target.widthNorm)/Math.max(.001,nearestRef.widthNorm)));
    const dh = Math.abs(Math.log(Math.max(.001,target.heightNorm)/Math.max(.001,nearestRef.heightNorm)));

    const geometryPenalty = Math.min(100, Math.round((dx/.03)*35 + (dy/.03)*35 + dw*20 + dh*10));
    const geometryScore = Math.max(0, 100 - geometryPenalty);
    const targetText = String(best.item.text || "");
    const targetDigits = (targetText.match(/\d/g)||[]).length;
    const referenceLength = Number(ref.valueTextLength)||0;
    const lengthRatio = referenceLength ? Math.abs(targetText.length-referenceLength)/referenceLength : 0;
    const contentTypeMismatch =
      field === "iban" ? (!/[A-Z]{2}\d{2}/i.test(targetText) ? 1 : 0) :
      field === "amount" ? (!/\d/.test(targetText) ? 1 : 0) : 0;

    const styleSignals = {
      referenceFontNames: ref.style?.fontNames || [],
      referenceAvgFontHeight: ref.style?.avgFontHeight || 0,
      referenceAvgCharWidth: ref.style?.avgCharWidth || 0,
      targetOCRConfidence: Number(best.item.score)||0,
      targetTextLength: targetText.length,
      referenceTextLength: referenceLength,
      lengthDifferenceRatio: lengthRatio,
      contentTypeMismatch,
      pixelComparisonAvailable:false,
    };

    // JPG'de PDF font adını birebir ölçmek mümkün değildir. Bunun yerine
    // OCR kutu geometrisi + metin uzunluğu + gerçek piksel yoğunluğu kullanılır.
    if (imageBuffer && field) {
      try {
        const meta = await sharp(imageBuffer).metadata();
        const left=Math.max(0,Math.floor(best.item.region.x1));
        const top=Math.max(0,Math.floor(best.item.region.y1));
        const width=Math.max(1,Math.min(meta.width-left,Math.ceil(best.item.region.x2-best.item.region.x1)));
        const height=Math.max(1,Math.min(meta.height-top,Math.ceil(best.item.region.y2-best.item.region.y1)));
        const raw=await sharp(imageBuffer).grayscale().extract({left,top,width,height}).raw().toBuffer({resolveWithObject:true});
        let ink=0,dark=0,pixels=0;
        for(let i=0;i<raw.data.length;i++){ const v=raw.data[i]; pixels++; if(v<220) ink++; if(v<185) dark += 255-v; }
        styleSignals.targetInkRatio=pixels?ink/pixels:0;
        styleSignals.targetDarkness=pixels?dark/pixels:0;
      } catch {}
    }

    matches.push({
      field,
      status:"matched",
      reference:{xNorm:nearestRef.xNorm,yNorm:nearestRef.yNorm,widthNorm:nearestRef.widthNorm,heightNorm:nearestRef.heightNorm,pageNumber:nearestRef.pageNumber,style:nearestRef.style,referenceFile:nearestRef.referenceFile,referenceCount:ref.referenceCount,spread:ref.spread},
      target:{...target,pageIndex:Number(best.item.pageIndex)||0,text:targetText,ocrScore:Number(best.item.score)||0},
      matchScore:Math.max(0,Math.round(best.score)),
      geometryScore,
      styleSignals,
    });
  }

  const matched = matches.filter(x=>x.status==="matched");
  const missing = matches.filter(x=>x.status==="missing");
  const strongGeometry = matched.filter(x=>x.geometryScore>=60);
  const weakPlacement = matched.filter(x=>x.geometryScore>=35);

  const referenceTemplateResult = {
    bank:profile.bank,
    referenceFile:profile.referenceFiles?.[0] || null,
    referenceFiles:profile.referenceFiles || [],
    referenceCount:profile.referenceCount || 1,
    referenceFieldCount:profile.fieldCount,
    matchedFieldCount:matched.length,
    missingFieldCount:missing.length,
    strongGeometryCount:strongGeometry.length,
    weakPlacementCount:weakPlacement.length,
    strongStyleCount:0,
    styleComparisonNote:"JPG'de PDF font adı birebir ölçülemez; PDF font metadata'sı referans profiline, gerçek piksel yoğunluğu ise JPG tarafına ayrı sinyal olarak kaydedilir.",
    fields:matches,
    evidence: strongGeometry.length || missing.length
      ? `Referans şablonuyla ${matched.length} alan eşleştirildi; ${strongGeometry.length} alanda belirgin geometri farkı, ${missing.length} alanda beklenen alan bulunamadı.`
      : `Referans şablonuyla ${matched.length} alan eşleştirildi; belirgin geometri farkı bulunmadı.`,
  };

  return sanitizeReferenceTemplateForOutput(referenceTemplateResult);
}

// =====================================================
// TUTAR FORENSICS V4 — ŞABLON + ETİKET + PİKSEL KONTROLÜ
// =====================================================

// =====================================================
// PaddleOCR kutularını ve gerçek piksel verisini birlikte kullanır.
// Amaç: tutarın içindeki tek/az sayıdaki karakterin diğerlerinden
// farklı render edilmesini yakalamaktır. Tek başına sahtecilik kanıtı değildir.
async function analyzeAmountForensics(
filePath,
ocrResult,
fileFingerprint = null,
bank = null
) {

if (
!filePath ||
!ocrResult?.success ||
!Array.isArray(ocrResult?.regions) ||
!ocrResult.regions.length
) {
if (!filePath || !ocrResult?.success || !Array.isArray(ocrResult?.regions) || !ocrResult.regions.length) {
return null;
}
}

if (fileFingerprint && amountForensicsStrongCache.has(fileFingerprint)) {
const cached = amountForensicsStrongCache.get(fileFingerprint);
console.log("AMOUNT FORENSICS CACHE HIT:", fileFingerprint);
return JSON.parse(JSON.stringify(cached));
}

const moneyPattern =
/(?:₺|TL|TRY|EUR|USD|GBP)?\s*\d{1,3}(?:[. ]\d{3})*(?:[,\.]\d{1,2})?(?:\s*(?:TL|TRY|₺|EUR|USD|GBP))?|(?:₺|TL|TRY|EUR|USD|GBP)?\s*\d+(?:[,\.]\d{1,2})?(?:\s*(?:TL|TRY|₺|EUR|USD|GBP))?/i;

const numericOnlyPattern =
/^[₺€$£]?\s*[0-9][0-9.,\s]*\s*(?:TL|TRY|₺|EUR|USD|GBP)?$/i;

function validRegion(region) {
return !!(
region &&
Number.isFinite(Number(region.x1)) &&
Number.isFinite(Number(region.y1)) &&
Number.isFinite(Number(region.x2)) &&
Number.isFinite(Number(region.y2)) &&
Number(region.x2) > Number(region.x1) &&
Number(region.y2) > Number(region.y1)
);
}

function cleanAmountText(value) {
return String(value || "")
.replace(/\s+/g, " ")
.trim();
}

function numericSignal(text) {
const value = cleanAmountText(text);
if (!value) return 0;
const anchoredMoneyPattern = /^(?:₺|€|\$|£|TL|TRY|EUR|USD|GBP)?\s*\d{1,3}(?:[. ]\d{3})*(?:[,\.]\d{1,2})?(?:\s*(?:TL|TRY|₺|EUR|USD|GBP))?$/i;
const anchoredDecimalPattern = /^(?:₺|€|\$|£|TL|TRY|EUR|USD|GBP)?\s*\d+(?:[,\.]\d{1,2})\s*(?:TL|TRY|₺|EUR|USD|GBP)?$/i;
if (anchoredDecimalPattern.test(value)) return 9;
if (anchoredMoneyPattern.test(value) && /[,\.]\d{1,2}/.test(value)) return 8;
if (anchoredMoneyPattern.test(value) && /\d/.test(value)) return 5;
if (numericOnlyPattern.test(value)) return 3;
return 0;
}

const rawCandidates =
ocrResult.regions
.filter((item) => validRegion(item?.region))
.map((item) => ({
...item,
text: cleanAmountText(item.text),
score: Number(item.score) || 0,
}))
.filter((item) => numericSignal(item.text) > 0);

if (!rawCandidates.length) {
return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText: null,
region: null,
characterCount: 0,
metrics: {
medianInkRatio: null,
maxInkRatioDifference: null,
maxStrokeProxyDifference: null,
maxEdgeDensityDifference: null,
localAnomalyRatio: null,
},
evidence:
"Tutar benzeri OCR alanı bulunamadığı için karakter düzeyinde görsel tutarlılık kontrolü yapılamadı.",
};
}

// Paddle bazen tutarı tek kutu yerine "1.700" + ",00" veya
// "1.700," + "00" gibi komşu kutulara bölebilir. Aynı satırdaki
// yakın sayısal kutuları birleştirerek tam tutar alanını oluştur.
function buildCandidateGroups(items) {
const groups = [];
const sorted = [...items].sort((a, b) => {
const ay = Number(a.region.y1) || 0;
const by = Number(b.region.y1) || 0;
if (Math.abs(ay - by) > 12) return ay - by;
return (Number(a.region.x1) || 0) - (Number(b.region.x1) || 0);
});

for (const item of sorted) {
let best = null;
let bestGap = Infinity;

for (const group of groups) {
const g = group.region;
const itemTop = Number(item.region.y1);
const itemBottom = Number(item.region.y2);
const groupHeight = Math.max(1, Number(g.y2) - Number(g.y1));
const verticalTolerance = Math.max(10, groupHeight * 0.65);
const verticalOverlap =
Math.min(Number(g.y2), itemBottom) -
Math.max(Number(g.y1), itemTop);

if (verticalOverlap < -verticalTolerance) continue;

const gap =
Number(item.region.x1) > Number(g.x2)
? Number(item.region.x1) - Number(g.x2)
: Number(g.x1) - Number(item.region.x2);

// Uzak kutuları birleştirme. Yüksek çözünürlüklü dekontlarda
// 60px'e kadar boşluk, küçük görüntülerde daha azı kabul edilir.
const maxGap = Math.max(24, Math.min(90, groupHeight * 2.2));
if (gap <= maxGap && gap < bestGap) {
best = group;
bestGap = gap;
}
}

if (!best) {
groups.push({
items: [item],
text: item.text,
score: item.score,
region: {...item.region},
pageIndex: item.pageIndex,
});
continue;
}

best.items.push(item);
best.items.sort(
(a, b) => Number(a.region.x1) - Number(b.region.x1)
);
best.text = best.items.map((x) => x.text).join("");
best.score =
best.items.reduce((sum, x) => sum + (Number(x.score) || 0), 0) / best.items.length;
best.region = {
x1: Math.min(...best.items.map((x) => Number(x.region.x1))),
y1: Math.min(...best.items.map((x) => Number(x.region.y1))),
x2: Math.max(...best.items.map((x) => Number(x.region.x2))),
y2: Math.max(...best.items.map((x) => Number(x.region.y2))),
};
}

return groups;
}

const groups = buildCandidateGroups(rawCandidates)
.map((group) => ({
...group,
text: cleanAmountText(group.text),
signal: numericSignal(group.text),
}))
.filter((group) => group.signal > 0)
.sort((a, b) => {
if (b.signal !== a.signal) return b.signal - a.signal;
const ad = /[,\.][0-9]{1,2}/.test(a.text) ? 1 : 0;
const bd = /[,\.][0-9]{1,2}/.test(b.text) ? 1 : 0;
if (bd !== ad) return bd - ad;
return (b.score || 0) - (a.score || 0);
});

if (!groups.length) {
return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText: null,
region: null,
characterCount: 0,
metrics: {},
evidence: "Tutar alanı oluşturulamadı.",
};
}

// =====================================================
// GERÇEK TUTAR ADAYINI SEÇ
// =====================================================
// OCR'ın düz rakamları (özellikle sorgu no / işlem no / fiş no)
// tutar sanmasını engelle. Biçimsel tutar sinyalleri ve komşu
// OCR metinleri birlikte değerlendirilir.
function anchorContextScore(group) {
const gx1 = Number(group.region.x1) || 0;
const gy1 = Number(group.region.y1) || 0;
const gx2 = Number(group.region.x2) || 0;
const gy2 = Number(group.region.y2) || 0;
const gh = Math.max(8, gy2 - gy1);
let score = 0;
const anchors = [];
for (const item of ocrResult.regions) {
if (!item?.text || !validRegion(item.region)) continue;
const text = cleanAmountText(item.text);
if (!text) continue;
const ix1 = Number(item.region.x1) || 0;
const iy1 = Number(item.region.y1) || 0;
const ix2 = Number(item.region.x2) || 0;
const iy2 = Number(item.region.y2) || 0;
const ih = Math.max(8, iy2 - iy1);
const overlap = Math.min(gy2, iy2) - Math.max(gy1, iy1);
if (overlap < -Math.max(8, Math.min(gh, ih) * 0.55)) continue;
if (/(işlem\s*tutarı|islem\s*tutari|ana\s*tutar|\btutar\b|\bamount\b)/i.test(text)) {
const labelGap = gx1 >= ix2 ? gx1 - ix2 : Math.abs(gx1 - ix1);
if (gx1 >= ix1 && labelGap <= Math.max(420, gh * 12)) {
score += 35;
anchors.push(text);
}
}
if (/(?:TL|TRY|₺|EUR|USD|GBP)/i.test(text)) {
const gap = Math.min(Math.abs(gx1 - ix2), Math.abs(ix1 - gx2));
if (gap <= Math.max(180, gh * 5)) score += 10;
}
}
return { score, anchors };
}

function candidateAmountScore(group) {
const text = cleanAmountText(group.text);
const digits = (text.match(/\d/g) || []).length;
const hasCurrency = /(?:₺|TL|TRY|EUR|USD|GBP)/i.test(text);
const hasDecimal = /[,\.]\d{2}(?:$|\s*(?:TL|TRY|₺|EUR|USD|GBP)$)/i.test(text) || /[,\.]\d{2}$/.test(text);
const hasThousands = /\d{1,3}(?:[. ]\d{3})+/.test(text);
const isLongPlainNumber = !/[,.]/.test(text) && !hasCurrency && digits >= 8;

let score = Number(group.signal) || 0;

// Türk dekontlarında gerçek para tutarı için en güçlü sinyaller.
if (hasDecimal) score += 12;
if (hasCurrency) score += 10;
if (hasThousands) score += 4;
if (/[,\.]\d{1,2}/.test(text)) score += 3;

// 8+ haneli noktasız rakamlar çoğunlukla sorgu/işlem/fiş no gibi
// kimlik numaralarıdır. Gerçek tutar da büyük olabilir; bu yüzden
// tamamen elemek yerine güçlü biçimsel tutar adaylarının gerisine at.
if (isLongPlainNumber) score -= 14;
if (!hasDecimal && !hasCurrency && digits >= 10) score -= 8;

return score;
}

function nearbyContextScore(group) {
const gx1 = Number(group.region.x1) || 0;
const gy1 = Number(group.region.y1) || 0;
const gx2 = Number(group.region.x2) || 0;
const gy2 = Number(group.region.y2) || 0;
const gh = Math.max(8, gy2 - gy1);

let score = 0;
let positive = [];
let negative = [];

for (const item of ocrResult.regions) {
if (!item?.text || !validRegion(item.region)) continue;
if (item === group) continue;

const text = cleanAmountText(item.text);
if (!text) continue;

const ix1 = Number(item.region.x1);
const iy1 = Number(item.region.y1);
const ix2 = Number(item.region.x2);
const iy2 = Number(item.region.y2);
const ih = Math.max(8, iy2 - iy1);
const verticalGap = Math.max(0, Math.max(gy1, iy1) - Math.min(gy2, iy2));
const horizontalGap = ix1 > gx2 ? ix1 - gx2 : gx1 - ix2;

// Aynı satırdaki veya hemen üst/altındaki komşu metinleri dikkate al.
if (verticalGap > Math.max(gh, ih) * 1.5) continue;
if (horizontalGap > Math.max(140, gh * 5)) continue;

if (/(?:^|\s)(?:TL|TRY|₺|EUR|USD|GBP)(?:\s|$)/i.test(text) || /(?:TL|TRY|₺|EUR|USD|GBP)/i.test(text)) {
score += 9;
positive.push(text);
}

if (/(?:tutar|amount|para cinsi)/i.test(text)) {
score += 7;
positive.push(text);
}

if (/(?:sorgu|sorgulama|işlem no|islem no|fiş no|fis no|referans no|referans|seri no|sıra no|sira no)/i.test(text)) {
score -= 18;
negative.push(text);
}
}

return {score, positive, negative};
}

let image;
try {
const meta = await sharp(filePath).metadata();
if (!meta?.width || !meta?.height) throw new Error("Görüntü boyutu alınamadı.");
image = {width: meta.width, height: meta.height};
} catch (error) {
return {available: false, status: "unknown", severity: "none", score: 0, amountText: null, region: null, characterCount: 0, metrics: {}, evidence: "Görüntü boyutu alınamadı."};
}

const referenceAnchor = await getReferenceAmountAnchor(bank);
console.log("AMOUNT TEMPLATE ANCHOR:", JSON.stringify(referenceAnchor ? { bank: referenceAnchor.bank, pageNumber: referenceAnchor.pageNumber, xNorm: referenceAnchor.xNorm, yNorm: referenceAnchor.yNorm, widthNorm: referenceAnchor.widthNorm, heightNorm: referenceAnchor.heightNorm, referenceCount: referenceAnchor.referenceCount, source: referenceAnchor.source } : null));

function templatePositionScore(group) {
if (!referenceAnchor || !image?.width || !image?.height) return 0;
const cx = (Number(group.region.x1) + Number(group.region.x2)) / 2;
const cy = (Number(group.region.y1) + Number(group.region.y2)) / 2;
const dx = Math.abs(cx / image.width - Number(referenceAnchor.xNorm || 0));
const dy = Math.abs(cy / image.height - Number(referenceAnchor.yNorm || 0));
const d = Math.sqrt(dx * dx + dy * dy);
if (d <= 0.025) return 35;
if (d <= 0.05) return 25;
if (d <= 0.09) return 14;
if (d <= 0.15) return 5;
return 0;
}

// =====================================================
// REFERANS ODAKLI TUTAR SEÇİMİ
// =====================================================
// Referansın "amount" alanı varsa, gerçek JPG'deki tutarı yalnızca
// genel OCR puanına bırakma. Önce referansın normalize konumuna,
// ardından aynı satırdaki tutar etiketine bak. Bu sayede müşteri no,
// sorgu no, işlem ref gibi rakamlar tutarın önüne geçemez.
let referenceAmountField = null;
try {
  const referenceProfile = await buildReferenceTemplateProfile(bank);
  referenceAmountField = referenceProfile?.fields?.amount || null;
} catch (error) {
  console.warn("REFERENCE GUIDED AMOUNT PROFILE HATASI:", error?.message || error);
}

function amountLabelEvidence(group) {
  const gx1 = Number(group.region.x1) || 0;
  const gy1 = Number(group.region.y1) || 0;
  const gx2 = Number(group.region.x2) || 0;
  const gy2 = Number(group.region.y2) || 0;
  const gh = Math.max(8, gy2 - gy1);
  let score = 0;
  const positive = [];
  const negative = [];

  for (const item of ocrResult.regions) {
    if (!item?.text || !validRegion(item.region)) continue;
    const text = cleanAmountText(item.text);
    if (!text) continue;

    const ix1 = Number(item.region.x1) || 0;
    const iy1 = Number(item.region.y1) || 0;
    const ix2 = Number(item.region.x2) || 0;
    const iy2 = Number(item.region.y2) || 0;
    const ih = Math.max(8, iy2 - iy1);
    const sameLine = Math.abs(((iy1 + iy2) / 2) - ((gy1 + gy2) / 2)) <= Math.max(14, Math.min(gh, ih) * 0.9);
    const leftOfAmount = ix2 <= gx1 + 8;
    const close = gx1 - ix2 <= Math.max(360, gh * 14);
    const aboveClose = iy2 <= gy1 + 8 && gy1 - iy2 <= Math.max(55, gh * 4);

    if (sameLine && leftOfAmount && close && /giden\s*fast\s*tutar|gönderilen\s*(?:fast\s*)?tutar|transfer\s*tutar|işlem\s*tutar|ana\s*tutar|gönderim\s*tutar|giden\s*tutar/i.test(text)) {
      score += 260;
      positive.push(text);
    } else if (sameLine && leftOfAmount && close && /(?:tutar|amount|para\s*cinsi)/i.test(text)) {
      score += 150;
      positive.push(text);
    }

    if (sameLine && leftOfAmount && close && /(?:müşteri\s*no|musteri\s*no|işlem\s*ref|işlem\s*no|islem\s*no|fiş\s*no|fis\s*no|referans|sorgu\s*no|seri\s*no|sıra\s*no|sira\s*no|hesap\s*no|iban|tckn|vergi\s*no)/i.test(text)) {
      score -= 140;
      negative.push(text);
    }

    if (aboveClose && /(?:giden\s*fast\s*tutar|tutar|amount)/i.test(text)) {
      score += 70;
      positive.push(text);
    }
  }

  return { score, positive, negative };
}

function referenceAmountPositionScore(group) {
  if (!referenceAmountField || !image?.width || !image?.height) return 0;

  const gx1 = Number(group.region.x1) || 0;
  const gy1 = Number(group.region.y1) || 0;
  const gx2 = Number(group.region.x2) || 0;
  const gy2 = Number(group.region.y2) || 0;
  const gcx = (gx1 + gx2) / 2 / image.width;
  const gcy = (gy1 + gy2) / 2 / image.height;

  const refCx = Number(referenceAmountField.xNorm || 0) + Number(referenceAmountField.widthNorm || 0) / 2;
  const refCy = Number(referenceAmountField.yNorm || 0) + Number(referenceAmountField.heightNorm || 0) / 2;
  const refW = Math.max(0.008, Number(referenceAmountField.widthNorm || 0));
  const refH = Math.max(0.008, Number(referenceAmountField.heightNorm || 0));

  const dx = Math.abs(gcx - refCx);
  const dy = Math.abs(gcy - refCy);
  const d = Math.sqrt(dx * dx + dy * dy);

  // Referans tutar kutusunun çevresinde normalize ROI oluştur.
  // Gerçek tutarın rakam sayısı referanstan farklı olabileceği için
  // X toleransı, Y toleransından biraz daha geniş tutulur.
  const xTolerance = Math.max(0.035, refW * 1.8);
  const yTolerance = Math.max(0.028, refH * 4.5);
  const insideRoi = dx <= xTolerance && dy <= yTolerance;

  if (insideRoi && dx <= Math.max(0.018, refW * 0.8) && dy <= Math.max(0.018, refH * 2.0)) return 320;
  if (insideRoi && dx <= Math.max(0.035, refW * 1.5) && dy <= Math.max(0.028, refH * 3.5)) return 250;
  if (insideRoi) return 180;
  if (d <= 0.120) return 20;
  return 0;
}

// =====================================================
// GERÇEK JPG'DEKİ TUTAR ETİKETİ -> DEĞER ROI
// =====================================================
// Referans PDF'nin normalize koordinatı; JPG'nin kırpılması, yeniden
// boyutlandırılması veya farklı kenar boşluğu nedeniyle birkaç piksel
// sapabilir. Bu nedenle gerçek JPG'deki açık tutar etiketini de ikinci
// ve daha güçlü bir ROI kapısı olarak kullanıyoruz.
function directAmountLabelEvidence(group) {
  if (!group?.region) return { score: 0, label: null, distance: null, hard: false };

  const target = group.region;
  const gx1 = Number(target.x1) || 0;
  const gy1 = Number(target.y1) || 0;
  const gx2 = Number(target.x2) || 0;
  const gy2 = Number(target.y2) || 0;
  const gh = Math.max(8, gy2 - gy1);

  const items = ocrResult.regions
    .filter((item) => item?.text && validRegion(item.region))
    .map((item) => ({
      ...item,
      clean: cleanAmountText(item.text),
      x1: Number(item.region.x1) || 0,
      y1: Number(item.region.y1) || 0,
      x2: Number(item.region.x2) || 0,
      y2: Number(item.region.y2) || 0,
    }))
    .filter((item) => item.clean);

  const labels = [];
  const strongLabel = /giden\s*fast\s*tutar[ıi]?/i;
  const mediumLabel = /(?:gönderilen\s*(?:fast\s*)?tutar|transfer\s*tutar|işlem\s*tutar|ana\s*tutar|gönderim\s*tutar|giden\s*tutar)/i;

  for (const item of items) {
    if (strongLabel.test(item.clean)) labels.push({ ...item, score: 180, label: item.clean });
    else if (mediumLabel.test(item.clean)) labels.push({ ...item, score: 150, label: item.clean });
  }

  // OCR etiketi birden fazla kutuya bölmüşse aynı satırdaki kutuları birleştir.
  const sorted = [...items].sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  for (let i = 0; i < sorted.length; i++) {
    let text = sorted[i].clean;
    const x1 = sorted[i].x1;
    const y1 = sorted[i].y1;
    let x2 = sorted[i].x2;
    let y2 = sorted[i].y2;

    for (let j = i + 1; j < sorted.length && j < i + 8; j++) {
      const next = sorted[j];
      const sameLine = Math.abs(next.y1 - y1) <= Math.max(12, gh * 1.2);
      const gap = next.x1 >= x2 ? next.x1 - x2 : Infinity;
      if (!sameLine || gap > Math.max(80, gh * 6)) break;

      text += " " + next.clean;
      x2 = Math.max(x2, next.x2);
      y2 = Math.max(y2, next.y2);

      if (strongLabel.test(text)) {
        labels.push({ x1, y1, x2, y2, score: 180, label: text });
        break;
      }
      if (mediumLabel.test(text)) {
        labels.push({ x1, y1, x2, y2, score: 150, label: text });
      }
    }
  }

  if (!labels.length) return { score: 0, label: null, distance: null, hard: false };

  let best = { score: 0, label: null, distance: Infinity, hard: false };

  for (const label of labels) {
    const sameLine =
      Math.abs(((gy1 + gy2) / 2) - ((label.y1 + label.y2) / 2)) <= Math.max(18, gh * 1.6);
    const rightOfLabel = gx1 >= label.x2 - Math.max(8, gh * 0.5);
    const gap = gx1 >= label.x2 ? gx1 - label.x2 : Infinity;

    if (!sameLine || !rightOfLabel || gap > Math.max(520, gh * 16)) continue;

    const labelCy = (label.y1 + label.y2) / 2;
    const groupCy = (gy1 + gy2) / 2;
    const distance = Math.sqrt(
      Math.pow(gap / Math.max(1, image?.width || 1), 2) +
      Math.pow((groupCy - labelCy) / Math.max(1, image?.height || 1), 2)
    );

    const proximityBonus = Math.max(0, 70 - Math.min(70, gap / Math.max(1, gh) * 4));
    const score = label.score + proximityBonus;

    if (score > best.score) {
      best = {
        score,
        label: label.label,
        distance,
        hard: label.score >= 180,
      };
    }
  }

  return best;
}


// =====================================================
// ROBUST TUTAR ETİKETİ RECONSTRUCTION
// =====================================================
// OCR, "GİDEN FAST TUTARI" gibi bir etiketi tek kutu yerine
// "GİDEN" + "FAST" + "TUTARI" şeklinde bölebilir. Bu durumda
// tek-kutu regex'i hiçbir şey bulamaz. Aynı satırdaki OCR kutularını
// soldan sağa birleştirip etiketi tekrar kuruyoruz ve hemen sağındaki
// sayıyı deterministik tutar adayı yapıyoruz.
function reconstructedAmountLabelEvidence(group) {
  if (!group?.region) return { score: 0, label: null, distance: Infinity, hard: false };

  const gr = group.region;
  const gx1 = Number(gr.x1) || 0;
  const gy1 = Number(gr.y1) || 0;
  const gx2 = Number(gr.x2) || 0;
  const gy2 = Number(gr.y2) || 0;
  const gh = Math.max(8, gy2 - gy1);
  const gcy = (gy1 + gy2) / 2;

  const items = ocrResult.regions
    .filter((item) => item?.text && validRegion(item.region))
    .map((item) => ({
      text: cleanAmountText(item.text),
      x1: Number(item.region.x1) || 0,
      y1: Number(item.region.y1) || 0,
      x2: Number(item.region.x2) || 0,
      y2: Number(item.region.y2) || 0,
    }))
    .filter((item) => item.text);

  const left = items
    .filter((item) => {
      const cy = (item.y1 + item.y2) / 2;
      return item.x2 <= gx1 + 10 &&
        Math.abs(cy - gcy) <= Math.max(18, gh * 1.8) &&
        gx1 - item.x2 <= Math.max(500, gh * 20);
    })
    .sort((a, b) => a.x1 - b.x1);

  if (!left.length) return { score: 0, label: null, distance: Infinity, hard: false };

  // Son kutudan geriye doğru birkaç kutu al. Böylece hem tek kutu
  // hem de parçalanmış "GİDEN FAST TUTARI" etiketleri yakalanır.
  const start = Math.max(0, left.length - 10);
  const tail = left.slice(start);

  for (let i = 0; i < tail.length; i++) {
    let combined = "";
    let first = null;
    let last = null;

    for (let j = i; j < tail.length && j < i + 8; j++) {
      const item = tail[j];
      if (first && item.x1 - last.x2 > Math.max(100, gh * 5)) break;
      combined = `${combined} ${item.text}`.trim();
      first = first || item;
      last = item;

      const normalized = combined
        .toLocaleLowerCase("tr-TR")
        .replace(/[^a-zçğıöşü0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const strong = /giden fast tutar|gönderilen fast tutar|giden tutar|gönderim tutar/.test(normalized);
      const medium = /işlem tutar|transfer tutar|ana tutar|tutar/.test(normalized);
      if (!strong && !medium) continue;

      const gap = gx1 - last.x2;
      const score = (strong ? 300 : 220) + Math.max(0, 90 - Math.min(90, gap / Math.max(1, gh) * 5));
      return {
        score,
        label: combined,
        distance: gap,
        hard: strong,
      };
    }
  }

  return { score: 0, label: null, distance: Infinity, hard: false };
}

function extractStrongAmountFromText(text) {
  const raw = cleanAmountText(text || "");
  if (!raw) return null;
  const patterns = [
    /giden\s*fast\s*tutar[ıi]?\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /gönderilen\s*(?:fast\s*)?tutar\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /transfer\s*tutar\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /işlem\s*tutar\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /ana\s*tutar\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /giden\s*tutar\s*[:\-]?\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function normalizePrimaryAmountOCRText(text) {
  return cleanAmountText(text || "")
    .toLocaleUpperCase("tr-TR")
    .replace(/[İIı]/g, "I")
    // PaddleOCR bazı fontlarda T harfini I/J/L gibi okuyabiliyor.
    .replace(/GIDEN\s+FAST\s+IUTARI/g, "GIDEN FAST TUTARI")
    .replace(/GIDEN\s+FAST\s+TUTARL/g, "GIDEN FAST TUTARI")
    .replace(/GIDEN\s+FAST\s+TUTAR1/g, "GIDEN FAST TUTARI")
    .replace(/GONDERILEN\s+FAST\s+IUTARI/g, "GONDERILEN FAST TUTARI")
    .replace(/GONDERILEN\s+FAST\s+TUTARL/g, "GONDERILEN FAST TUTARI")
    .replace(/GONDERIM\s+IUTARI/g, "GONDERIM TUTARI")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPrimaryAmountFromLine(text) {
  const raw = normalizePrimaryAmountOCRText(text);
  if (!raw) return null;
  const patterns = [
    /GIDEN\s+FAST\s+TUTARI\s*[:=\-]*\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /GONDERILEN\s+FAST\s+TUTARI\s*[:=\-]*\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /TRANSFER\s+TUTARI\s*[:=\-]*\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /ISLEM\s+TUTARI\s*[:=\-]*\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
    /ANA\s+TUTARI\s*[:=\-]*\s*([-+]?\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return { value: m[1], normalized: raw };
  }
  return null;
}

// Etiket ve rakam aynı OCR kutusunda olmayabilir. Aynı satırdaki yakın
// kutuları birleştirerek GİDEN FAST TUTARI -> değer ilişkisini yeniden kur.
function buildPrimaryAmountLabelDerivedCandidates() {
  const regions = ocrResult.regions
    .filter((item) => item?.text && validRegion(item.region))
    .map((item) => ({
      item,
      text: cleanAmountText(item.text),
      x1: Number(item.region.x1) || 0,
      y1: Number(item.region.y1) || 0,
      x2: Number(item.region.x2) || 0,
      y2: Number(item.region.y2) || 0,
    }))
    .sort((a,b) => a.y1 - b.y1 || a.x1 - b.x1);

  const lines = [];
  for (const r of regions) {
    const cy = (r.y1 + r.y2) / 2;
    let line = lines.find(l => Math.abs(l.cy - cy) <= Math.max(14, Math.min(r.y2-r.y1, 30) * 1.25));
    if (!line) { line = { cy, items: [] }; lines.push(line); }
    line.items.push(r);
  }

  const candidates = [];
  for (const line of lines) {
    line.items.sort((a,b) => a.x1 - b.x1);
    // Hem tam satırı hem de kayan pencereleri dene; böylece araya OCR
    // ile bölünmüş VERGİ/KOMİSYON kutuları girmesi sorun olmaz.
    for (let i=0; i<line.items.length; i++) {
      let combined = "";
      let first = null;
      let last = null;
      for (let j=i; j<Math.min(line.items.length, i+10); j++) {
        const cur = line.items[j];
        if (last && cur.x1 - last.x2 > 180) break;
        combined = `${combined} ${cur.text}`.trim();
        first = first || cur;
        last = cur;
        const parsed = extractPrimaryAmountFromLine(combined);
        if (!parsed) continue;

        // Sayısal değerin OCR kutusunu mümkün olduğunca sağdaki son kutuya
        // bağla; amountForensics bu kutuyu sonraki piksel analizinde kullanır.
        const source = last?.item || first.item;
        const sourceRegion = source.region;
        candidates.push({
          ...source,
          text: parsed.value,
          labelDerived: true,
          labelDerivedScore: 1200,
          amountCandidateScore: 1200,
          referencePositionScore: 0,
          directLabelEvidence: { score: 1200, label: parsed.normalized, distance: 0, hard: true },
          reconstructedLabelEvidence: { score: 1200, label: parsed.normalized, distance: 0, hard: true },
          labelEvidence: { score: 1200, positive: [parsed.normalized], negative: [] },
          context: { score: 0, positive: [], negative: [] },
          anchor: { score: 0, anchors: [] },
          templateScore: 0,
          signal: 1,
          region: sourceRegion,
        });
        break;
      }
    }
  }

  // Aynı OCR kutusundan üretilen tekrarları temizle.
  const seen = new Set();
  return candidates.filter(c => {
    const key = `${c.region?.x1}:${c.region?.y1}:${c.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const labelDerivedCandidates = buildPrimaryAmountLabelDerivedCandidates();

const allRankedCandidates = groups.map((group) => {
const baseScore = candidateAmountScore(group);
const context = nearbyContextScore(group);
const anchor = anchorContextScore(group);
const templateScore = templatePositionScore(group);
const labelEvidence = amountLabelEvidence(group);
const referencePositionScore = referenceAmountPositionScore(group);
const directLabelEvidence = directAmountLabelEvidence(group);
const reconstructedLabelEvidence = reconstructedAmountLabelEvidence(group);
return {
...group,
amountCandidateScore:
baseScore +
context.score +
anchor.score +
templateScore +
labelEvidence.score +
referencePositionScore +
directLabelEvidence.score,
context,
anchor,
templateScore,
labelEvidence,
referencePositionScore,
directLabelEvidence,
reconstructedLabelEvidence,
};
});

// =====================================================
// REFERANS TUTAR ALANI = HARD GATE
// =====================================================
// Referans profili mevcutsa, genel OCR sıralamasının sayfa üzerindeki
// herhangi bir numarayı tutar seçmesine izin verme. Önce referansın
// beklenen tutar bölgesine düşen adayları ve/veya gerçek tutar etiketini
// taşıyan adayları ayır. Böylece MÜŞTERİ NO / SORGU NO / İŞLEM REF gibi
// rakamlar, sırf OCR puanı yüksek diye tutarın önüne geçemez.
let candidatePool = allRankedCandidates;
let selectionMethod = "legacy-scoring";

if (referenceAmountField) {
  if (labelDerivedCandidates.length) {
    candidatePool = labelDerivedCandidates;
    selectionMethod = "same-region-strong-amount-label";
  } else {
  const referenceMatched = allRankedCandidates.filter((item) =>
    Number(item.referencePositionScore || 0) >= 180
  );
  const directLabelMatched = allRankedCandidates.filter((item) =>
    Number(item.directLabelEvidence?.score || 0) >= 150
  );
  const reconstructedLabelMatched = allRankedCandidates.filter((item) =>
    Number(item.reconstructedLabelEvidence?.score || 0) >= 220
  );
  const labelMatched = allRankedCandidates.filter((item) =>
    Number(item.labelEvidence?.score || 0) >= 150
  );

  // En güçlü seçim: referans ROI + gerçek dekontta açık tutar etiketi.
  const bothMatched = referenceMatched.filter((item) =>
    Number(item.directLabelEvidence?.score || 0) >= 150 ||
    Number(item.reconstructedLabelEvidence?.score || 0) >= 220
  );

  if (bothMatched.length) {
    candidatePool = bothMatched;
    selectionMethod = "reference-roi-and-direct-label";
  } else if (referenceMatched.length) {
    candidatePool = referenceMatched;
    selectionMethod = "reference-roi";
  } else if (reconstructedLabelMatched.length) {
    // OCR etiketi parçaladıysa bile "GİDEN FAST TUTARI" yeniden kurulur.
    candidatePool = reconstructedLabelMatched;
    selectionMethod = "reconstructed-amount-label";
  } else if (directLabelMatched.length) {
    candidatePool = directLabelMatched;
    selectionMethod = "direct-amount-label-roi";
  } else if (labelMatched.length) {
    candidatePool = labelMatched;
    selectionMethod = "amount-label";
  } else {
    // KRİTİK: Referans mevcutken referansla ilgisiz bir sayıya FALLBACK YOK.
    // Aksi halde müşteri no / sorgu no tekrar tutar seçilebilir.
    candidatePool = [];
    selectionMethod = "reference-unmatched";
  }
  }
}

const rankedCandidates = candidatePool.sort((a, b) => {
if (b.amountCandidateScore !== a.amountCandidateScore) return b.amountCandidateScore - a.amountCandidateScore;
if ((b.referencePositionScore || 0) !== (a.referencePositionScore || 0)) return (b.referencePositionScore || 0) - (a.referencePositionScore || 0);
if ((b.labelEvidence?.score || 0) !== (a.labelEvidence?.score || 0)) return (b.labelEvidence?.score || 0) - (a.labelEvidence?.score || 0);
if ((b.signal || 0) !== (a.signal || 0)) return (b.signal || 0) - (a.signal || 0);
if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
const ay = Number(a.region?.y1) || 0;
const by = Number(b.region?.y1) || 0;
if (ay !== by) return ay - by;
const ax = Number(a.region?.x1) || 0;
const bx = Number(b.region?.x1) || 0;
if (ax !== bx) return ax - bx;
return String(a.text).localeCompare(String(b.text));
});

const candidate = rankedCandidates[0];

if (!candidate) {
  console.warn(
    "REFERENCE GUIDED AMOUNT: GÜVENİLİR TUTAR ADAYI BULUNAMADI",
    JSON.stringify({
      referenceAmountField: referenceAmountField ? {
        xNorm: referenceAmountField.xNorm,
        yNorm: referenceAmountField.yNorm,
        widthNorm: referenceAmountField.widthNorm,
        heightNorm: referenceAmountField.heightNorm,
        pageNumber: referenceAmountField.pageNumber,
        referenceCount: referenceAmountField.referenceCount
      } : null,
      selectionMethod,
      candidateCount: allRankedCandidates.length,
    })
  );

  return {
    available: true,
    status: "unknown",
    severity: "none",
    score: 0,
    fileFingerprint: fileFingerprint || null,
    amountText: null,
    region: null,
    characterCount: 0,
    metrics: {},
    referenceGuided: Boolean(referenceAmountField),
    referenceGuidedSelection: selectionMethod,
    selectedAmountText: null,
    evidence: referenceAmountField
      ? "Referans tutar alanı mevcut ancak gerçek dekontta referans bölgesi veya açık tutar etiketiyle doğrulanmış aday bulunamadı. İlgisiz müşteri/ref numarası tutar olarak seçilmedi."
      : "Güvenilir tutar adayı bulunamadı.",
  };
}

const rawRegion = candidate.region;

console.log(
"AMOUNT CANDIDATE RANKING:",
JSON.stringify(rankedCandidates.slice(0, 10).map((item) => ({
text: item.text,
signal: item.signal,
amountCandidateScore: item.amountCandidateScore,
templateScore: item.templateScore || 0,
referencePositionScore: item.referencePositionScore || 0,
amountLabelScore: item.labelEvidence?.score || 0,
amountLabel: item.labelEvidence?.positive || [],
directAmountLabelScore: item.directLabelEvidence?.score || 0,
directAmountLabel: item.directLabelEvidence?.label || null,
reconstructedAmountLabelScore: item.reconstructedLabelEvidence?.score || 0,
reconstructedAmountLabel: item.reconstructedLabelEvidence?.label || null,
anchorContext: item.anchor?.anchors || [],
positiveContext: item.context?.positive || [],
negativeContext: [...(item.context?.negative || []), ...(item.labelEvidence?.negative || [])],
})))
);

console.log(
"REFERENCE GUIDED AMOUNT:",
JSON.stringify({
referenceAmountField: referenceAmountField ? { xNorm: referenceAmountField.xNorm, yNorm: referenceAmountField.yNorm, widthNorm: referenceAmountField.widthNorm, heightNorm: referenceAmountField.heightNorm, pageNumber: referenceAmountField.pageNumber, referenceCount: referenceAmountField.referenceCount, templateRole: referenceAmountField.templateRole || null } : null,
selectedText: candidate.text,
selectionMethod
})
);

const rawWidth = Math.max(1, Number(rawRegion.x2) - Number(rawRegion.x1));
const rawHeight = Math.max(1, Number(rawRegion.y2) - Number(rawRegion.y1));
const padX = Math.max(6, Math.round(rawWidth * 0.08));
const padYBox = Math.max(4, Math.round(rawHeight * 0.22));
const left = Math.max(0, Math.floor(rawRegion.x1 - padX));
const top = Math.max(0, Math.floor(rawRegion.y1 - padYBox));
const right = Math.min(image.width, Math.ceil(rawRegion.x2 + padX));
const bottom = Math.min(image.height, Math.ceil(rawRegion.y2 + padYBox));

const width = right - left;
const height = bottom - top;

if (width < 12 || height < 6) {
return {
available: true,
status: "unknown",
severity: "none",
score: 0,
amountText: candidate.text,
region: rawRegion,
characterCount: 0,
metrics: {},
evidence: "Tutar alanı bulundu ancak piksel analizi için yeterli çözünürlük yok.",
};
}

let crop;
try {
crop = await sharp(filePath)
.grayscale()
.extract({left, top, width, height})
.raw()
.toBuffer({resolveWithObject: true});
} catch (error) {
return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText: candidate.text,
region: rawRegion,
characterCount: 0,
metrics: {},
evidence: "Tutar alanı bulundu ancak piksel analizi yapılamadı.",
};
}

const data = crop.data;
const w = crop.info.width;
const h = crop.info.height;

// Küçük bir üst/alt kenar payını kaldır. Böylece OCR kutusunun
// etrafındaki arka plan ölçümü bozmaz.
const padY = Math.max(0, Math.floor(h * 0.08));
const yStart = padY;
const yEnd = Math.max(yStart + 1, h - padY);

const columnInk = [];
const columnDarkness = [];
const columnEdge = [];

for (let x = 0; x < w; x++) {
let ink220 = 0;
let darknessSum = 0;
let edgeSum = 0;
let count = 0;

for (let y = yStart; y < yEnd; y++) {
const idx = y * w + x;
const value = data[idx];

if (value < 220) ink220++;
if (value < 185) {
darknessSum += 255 - value;
count++;
}

if (y > yStart) {
const prev = data[(y - 1) * w + x];
edgeSum += Math.abs(value - prev);
}
}

const pixels = Math.max(1, yEnd - yStart);
columnInk.push(ink220 / pixels);
columnDarkness.push(count ? darknessSum / count : 0);
columnEdge.push(edgeSum / pixels);
}

// Karakter aralarını belirlemek için iki sinyal kullanılır.
// Tek bir koyuluk eşiğine bağlı kalmak önceki sürümdeki false-negative
// problemini azaltır.
const inkActive = columnInk.map((v) => v > 0.035);
const darkActive = columnDarkness.map((v) => v > 10);
const active = columnInk.map((v, i) => v > 0.035 || darkActive[i]);

// 1-2 piksellik kopuklukları doldur.
for (let i = 1; i < active.length - 1; i++) {
if (!active[i] && active[i - 1] && active[i + 1]) active[i] = true;
}

const segments = [];
let segStart = null;

for (let x = 0; x < active.length; x++) {
if (active[x] && segStart === null) segStart = x;

const endNow =
segStart !== null &&
(!active[x] || x === active.length - 1);

if (endNow) {
const end = active[x] ? x + 1 : x;
if (end - segStart >= 2) {
segments.push({start: segStart, end});
}
segStart = null;
}
}

// Çok dar noktaları temizle; fakat virgül/nokta gibi işaretlerin
// tamamen kaybolmasına izin verme.
const filteredSegments = segments.filter((segment) => {
const sw = segment.end - segment.start;
return sw >= 2 && sw <= Math.max(4, Math.floor(w * 0.35));
});

if (filteredSegments.length < 4) {
return {
available: true,
status: "unknown",
severity: "none",
score: 0,
amountText: candidate.text,
region: {...rawRegion, pageIndex: candidate.pageIndex},
characterCount: filteredSegments.length,
metrics: {},
evidence: "Tutar alanında güvenilir karakter karşılaştırması için yeterli ayrı karakter bölgesi bulunamadı.",
};
}

function segmentMetrics(segment) {
let inkCount220 = 0;
let inkCount200 = 0;
let inkCount160 = 0;
let darkTotal = 0;
let darkCount = 0;
let edgeTotal = 0;
let pixelCount = 0;
let minY = h;
let maxY = -1;

for (let x = segment.start; x < segment.end; x++) {
for (let y = yStart; y < yEnd; y++) {
const value = data[y * w + x];
pixelCount++;
if (value < 220) {
inkCount220++;
minY = Math.min(minY, y);
maxY = Math.max(maxY, y);
}
if (value < 200) inkCount200++;
if (value < 160) inkCount160++;
if (value < 185) {
darkTotal += 255 - value;
darkCount++;
}
if (y > yStart) {
edgeTotal += Math.abs(value - data[(y - 1) * w + x]);
}
}
}

const sw = Math.max(1, segment.end - segment.start);
const activeHeight = maxY >= minY ? maxY - minY + 1 : 0;

return {
width: sw,
height: activeHeight,
inkRatio: pixelCount ? inkCount220 / pixelCount : 0,
inkRatio200: pixelCount ? inkCount200 / pixelCount : 0,
inkRatio160: pixelCount ? inkCount160 / pixelCount : 0,
darkness: darkCount ? darkTotal / darkCount : 0,
edgeDensity: pixelCount ? edgeTotal / pixelCount : 0,
};
}

const features = filteredSegments.map(segmentMetrics);

function median(values) {
const a = values.filter(Number.isFinite).sort((x, y) => x - y);
if (!a.length) return 0;
const mid = Math.floor(a.length / 2);
return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function relativeOutlier(value, center) {
return center > 0 ? Math.abs(value - center) / center : 0;
}

const inkValues = features.map((x) => x.inkRatio);
const ink200Values = features.map((x) => x.inkRatio200);
const ink160Values = features.map((x) => x.inkRatio160);
const darknessValues = features.map((x) => x.darkness);
const edgeValues = features.map((x) => x.edgeDensity);
const widthValues = features.map((x) => x.width);
const heightValues = features.map((x) => x.height);

const medInk = median(inkValues);
const medInk200 = median(ink200Values);
const medInk160 = median(ink160Values);
const medDark = median(darknessValues);
const medEdge = median(edgeValues);
const medWidth = median(widthValues);
const medHeight = median(heightValues);

// =====================================================
// AYNI KARAKTER KARŞILAŞTIRMASI
// =====================================================
// Genel medyan karşılaştırması 1, 7 ve 0 gibi doğal olarak farklı
// glyph'leri birbirleriyle kıyasladığı için tek başına yeterli değildir.
// Özellikle aynı tutar içindeki 0-0, 1-1 gibi tekrar eden karakterleri
// ayrıca karşılaştırıyoruz. Bu, örneğin "1.700,00" içindeki son iki
// 0'ın önceki 0'lardan belirgin biçimde farklı render edilmesini yakalar.
function extractConnectedCharacterComponents(gray, width, height) {
const visited = new Uint8Array(width * height);
const components = [];
const threshold = 200;

for (let sy = 0; sy < height; sy++) {
for (let sx = 0; sx < width; sx++) {
const startIndex = sy * width + sx;
if (visited[startIndex] || gray[startIndex] >= threshold) continue;

const queueX = [sx];
const queueY = [sy];
visited[startIndex] = 1;
let qi = 0;
let minX = sx;
let maxX = sx;
let minY = sy;
let maxY = sy;
let area = 0;

while (qi < queueX.length) {
const x = queueX[qi];
const y = queueY[qi];
qi++;
area++;
minX = Math.min(minX, x);
maxX = Math.max(maxX, x);
minY = Math.min(minY, y);
maxY = Math.max(maxY, y);

for (let dy = -1; dy <= 1; dy++) {
for (let dx = -1; dx <= 1; dx++) {
if (dx === 0 && dy === 0) continue;
const nx = x + dx;
const ny = y + dy;
if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
const ni = ny * width + nx;
if (visited[ni] || gray[ni] >= threshold) continue;
visited[ni] = 1;
queueX.push(nx);
queueY.push(ny);
}
}
}

const cw = maxX - minX + 1;
const ch = maxY - minY + 1;
if (area >= 3 && cw <= Math.max(2, Math.floor(width * 0.40)) && ch >= 2) {
components.push({ minX, maxX, minY, maxY, width: cw, height: ch, area });
}
}
}

return components.sort((a, b) => a.minX - b.minX);
}

function characterComponentFeatures(component) {
const x0 = component.minX;
const y0 = component.minY;
const x1 = component.maxX + 1;
const y1 = component.maxY + 1;
const cw = Math.max(1, x1 - x0);
const ch = Math.max(1, y1 - y0);

let ink220 = 0;
let ink180 = 0;
let darkSum = 0;
let darkCount = 0;
let edgeSum = 0;
let pixels = 0;

for (let y = y0; y < y1; y++) {
for (let x = x0; x < x1; x++) {
const value = data[y * w + x];
pixels++;
if (value < 220) ink220++;
if (value < 180) ink180++;
if (value < 185) {
darkSum += 255 - value;
darkCount++;
}
if (x > x0) {
edgeSum += Math.abs(value - data[y * w + (x - 1)]);
}
if (y > y0) {
edgeSum += Math.abs(value - data[(y - 1) * w + x]);
}
}
}

return {
width: cw,
height: ch,
inkRatio: pixels ? ink220 / pixels : 0,
inkRatio180: pixels ? ink180 / pixels : 0,
darkness: darkCount ? darkSum / darkCount : 0,
edgeDensity: pixels ? edgeSum / (pixels * 2) : 0,
};
}

function relativeDifference(a, b) {
const denom = Math.max(0.0001, (Math.abs(a) + Math.abs(b)) / 2);
return Math.abs(a - b) / denom;
}

let repeatedCharacterAnalysis = {
available: false,
strongGroups: [],
maxDifference: 0,
};

try {
const normalizedAmount = cleanAmountText(candidate.text)
.replace(/(?:TL|TRY|EUR|USD|GBP|₺|€|\$|£)/gi, "")
.replace(/\s+/g, "");

const expectedCharacters = [...normalizedAmount].filter((char) => /[0-9.,]/.test(char));
const components = extractConnectedCharacterComponents(data, w, h);

// İlk karakterler soldan sağa tutar karakterlerine karşılık gelir.
// Currency metni varsa sayısal karakterlerden sonra gelir ve dışarıda bırakılır.
if (expectedCharacters.length >= 4 && components.length >= expectedCharacters.length) {
const charPairs = expectedCharacters.map((char, index) => ({
char,
component: components[index],
features: characterComponentFeatures(components[index]),
index,
}));

const groupsByChar = {};
for (const item of charPairs) {
if (!groupsByChar[item.char]) groupsByChar[item.char] = [];
groupsByChar[item.char].push(item);
}

for (const [char, items] of Object.entries(groupsByChar)) {
if (!/[0-9]/.test(char) || items.length < 2) continue;

const medianInkChar = median(items.map((x) => x.features.inkRatio));
const medianInk180Char = median(items.map((x) => x.features.inkRatio180));
const medianDarkChar = median(items.map((x) => x.features.darkness));
const medianEdgeChar = median(items.map((x) => x.features.edgeDensity));
const medianWidthChar = median(items.map((x) => x.features.width));
const medianHeightChar = median(items.map((x) => x.features.height));

for (const item of items) {
const differences = {
ink: relativeDifference(item.features.inkRatio, medianInkChar),
ink180: relativeDifference(item.features.inkRatio180, medianInk180Char),
dark: relativeDifference(item.features.darkness, medianDarkChar),
edge: relativeDifference(item.features.edgeDensity, medianEdgeChar),
width: relativeDifference(item.features.width, medianWidthChar),
height: relativeDifference(item.features.height, medianHeightChar),
};

const votes = [
differences.ink >= 0.08,
differences.ink180 >= 0.08,
differences.dark >= 0.08,
differences.edge >= 0.10,
differences.width >= 0.10,
differences.height >= 0.08,
].filter(Boolean).length;

const maxDifference = Math.max(...Object.values(differences));
repeatedCharacterAnalysis.maxDifference = Math.max(
repeatedCharacterAnalysis.maxDifference,
maxDifference
);

if (votes >= 2 && maxDifference >= 0.08) {
repeatedCharacterAnalysis.strongGroups.push({
char,
position: item.index,
votes,
differences,
features: item.features,
});
}
}
}

repeatedCharacterAnalysis.available = repeatedCharacterAnalysis.strongGroups.length > 0;
}
} catch (error) {
console.warn("AYNI KARAKTER ANALİZİ HATASI:", error?.message || error);
}

const anomalyScores = features.map((feature) => {
const inkDiff = relativeOutlier(feature.inkRatio, medInk);
const ink200Diff = relativeOutlier(feature.inkRatio200, medInk200);
const ink160Diff = relativeOutlier(feature.inkRatio160, medInk160);
const darkDiff = relativeOutlier(feature.darkness, medDark);
const edgeDiff = relativeOutlier(feature.edgeDensity, medEdge);
const widthDiff = relativeOutlier(feature.width, medWidth);
const heightDiff = relativeOutlier(feature.height, medHeight);

let votes = 0;
if (inkDiff >= 0.22) votes++;
if (ink200Diff >= 0.20) votes++;
if (ink160Diff >= 0.20) votes++;
if (darkDiff >= 0.18) votes++;
if (edgeDiff >= 0.22) votes++;
if (widthDiff >= 0.18) votes++;
if (heightDiff >= 0.12) votes++;

return {
votes,
inkDiff,
ink200Diff,
ink160Diff,
darkDiff,
edgeDiff,
widthDiff,
heightDiff,
};
});

const maxScore = Math.max(...anomalyScores.map((x) => x.votes));
const maxIndex = anomalyScores.findIndex((x) => x.votes === maxScore);
const maxAnomaly = anomalyScores[maxIndex] || null;

const maxInkDifference = Math.max(
...features.map((x) => relativeOutlier(x.inkRatio, medInk))
);
const maxStrokeProxyDifference = Math.max(
...features.map((x) => Math.max(
relativeOutlier(x.inkRatio200, medInk200),
relativeOutlier(x.inkRatio160, medInk160),
relativeOutlier(x.width, medWidth)
))
);
const maxEdgeDifference = Math.max(
...features.map((x) => relativeOutlier(x.edgeDensity, medEdge))
);
const maxDarkDifference = Math.max(
...features.map((x) => relativeOutlier(x.darkness, medDark))
);

const anomalousCount = anomalyScores.filter((x) => x.votes >= 3).length;
const anomalyRatio = features.length ? anomalousCount / features.length : 0;

// Özellikle tek bir karakterin diğerlerinden ayrılması değerlidir.
// Çok sayıda karakter aynı şekilde değişmişse bunun belge/render etkisi
// olma ihtimali daha yüksektir.
const localized =
maxScore >= 3 &&
anomalyRatio <= 0.35;

const repeatedStrong =
repeatedCharacterAnalysis.strongGroups.length >= 1;

const repeatedVeryStrong =
repeatedCharacterAnalysis.strongGroups.some((group) =>
(group.votes >= 3 &&
Math.max(
Number(group.differences.ink) || 0,
Number(group.differences.ink180) || 0,
Number(group.differences.dark) || 0
) >= 0.12)
);

let status = "pass";
let severity = "none";
let score = 0;

// Aynı rakamın (özellikle 0'ın) bir kopyası diğerlerinden belirgin
// biçimde farklıysa, genel medyan testi güçlü çıkmasa bile bunu yakala.
if (
repeatedVeryStrong ||
(
repeatedStrong &&
(
maxInkDifference >= 0.18 ||
maxStrokeProxyDifference >= 0.18 ||
maxDarkDifference >= 0.18
)
)
) {
status = "warning";
severity = "strong";
score = 85;
}
else if (
(
localized &&
maxScore >= 4 &&
(
maxInkDifference >= 0.28 ||
maxStrokeProxyDifference >= 0.28 ||
maxEdgeDifference >= 0.32 ||
maxDarkDifference >= 0.30
)
) ||
repeatedStrong
) {
status = "warning";
severity = "moderate";
score = 65;
}

const outlierFeature =
maxIndex >= 0 ? features[maxIndex] : null;

let evidence;
if (status === "warning") {
const repeatedText = repeatedCharacterAnalysis.strongGroups.length
? ` Aynı rakam tekrarları içinde ${repeatedCharacterAnalysis.strongGroups.length} lokal farklılık da tespit edildi.`
: "";
evidence =
`Tutar alanında ${features.length} karakter bölgesi karşılaştırıldı. ${maxScore} ayrı mikro-görsel özellik aynı karakter bölgesinde diğer karakterlerden ayrıştı.${repeatedText} En belirgin fark; ink/stroke yoğunluğu, kenar yapısı veya karakter geometrisinde lokalize bir tutarsızlık olarak ölçüldü. Bu bulgu tek başına sahtecilik kanıtı değildir; yeniden boyutlandırma, sıkıştırma, tarama ve render farklılıkları ayrıca dikkate alınmalıdır.`;
} else {
evidence =
`Tutar alanında ${features.length} karakter bölgesi mikro-görsel olarak karşılaştırıldı; lokal ve çoklu özelliklerle desteklenen belirgin bir karakter render anomalisi oluşmadı.`;
}

console.log(
"AMOUNT FORENSICS V3 DETAIL:",
JSON.stringify({
fileFingerprint: fileFingerprint || null,
amountText: candidate.text,
templateBank: referenceAnchor?.bank || null,
templateAmountText: null,
templatePositionScore: candidate.templateScore || 0,
characterCount: features.length,
maxScore,
maxInkDifference,
maxStrokeProxyDifference,
maxEdgeDifference,
maxDarkDifference,
anomalyRatio,
repeatedCharacterAnalysis,
outlierFeature,
})
);

const finalForensics = {
available: true,
status,
severity,
score,
fileFingerprint: fileFingerprint || null,
amountText: candidate.text,
region: {
...rawRegion,
pageIndex: candidate.pageIndex,
},
characterCount: features.length,
metrics: {
medianInkRatio: Number(medInk.toFixed(4)),
medianInkRatio200: Number(medInk200.toFixed(4)),
medianInkRatio160: Number(medInk160.toFixed(4)),
medianDarkness: Number(medDark.toFixed(2)),
medianEdgeDensity: Number(medEdge.toFixed(2)),
medianCharacterWidth: Number(medWidth.toFixed(2)),
medianCharacterHeight: Number(medHeight.toFixed(2)),
maxInkRatioDifference: Number(maxInkDifference.toFixed(3)),
maxStrokeProxyDifference: Number(maxStrokeProxyDifference.toFixed(3)),
maxEdgeDensityDifference: Number(maxEdgeDifference.toFixed(3)),
maxDarknessDifference: Number(maxDarkDifference.toFixed(3)),
localAnomalyRatio: Number(anomalyRatio.toFixed(3)),
repeatedCharacterAvailable: repeatedCharacterAnalysis.available,
repeatedCharacterMaxDifference: Number((repeatedCharacterAnalysis.maxDifference || 0).toFixed(3)),
repeatedCharacterGroups: repeatedCharacterAnalysis.strongGroups.slice(0, 8),
maxFeatureVotes: maxScore,
templateBank: referenceAnchor?.bank || null,
templateAmountText: null,
templatePositionScore: Number(candidate.templateScore || 0),
referenceGuided: Boolean(referenceAmountField),
referenceGuidedSelection: selectionMethod,
referenceAmountPositionScore: Number(candidate.referencePositionScore || 0),
amountLabelScore: Number(candidate.labelEvidence?.score || 0),
amountLabelEvidence: candidate.labelEvidence?.positive || [],
directAmountLabelScore: Number(candidate.directLabelEvidence?.score || 0),
directAmountLabel: candidate.directLabelEvidence?.label || null,
},
selectionMethod,
selectedAmountText: candidate.text,
referenceAmountText: null,
segmentFeatures: features.map((feature, index) => ({
index,
width: Number(feature.width.toFixed(2)),
height: Number(feature.height.toFixed(2)),
inkRatio: Number(feature.inkRatio.toFixed(4)),
inkRatio200: Number(feature.inkRatio200.toFixed(4)),
inkRatio160: Number(feature.inkRatio160.toFixed(4)),
darkness: Number(feature.darkness.toFixed(2)),
edgeDensity: Number(feature.edgeDensity.toFixed(2)),
votes: anomalyScores[index]?.votes || 0,
})),
evidence,
};

if (
finalForensics.status === "warning" &&
finalForensics.severity === "strong" &&
fileFingerprint
) {
amountForensicsStrongCache.set(fileFingerprint, finalForensics);
console.log("AMOUNT FORENSICS STRONG CACHED:", fileFingerprint);
}

return finalForensics;
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

IMPORTANT AMOUNT CONSISTENCY:
As part of the amountConsistency check, also verify whether
the main transaction amount matches any written statement such as
"... TL has been sent".

If the visible numeric amount and the written transaction amount
do not match, report this as a fail under amountConsistency.
Only report this when both values are actually visible and readable.
For each check:
status:
- pass = sorun görülmedi
- fail = somut bir sorun veya tutarsızlık görüldü
- unknown = güvenilir şekilde değerlendirilmedi
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

==================================================
RISK CALCULATION
==================================================

DO NOT calculate any risk score.
Do NOT calculate:
- visualRisk
- textRisk
- layoutRisk
- financialDataRisk
- editingRisk
- overallRisk

You MAY provide confidence as a 0-100 value
representing how confident you are that your
observable findings are reliable.

Confidence is NOT a risk score.

Do not use confidence to calculate any risk score.

Your job is ONLY to inspect the document and report
observable evidence.

For every check, return a deterministic finding:
- "pass" = no visible problem found
- "fail" = visible evidence of a problem exists
- "unknown" = the check cannot be reliably determined

IMPORTANT:
Do not use intuition, probability, suspicion, or guesswork.

Do not assign a numeric score.

Do not decide LOW / MODERATE / HIGH / VERY HIGH risk.
Do not compensate one finding with another.

Only report what is actually visible in the document.

If evidence is insufficient, return "unknown".


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
============================================================
TRANSACTION DATA CONSISTENCY — HIGH PRIORITY
============================================================

For EVERY document analysis, whether the uploaded document is a JPG/PNG
image or a PDF, perform a dedicated transaction-data consistency check.
This check has HIGHER PRIORITY than general visual/template observations.
Pay particular attention to these fields:

1. RECIPIENT NAME
2. RECIPIENT IBAN
3. TRANSACTION DATE AND TIME
4. TRANSACTION AMOUNT
5. WRITTEN AMOUNT / AMOUNT IN WORDS
6. TOTAL / FEE / EXPENSE INFORMATION
7. DESCRIPTION / TRANSACTION TEXT

For each field:
- Read the value directly from the analyzed document.
- Do not invent, complete, or infer unreadable values.
- If a value cannot be read reliably, use null or state that it is unreadable.
- Compare repeated occurrences of the same information within the document.
- Check whether the recipient name and recipient IBAN appear internally consistent.
- Check whether the transaction date/time is internally consistent.
- Check whether the numeric transaction amount is internally consistent.
- If an amount is written both numerically and in words, compare the two.
- Check whether fees, expenses, commissions, or additional charges mathematically
agree with the displayed total.
- Check whether the amount mentioned in the description agrees with the actual
transaction amount.
- Pay special attention to decimal separators, thousands separators, TRY/EUR/USD
notation, and possible OCR digit substitutions.
- Do not treat a formatting difference alone as evidence of fraud.
IMPORTANT AMOUNT CHECK:

If the document contains multiple monetary values, determine what each value
represents before comparing them.

Do NOT automatically assume that every monetary number is the transaction amount.

For example, distinguish between:

- main transaction amount
- fee
- commission
- expense
- total amount
- remaining balance
- previous balance
- reference number
- account number
- IBAN
- date/time
Perform arithmetic checks whenever the visible information allows it.
If:

transaction amount + fee + other applicable charges != displayed total
report the exact visible values and the mathematical discrepancy.

If a written amount and numeric amount disagree, treat this as an important
consistency finding and explicitly report both values.

RECIPIENT PRIORITY:

Recipient name and recipient IBAN are especially important.
Check whether:
- the recipient name is clearly visible,
- the recipient IBAN is clearly visible,
- the same recipient information appears consistently,
- there are suspicious inconsistencies between recipient fields,
- a recipient name appears to have been inserted or altered,
- the IBAN format contains unusual or inconsistent characters.
DATE/TIME PRIORITY:
Check:

- transaction date,
- transaction time,
- repeated date/time values,
- chronological consistency,
- unusual formatting or visible inconsistencies.
DO NOT invent a discrepancy.

Only report a discrepancy when it is supported by information actually visible
in the analyzed document.
If a field is unreadable, explicitly say that it could not be reliably verified.

------------------------------------------------------------
ANALYSIS ORDER
------------------------------------------------------------
Always analyze the actual uploaded document first.

For an image document:
- analyze the actual image,
- extract the visible transaction information,
- perform the transaction consistency checks above,
- then perform visual/template analysis.
For a PDF document:
- analyze the actual PDF,
- extract the visible transaction information from the PDF,
- perform the SAME transaction consistency checks above,
- then perform visual/template analysis.

The same transaction-consistency rules apply to BOTH image and PDF analysis.
Do not redirect image analysis to the PDF analysis path.
Do not redirect PDF analysis to the image analysis path.

When a reference document is supplied, use it only according to the existing
reference-document rules. Never copy transaction values from a reference document
into the analyzed document.
------------------------------------------------------------
RESULT EXPLANATION
------------------------------------------------------------
The final explanation should be similar to a forensic consistency summary.
Prioritize concrete findings over generic statements.
When a meaningful inconsistency is found, explain:

- WHAT was found,
- WHERE it was found,
- WHAT the expected relationship was,
- WHY the values are inconsistent,
- and, when applicable, the exact arithmetic difference.

Example style:
"The document shows a transaction amount of 3090.00 TRY, while the description
states that 3090.40 TRY was deducted. The displayed fee is 6.40 TRY, so the
amounts do not reconcile as presented. This is a financial-data inconsistency
and should increase the risk assessment."

Do not state that a document is definitely fake solely because of one
inconsistency.

Instead distinguish between:

- consistent,
- minor inconsistency,
- significant inconsistency,
- suspicious visual/data inconsistency,
- insufficient evidence.
The final summary should mention the most important transaction-data findings
before less important template/style observations.

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



JPEG VE PDF İÇİN AYNI FORMAT KULLANILACAKTIR.
DOSYA TÜRÜNE GÖRE BAŞLIK, SIRA VE YAPI DEĞİŞTİRME.
=====================================================
YORUM / SUMMARY FORMATI
=====================================================

summary alanı kullanıcıya gösterilecek ana yorumdur.

ÇOK ÖNEMLİ:

summary yalnızca gerçekten tespit edilen önemli bulguları
içermelidir.

TEMİZ / SORUNSUZ KONTROLLERİ TEK TEK YAZMA.

Örneğin:

Tutar sorunsuzsa:
"1. TUTAR KONTROLÜ: Sorun tespit edilmedi."

şeklinde ayrı ayrı yazma.

Bunun yerine yalnızca önemli bir sorun varsa belirt.

=====================================================
KULLANILACAK KONTROL SIRASI
=====================================================

Analiz mantıksal olarak aşağıdaki 5 alanı kontrol etmelidir:

1. TUTAR KONTROLÜ
2. ALICI BİLGİLERİ
3. TOPLAM / YAZILI TUTAR UYUMU
4. OYNAMA / KIRPMA / KESME KONTROLÜ
5. TARİH / SAAT KONTROLÜ

Ancak summary içerisinde yalnızca sorun veya dikkat edilmesi
gereken somut bir bulgu bulunan alanları göster.

Sorunsuz alanları tekrar tekrar yazma.

=====================================================
YORUM YAZIM KURALI
=====================================================

Eğer önemli bir sorun / tutarsızlık / görsel anormallik varsa:

summary içerisinde kısa maddeler halinde belirt.

Örnek:

"• İşlem tutarı ile yazılı tutar arasında uyumsuzluk tespit edildi.
• Alıcı IBAN'ında belge içerisindeki diğer bilgilerle tutarsızlık görüldü."

Her madde en fazla 1 kısa cümle olsun.

Gereksiz açıklama yapma.

Kare kare anlatma.

OCR sürecini anlatma.

Teknik analiz sürecini anlatma.

Model veya algoritmadan bahsetme.

=====================================================
SORUN YOKSA
=====================================================

Eğer anlamlı hiçbir tutarsızlık veya manipülasyon göstergesi
tespit edilmemişse summary yalnızca şu anlama gelen kısa bir
cümle olmalıdır:

"Belgede belirgin bir tutarsızlık veya manipülasyon göstergesi
tespit edilmedi."

Bu cümleyi gereksiz şekilde uzatma.

=====================================================
BELİRSİZ DURUMLAR
=====================================================

Bir alan okunamıyorsa veya güvenilir şekilde değerlendirilemiyorsa
bunu yalnızca gerçekten önemliyse belirt.

Örneğin:

"• Görüntü kalitesi nedeniyle alıcı IBAN'ının tamamı güvenilir
şekilde doğrulanamadı."

Belirsizliği sahtecilik olarak değerlendirme.

=====================================================
ÖNCELİK
=====================================================

Bulgu varsa öncelik sırası:

1. Tutar uyumsuzluğu
2. Yazılı tutar / rakamsal tutar uyumsuzluğu
3. Alıcı adı / IBAN uyumsuzluğu
4. Tarih / saat tutarsızlığı
5. Görsel oynama / ekleme / silme / kesme
6. Diğer önemli finansal tutarsızlıklar

Önemsiz veya normal görsel farklılıkları summary'ye yazma.

=====================================================
KANIT KURALI
=====================================================

"Şüpheli",
"uyumsuz",
"oynama var",
"değiştirilmiş",
"manipüle edilmiş"

gibi ifadeleri yalnızca gözlemlenebilir ve açıklanabilir
kanıt varsa kullan.

Tek başına:

- farklı font görünümü
- fotoğraf açısı
- JPEG sıkıştırması
- görüntü kalitesi
- tarama kalitesi
- normal karakter farklılığı

sahtecilik kanıtı değildir.

Görsel veya veri kanıtı yoksa sorun üretme.

=====================================================
SUMMARY ÇIKTI KURALI
=====================================================

summary:

- Türkçe olmalıdır.
- Kısa olmalıdır.
- Yalnızca önemli bulguları içermelidir.
- Temiz kontrolleri tek tek listelememelidir.
- En fazla 3-5 kısa madde kullanılmalıdır.
- Sorun yoksa tek kısa cümle kullanılmalıdır.
- Aynı bulguyu tekrar etmemelidir.
- Kesin "sahte" veya "gerçek" sonucu vermemelidir.
============================================================
KANIT KURALI
============================================================
"Şüpheli", "uyumsuz", "oynama var", "değiştirilmiş" veya benzeri bir sonuç
SADECE gözlemlenebilir ve açıklanabilir kanıt varsa kullanılmalıdır.
Tek başına:
- farklı font görünümü,
- fotoğraf açısı,
- JPEG sıkıştırması,
- görüntü kalitesi,
- tarama kalitesi,
- normal karakter farklılığı

sahtecilik kanıtı olarak kabul edilmemelidir.

Bir kontrol güvenilir şekilde yapılamıyorsa:
"Belirlenemedi — yeterli görsel kanıt yok."
şeklinde cevap ver.

Özellikle tutar, alıcı adı, alıcı IBAN, yazıyla belirtilen tutar,
"Hesabınızdan..." tutarı, tarih ve saat üzerinde görülen somut
uyumsuzluklara öncelik ver.

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
Belgede tüm sütunlarda giriş çıkışlarda rakamlar tutmuyorsa bunu belirt.

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
"gpt-5.6-terra",
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
console.log("KULLANILAN OPENAI MODEL:", response.model);
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

return ""

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
return ""
}

return String(value)
.toUpperCase()
.replace(/\s+/g, "")
.replace(/[^A-Z0-9]/g, "");
}

function validateIBANMod97(value) {
const iban = normalizeIBAN(value);
if (!iban) {
return {
valid: false,
reason: "IBAN okunamadı"
};
}
if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) {
return {
valid: false,
reason: "IBAN formatı geçersiz"
};
}
const rearranged = iban.slice(4) + iban.slice(0, 4);
let remainder = 0;

for (const char of rearranged) {
const value = /[A-Z]/.test(char)
? char.charCodeAt(0) - 55
: Number(char);

const digits = String(value);

for (const digit of digits) {
remainder = (remainder * 10 + Number(digit)) % 97;
}
}
return {
valid: remainder === 1,
remainder
};
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
"unknown"
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
: "mismatch"

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
"unknown"
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
: "mismatch"
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
"unknown"

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
document.recipientIban
);

if (actual) {
const ibanMod97 = validateIBANMod97(actual);
warnings.push(
`MOD-97 TEST: ${ibanMod97.valid ? "GEÇERLİ" : "GEÇERSİZ"} | Kalan: ${ibanMod97.remainder}`
);

console.log("===== IBAN MOD-97 =====");
console.log("IBAN:", actual);
console.log("MOD-97 VALID:", ibanMod97.valid);
console.log("MOD-97 REMAINDER:", ibanMod97.remainder);
console.log("========================");

if (!ibanMod97.valid) {
warnings.push(
`Dekonttaki alıcı IBAN'ı MOD-97 kontrolünden geçmedi. Kalan: ${
ibanMod97.remainder ?? "bilinmiyor"
}.`
);
}
}
matches.iban =
expected === actual
? "match"
: "mismatch"

if (
expected !== actual
) {
warnings.push(
`IBAN uyuşmuyor. Beklenen: "${provided.iban}", dekontta görülen: "${document.recipientIban}".`
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
"unknown"
warnings.push(
"Tutar kontrolü yapılamadı: gönderilen beklenen tutar okunabilir bir sayıya dönüştürülemedi."
);
}
else if (
actual === null
) {

matches.amount =
"unknown"

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
: "mismatch"

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
"document"

const statementMode =
first(
fields?.statementMode
) === "true"

const type =
statementMode
? "statement"
: rawType;
const fileName =
first(
fields?.fileName
) ||
uploadedFile.originalFilename ||
"document"

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
let mime =
uploadedFile.mimetype || ""
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

const fileFingerprint =
createHash("sha256")
.update(buffer)
.digest("hex");


console.log("FILE SHA256:", fileFingerprint);

if (
!buffer?.length
) {
throw new Error(
"Dosya boş."
);

}
// =================================================
// PDF METİN ÇIKARMA — YEREL
// =================================================

let extractedPdfText = ""
let paddleOcrText = ""
let paddleOcrConfidence = 0;
let paddleOcrAttempted = false;

if (
mime === "application/pdf" ||
path.extname(filePath).toLowerCase() === ".pdf"
) {
try {
const pdf = await pdfjsLib.getDocument({
data: new Uint8Array(buffer),
}).promise;

const pages = [];
for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
const page = await pdf.getPage(pageNumber);
const textContent = await page.getTextContent();

const pageText = textContent.items
.map(item => item.str || "")
.join(" ");
pages.push(pageText);
}

extractedPdfText = pages.join("\n");
console.log(
"PDF METİN ÇIKARILDI:",
extractedPdfText.length,
"karakter"
);

// =====================================================
// OCR FALLBACK - TARAMA PDF
// =====================================================
if (extractedPdfText.trim().length < 100) {
console.log("PDF metni yetersiz, PaddleOCR başlatılıyor...");
const paddleResult =
await runPaddleOCR(filePath);

paddleOcrAttempted = true;
if (paddleResult.text?.trim()) {
paddleOcrText =
paddleResult.text.trim();

paddleOcrConfidence =
Number(paddleResult.confidence) || 0;
extractedPdfText =
paddleOcrText;

console.log(
"PADDLEOCR OCR TAMAMLANDI:",
extractedPdfText.length,
"karakter"
);
} else {

console.log(
"PaddleOCR metin üretemedi, Tesseract OCR fallback başlatılıyor..."
);

const ocrWorker = await createWorker("tur+eng");

try {
const ocrDocument = await pdfToImg(buffer, {
scale: 2
});
const ocrPages = [];
for await (const image of ocrDocument) {
const { data } = await ocrWorker.recognize(image);
if (data.text?.trim()) {
ocrPages.push(data.text.trim());
}
}

extractedPdfText = ocrPages.join("\n");

console.log(
"TESSERACT OCR TAMAMLANDI:",
extractedPdfText.length,
"karakter"
);

await ocrDocument.destroy();
} finally {
await ocrWorker.terminate();
}
}
}

} catch (error) {
console.error(
"PDF METİN ÇIKARMA HATASI:",
error
);
}
}

// =====================================================
// PADDLEOCR FALLBACK
// =====================================================

if (
extractedPdfText.trim().length < 100
) {

console.log(
"PDF metni yetersiz, PaddleOCR başlatılıyor..."
);

const paddleResult =
await runPaddleOCR(
filePath
);

if (
paddleResult.success &&
paddleResult.text?.trim()
) {

extractedPdfText =
paddleResult.text;

console.log(
"PADDLEOCR PDF METNİ ALINDI:",
extractedPdfText.length,
"karakter"
);

console.log(
"PADDLEOCR CONFIDENCE:",
paddleResult.confidence
);

}

else {

console.log(
"PaddleOCR kullanılabilir sonuç vermedi."
);

}

}


// =================================================
// BASE64
// =================================================
const base64 =
buffer.toString(
"base64"
);
// =====================================================
// PADDLEOCR IMAGE OCR
// =====================================================

let paddleImageOCR = null;
let amountForensics = null;
let referenceTemplateAnalysis = null;
let visualForensics = null;
let layoutForensics = null;

// PDF'yi de görüntü tabanlı forensic hattına sok.
// OpenAI için orijinal PDF korunur; OCR/geometry/visual forensic için ilk sayfa
// normalize PNG olarak kullanılır.
let forensicTargetPath = filePath;
let forensicTargetMime = mime;
let forensicTargetIsTemporary = false;

if (type === "pdf") {
  try {
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
    const rendered = await renderPdfPagePng(pdf, 1, 1.6);
    if (rendered?.buffer) {
      forensicTargetPath = `/tmp/verifydoc-forensic-${fileFingerprint}.png`;
      await fs.writeFile(forensicTargetPath, rendered.buffer);
      forensicTargetMime = "image/png";
      forensicTargetIsTemporary = true;
      console.log("PDF FORENSIC RASTER HAZIR:", forensicTargetPath);
    } else {
      console.warn("PDF FORENSIC RASTER OLUŞTURULAMADI");
    }
  } catch (error) {
    console.warn("PDF FORENSIC RASTER HATASI:", error?.message || error);
  }
}

if (
  (type === "image" || type === "pdf" || type === "statement") &&
  forensicTargetPath
) {

console.log(
"PADDLEOCR IMAGE ANALİZİ BAŞLIYOR..."
);

paddleImageOCR =
await runPaddleOCR(
forensicTargetPath
);

if (
paddleImageOCR.success
) {

console.log(
"PADDLEOCR IMAGE OCR BAŞARILI"
);

console.log(
"PADDLEOCR IMAGE CONFIDENCE:",
paddleImageOCR.confidence
);

amountForensics =
await analyzeAmountForensics(
filePath,
paddleImageOCR,
fileFingerprint,
bank
);

console.log(
"AMOUNT FORENSICS:",
JSON.stringify(amountForensics)
);

}

}

// =====================================================
// REFERANS DEKONTU ÖNCE YÜKLE
// =====================================================
// reference değişkeni, referans şablon kalibrasyonu kullanılmadan
// ÖNCE tanımlanmalı. Aksi halde JavaScript TDZ nedeniyle:
// ReferenceError: Cannot access 'reference' before initialization
// hatası oluşur.
let reference = null;

if (type !== "video" && type !== "statement") {
  reference = await loadReferenceFile(bank);
}

console.log("BANK:", bank || "YOK");
console.log("REFERENCE:", reference?.fileName || "YOK");

// =====================================================
// REFERANS ŞABLON KALİBRASYONU
// =====================================================
if (
  (type === "image" || type === "pdf") &&
  bank &&
  reference &&
  paddleImageOCR?.success
) {
  try {
    referenceTemplateAnalysis = await analyzeReferenceTemplateAgainstDocument(
      forensicTargetPath,
      forensicTargetMime,
      bank,
      paddleImageOCR
    );
    console.log("REFERENCE TEMPLATE ANALYSIS (SAFE):", JSON.stringify(referenceTemplateAnalysis));
  } catch (error) {
    console.warn("REFERENCE TEMPLATE ANALYSIS HATASI:", error?.message || error);
  }
}

// =====================================================
// GÖRSEL FORENSICS — BÜTÜN SAYFA REFERANS KARŞILAŞTIRMASI
// =====================================================
if ((type === "image" || type === "pdf") && bank && reference && paddleImageOCR?.success) {
  try {
    const trustedReferencePaths = await getReferenceFiles(bank);
    visualForensics = await runVisualForensics({
      targetPath: forensicTargetPath,
      referencePaths: trustedReferencePaths,
      bank,
      tempDir: "/tmp",
    });
    console.log("VISUAL FORENSICS:", JSON.stringify(visualForensics));
  } catch (error) {
    console.warn("VISUAL FORENSICS HATASI:", error?.message || error);
  }
}

// =====================================================
// YAPISAL KUTU / ÇİZGİ GEOMETRİSİ FORENSICS
// =====================================================
if ((type === "image" || type === "pdf") && bank && reference) {
  try {
    layoutForensics = await runReferenceLayoutForensics(forensicTargetPath, bank);
    console.log("REFERENCE LAYOUT FORENSICS:", JSON.stringify(layoutForensics));
  } catch (error) {
    console.warn("REFERENCE LAYOUT FORENSICS HATASI:", error?.message || error);
  }
}

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
"image/png"

}

else if (
extension === ".webp"
) {

mime =
"image/webp"

}

else if (
extension === ".jpg" ||
extension === ".jpeg"
) {

mime =
"image/jpeg"
}

else {

mime =
"image/jpeg"

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
"application/pdf"
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
"video/mp4"

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


// -------------------------------------------------
// OPENAI INPUT
// -------------------------------------------------

const imageDataUrl =
`data:${mime};base64,${base64}`;

let content;


// =================================================
// IMAGE / JPEG
// =================================================

if (
type === "image"
) {

content = [

// =================================================
// SADECE JPEG ANALİZ TALİMATI
// =================================================

{
type:
"input_text",

text: `${PROMPT}

=====================================================
PADDLEOCR EK OCR SONUCU
=====================================================

PaddleOCR tarafından ayrıca çıkarılmış OCR metni
aşağıdadır.

Bu metin yalnızca OCR yardımcı verisidir.

ASLINDA GÖRÜNEN BELGE HER ZAMAN ÖNCELİKLİDİR.

PaddleOCR metni görüntüyle çelişirse görüntüyü esas al.

OCR tarafından tahmin edilmiş veya yanlış okunmuş
değerleri belge üzerinde gerçekmiş gibi kullanma.

PaddleOCR OCR metni:

${paddleImageOCR?.text || "PaddleOCR sonucu alınamadı."}

PaddleOCR confidence:

${paddleImageOCR?.confidence ?? 0}


=====================================================
JPG / JPEG — ANALİZ EDİLECEK ASIL BELGE
=====================================================

ÇOK ÖNEMLİ:
Bu analizde ASIL ANALİZ EDİLECEK BELGE,
aşağıda gönderilen input_image olarak verilen
JPG / JPEG dosyasıdır.
TÜM GERÇEK DEKONT BİLGİLERİNİ YALNIZCA
JPG / JPEG GÖRÜNTÜSÜNDEN ÇIKAR.

JPG / JPEG üzerinde gerçekten görünmeyen hiçbir
bilgiyi yazma.
JPG / JPEG üzerinde bir bilgi okunamıyorsa:
null kullan.
=====================================================
REFERANS PDF — SADECE GÖRSEL / ŞABLON REFERANSI
=====================================================

Aşağıda ayrıca bir banka referans PDF'i verilebilir.

REFERANS PDF:

SADECE şu amaçlarla kullanılabilir:

- belge şablonu
- sayfa düzeni
- alanların konumu
- banka logosu
- başlık yapısı
- tipografi
- font görünümü
- font boyutu
- karakter aralıkları
- satır aralıkları
- hizalama
- tarih biçiminin görsel yapısı
- tutar biçiminin görsel yapısı
- IBAN alanının görsel yapısı
- gönderen/alıcı alanlarının görsel yerleşimi
- genel görsel yapı
- belge üzerindeki olası düzenleme izlerinin karşılaştırılması

=====================================================
KESİN KURAL — VERİ AKTARMA YASAK
=====================================================

REFERANS PDF'DEKİ HİÇBİR GERÇEK İŞLEM BİLGİSİNİ
JPG / JPEG'E AKTARMA.

Özellikle REFERANS PDF'den:

- isim
- soyisim
- gönderen adı
- alıcı adı
- IBAN
- hesap numarası
- tutar
- para birimi
- tarih
- saat
- işlem numarası
- referans numarası
- açıklama
- vergi numarası
- müşteri numarası
- diğer herhangi bir rakam veya metin
ALMA.
JPG / JPEG'DE YOKSA BU BİLGİLERİ
REFERANS PDF'DEN TAMAMLAMA.

JPG / JPEG'DEKİ BİR ALAN REFERANS PDF'DEKİ
DEĞERDEN FARKLIYSA REFERANS PDF'Yİ DOĞRU
KABUL ETME.

GERÇEK DEĞER HER ZAMAN JPG / JPEG ÜZERİNDE
GERÇEKTEN GÖRÜLEN DEĞERDİR.

JPG / JPEG'DE OKUNAMAYAN BİR DEĞER İÇİN
TAHMİN YAPMA VE REFERANS PDF'DEN DEĞER
KOPYALAMA.
=====================================================
DOCUMENT DATA
=====================================================

Aşağıdaki alanları YALNIZCA JPG / JPEG
görüntüsünden çıkar:

documentData.senderName
documentData.recipientName
documentData.amount
documentData.currency
documentData.iban

Kurallar:

- Yalnızca JPG / JPEG üzerinde gerçekten görülen bilgileri yaz.
- Güvenilir şekilde okunamıyorsa null kullan.
- IBAN'ı mümkünse standart biçimde yaz.
- amount alanına yalnızca JPG / JPEG üzerinde görülen
ana işlem tutarını yaz.
- IBAN, hesap numarası, işlem numarası,
referans numarası veya tarih gibi rakamları
amount olarak kullanma.
- Gönderen ve alıcıyı JPG / JPEG üzerindeki
alan etiketlerine göre ayırt et.
- Açıklama alanındaki isimleri gönderen/alıcı
yerine kullanma.
- REFERANS PDF'dEKİ DEĞERLERİ documentData'YA
KOPYALAMA.
- JPG / JPEG'de yoksa null döndür.

=====================================================
ANALİZ SIRASI
=====================================================
1. Önce JPG / JPEG görüntüsünü baştan sona analiz et.
2. JPG / JPEG'de görülen tüm bilgileri belirle.
3. documentData alanlarını yalnızca JPG / JPEG'den doldur.
4. Daha sonra referans PDF'yi yalnızca görsel/şablon
karşılaştırması için kullan.
5. Referans PDF'deki gerçek işlem bilgilerini
analiz edilen JPG / JPEG'in bilgileri olarak kullanma.

Dosya adı:
${fileName}`,
},
// =================================================
// ASIL ANALİZ EDİLECEK JPEG
// =================================================

{
type:
"input_image",

image_url:
imageDataUrl,
detail:
"high",
},

// =================================================
// REFERANS PDF BINARY GONDERILMEZ
// Terra yalnızca gerçek hedef belgeyi görür.
// Referanslar backend tarafında OCR/şablon/forensic
// istatistikleri olarak kullanılabilir; ham referans
// dosyası modele verilmez.
// =================================================

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
// =================================================
// PROMPT
// =================================================
{
type: "input_text",

text: `${PROMPT}`
},


// =================================================
// GERÇEK DEKONT
// =================================================
{
type: "input_text",
text: `
==================================================
GERÇEK DEKONT — ANALİZ EDİLECEK DOSYA
==================================================

Aşağıdaki PDF, kullanıcının yüklediği GERÇEK DEKONT'tur.

ÇIKARILACAK GERÇEK DEĞERLER YALNIZCA BU PDF'DEN
ALINMALIDIR.
Gönderen adı, alıcı adı, IBAN, tutar, tarih, işlem numarası
ve diğer belge değerlerini bu PDF üzerinde göründüğü
şekilde belirle.
REFERANS PDF'deki hiçbir değer gerçek dekontun değeri
olarak kullanılmamalıdır.

Dosya adı:
${fileName}
`
},
{
type: "input_file",
filename: fileName,
file_data: pdfDataUrl,
},

// =================================================
// REFERANS BANKA ŞABLONU — HAM PDF MODELE GONDERILMEZ
// =================================================
// Referans bilgileri backend tarafında çıkarılır ve
// yalnızca türetilmiş, değer-izole edilmiş şablon bilgisi
// daha sonraki context katmanından kullanılabilir.


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
// =====================================================
// DETERMINISTIK VIDEO RISK MOTORU
// =====================================================

const videoRisk =
calculateOverallRisk(
videoResult
);

// =====================================================
// AI RISK SKORU KULLANILMAZ
// =====================================================

videoResult.overallRisk =
videoRisk.overallRisk;

videoResult.riskLabel =
videoRisk.riskLabel;

videoResult.categories =
videoRisk.categories;

// =====================================================
// FINAL VIDEO SCORE
// =====================================================
const videoScore =
Number(
videoResult?.overallRisk
) || 0;

const videoSuspicious =
videoScore >= 46;

const videoEvidence =
videoResult?.summary ||
"Video analizi tamamlandı."


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
// PADDLEOCR CONTEXT
// -------------------------------------------------

// PaddleOCR sonucu, OpenAI'nin belge görüntüsü/PDF'si ile birlikte
// yalnızca yardımcı OCR metni olarak verilir.
// Gerçek görsel/PDF her zaman ana kaynaktır.
if (
(type === "image" || type === "pdf") &&
process.env.PADDLEOCR_ACCESS_TOKEN &&
!paddleOcrAttempted
) {

const paddleResult =
await runPaddleOCR(filePath);
paddleOcrAttempted = true;

if (!amountForensics) {
amountForensics =
await analyzeAmountForensics(
filePath,
paddleResult,
fileFingerprint,
bank
);
}

if (paddleResult.text?.trim()) {

paddleOcrText =
paddleResult.text.trim();
paddleOcrConfidence =
Number(paddleResult.confidence) || 0;

content.unshift({
type:
"input_text",
text: `
=====================================================
PADDLEOCR YARDIMCI OCR SONUCU
=====================================================

Bu metin PaddleOCR tarafından gerçek yüklenen dosyadan
çıkarılmış yardımcı OCR sonucudur.
OCR güven skoru: ${paddleOcrConfidence}/100
ÇOK ÖNEMLİ:

Bu metni tek başına gerçek belge kabul etme.
Ana kaynak her zaman aşağıdaki gerçek JPG/PDF dosyasıdır.

PaddleOCR'da okunamayan veya belirsiz görünen bilgileri
ana belge görüntüsünden doğrula.

Referans PDF'den hiçbir bilgi aktarma.

OCR METNİ:
${paddleOcrText}

=====================================================
`,
});

console.log(
"PADDLEOCR CONTEXT OPENAI'YE EKLENDİ"
);

}
}
// -------------------------------------------------
// DETERMINISTIK TUTAR FORENSICS CONTEXT
// -------------------------------------------------
if (
amountForensics
) {

content.unshift({
type:
"input_text",
text: `
=====================================================
DETERMINISTIK TUTAR FORENSICS SONUCU
=====================================================

Bu sonuç backend tarafından görüntü pikselleri ve
PaddleOCR bounding-box verisi kullanılarak oluşturulmuştur.

Durum: ${amountForensics.status}
Şiddet: ${amountForensics.severity}
Dosya SHA256: ${amountForensics.fileFingerprint || "unknown"}
OCR tutar alanı: ${amountForensics.amountText || "unknown"}
Karakter segment sayısı: ${amountForensics.characterCount || 0}

Metrikler:
${JSON.stringify(amountForensics.metrics || {})}

Kanıt:
${amountForensics.evidence || "Yok"}

ÖNEMLİ:
Bu sinyal tek başına sahtecilik kanıtı değildir.
JPEG sıkıştırması, yeniden boyutlandırma, tarama ve
render farklılıkları da lokal koyuluk/stroke farkı oluşturabilir.
Bu sonucu görsel belgeyle birlikte değerlendir.
=====================================================
`,
});
}

// -------------------------------------------------
// REFERANS ŞABLON PROFİLİ CONTEXT
// -------------------------------------------------
if (referenceTemplateAnalysis) {
  content.unshift({
    type: "input_text",
    text: `
=====================================================
DETERMINISTIK REFERANS ŞABLON KALİBRASYONU
=====================================================

Bu veri, banka referans PDF'sinden çıkarılan ŞABLON bilgisidir.
Referans PDF'deki gerçek işlem değerleri kullanılmaz ve gerçek dekonta aktarılmaz.

Referans alan sayısı: ${referenceTemplateAnalysis.referenceFieldCount}
REFERANS DEĞERLERİ: GİZLENDİ — yalnızca koordinat/geometri/stil kullanılır.
Eşleşen alan sayısı: ${referenceTemplateAnalysis.matchedFieldCount}
Belirgin geometri farkı: ${referenceTemplateAnalysis.strongGeometryCount}
Belirgin render/font yoğunluğu farkı: ${referenceTemplateAnalysis.strongStyleCount}

Alanlar:
${JSON.stringify(referenceTemplateAnalysis.fields || [], null, 2)}

ÖZELLİKLE GÖNDEREN/ALICI ADRES ALANLARINI KONTROL ET.
Referansın konumu, alan ölçüsü ve render yoğunluğu gerçek dekonttaki karşılığıyla birlikte değerlendirilsin.

Konum veya font/render farkı tek başına sahtecilik kanıtı değildir; başka bağımsız bulgularla birlikte değerlendirilmelidir.
=====================================================
`,
  });
}

// -------------------------------------------------
// YAPISAL GEOMETRİ FORENSICS CONTEXT
// -------------------------------------------------
if (layoutForensics?.available) {
  content.unshift({
    type: "input_text",
    text: `
=====================================================
DETERMINISTIK YAPISAL GEOMETRİ FORENSICS
=====================================================

Referans dekontun gerçek işlem değerleri kullanılmaz.
Bu bölüm yalnızca çizgi/kutu yerleşimi geometrisini karşılaştırır.

${JSON.stringify({
  bank: layoutForensics.bank,
  referenceLineCount: layoutForensics.referenceLineCount,
  targetLineCount: layoutForensics.targetLineCount,
  topBox: layoutForensics.topBox,
  lowerBox: layoutForensics.lowerBox,
  score: layoutForensics.score,
  severity: layoutForensics.severity,
  evidence: layoutForensics.evidence
}, null, 2)}

Bu bulguyu layoutIntegrity ve editingRisk değerlendirmesinde dikkate al;
ancak tek başına sahtecilik kanıtı olarak kabul etme.
=====================================================
`,
  });
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
"gpt-5.6-terra",

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

console.log("KULLANILAN OPENAI MODEL:", response.model);
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

// Deterministik yapısal geometri sinyali AI çıktısından bağımsızdır.
if (layoutForensics?.available && result?.checks) {
  result.checks.layoutIntegrity = layoutForensics.check;
}

function preserveAmount(value) {
if (value === null || value === undefined) {
return null;
}

const text = String(value).trim();

if (!text) {
return null;
}

// Tutarı değiştirme:
// - sondaki sıfırları koru
// - nokta/virgülü koru
// - yuvarlama yapma
return text;
}

if (result?.documentData) {
result.documentData.amount =
preserveAmount(result.documentData.amount);

// Referans + güçlü tutar etiketi birlikte doğrulanmışsa AI'ın seçtiği
// başka bir sayının tekrar tutar olarak kullanılmasına izin verme.
// Eksi işareti dekontta çıkış yönünü gösterir; documentData.amount
// tutarın büyüklüğünü korur.
if (
  ["reference-roi-and-direct-label", "direct-amount-label-roi", "reference-roi", "reference-position-and-label", "reference-position", "reference-nearest", "amount-label", "reconstructed-amount-label"].includes(amountForensics?.selectionMethod) &&
  amountForensics?.selectedAmountText
) {
  const selected = String(amountForensics.selectedAmountText)
    .trim()
    .replace(/^[+]+/, "")
    .replace(/[)]+$/, "")
    .trim();
  if (selected) {
    result.documentData.amount = selected;
    console.log("REFERENCE GUIDED DOCUMENT AMOUNT:", selected);
  }
}
}

if (visualForensics) {
  result.visualForensics = visualForensics;
}
if (layoutForensics) {
  result.layoutForensics = layoutForensics;
}

if (amountForensics) {
result.amountForensics = amountForensics;
}

// =====================================================
// DETERMINISTIK RİSK MOTORU
// =====================================================
const calculatedRisk =
calculateOverallRisk(
result
);

// Güçlü karakter-düzeyi tutar anomalisi varsa risk motoruna
// deterministik bir üst sınır uygula. Orta seviye sinyal
// tek başına skoru değiştirmez.
if (
amountForensics?.status === "warning" &&
amountForensics?.severity === "strong" &&
result?.checks?.amountConsistency
) {

result.checks.amountConsistency.status =
"fail";

result.checks.amountConsistency.score =
Math.max(
Number(result.checks.amountConsistency.score) || 0,
85
);

result.checks.amountConsistency.evidence =
[
result.checks.amountConsistency.evidence,
amountForensics.evidence,
]
.filter(Boolean)
.join(" ");
}

// Görsel forensics güçlü bir sapma bulduğunda, tek başına değil,
// referans alan eşleşmeleri/missing alanlar gibi bağımsız yapı sinyalleriyle birlikte
// nihai risk için bir alt sınır uygulanır.
if (visualForensics?.available && visualForensics?.severity === "strong") {
  const structuralSupport =
    Number(referenceTemplateAnalysis?.strongGeometryCount || 0) > 0 ||
    Number(referenceTemplateAnalysis?.missingFieldCount || 0) > 0;
  if (structuralSupport) {
    result.summary = [result.summary, visualForensics.evidence].filter(Boolean).join(" ");
  }
}

// Yapısal geometri çok güçlü biçimde referanstan sapıyorsa, yalnızca AI'ın
// düşük skor vermesine izin verme. Bu hâlâ adli bir sinyaldir; kesin sahtecilik
// hükmü değildir.
if (layoutForensics?.available && layoutForensics.severity === "strong") {
  // Layout sinyali artık kendi sayısal skoru üzerinden risk motoruna girer;
  // tek başına sabit 70 tabanı uygulanmaz.
  result.summary = [result.summary, layoutForensics.evidence].filter(Boolean).join(" ");
}

// FINAL RISK IS NOW INDEPENDENT FROM AI-GENERATED CHECK SCORES.
// GPT may still provide explanations/documentData, but it cannot change the
// numerical risk result.
result.deterministicRisk = calculateDeterministicForensicRisk(result, {
  visualForensics,
  layoutForensics,
  amountForensics,
  paddleImageOCR,
  referenceTemplateAnalysis,
});
console.log("DETERMINISTIC FORENSIC RISK:", JSON.stringify(result.deterministicRisk));

// Risk motorunu amount forensics değişikliğinden sonra tekrar hesapla.
const deterministicRiskAfterForensics =
calculateOverallRisk(
result
);

// IMPORTANT: İlk calculateOverallRisk çağrısının skorunu koruma.
// O çağrı, amount/layout forensics sonradan check'leri güncellemeden önce
// yapılır ve AI'ın eski bir check skorunu nihai skora taşıyabilir.
// Nihai skor yalnızca güncellenmiş deterministik check setinden hesaplanmalı.
calculatedRisk.overallRisk =
Number(deterministicRiskAfterForensics.overallRisk) || 0;

calculatedRisk.categories =
deterministicRiskAfterForensics.categories;

console.log("FINAL RISK RECOMPUTED FROM UPDATED CHECKS:", JSON.stringify({
  overallRisk: calculatedRisk.overallRisk,
  categories: calculatedRisk.categories
}));

// ==========================================
// KRİTİK TUTAR TUTARSIZLIĞI
// ==========================================

const amountAnalysis = result?.amountAnalysis;

const totalAmount = Number(
amountAnalysis?.totalAmount
);

const calculatedTotal = Number(
amountAnalysis?.calculatedTotal
);

const amountDifference =
Number.isFinite(totalAmount) &&
Number.isFinite(calculatedTotal)
? Math.abs(totalAmount - calculatedTotal)
: Number(amountAnalysis?.difference);

const hasMajorAmountMismatch =
Number.isFinite(amountDifference) &&
Math.abs(amountDifference) >= 100;
const hasSevereAmountMismatch =
Number.isFinite(amountDifference) &&
Math.abs(amountDifference) >= 1000;

// Mevcut JavaScript risk motorunun sonucunu temel al
let finalRiskScore =
Number(calculatedRisk.overallRisk) || 0;

if (visualForensics?.available && visualForensics?.severity === "strong") {
  const structuralSupport =
    Number(referenceTemplateAnalysis?.strongGeometryCount || 0) > 0 ||
    Number(referenceTemplateAnalysis?.missingFieldCount || 0) > 0;
  if (structuralSupport) finalRiskScore = Math.max(finalRiskScore, 70);
}
if (layoutForensics?.available && layoutForensics.severity === "strong") {
  finalRiskScore = Math.max(finalRiskScore, 70);
}
// KRİTİK: amountAnalysis tek başına nihai risk tabanı oluşturmaz.
// Bu alan AI tarafından çıkarılmış toplam/hesaplanan tutar verisidir;
// tek başına 60/85 puan zorlamak, kullanıcı arayüzünde "tutar tutarsızlığı"
// yok denirken HIGH RISK üretmesine neden olabilir.
// Tutar farkı yalnızca güvenilir bir check üzerinden risk motoruna girer.
if (hasMajorAmountMismatch || hasSevereAmountMismatch) {
  console.log("AMOUNT DIFFERENCE OBSERVED (NO DIRECT RISK FLOOR):", JSON.stringify({
    difference: amountDifference,
    major: hasMajorAmountMismatch,
    severe: hasSevereAmountMismatch,
    note: "amountAnalysis farkı tek başına nihai skoru 60/85'e zorlamıyor."
  }));
}

// FINAL SKORU SADECE GÜNCEL CHECK'LERDEN TÜRET.
// Eski/AI skorunun veya amountAnalysis'in gizli katkısı olamaz.
const finalDeterministicRisk = calculateOverallRisk(result);
finalRiskScore = Number(finalDeterministicRisk.overallRisk) || 0;
result.categories = finalDeterministicRisk.categories;
console.log("FINAL RISK CONSISTENCY:", JSON.stringify({
  overallRisk: finalRiskScore,
  categories: result.categories,
  source: "updated deterministic checks only"
}));

// 0-100 arasında tut
finalRiskScore = Math.round(
Math.max(
0,
Math.min(100, finalRiskScore)
)
);
let finalRiskLabel;

if (finalRiskScore >= 85) {
finalRiskLabel = "VERY HIGH RISK"
} else if (finalRiskScore >= 60) {
finalRiskLabel = "HIGH RISK"
} else if (finalRiskScore >= 46) {
finalRiskLabel = "MODERATE RISK"
} else {
finalRiskLabel = "LOW RISK"
}
result.overallRisk =
finalRiskScore;
result.riskLabel =
finalRiskLabel;

result.categories =
finalDeterministicRisk.categories;

// AI'ın overallRisk değerini kullanma.
// Nihai skor JavaScript risk motorundan gelir.


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
"Analiz tamamlandı."

console.log(
"FINAL SCORE:",
finalScore
);
console.log("FINAL RISK SOURCE: deterministic checks only; amountAnalysis direct floor disabled");


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


console.log("ENSEMBLE FORENSICS ACTIVE: all same-bank references + PDF raster + tolerant layout scoring");
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
