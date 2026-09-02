import OpenAI from "openai"
import formidable from "formidable"
import fs from "fs/promises"
import path from "path"
import { execFile } from "child_process"
import { promisify } from "util"
import ffmpegPath from "ffmpeg-static"
import sharp from "sharp"
import { createWorker } from "tesseract.js"
import { Model, PaddleOCRClient } from "@paddleocr/api-sdk"
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs"
import { createRequire } from "module"
import { pathToFileURL } from "url"
import {
createCanvas,
ImageData,
} from "@napi-rs/canvas"

const require = createRequire(import.meta.url);

let pdfjsWorker;
try {
const workerPath = require.resolve("pdfjs-dist/build/pdf.worker.mjs");
pdfjsWorker = pathToFileURL(workerPath).toString();
} catch (e) {
pdfjsWorker = null;
}

if (pdfjsWorker) {
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
}

const execFileAsync = promisify(execFile);

const client = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

const MODEL = "gpt-5.6-terra";

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
"image/jpeg",
"image/png",
"image/webp",
];

const ALLOWED_DOCUMENT_TYPES = [
"application/pdf",
"image/jpeg",
"image/png",
"image/webp",
];

const VIDEO_TYPES = [
"video/mp4",
"video/quicktime",
"video/x-matroska",
"video/webm",
];

const CHECK_SCHEMA = {
type: "object",
additionalProperties: false,
properties: {
status: {
type: "string",
enum: ["pass", "fail", "unknown"],
},
score: {
type: "number",
},
evidence: {
type: "array",
items: {
type: "string",
},
},
},
required: ["status", "score", "evidence"],
};

const RESPONSE_SCHEMA = {
type: "object",
additionalProperties: false,
properties: {
documentType: {
type: "string",
},

bank: {
type: "string",
},

documentData: {
type: "object",
additionalProperties: false,
properties: {
senderName: {
type: "string",
},
senderIBAN: {
type: "string",
},
receiverName: {
type: "string",
},
receiverIBAN: {
type: "string",
},
amount: {
type: "string",
},
currency: {
type: "string",
},
date: {
type: "string",
},
time: {
type: "string",
},
transactionId: {
type: "string",
},
referenceNo: {
type: "string",
},
description: {
type: "string",
},
},
required: [
"senderName",
"senderIBAN",
"receiverName",
"receiverIBAN",
"amount",
"currency",
"date",
"time",
"transactionId",
"referenceNo",
"description",
],
},

checks: {
type: "object",
additionalProperties: false,
properties: {
amountConsistency: CHECK_SCHEMA,
ibanConsistency: CHECK_SCHEMA,
dateConsistency: CHECK_SCHEMA,
transactionIdConsistency: CHECK_SCHEMA,
layoutConsistency: CHECK_SCHEMA,
typographyConsistency: CHECK_SCHEMA,
metadataConsistency: CHECK_SCHEMA,
pdfStructureConsistency: CHECK_SCHEMA,
ocrConsistency: CHECK_SCHEMA,
imageManipulation: CHECK_SCHEMA,
templateConsistency: CHECK_SCHEMA,
writtenAmountConsistency: CHECK_SCHEMA,
transactionLogic: CHECK_SCHEMA,
},
required: [
"amountConsistency",
"ibanConsistency",
"dateConsistency",
"transactionIdConsistency",
"layoutConsistency",
"typographyConsistency",
"metadataConsistency",
"pdfStructureConsistency",
"ocrConsistency",
"imageManipulation",
"templateConsistency",
"writtenAmountConsistency",
"transactionLogic",
],
},

amountAnalysis: {
type: "object",
additionalProperties: false,
properties: {
numericAmount: {
type: "string",
},
formattedAmount: {
type: "string",
},
suspiciousFormatting: {
type: "boolean",
},
evidence: {
type: "array",
items: {
type: "string",
},
},
},
required: [
"numericAmount",
"formattedAmount",
"suspiciousFormatting",
"evidence",
],
},

findings: {
type: "array",
items: {
type: "object",
additionalProperties: false,
properties: {
severity: {
type: "string",
},
category: {
type: "string",
},
description: {
type: "string",
},
evidence: {
type: "string",
},
},
required: [
"severity",
"category",
"description",
"evidence",
],
},
},

overallRisk: {
type: "number",
},

summary: {
type: "string",
},
},
required: [
"documentType",
"bank",
"documentData",
"checks",
"amountAnalysis",
"findings",
"overallRisk",
"summary",
],
};

const REFERENCE_MAP = {
akbank: {
name: "Akbank",
aliases: ["akbank", "akbank t.a.ş."],
},

enpara: {
name: "Enpara",
aliases: ["enpara", "enpara.com"],
},

vakifbank: {
name: "VakıfBank",
aliases: ["vakıfbank", "vakifbank", "türkiye vakıflar bankası"],
},

isbankasi: {
name: "İş Bankası",
aliases: ["iş bankası", "is bankasi", "türkiye iş bankası"],
},

ziraat: {
name: "Ziraat Bankası",
aliases: ["ziraat", "ziraat bankası", "t.c. ziraat bankası"],
},

denizbank: {
name: "DenizBank",
aliases: ["denizbank", "deniz bank"],
},

halkbank: {
name: "Halkbank",
aliases: ["halkbank", "türkiye halk bankası"],
},

yapikredi: {
name: "Yapı Kredi",
aliases: ["yapı kredi", "yapi kredi", "yapı ve kredi bankası"],
},

garanti: {
name: "Garanti BBVA",
aliases: [
"garanti",
"garanti bbva",
"garanti bankası",
"türkiye garanti bankası",
],
},
};

function normalizeText(value) {
return String(value ?? "")
.normalize("NFKC")
.replace(/\s+/g, " ")
.trim();
}

function normalizeIBAN(value) {
return String(value ?? "")
.toUpperCase()
.replace(/[^A-Z0-9]/g, "");
}

function normalizeAmount(value) {
return String(value ?? "")
.replace(/\s/g, "")
.replace(/₺/g, "")
.replace(/TL/gi, "")
.trim();
}

function parseAmount(value) {
if (value === null || value === undefined) {
return null;
}

let s = String(value)
.trim()
.replace(/[^\d,.-]/g, "");

if (!s) {
return null;
}

const commaCount = (s.match(/,/g) || []).length;
const dotCount = (s.match(/\./g) || []).length;

if (commaCount > 0 && dotCount > 0) {
if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
s = s.replace(/\./g, "").replace(",", ".");
} else {
s = s.replace(/,/g, "");
}
} else if (commaCount > 0) {
if (/,\d{1,2}$/.test(s)) {
s = s.replace(",", ".");
} else {
s = s.replace(/,/g, "");
}
} else if (dotCount > 0) {
if (!/\.\d{1,2}$/.test(s)) {
s = s.replace(/\./g, "");
}
}

const number = Number(s);

return Number.isFinite(number) ? number : null;
}

function amountsEqual(a, b, tolerance = 0.01) {
const aa = parseAmount(a);
const bb = parseAmount(b);

if (aa === null || bb === null) {
return false;
}

return Math.abs(aa - bb) <= tolerance;
}

function validateIBANMod97(iban) {
const normalized = normalizeIBAN(iban);

if (!normalized) {
return {
valid: false,
reason: "IBAN boş",
};
}

if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(normalized)) {
return {
valid: false,
reason: "IBAN formatı geçersiz",
};
}

const rearranged =
normalized.slice(4) +
normalized.slice(0, 4);

let numeric = "";

for (const char of rearranged) {
if (/[A-Z]/.test(char)) {
numeric += String(char.charCodeAt(0) - 55);
} else {
numeric += char;
}
}

let remainder = 0;

for (const digit of numeric) {
remainder =
(remainder * 10 + Number(digit)) % 97;
}

return {
valid: remainder === 1,
reason:
remainder === 1
? "IBAN checksum geçerli"
: "IBAN checksum geçersiz",
};
}

function compareProvidedInfoWithDocument(
providedInfo,
documentData
) {
const comparison = {
available: false,
amount: {
available: false,
matches: null,
provided: null,
document: null,
difference: null,
},
senderIBAN: {
available: false,
matches: null,
},
receiverIBAN: {
available: false,
matches: null,
},
};

if (!providedInfo || !documentData) {
return comparison;
}

if (
providedInfo.amount !== undefined &&
providedInfo.amount !== null &&
String(providedInfo.amount).trim() !== ""
) {
comparison.available = true;
comparison.amount.available = true;
comparison.amount.provided =
String(providedInfo.amount);
comparison.amount.document =
String(documentData.amount ?? "");

const providedAmount =
parseAmount(providedInfo.amount);
const documentAmount =
parseAmount(documentData.amount);

if (
providedAmount !== null &&
documentAmount !== null
) {
comparison.amount.difference =
Math.abs(
providedAmount - documentAmount
);

comparison.amount.matches =
comparison.amount.difference <= 0.01;
}
}

if (
providedInfo.senderIBAN &&
documentData.senderIBAN
) {
comparison.available = true;
comparison.senderIBAN.available = true;

comparison.senderIBAN.matches =
normalizeIBAN(providedInfo.senderIBAN) ===
normalizeIBAN(documentData.senderIBAN);
}

if (
providedInfo.receiverIBAN &&
documentData.receiverIBAN
) {
comparison.available = true;
comparison.receiverIBAN.available = true;

comparison.receiverIBAN.matches =
normalizeIBAN(providedInfo.receiverIBAN) ===
normalizeIBAN(documentData.receiverIBAN);
}

return comparison;
}

function getRiskLabel(score) {
if (score <= 20) {
return "Düşük Risk";
}

if (score <= 45) {
return "Orta Risk";
}

if (score <= 70) {
return "Yüksek Risk";
}

return "Çok Yüksek Risk";
}

function clampScore(value) {
const score = Number(value);

if (!Number.isFinite(score)) {
return 0;
}

return Math.max(0, Math.min(100, score));
}

function safeString(value) {
if (value === null || value === undefined) {
return "";
}

return String(value);
}

function cleanOCRText(text) {
return String(text ?? "")
.replace(/\r/g, "\n")
.replace(/[ \t]+/g, " ")
.replace(/\n{3,}/g, "\n\n")
.trim();
}

function isMoneyLikeText(text) {
const value = normalizeText(text);

if (!value) {
return false;
}

return (
/(?:₺|TL|TRY)\s*\d/.test(value) ||
/\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})/.test(
value
) ||
/^\d+(?:[.,]\d{1,2})?$/.test(value)
);
}

function normalizeBox(box) {
if (!Array.isArray(box)) {
return null;
}

if (
box.length >= 4 &&
typeof box[0] === "number" &&
typeof box[1] === "number" &&
typeof box[2] === "number" &&
typeof box[3] === "number"
) {
const x1 = Number(box[0]);
const y1 = Number(box[1]);
const x2 = Number(box[2]);
const y2 = Number(box[3]);

return {
x1: Math.min(x1, x2),
y1: Math.min(y1, y2),
x2: Math.max(x1, x2),
y2: Math.max(y1, y2),
};
}

if (
box.length >= 4 &&
Array.isArray(box[0]) &&
Array.isArray(box[1])
) {
const points = box
.filter(
(point) =>
Array.isArray(point) &&
point.length >= 2
)
.map((point) => [
Number(point[0]),
Number(point[1]),
])
.filter(
(point) =>
Number.isFinite(point[0]) &&
Number.isFinite(point[1])
);

if (!points.length) {
return null;
}

const xs = points.map((point) => point[0]);
const ys = points.map((point) => point[1]);

return {
x1: Math.min(...xs),
y1: Math.min(...ys),
x2: Math.max(...xs),
y2: Math.max(...ys),
};
}

return null;
}

function cropRegionForImage(
imageWidth,
imageHeight,
region
) {
if (!region) {
return null;
}

const x1 = Math.max(
0,
Math.floor(region.x1)
);
const y1 = Math.max(
0,
Math.floor(region.y1)
);
const x2 = Math.min(
imageWidth,
Math.ceil(region.x2)
);
const y2 = Math.min(
imageHeight,
Math.ceil(region.y2)
);

if (
x2 <= x1 ||
y2 <= y1
) {
return null;
}

return {
left: x1,
top: y1,
width: x2 - x1,
height: y2 - y1,
};
}

async function runOCR(
filePath,
language = "eng"
) {
let worker;

try {
worker =
await createWorker(language);

const result =
await worker.recognize(filePath);

return {
text:
result?.data?.text || "",
confidence:
Number(
result?.data?.confidence
) || 0,
success: true,
};
} catch (error) {
console.error(
"Tesseract OCR error:",
error
);

return {
text: "",
confidence: 0,
success: false,
error:
error?.message ||
String(error),
};
} finally {
if (worker) {
try {
await worker.terminate();
} catch {}
}
}
}

let paddleClient = null;

function getPaddleClient() {
if (paddleClient) {
return paddleClient;
}

try {
paddleClient =
new PaddleOCRClient({
apiKey:
process.env.PADDLEOCR_API_KEY,
});

return paddleClient;
} catch (error) {
console.error(
"PaddleOCR client init error:",
error
);

return null;
}
}

async function runPaddleOCR(
filePath,
options = {}
) {
const client =
getPaddleClient();

if (!client) {
return {
text: "",
confidence: 0,
success: false,
pages: 0,
regions: [],
};
}

try {
const model =
options.model ||
"PaddleOCR-VL-1.5";

const input = {
model,
file: filePath,
};

const result =
await client.ocr.predict(input);

const pages =
Array.isArray(result?.pages)
? result.pages
: [];

const allText = [];
const allScores = [];
const allRegions = [];

for (
let pageIndex = 0;
pageIndex < pages.length;
pageIndex++
) {
const page =
pages[pageIndex];

const pruned =
page?.pruned_result ||
page?.result ||
page;

const texts =
Array.isArray(
pruned?.rec_texts
)
? pruned.rec_texts
: [];

const scores =
Array.isArray(
pruned?.rec_scores
)
? pruned.rec_scores
: [];

const boxes =
Array.isArray(
pruned?.rec_boxes
)
? pruned.rec_boxes
: [];

const polys =
Array.isArray(
pruned?.rec_polys
)
? pruned.rec_polys
: [];

for (
let textIndex = 0;
textIndex < texts.length;
textIndex++
) {
const text =
String(
texts[textIndex] ?? ""
).trim();

if (text) {
allText.push(text);
}

const score =
Number(
scores[textIndex]
) || 0;

if (
Number.isFinite(score) &&
score > 0
) {
allScores.push(score);
}

const rawRegion =
boxes[textIndex] ||
polys[textIndex];

const region =
normalizeBox(
rawRegion
);

if (region) {
allRegions.push({
pageIndex,
text,
score,
region,
});
}
}
}

const text =
cleanOCRText(
allText.join("\n")
);

const confidence =
allScores.length
? allScores.reduce(
(sum, value) =>
sum + value,
0
) / allScores.length
: 0;

return {
text,
confidence,
success: true,
pages: pages.length,
regions: allRegions,
raw: result,
};
} catch (error) {
console.error(
"PaddleOCR error:",
error
);

return {
text: "",
confidence: 0,
success: false,
pages: 0,
regions: [],
error:
error?.message ||
String(error),
};
}
}

async function extractPaddleOCRText(
filePath
) {
const result =
await runPaddleOCR(
filePath
);

return result?.text || "";
}

async function analyzeAmountForensics(
filePath,
ocrResult
) {
if (
!ocrResult?.success ||
!Array.isArray(
ocrResult.regions
) ||
!ocrResult.regions.length
) {
return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText: "",
region: null,
characterCount: 0,
metrics: {
medianDarkness: null,
maxLocalDarknessDifference:
null,
localAnomalyRatio: null,
},
evidence: [
"Amount forensics için OCR bölge bilgisi bulunamadı.",
],
};
}

const candidates =
ocrResult.regions
.filter(
(item) =>
item?.text &&
isMoneyLikeText(
item.text
) &&
item?.region
)
.sort(
(a, b) =>
String(b.text).length -
String(a.text).length
);

if (!candidates.length) {
return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText: "",
region: null,
characterCount: 0,
metrics: {
medianDarkness: null,
maxLocalDarknessDifference:
null,
localAnomalyRatio: null,
},
evidence: [
"OCR sonucunda analiz edilebilir para tutarı bölgesi bulunamadı.",
],
};
}

const selected =
candidates[0];

try {
const metadata =
await sharp(filePath)
.metadata();

const width =
Number(metadata.width) || 0;
const height =
Number(metadata.height) || 0;

if (!width || !height) {
throw new Error(
"Görüntü boyutları alınamadı."
);
}

const crop =
cropRegionForImage(
width,
height,
selected.region
);

if (!crop) {
throw new Error(
"Amount OCR bölgesi geçersiz."
);
}

const paddingX =
Math.max(
4,
Math.round(
crop.width * 0.08
)
);

const paddingY =
Math.max(
4,
Math.round(
crop.height * 0.15
)
);

const left =
Math.max(
0,
crop.left - paddingX
);

const top =
Math.max(
0,
crop.top - paddingY
);

const right =
Math.min(
width,
crop.left +
crop.width +
paddingX
);

const bottom =
Math.min(
height,
crop.top +
crop.height +
paddingY
);

const finalWidth =
Math.max(
1,
right - left
);

const finalHeight =
Math.max(
1,
bottom - top
);

const { data, info } =
await sharp(filePath)
.extract({
left,
top,
width: finalWidth,
height: finalHeight,
})
.grayscale()
.raw()
.toBuffer({
resolveWithObject: true,
});

const columns =
new Array(info.width)
.fill(0);

for (
let x = 0;
x < info.width;
x++
) {
let darkness = 0;

for (
let y = 0;
y < info.height;
y++
) {
const pixel =
data[
y * info.width + x
];

darkness +=
255 - pixel;
}

columns[x] =
darkness /
(info.height * 255);
}

const activeColumns =
columns.map(
(value) =>
value >= 0.08
);

const segments = [];

let start = -1;

for (
let x = 0;
x < activeColumns.length;
x++
) {
if (
activeColumns[x] &&
start === -1
) {
start = x;
}

const isLast =
x ===
activeColumns.length - 1;

if (
start !== -1 &&
(!activeColumns[x] ||
isLast)
) {
const end =
activeColumns[x] &&
isLast
? x
: x - 1;

if (
end - start + 1 >= 1
) {
segments.push({
start,
end,
});
}

start = -1;
}
}

const filteredSegments =
segments.filter(
(segment) =>
segment.end -
segment.start +
1 >= 1
);

const segmentDarkness =
filteredSegments.map(
(segment) => {
let total = 0;
let count = 0;

for (
let x =
segment.start;
x <= segment.end;
x++
) {
total +=
columns[x];
count++;
}

return count
? total / count
: 0;
}
);

const sorted =
[...segmentDarkness].sort(
(a, b) => a - b
);

const median =
sorted.length
? sorted[
Math.floor(
sorted.length / 2
)
]
: 0;

const deviations =
segmentDarkness.map(
(value) =>
Math.abs(
value - median
)
);

const maxDeviation =
deviations.length
? Math.max(
...deviations
)
: 0;

const relativeDifference =
median > 0
? maxDeviation /
median
: 0;

const anomalyCount =
deviations.filter(
(value) =>
value >= 0.18
).length;

const anomalyRatio =
segmentDarkness.length
? anomalyCount /
segmentDarkness.length
: 0;

let status = "pass";
let severity = "none";
let score = 0;

if (
segmentDarkness.length >= 4 &&
maxDeviation >= 0.24 &&
relativeDifference >= 0.22 &&
anomalyRatio <= 0.5
) {
status = "warning";
severity = "strong";
score = 85;
} else if (
segmentDarkness.length >= 4 &&
maxDeviation >= 0.18 &&
relativeDifference >= 0.18 &&
anomalyRatio <= 0.35
) {
status = "warning";
severity = "moderate";
score = 65;
}

const evidence =
status === "warning"
? [
`Tutar bölgesinde karakter seviyesinde lokal yoğunluk farkı tespit edildi: maksimum sapma ${maxDeviation.toFixed(
3
)}, göreli fark ${relativeDifference.toFixed(
3
)}.`,
`Analiz edilen karakter-benzeri segment sayısı: ${segmentDarkness.length}; lokal anomali oranı: ${anomalyRatio.toFixed(
3
)}.`,
"Bu bulgu tek başına sahtecilik kanıtı değildir; görüntü sıkıştırması, tarama veya yeniden boyutlandırma da benzer farklar oluşturabilir.",
]
: [
"Tutar bölgesinde karakter seviyesinde belirgin bir lokal yoğunluk anomalisi tespit edilmedi.",
];

return {
available: true,
status,
severity,
score,
amountText:
String(
selected.text
),
region: {
pageIndex:
selected.pageIndex,
x1:
selected.region.x1,
y1:
selected.region.y1,
x2:
selected.region.x2,
y2:
selected.region.y2,
},
characterCount:
segmentDarkness.length,
metrics: {
medianDarkness:
Number(
median.toFixed(4)
),
maxLocalDarknessDifference:
Number(
maxDeviation.toFixed(
4
)
),
localAnomalyRatio:
Number(
anomalyRatio.toFixed(
4
)
),
},
evidence,
};
} catch (error) {
console.error(
"Amount forensics error:",
error
);

return {
available: false,
status: "unknown",
severity: "none",
score: 0,
amountText:
String(
selected.text
),
region:
selected.region,
characterCount: 0,
metrics: {
medianDarkness: null,
maxLocalDarknessDifference:
null,
localAnomalyRatio: null,
},
evidence: [
`Amount forensics çalıştırılamadı: ${
error?.message ||
String(error)
}`,
],
};
}
}

function preserveAmount(
value
) {
if (
value === null ||
value === undefined
) {
return "";
}

return String(value)
.replace(/\s+/g, " ")
.trim();
}

function parseAIResponse(
raw
) {
if (
raw &&
typeof raw === "object"
) {
return raw;
}

const text =
String(raw ?? "")
.trim();

if (!text) {
throw new Error(
"OpenAI boş yanıt döndürdü."
);
}

try {
return JSON.parse(text);
} catch {
const fenced =
text
.replace(
/^```json\s*/i,
""
)
.replace(
/^```\s*/i,
""
)
.replace(
/\s*```$/i,
""
)
.trim();

try {
return JSON.parse(
fenced
);
} catch {
throw new Error(
"OpenAI yanıtı geçerli JSON değil."
);
}
}
}
async function renderPdfPages(
filePath,
outputDir,
maxPages = 5
) {
await fs.mkdir(
outputDir,
{ recursive: true }
);

const data =
await fs.readFile(filePath);

const loadingTask =
pdfjsLib.getDocument({
data,
useWorkerFetch: false,
isEvalSupported: false,
});

const pdf =
await loadingTask.promise;

const pages = [];

const totalPages =
Math.min(
pdf.numPages,
maxPages
);

for (
let pageNumber = 1;
pageNumber <= totalPages;
pageNumber++
) {
const page =
await pdf.getPage(
pageNumber
);

const viewport =
page.getViewport({
scale: 2,
});

const canvas =
createCanvas(
Math.ceil(
viewport.width
),
Math.ceil(
viewport.height
)
);

const context =
canvas.getContext("2d");

const renderContext = {
canvasContext:
context,
viewport,
};

await page.render(
renderContext
).promise;

const outputPath =
path.join(
outputDir,
`page-${pageNumber}.png`
);

await fs.writeFile(
outputPath,
canvas.toBuffer(
"image/png"
)
);

pages.push({
pageNumber,
path: outputPath,
width:
Math.ceil(
viewport.width
),
height:
Math.ceil(
viewport.height
),
});
}

return {
pages,
totalPages:
pdf.numPages,
};
}

async function extractPdfText(
filePath
) {
try {
const data =
await fs.readFile(
filePath
);

const loadingTask =
pdfjsLib.getDocument({
data,
useWorkerFetch: false,
isEvalSupported: false,
});

const pdf =
await loadingTask.promise;

const pageTexts = [];

for (
let pageNumber = 1;
pageNumber <=
pdf.numPages;
pageNumber++
) {
const page =
await pdf.getPage(
pageNumber
);

const content =
await page.getTextContent();

const text =
content.items
.map(
(item) =>
item?.str || ""
)
.join(" ");

pageTexts.push(
text
);
}

return cleanOCRText(
pageTexts.join("\n")
);
} catch (error) {
console.error(
"PDF text extraction error:",
error
);

return "";
}
}

function detectBank(
text
) {
const normalized =
normalizeText(
text
).toLowerCase();

for (
const [key, reference]
of Object.entries(
REFERENCE_MAP
)
) {
if (
reference.aliases.some(
(alias) =>
normalized.includes(
alias.toLowerCase()
)
)
) {
return {
key,
name:
reference.name,
};
}
}

return {
key: "unknown",
name: "Bilinmiyor",
};
}

function extractCurrency(
text
) {
const value =
normalizeText(text);

if (
/₺|TL|TRY/i.test(value)
) {
return "TRY";
}

if (
/€|EUR/i.test(value)
) {
return "EUR";
}

if (
/\$|USD/i.test(value)
) {
return "USD";
}

if (
/£|GBP/i.test(value)
) {
return "GBP";
}

return "";
}

function extractIBANs(
text
) {
const normalized =
normalizeText(text)
.toUpperCase()
.replace(
/[^A-Z0-9 ]/g,
" "
);

const matches =
normalized.match(
/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g
) || [];

return [
...new Set(
matches.map(
normalizeIBAN
)
),
];
}

function validateExtractedIBANs(
text
) {
const ibans =
extractIBANs(
text
);

return ibans.map(
(iban) => ({
iban,
...validateIBANMod97(
iban
),
})
);
}

function extractMoneyCandidates(
text
) {
const value =
normalizeText(text);

const candidates =
value.match(
/(?:₺|TL|TRY)?\s*\d{1,3}(?:[.\s]\d{3})*(?:,\d{1,2})?(?:\s*(?:₺|TL|TRY))?/gi
) || [];

return candidates
.map(
(item) =>
item.trim()
)
.filter(
(item) =>
parseAmount(
item
) !== null
);
}

function chooseLikelyAmount(
text
) {
const candidates =
extractMoneyCandidates(
text
);

if (!candidates.length) {
return "";
}

const currency =
extractCurrency(
text
);

const withCurrency =
candidates.filter(
(item) =>
currency === "TRY"
? /₺|TL|TRY/i.test(
item
)
: true
);

if (
withCurrency.length
) {
return withCurrency[
withCurrency.length - 1
];
}

return candidates[
candidates.length - 1
];
}

function normalizeName(
value
) {
return normalizeText(
value
)
.toLocaleUpperCase(
"tr-TR"
)
.replace(
/[^A-ZÇĞİÖŞÜ0-9 ]/gi,
" "
)
.replace(
/\s+/g,
" "
)
.trim();
}

function namesLikelyMatch(
a,
b
) {
const aa =
normalizeName(a);
const bb =
normalizeName(b);

if (!aa || !bb) {
return null;
}

if (aa === bb) {
return true;
}

if (
aa.includes(bb) ||
bb.includes(aa)
) {
return true;
}

return false;
}

function ibansLikelyMatch(
a,
b
) {
const aa =
normalizeIBAN(a);
const bb =
normalizeIBAN(b);

if (!aa || !bb) {
return null;
}

return aa === bb;
}

function amountDifference(
a,
b
) {
const aa =
parseAmount(a);
const bb =
parseAmount(b);

if (
aa === null ||
bb === null
) {
return null;
}

return Math.abs(
aa - bb
);
}

function buildProvidedInfoContext(
providedInfo,
documentData
) {
if (
!providedInfo
) {
return "";
}

const comparison =
compareProvidedInfoWithDocument(
providedInfo,
documentData
);

return `
KULLANICI TARAFINDAN SAĞLANAN BİLGİLER:
${JSON.stringify(
providedInfo,
null,
2
)}

BELGEDEN ÇIKARILAN BİLGİLER:
${JSON.stringify(
documentData || {},
null,
2
)}

SAĞLANAN BİLGİ / BELGE KARŞILAŞTIRMASI:
${JSON.stringify(
comparison,
null,
2
)}

ÖNEMLİ:
- Sağlanan bilgi belge üzerinde açıkça görünen bilgiyle uyuşmuyorsa bunu bulgu olarak değerlendir.
- Ancak yalnızca sağlanan bilginin belge üzerinde bulunmaması, belgenin sahte olduğunu tek başına kanıtlamaz.
- Tutar karşılaştırmasında 0.01 TRY'ye kadar farkı eşleşme kabul et.
`;
}

function buildAmountForensicsContext(
amountForensics
) {
if (
!amountForensics?.available
) {
return "";
}

return `
DETERMİNİSTİK TUTAR FORENSICS ANALİZİ:
${JSON.stringify(
amountForensics,
null,
2
)}

Bu analiz OCR'ın bulduğu tutar bölgesindeki karakter-benzeri segmentlerin
görsel yoğunluklarını karşılaştırır.

Yorumlama:
- status=pass: belirgin lokal yoğunluk anomalisi tespit edilmedi.
- status=warning/moderate: lokal görsel tutarsızlık bulundu; tek başına sahtecilik kanıtı değildir.
- status=warning/strong: daha güçlü lokal tutarsızlık bulundu; diğer bulgularla birlikte değerlendirilmelidir.
- JPEG sıkıştırması, ekran görüntüsü, yeniden boyutlandırma, tarama ve farklı render süreçleri de lokal yoğunluk farkı oluşturabilir.
- Belgenin gerçek içeriği ve görünen görüntüsü her zaman esas alınmalıdır.
`;
}

function getFileExtension(
filePath
) {
return path
.extname(filePath)
.toLowerCase();
}

function isPdfFile(
mimeType,
filePath
) {
return (
mimeType ===
"application/pdf" ||
getFileExtension(
filePath
) === ".pdf"
);
}

function isImageFile(
mimeType,
filePath
) {
const extension =
getFileExtension(
filePath
);

return (
ALLOWED_IMAGE_TYPES.includes(
mimeType
) ||
[
".jpg",
".jpeg",
".png",
".webp",
].includes(
extension
)
);
}

function isVideoFile(
mimeType,
filePath
) {
const extension =
getFileExtension(
filePath
);

return (
VIDEO_TYPES.includes(
mimeType
) ||
[
".mp4",
".mov",
".mkv",
".webm",
].includes(
extension
)
);
}

async function getImageMetadata(
filePath
) {
try {
return await sharp(
filePath
).metadata();
} catch (error) {
console.error(
"Image metadata error:",
error
);

return null;
}
}

async function normalizeImage(
filePath,
outputPath
) {
await sharp(
filePath
)
.rotate()
.png()
.toFile(
outputPath
);

return outputPath;
}

async function extractVideoFrames(
filePath,
outputDir,
maxFrames = 4
) {
await fs.mkdir(
outputDir,
{
recursive: true,
}
);

const outputPattern =
path.join(
outputDir,
"frame-%02d.jpg"
);

try {
await execFileAsync(
ffmpegPath,
[
"-y",
"-i",
filePath,
"-vf",
"fps=1,scale=1280:-2",
"-frames:v",
String(maxFrames),
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

return files
.filter(
(file) =>
/^frame-\d+\.jpg$/i.test(
file
)
)
.sort()
.map(
(file) =>
path.join(
outputDir,
file
)
);
} catch (error) {
console.error(
"Video frame extraction error:",
error
);

return [];
}
}

async function cleanupFiles(
filePaths
) {
for (
const filePath of filePaths
) {
try {
await fs.rm(
filePath,
{
recursive: true,
force: true,
}
);
} catch {}
}
}

function ensureArray(
value
) {
return Array.isArray(
value
)
? value
: [];
}

function ensureObject(
value
) {
return value &&
typeof value === "object"
? value
: {};
}

function safeJson(
value
) {
try {
return JSON.stringify(
value,
null,
2
);
} catch {
return "{}";
}
}

function buildOCRContext(
paddleResult,
tesseractResult,
pdfText = ""
) {
return `
PADDLEOCR METNİ:
${safeString(
paddleResult?.text
)}

PADDLEOCR CONFIDENCE:
${Number(
paddleResult?.confidence ||
0
).toFixed(4)}

TESSERACT METNİ:
${safeString(
tesseractResult?.text
)}

TESSERACT CONFIDENCE:
${Number(
tesseractResult?.confidence ||
0
).toFixed(2)}

PDF NATIVE TEXT:
${safeString(
pdfText
)}

OCR BİLGİSİ YORUMLAMA:
- OCR metni yalnızca yardımcı kanıttır.
- Görsel belge üzerinde açıkça görünen bilgi önceliklidir.
- OCR motorlarının farklı okuması tek başına sahtecilik kanıtı değildir.
- Aynı alan farklı OCR motorlarında tutarlı biçimde okunuyorsa bu destekleyici kanıttır.
- OCR ile görüntü arasında anlamlı ve tekrarlanabilir bir fark varsa bunu bulgu olarak değerlendir.
`;
}

function buildTemplateContext(
bank,
text
) {
return `
BANKA / ŞABLON BAĞLAMI:
${safeString(
bank?.name
)}

BELGE METNİ:
${safeString(
text
)}

Şablon değerlendirmesinde:
- banka adı,
- başlık,
- alan sırası,
- tipografi,
- hizalama,
- boşluklar,
- tutar konumu,
- IBAN biçimi,
- tarih/saat biçimi,
- işlem numarası biçimi
birlikte değerlendirilmelidir.

Banka şablonunda farklılık görülmesi tek başına sahtecilik kanıtı değildir;
resmî uygulama sürümleri, kanal farkları ve ekran görüntüsü/reformatlama da farklılık oluşturabilir.
`;
}

function buildTransactionLogicContext(
documentData
) {
const amount =
parseAmount(
documentData?.amount
);

const currency =
safeString(
documentData?.currency
);

const senderIBAN =
safeString(
documentData?.senderIBAN
);

const receiverIBAN =
safeString(
documentData?.receiverIBAN
);

const senderValidation =
validateIBANMod97(
senderIBAN
);

const receiverValidation =
validateIBANMod97(
receiverIBAN
);

return `
İŞLEM MANTIĞI / MATEMATİKSEL KONTROLLER:

Belgedeki tutar:
${safeString(
documentData?.amount
)}

Sayısal tutar:
${amount === null ? "unknown" : amount}

Para birimi:
${currency}

Gönderen IBAN:
${senderIBAN}

Gönderen IBAN doğrulaması:
${safeJson(
senderValidation
)}

Alıcı IBAN:
${receiverIBAN}

Alıcı IBAN doğrulaması:
${safeJson(
receiverValidation
)}

IBAN checksum geçersizse bunu yüksek öncelikli teknik tutarsızlık olarak değerlendir.
Ancak OCR hatası ihtimalini de göz önünde bulundur.
`;
}

function normalizeCheck(
check
) {
const value =
ensureObject(check);

const status =
["pass", "fail", "unknown"].includes(
value.status
)
? value.status
: "unknown";

const score =
clampScore(
value.score
);

const evidence =
ensureArray(
value.evidence
).map(
(item) =>
safeString(
item
)
);

return {
status,
score,
evidence,
};
}

function normalizeChecks(
checks
) {
const source =
ensureObject(
checks
);

const result = {};

for (
const key of Object.keys(
RESPONSE_SCHEMA
.properties
.checks
.properties
)
) {
result[key] =
normalizeCheck(
source[key]
);
}

return result;
}

function normalizeFindings(
findings
) {
return ensureArray(
findings
).map(
(finding) => {
const item =
ensureObject(
finding
);

return {
severity:
safeString(
item.severity
),
category:
safeString(
item.category
),
description:
safeString(
item.description
),
evidence:
safeString(
item.evidence
),
};
}
);
}

function normalizeDocumentData(
documentData
) {
const source =
ensureObject(
documentData
);

return {
senderName:
safeString(
source.senderName
),
senderIBAN:
safeString(
source.senderIBAN
),
receiverName:
safeString(
source.receiverName
),
receiverIBAN:
safeString(
source.receiverIBAN
),
amount:
preserveAmount(
source.amount
),
currency:
safeString(
source.currency
),
date:
safeString(
source.date
),
time:
safeString(
source.time
),
transactionId:
safeString(
source.transactionId
),
referenceNo:
safeString(
source.referenceNo
),
description:
safeString(
source.description
),
};
}

function normalizeAmountAnalysis(
amountAnalysis
) {
const source =
ensureObject(
amountAnalysis
);

return {
numericAmount:
safeString(
source.numericAmount
),
formattedAmount:
preserveAmount(
source.formattedAmount
),
suspiciousFormatting:
Boolean(
source.suspiciousFormatting
),
evidence:
ensureArray(
source.evidence
).map(
safeString
),
};
}

function normalizeAIResult(
result
) {
const source =
ensureObject(
result
);

return {
documentType:
safeString(
source.documentType
),
bank:
safeString(
source.bank
),
documentData:
normalizeDocumentData(
source.documentData
),
checks:
normalizeChecks(
source.checks
),
amountAnalysis:
normalizeAmountAnalysis(
source.amountAnalysis
),
findings:
normalizeFindings(
source.findings
),
overallRisk:
clampScore(
source.overallRisk
),
summary:
safeString(
source.summary
),
};
}
function calculateRiskFromChecks(
checks
) {
const normalized =
normalizeChecks(
checks
);

let total = 0;
let count = 0;

for (
const check of Object.values(
normalized
)
) {
if (
check.status === "fail"
) {
total += 100;
count++;
} else if (
check.status === "pass"
) {
total += 0;
count++;
}
}

if (!count) {
return 0;
}

return clampScore(
total / count
);
}

function applyDeterministicRiskRules(
result,
comparison,
amountForensics
) {
const checks =
result.checks ||
{};

/*
* Kullanıcı tarafından verilen tutar ile
* belgede görünen tutar arasında fark varsa
* bu farkı deterministic kanıt olarak sakla.
*/
if (
comparison?.amount?.available &&
comparison.amount.matches === false
) {
const difference =
Number(
comparison.amount.difference
);

const amountCheck =
normalizeCheck(
checks.amountConsistency
);

amountCheck.status =
"fail";

/*
* Büyük tutar farklarını daha güçlü
* işaretle.
*/
if (
Number.isFinite(
difference
)
) {
if (
difference >= 1000
) {
amountCheck.score =
Math.max(
amountCheck.score,
85
);
} else if (
difference >= 100
) {
amountCheck.score =
Math.max(
amountCheck.score,
60
);
} else {
amountCheck.score =
Math.max(
amountCheck.score,
40
);
}
}

amountCheck.evidence.push(
`Sağlanan tutar ile belgede görünen tutar uyuşmuyor. Sağlanan: ${safeString(
comparison.amount.provided
)}, belge: ${safeString(
comparison.amount.document
)}, fark: ${Number.isFinite(
difference
)
? difference.toFixed(2)
: "unknown"}.`
);

checks.amountConsistency =
amountCheck;
}

/*
* IBAN karşılaştırmaları.
*/
if (
comparison?.senderIBAN?.available &&
comparison.senderIBAN.matches ===
false
) {
const check =
normalizeCheck(
checks.ibanConsistency
);

check.status =
"fail";

check.score =
Math.max(
check.score,
85
);

check.evidence.push(
"Sağlanan gönderen IBAN ile belgede görünen gönderen IBAN uyuşmuyor."
);

checks.ibanConsistency =
check;
}

if (
comparison?.receiverIBAN?.available &&
comparison.receiverIBAN.matches ===
false
) {
const check =
normalizeCheck(
checks.ibanConsistency
);

check.status =
"fail";

check.score =
Math.max(
check.score,
85
);

check.evidence.push(
"Sağlanan alıcı IBAN ile belgede görünen alıcı IBAN uyuşmuyor."
);

checks.ibanConsistency =
check;
}

/*
* Amount forensics:
*
* Moderate:
* sadece forensic uyarı olarak saklanır.
*
* Strong:
* amountConsistency deterministic olarak
* fail yapılır.
*
* Böylece OpenAI'nin overallRisk değerine
* güvenmek zorunda kalmayız.
*/
if (
amountForensics?.status ===
"warning"
) {
const check =
normalizeCheck(
checks.amountConsistency
);

for (
const evidence of
ensureArray(
amountForensics.evidence
)
) {
if (
!check.evidence.includes(
evidence
)
) {
check.evidence.push(
evidence
);
}
}

if (
amountForensics.severity ===
"strong"
) {
check.status =
"fail";

check.score =
Math.max(
check.score,
85
);
}

checks.amountConsistency =
check;
}

result.checks =
checks;

/*
* Deterministic risk hesabı.
*
* Burada check.score değerleri yerine
* check.status kullanılır:
*
* pass = 0
* fail = 100
* unknown = hesaba katılmaz
*
* Böylece modelin verdiği sayısal
* overallRisk nihai sonucu doğrudan
* belirleyemez.
*/
const risk =
calculateRiskFromChecks(
checks
);

result.overallRisk =
risk;

return result;
}

function buildFinalSummary(
result,
amountForensics
) {
const findings =
ensureArray(
result.findings
);

const warningEvidence =
ensureArray(
amountForensics?.evidence
);

const parts = [];

if (
result.documentType
) {
parts.push(
`Belge tipi: ${result.documentType}.`
);
}

if (
result.bank
) {
parts.push(
`Banka: ${result.bank}.`
);
}

if (
result.documentData?.amount
) {
parts.push(
`Tutar: ${result.documentData.amount}.`
);
}

if (
findings.length
) {
parts.push(
`${findings.length} adet bulgu değerlendirildi.`
);
}

if (
amountForensics?.status ===
"warning"
) {
parts.push(
"Tutar bölgesinde lokal görsel tutarsızlık tespit edildi."
);
}

if (
warningEvidence.length
) {
parts.push(
warningEvidence[0]
);
}

if (
!parts.length
) {
return safeString(
result.summary
);
}

return parts.join(
" "
);
}

function getFinalRiskLabel(
score
) {
const value =
clampScore(score);

if (
value >= 85
) {
return "Çok Yüksek Risk";
}

if (
value >= 60
) {
return "Yüksek Risk";
}

if (
value >= 46
) {
return "Orta Risk";
}

return "Düşük Risk";
}

function appendFinding(
result,
finding
) {
if (
!result
) {
return;
}

if (
!Array.isArray(
result.findings
)
) {
result.findings = [];
}

const normalized = {
severity:
safeString(
finding?.severity
),
category:
safeString(
finding?.category
),
description:
safeString(
finding?.description
),
evidence:
safeString(
finding?.evidence
),
};

const exists =
result.findings.some(
(item) =>
item?.category ===
normalized.category &&
item?.description ===
normalized.description &&
item?.evidence ===
normalized.evidence
);

if (!exists) {
result.findings.push(
normalized
);
}
}

function applyAmountForensicsFinding(
result,
amountForensics
) {
if (
!amountForensics?.available ||
amountForensics.status !==
"warning"
) {
return;
}

const severity =
amountForensics.severity ===
"strong"
? "high"
: "medium";

const description =
amountForensics.severity ===
"strong"
? "Tutar bölgesinde güçlü lokal görsel yoğunluk farkı tespit edildi."
: "Tutar bölgesinde orta seviyede lokal görsel yoğunluk farkı tespit edildi.";

appendFinding(
result,
{
severity,
category:
"amount_forensics",
description,
evidence:
ensureArray(
amountForensics.evidence
).join(" "),
}
);
}

function addIBANChecksumFindings(
result
) {
const documentData =
result?.documentData;

if (!documentData) {
return;
}

const fields = [
{
label:
"Gönderen IBAN",
value:
documentData.senderIBAN,
},
{
label:
"Alıcı IBAN",
value:
documentData.receiverIBAN,
},
];

for (
const field of fields
) {
if (!field.value) {
continue;
}

const validation =
validateIBANMod97(
field.value
);

if (
validation.valid ===
false
) {
appendFinding(
result,
{
severity:
"high",
category:
"iban_checksum",
description:
`${field.label} checksum doğrulamasından geçmedi.`,
evidence:
`${field.label}: ${field.value}. ${validation.reason}.`,
}
);

const check =
normalizeCheck(
result.checks
?.ibanConsistency
);

check.status =
"fail";

check.score =
Math.max(
check.score,
85
);

check.evidence.push(
`${field.label} checksum doğrulaması başarısız.`
);

result.checks =
result.checks ||
{};

result.checks.ibanConsistency =
check;
}
}
}

function buildRiskExplanation(
result
) {
const checks =
normalizeChecks(
result?.checks
);

const failed =
Object.entries(
checks
).filter(
([, check]) =>
check.status ===
"fail"
);

const passed =
Object.entries(
checks
).filter(
([, check]) =>
check.status ===
"pass"
);

const unknown =
Object.entries(
checks
).filter(
([, check]) =>
check.status ===
"unknown"
);

return {
score:
clampScore(
result?.overallRisk
),
label:
getFinalRiskLabel(
result?.overallRisk
),
failedChecks:
failed.map(
([name, check]) => ({
name,
score:
check.score,
evidence:
check.evidence,
})
),
passedChecks:
passed.map(
([name]) =>
name
),
unknownChecks:
unknown.map(
([name]) =>
name
),
};
}

async function callOpenAIAnalysis(
content
) {
const response =
await client.responses.create(
{
model: MODEL,

input: [
{
role: "system",
content: [
{
type:
"input_text",
text: `
Sen VerifyDoc'un belge adli inceleme motorusun.

Görevin:
- banka dekontları,
- ödeme belgeleri,
- transfer belgeleri,
- hesap hareketleri,
- benzeri finansal belgelerde
sahtecilik veya manipülasyon belirtilerini
çok katmanlı şekilde incelemektir.

ÇOK ÖNEMLİ KURALLAR:

1. Görmediğin bilgiyi uydurma.
2. OCR hatasını sahtecilik olarak yorumlama.
3. Görsel kanıt ile OCR bilgisini birbirinden ayır.
4. Bir alanın farklı görünmesi tek başına sahtecilik kanıtı değildir.
5. Ekran görüntüsü, JPEG sıkıştırması, yeniden boyutlandırma, tarama ve farklı render süreçlerinin oluşturabileceği doğal farklılıkları dikkate al.
6. Tutar alanını özellikle dikkatli incele.
7. "1700,00" gibi bir tutarın "00" kısmı ile "1700" kısmı arasında lokal font, stroke, darkness, spacing veya rendering farkı varsa bunu değerlendir; fakat yalnızca görsel fark gördün diye kesin sahte deme.
8. Verilen amountForensics bilgisini yardımcı deterministic kanıt olarak kullan.
9. amountForensics strong warning ise bunu önemli bir bulgu olarak değerlendir.
10. Belgenin gerçek görüntüsü her zaman nihai görsel referanstır.
11. Kanıt yoksa unknown kullan.
12. Her bulguda somut kanıt yaz.
13. OverallRisk alanını kendi değerlendirmen olarak üret; backend deterministic risk motoru nihai skoru ayrıca hesaplayabilir.

Tutar konusunda:
- Binlik ayırıcı ile ondalık ayırıcıyı karıştırma.
- "1.700,00 TL" Türkiye formatında 1700.00 TRY anlamına gelebilir.
- "1,700.00" farklı locale formatıdır.
- Görseldeki karakterlerin tek tek okunabilirliği önemlidir.
- Bir tutarın yalnızca OCR tarafından yanlış okunması sahtecilik kanıtı değildir.

IBAN konusunda:
- IBAN karakterlerini dikkatle incele.
- OCR kaynaklı karakter karışıklıkları olabilir.
- Checksum tutarsızlığı teknik bulgudur fakat OCR hatası ihtimalini değerlendir.

Şablon konusunda:
- Bankanın resmî şablonundaki makul varyasyonları dikkate al.
- Farklı uygulama sürümleri ve ekran görüntülerini otomatik olarak sahte kabul etme.

Çıktı kesinlikle verilen JSON şemasına uygun olmalıdır.
`,
},
],
},
{
role: "user",
content,
},
],

text: {
format: {
type:
"json_schema",
name:
"verifydoc_result",
strict: true,
schema:
RESPONSE_SCHEMA,
},
},
}
);

return response;
}
async function analyzePdfStructure(
filePath
) {
try {
const data =
await fs.readFile(
filePath
);

const loadingTask =
pdfjsLib.getDocument({
data,
useWorkerFetch: false,
isEvalSupported: false,
});

const pdf =
await loadingTask.promise;

const pages = [];

for (
let pageNumber = 1;
pageNumber <=
pdf.numPages;
pageNumber++
) {
const page =
await pdf.getPage(
pageNumber
);

const content =
await page.getTextContent();

const items =
Array.isArray(
content?.items
)
? content.items
: [];

const fonts =
new Set();

const positions = [];

for (
const item of items
) {
if (
item?.fontName
) {
fonts.add(
String(
item.fontName
)
);
}

if (
Array.isArray(
item?.transform
)
) {
positions.push({
x:
Number(
item.transform[4]
) || 0,
y:
Number(
item.transform[5]
) || 0,
width:
Number(
item.width
) || 0,
height:
Number(
item.height
) || 0,
text:
safeString(
item.str
),
font:
safeString(
item.fontName
),
});
}
}

pages.push({
pageNumber,
textItemCount:
items.length,
fontCount:
fonts.size,
fonts:
[...fonts],
positions,
});
}

return {
available: true,
pageCount:
pdf.numPages,
pages,
};
} catch (error) {
console.error(
"PDF structure analysis error:",
error
);

return {
available: false,
pageCount: 0,
pages: [],
error:
error?.message ||
String(error),
};
}
}

async function analyzeImageForensics(
filePath
) {
try {
const metadata =
await sharp(
filePath
).metadata();

const stats =
await sharp(
filePath
)
.stats();

const channels =
Array.isArray(
stats?.channels
)
? stats.channels
: [];

const channelStats =
channels.map(
(channel, index) => ({
channel: index,
min:
Number(
channel.min
) || 0,
max:
Number(
channel.max
) || 0,
mean:
Number(
channel.mean
) || 0,
stdev:
Number(
channel.stdev
) || 0,
})
);

return {
available: true,
format:
safeString(
metadata?.format
),
width:
Number(
metadata?.width
) || 0,
height:
Number(
metadata?.height
) || 0,
channels:
Number(
metadata?.channels
) || 0,
density:
Number(
metadata?.density
) || 0,
hasAlpha:
Boolean(
metadata?.hasAlpha
),
space:
safeString(
metadata?.space
),
channelStats,
};
} catch (error) {
console.error(
"Image forensics error:",
error
);

return {
available: false,
error:
error?.message ||
String(error),
};
}
}

function compareOCRTexts(
first,
second
) {
const a =
normalizeText(
first
).toLowerCase();

const b =
normalizeText(
second
).toLowerCase();

if (!a || !b) {
return {
available: false,
similarity: null,
exact: false,
};
}

if (a === b) {
return {
available: true,
similarity: 1,
exact: true,
};
}

const maxLength =
Math.max(
a.length,
b.length
);

if (!maxLength) {
return {
available: false,
similarity: null,
exact: false,
};
}

const distance =
levenshteinDistance(
a,
b
);

return {
available: true,
similarity:
Math.max(
0,
1 -
distance /
maxLength
),
exact: false,
};
}

function levenshteinDistance(
a,
b
) {
const aa =
String(a ?? "");

const bb =
String(b ?? "");

if (!aa.length) {
return bb.length;
}

if (!bb.length) {
return aa.length;
}

let previous =
new Array(
bb.length + 1
);

for (
let j = 0;
j <= bb.length;
j++
) {
previous[j] = j;
}

for (
let i = 1;
i <= aa.length;
i++
) {
const current =
new Array(
bb.length + 1
);

current[0] = i;

for (
let j = 1;
j <= bb.length;
j++
) {
const cost =
aa[i - 1] ===
bb[j - 1]
? 0
: 1;

current[j] =
Math.min(
current[j - 1] + 1,
previous[j] + 1,
previous[j - 1] +
cost
);
}

previous =
current;
}

return previous[
bb.length
];
}

function buildPDFForensicsContext(
pdfStructure
) {
if (
!pdfStructure?.available
) {
return "";
}

return `
PDF YAPISAL FORENSİK BİLGİSİ:
${safeJson(
pdfStructure
)}

PDF yapısal bilgisi yardımcı kanıttır.
Tek başına farklı font sayısı, text item sayısı veya
koordinat farklılığı sahtecilik kanıtı değildir.

Özellikle:
- aynı sayfada olağandışı font kullanımı,
- belirli bir alanın diğer metinlerden farklı fontla oluşturulması,
- olağandışı text item ayrışması,
- tutar alanında sıra dışı koordinat / boyut farklılığı

varsa bunu diğer görsel ve içerik bulgularıyla birlikte değerlendir.
`;
}

function buildImageForensicsContext(
imageForensics
) {
if (
!imageForensics?.available
) {
return "";
}

return `
GÖRSEL DOSYA FORENSİKS BİLGİSİ:
${safeJson(
imageForensics
)}

Bu bilgiler dosyanın teknik görüntü özelliklerini gösterir.
Bunları tek başına sahtecilik kanıtı kabul etme.

Özellikle JPEG/PNG dönüşümü, yeniden boyutlandırma,
ekran görüntüsü ve sıkıştırma gibi işlemlerin doğal etkilerini dikkate al.
`;
}

function buildRiskMotorEvidence(
result
) {
const checks =
normalizeChecks(
result?.checks
);

const evidence = [];

for (
const [
name,
check,
] of Object.entries(
checks
)
) {
if (
check.status ===
"fail"
) {
evidence.push({
check:
name,
score:
check.score,
evidence:
check.evidence,
});
}
}

return evidence;
}

function sanitizeResult(
result
) {
const normalized =
normalizeAIResult(
result
);

normalized.checks =
normalizeChecks(
normalized.checks
);

normalized.findings =
normalizeFindings(
normalized.findings
);

normalized.documentData =
normalizeDocumentData(
normalized.documentData
);

normalized.amountAnalysis =
normalizeAmountAnalysis(
normalized.amountAnalysis
);

return normalized;
}

async function buildOpenAIContent({
documentText,
ocrText,
paddleResult,
tesseractResult,
pdfText,
pdfStructure,
imageForensics,
amountForensics,
providedInfo,
documentData,
bank,
fileType,
}) {
const providedContext =
buildProvidedInfoContext(
providedInfo,
documentData
);

const amountContext =
buildAmountForensicsContext(
amountForensics
);

const ocrContext =
buildOCRContext(
paddleResult,
tesseractResult,
pdfText
);

const templateContext =
buildTemplateContext(
bank,
documentText
);

const transactionContext =
buildTransactionLogicContext(
documentData
);

const pdfContext =
buildPDFForensicsContext(
pdfStructure
);

const imageContext =
buildImageForensicsContext(
imageForensics
);

return `
BELGE TÜRÜ:
${safeString(
fileType
)}

BELGEDEN ÇIKARILAN ANA METİN:
${safeString(
documentText
)}

${ocrContext}

${providedContext}

${amountContext}

${pdfContext}

${imageContext}

${templateContext}

${transactionContext}

BELGE İNCELEME TALİMATI:

Aşağıdaki alanların tamamını mümkün olduğunca dikkatli değerlendir:

1. Tutar
2. Para birimi
3. Gönderen adı
4. Gönderen IBAN
5. Alıcı adı
6. Alıcı IBAN
7. Tarih
8. Saat
9. İşlem numarası
10. Referans numarası
11. Açıklama
12. IBAN checksum
13. OCR tutarlılığı
14. Görsel tutarlılık
15. Font tutarlılığı
16. Layout
17. Hizalama
18. Boşluklar
19. Şablon uyumu
20. PDF yapısı
21. Metadata
22. Görsel sıkıştırma izleri
23. Tutar karakterlerinin kendi içindeki tutarlılığı
24. Yazıyla tutar / rakamla tutar uyumu
25. İşlem mantığı

TUTAR FORENSICS İÇİN ÖZEL KURAL:

Özellikle şu tür durumları ara:

- "1.700,00" gibi bir tutarın "1.700" kısmı ile ",00" kısmının farklı görünmesi
- aynı rakamların stroke kalınlıklarının farklı olması
- aynı rakamların darkness değerlerinin farklı olması
- bazı karakterlerin diğerlerine göre daha keskin veya daha bulanık olması
- karakter aralıklarının lokal olarak değişmesi
- decimal kısmının farklı font / rendering ile görünmesi
- tutarın geri kalan metinden farklı bir şekilde rasterize edilmiş görünmesi

Ancak:

- tek bir piksel farkını,
- JPEG artefaktını,
- ekran görüntüsü kaynaklı farkı,
- anti-aliasing farkını,
- yeniden boyutlandırma etkisini

sahtecilik olarak yorumlama.

SONUÇ KURALI:

Bir bulgu yalnızca gerçekten destekleniyorsa fail yap.

Kanıt yetersizse unknown kullan.

Görsel olarak şüpheli fakat kesin olmayan bulguları findings içine
uygun severity ile ekleyebilirsin.

Deterministic backend forensics tarafından sağlanan bilgiler
OpenAI değerlendirmesini destekler; ancak bunların da bağlam içinde
yorumlanması gerekir.
`;
}

function collectDocumentDataForComparison(
result
) {
return {
senderName:
safeString(
result?.documentData
?.senderName
),
senderIBAN:
safeString(
result?.documentData
?.senderIBAN
),
receiverName:
safeString(
result?.documentData
?.receiverName
),
receiverIBAN:
safeString(
result?.documentData
?.receiverIBAN
),
amount:
preserveAmount(
result?.documentData
?.amount
),
currency:
safeString(
result?.documentData
?.currency
),
date:
safeString(
result?.documentData
?.date
),
time:
safeString(
result?.documentData
?.time
),
transactionId:
safeString(
result?.documentData
?.transactionId
),
referenceNo:
safeString(
result?.documentData
?.referenceNo
),
description:
safeString(
result?.documentData
?.description
),
};
}

function ensureRequiredResultShape(
result
) {
const normalized =
sanitizeResult(
result
);

normalized.documentData =
normalized.documentData ||
{};

normalized.checks =
normalized.checks ||
{};

normalized.findings =
normalized.findings ||
[];

normalized.amountAnalysis =
normalized.amountAnalysis ||
{
numericAmount: "",
formattedAmount: "",
suspiciousFormatting:
false,
evidence: [],
};

return normalized;
}

function finalizeAnalysisResult(
result,
{
amountForensics = null,
providedInfo = null,
} = {}
) {
let finalResult =
ensureRequiredResultShape(
result
);

finalResult.documentData.amount =
preserveAmount(
finalResult.documentData.amount
);

const documentData =
collectDocumentDataForComparison(
finalResult
);

const comparison =
compareProvidedInfoWithDocument(
providedInfo,
documentData
);

applyAmountForensicsFinding(
finalResult,
amountForensics
);

addIBANChecksumFindings(
finalResult
);

applyDeterministicRiskRules(
finalResult,
comparison,
amountForensics
);

finalResult.overallRisk =
clampScore(
finalResult.overallRisk
);

finalResult.summary =
buildFinalSummary(
finalResult,
amountForensics
);

finalResult.riskLabel =
getFinalRiskLabel(
finalResult.overallRisk
);

finalResult.riskExplanation =
buildRiskExplanation(
finalResult
);

finalResult.riskEvidence =
buildRiskMotorEvidence(
finalResult
);

finalResult.informationCheck =
comparison;

if (
amountForensics
) {
finalResult.amountForensics =
amountForensics;
}

return finalResult;
}
async function processImageDocument(
filePath,
{
providedInfo = null,
} = {}
) {
console.log(
"IMAGE ANALYSIS BAŞLADI"
);

const paddleImageOCR =
await runPaddleOCR(
filePath
);

console.log(
"IMAGE PADDLEOCR TAMAMLANDI",
{
success:
paddleImageOCR?.success,
confidence:
paddleImageOCR?.confidence,
regions:
paddleImageOCR?.regions
?.length || 0,
}
);

const tesseractImageOCR =
await runOCR(
filePath,
"eng"
);

const imageForensics =
await analyzeImageForensics(
filePath
);

/*
* Yeni tutar forensics katmanı.
*
* Burada OCR'ın koordinat bilgisini kullanarak
* tutar bölgesini doğrudan görüntü üzerinden
* inceliyoruz.
*/
const amountForensics =
await analyzeAmountForensics(
filePath,
paddleImageOCR
);

console.log(
"AMOUNT FORENSICS:",
amountForensics
);

const documentText =
cleanOCRText(
[
paddleImageOCR?.text ||
"",
tesseractImageOCR?.text ||
"",
].join("\n")
);

const bank =
detectBank(
documentText
);

/*
* İlk OpenAI çağrısında belge verisini
* çıkarttırıyoruz.
*
* Buradaki overallRisk nihai risk olarak
* kullanılmayacak.
*/
const initialContent =
await buildOpenAIContent({
documentText,
ocrText:
paddleImageOCR?.text ||
"",
paddleResult:
paddleImageOCR,
tesseractResult:
tesseractImageOCR,
pdfText: "",
pdfStructure: null,
imageForensics,
amountForensics,
providedInfo,
documentData: null,
bank,
fileType:
"image",
});

const response =
await callOpenAIAnalysis(
initialContent
);

const rawOutput =
response?.output_text ||
"";

let result =
parseAIResponse(
rawOutput
);

result =
ensureRequiredResultShape(
result
);

/*
* Belgeden çıkan gerçek documentData
* üzerinden kullanıcı tarafından sağlanan
* bilgiler tekrar karşılaştırılır.
*/
const documentData =
collectDocumentDataForComparison(
result
);

const comparison =
compareProvidedInfoWithDocument(
providedInfo,
documentData
);

/*
* Deterministic risk motoru burada
* devreye girer.
*
* OpenAI overallRisk yalnızca model görüşüdür.
* Nihai score backend tarafından hesaplanır.
*/
result =
finalizeAnalysisResult(
result,
{
amountForensics,
providedInfo,
}
);

/*
* Ek teknik bilgiler.
* Bunlar RESPONSE_SCHEMA'ın parçası olmadığı
* için OpenAI structured output'u bozmaz.
*/
result.ocr = {
paddle: {
success:
Boolean(
paddleImageOCR?.success
),
confidence:
Number(
paddleImageOCR?.confidence
) || 0,
text:
safeString(
paddleImageOCR?.text
),
},
tesseract: {
success:
Boolean(
tesseractImageOCR?.success
),
confidence:
Number(
tesseractImageOCR?.confidence
) || 0,
text:
safeString(
tesseractImageOCR?.text
),
},
};

result.imageForensics =
imageForensics;

result.informationCheck =
comparison;

return result;
}

async function processPdfDocument(
filePath,
{
providedInfo = null,
tempDir = null,
} = {}
) {
console.log(
"PDF ANALYSIS BAŞLADI"
);

/*
* Önce PDF'in native text layer'ını
* çıkartıyoruz.
*/
const pdfText =
await extractPdfText(
filePath
);

console.log(
"PDF NATIVE TEXT LENGTH:",
pdfText.length
);

/*
* PDF yapısal forensics.
*/
const pdfStructure =
await analyzePdfStructure(
filePath
);

/*
* PDF sayfalarını görüntüye render ediyoruz.
*
* Bu sayede görsel OCR ve amount
* forensics PDF üzerinde de çalışabilir.
*/
const renderDir =
tempDir ||
path.join(
path.dirname(
filePath
),
"verifydoc-pdf-pages"
);

let renderedPages = [];

try {
const rendered =
await renderPdfPages(
filePath,
renderDir,
5
);

renderedPages =
rendered?.pages ||
[];
} catch (error) {
console.error(
"PDF render error:",
error
);
}

/*
* PDF native text varsa bunu temel
* metin olarak kullan.
*
* Render edilmiş sayfalardan OCR da
* ayrıca alınır.
*/
let paddleResult = {
text: "",
confidence: 0,
success: false,
pages: 0,
regions: [],
};

let tesseractResult = {
text: "",
confidence: 0,
success: false,
};

let amountForensics =
null;

if (
renderedPages.length
) {
const pageResults = [];

for (
const page of
renderedPages
) {
const paddle =
await runPaddleOCR(
page.path
);

pageResults.push(
paddle
);

if (
!amountForensics &&
paddle?.success
) {
amountForensics =
await analyzeAmountForensics(
page.path,
paddle
);
}

if (
paddle?.success &&
paddle?.text
) {
paddleResult.text +=
"\n" +
paddle.text;
}

if (
paddle?.confidence
) {
paddleResult.confidence =
Math.max(
paddleResult.confidence,
Number(
paddle.confidence
) || 0
);
}

paddleResult.success =
paddleResult.success ||
Boolean(
paddle?.success
);

paddleResult.pages +=
Number(
paddle?.pages
) || 0;

if (
Array.isArray(
paddle?.regions
)
) {
paddleResult.regions.push(
...paddle.regions.map(
(item) => ({
...item,
pageIndex:
Number(
page.pageNumber
) - 1,
})
)
);
}

const tesseract =
await runOCR(
page.path,
"eng"
);

if (
tesseract?.text
) {
tesseractResult.text +=
"\n" +
tesseract.text;
}

if (
tesseract?.confidence
) {
tesseractResult.confidence =
Math.max(
tesseractResult.confidence,
Number(
tesseract.confidence
) || 0
);
}

tesseractResult.success =
tesseractResult.success ||
Boolean(
tesseract?.success
);
}
}

paddleResult.text =
cleanOCRText(
paddleResult.text
);

tesseractResult.text =
cleanOCRText(
tesseractResult.text
);

const combinedText =
cleanOCRText(
[
pdfText,
paddleResult.text,
tesseractResult.text,
].join("\n")
);

const bank =
detectBank(
combinedText
);

console.log(
"PDF BANK:",
bank
);

console.log(
"PDF AMOUNT FORENSICS:",
amountForensics
);

const imageForensics =
renderedPages.length
? await analyzeImageForensics(
renderedPages[0].path
)
: null;

const content =
await buildOpenAIContent({
documentText:
combinedText,
ocrText:
paddleResult.text,
paddleResult,
tesseractResult,
pdfText,
pdfStructure,
imageForensics,
amountForensics,
providedInfo,
documentData: null,
bank,
fileType:
"pdf",
});

const response =
await callOpenAIAnalysis(
content
);

const rawOutput =
response?.output_text ||
"";

let result =
parseAIResponse(
rawOutput
);

result =
ensureRequiredResultShape(
result
);

result =
finalizeAnalysisResult(
result,
{
amountForensics,
providedInfo,
}
);

result.pdfForensics =
pdfStructure;

result.ocr = {
paddle: {
success:
Boolean(
paddleResult.success
),
confidence:
Number(
paddleResult.confidence
) || 0,
text:
paddleResult.text,
},
tesseract: {
success:
Boolean(
tesseractResult.success
),
confidence:
Number(
tesseractResult.confidence
) || 0,
text:
tesseractResult.text,
},
};

result.renderedPages =
renderedPages.map(
(page) => ({
pageNumber:
page.pageNumber,
width:
page.width,
height:
page.height,
})
);

return result;
}

async function processVideoDocument(
filePath,
{
providedInfo = null,
tempDir = null,
} = {}
) {
console.log(
"VIDEO ANALYSIS BAŞLADI"
);

const framesDir =
tempDir ||
path.join(
path.dirname(
filePath
),
"verifydoc-video-frames"
);

const framePaths =
await extractVideoFrames(
filePath,
framesDir,
4
);

console.log(
"VIDEO FRAMES:",
framePaths.length
);

if (
!framePaths.length
) {
return {
documentType:
"video",
bank:
"Bilinmiyor",
documentData:
normalizeDocumentData(
{}
),
checks:
normalizeChecks(
{}
),
amountAnalysis:
normalizeAmountAnalysis(
{}
),
findings: [
{
severity:
"high",
category:
"video_processing",
description:
"Video kareleri çıkarılamadı.",
evidence:
"FFmpeg video karelerini üretemedi.",
},
],
overallRisk: 85,
summary:
"Video analiz edilemedi.",
riskLabel:
"Çok Yüksek Risk",
};
}

const frameResults = [];

for (
let index = 0;
index < framePaths.length;
index++
) {
const framePath =
framePaths[index];

/*
* ÖNEMLİ:
* PaddleOCR'a MP4 değil,
* çıkarılmış JPG frame gönderilir.
*/
const paddle =
await runPaddleOCR(
framePath
);

console.log(
"VIDEO PADDLEOCR TAMAMLANDI",
index + 1
);

const tesseract =
await runOCR(
framePath,
"eng"
);

const imageForensics =
await analyzeImageForensics(
framePath
);

const amountForensics =
await analyzeAmountForensics(
framePath,
paddle
);

frameResults.push({
frame:
index + 1,
path:
framePath,
paddle,
tesseract,
imageForensics,
amountForensics,
});
}

const allPaddleText =
cleanOCRText(
frameResults
.map(
(frame) =>
`FRAME ${
frame.frame
}:\n${
frame.paddle
?.text || ""
}`
)
.join("\n\n")
);

const allTesseractText =
cleanOCRText(
frameResults
.map(
(frame) =>
`FRAME ${
frame.frame
}:\n${
frame.tesseract
?.text || ""
}`
)
.join("\n\n")
);

const videoAmountForensics =
frameResults.find(
(frame) =>
frame.amountForensics
?.available
)?.amountForensics ||
null;

const combinedVideoText =
cleanOCRText(
[
allPaddleText,
allTesseractText,
].join("\n\n")
);

const bank =
detectBank(
combinedVideoText
);

const content =
await buildOpenAIContent({
documentText:
combinedVideoText,
ocrText:
allPaddleText,
paddleResult: {
text:
allPaddleText,
confidence:
Math.max(
0,
...frameResults.map(
(frame) =>
Number(
frame.paddle
?.confidence
) || 0
)
),
success:
frameResults.some(
(frame) =>
frame.paddle
?.success
),
pages:
frameResults.length,
regions:
frameResults.flatMap(
(frame) =>
frame.paddle
?.regions || []
),
},
tesseractResult: {
text:
allTesseractText,
confidence:
Math.max(
0,
...frameResults.map(
(frame) =>
Number(
frame.tesseract
?.confidence
) || 0
)
),
success:
frameResults.some(
(frame) =>
frame.tesseract
?.success
),
},
pdfText: "",
pdfStructure: null,
imageForensics:
frameResults[0]
?.imageForensics ||
null,
amountForensics:
videoAmountForensics,
providedInfo,
documentData: null,
bank,
fileType:
"video",
});

const response =
await callOpenAIAnalysis(
content
);

const rawOutput =
response?.output_text ||
"";

let result =
parseAIResponse(
rawOutput
);

result =
ensureRequiredResultShape(
result
);

result =
finalizeAnalysisResult(
result,
{
amountForensics:
videoAmountForensics,
providedInfo,
}
);

result.videoForensics = {
frameCount:
frameResults.length,
frames:
frameResults.map(
(frame) => ({
frame:
frame.frame,
paddleConfidence:
Number(
frame.paddle
?.confidence
) || 0,
tesseractConfidence:
Number(
frame.tesseract
?.confidence
) || 0,
amountForensics:
frame.amountForensics,
})
),
};

return result;
}
function getRiskScoreFromResult(
 result
) {
 const checks =
 normalizeChecks(
 result?.checks
 );

 const failed =
 Object.values(
 checks
 ).filter(
 (check) =>
 check.status ===
 "fail"
 ).length;

 const passed =
 Object.values(
 checks
 ).filter(
 (check) =>
 check.status ===
 "pass"
 ).length;

 const unknown =
 Object.values(
 checks
 ).filter(
 (check) =>
 check.status ===
 "unknown"
 ).length;

 const total =
 failed +
 passed;

 if (!total) {
 return {
 score: 0,
 failed,
 passed,
 unknown,
 };
 }

 /*
 * Her fail 100 puan,
 * pass 0 puan.
 *
 * Unknown kontrole dahil edilmez.
 */
 const score =
 clampScore(
 (failed /
 total) *
 100
 );

 return {
 score,
 failed,
 passed,
 unknown,
 };
}

function applyRiskCeiling(
 result
) {
 const checks =
 normalizeChecks(
 result?.checks
 );

 let minimumRisk =
 0;

 /*
 * Kritik teknik bulgular için
 * minimum risk seviyeleri.
 */
 for (
 const check of Object.values(
 checks
 )
 ) {
 if (
 check.status !==
 "fail"
 ) {
 continue;
 }

 if (
 Number(
 check.score
 ) >= 85
 ) {
 minimumRisk =
 Math.max(
 minimumRisk,
 60
 );
 } else if (
 Number(
 check.score
 ) >= 60
 ) {
 minimumRisk =
 Math.max(
 minimumRisk,
 46
 );
 } else {
 minimumRisk =
 Math.max(
 minimumRisk,
 30
 );
 }
 }

 result.overallRisk =
 Math.max(
 clampScore(
 result.overallRisk
 ),
 minimumRisk
 );

 return result;
}

function applyStrongAmountForensics(
 result,
 amountForensics
) {
 if (
 !amountForensics?.available
 ) {
 return;
 }

 if (
 amountForensics.status !==
 "warning"
 ) {
 return;
 }

 const check =
 normalizeCheck(
 result?.checks
 ?.amountConsistency
 );

 /*
 * Moderate warning:
 * kanıt olarak sakla fakat
 * doğrudan fail yapma.
 */
 if (
 amountForensics.severity ===
 "moderate"
 ) {
 for (
 const evidence of
 ensureArray(
 amountForensics.evidence
 )
 ) {
 if (
 !check.evidence.includes(
 evidence
 )
 ) {
 check.evidence.push(
 evidence
 );
 }
 }

 result.checks =
 result.checks ||
 {};

 result.checks.amountConsistency =
 check;

 return;
 }

 /*
 * Strong warning:
 * amountConsistency fail.
 */
 if (
 amountForensics.severity ===
 "strong"
 ) {
 check.status =
 "fail";

 check.score =
 Math.max(
 Number(
 check.score
 ) || 0,
 85
 );

 for (
 const evidence of
 ensureArray(
 amountForensics.evidence
 )
 ) {
 if (
 !check.evidence.includes(
 evidence
 )
 ) {
 check.evidence.push(
 evidence
 );
 }
 }

 result.checks =
 result.checks ||
 {};

 result.checks.amountConsistency =
 check;

 appendFinding(
 result,
 {
 severity:
 "high",
 category:
 "amount_forensics",
 description:
 "Tutar alanında karakter seviyesinde güçlü lokal görsel tutarsızlık bulundu.",
 evidence:
 ensureArray(
 amountForensics.evidence
 ).join(" "),
 }
 );
 }
}

function applyOCRConsistency(
 result,
 paddleText,
 tesseractText
) {
 const comparison =
 compareOCRTexts(
 paddleText,
 tesseractText
 );

 const check =
 normalizeCheck(
 result?.checks
 ?.ocrConsistency
 );

 if (
 !comparison.available
 ) {
 return;
 }

 /*
 * OCR motorları tamamen aynıysa
 * destekleyici geçiş.
 */
 if (
 comparison.exact
 ) {
 check.status =
 "pass";

 check.score =
 0;

 check.evidence.push(
 "PaddleOCR ve Tesseract metinleri aynı."
 );
 } else if (
 comparison.similarity >=
 0.90
 ) {
 check.status =
 "pass";

 check.score =
 0;

 check.evidence.push(
 `PaddleOCR ve Tesseract arasında yüksek metin benzerliği bulundu: ${comparison.similarity.toFixed(
 3
 )}.`
 );
 } else if (
 comparison.similarity >=
 0.70
 ) {
 check.status =
 "unknown";

 check.evidence.push(
 `OCR motorları arasında orta seviyede farklılık bulundu: ${comparison.similarity.toFixed(
 3
 )}. Bu fark OCR hatasından kaynaklanabilir.`
 );
 } else {
 check.status =
 "unknown";

 check.evidence.push(
 `OCR motorları arasında belirgin farklılık bulundu: ${comparison.similarity.toFixed(
 3
 )}. Tek başına sahtecilik kanıtı değildir.`
 );
 }

 result.checks =
 result.checks ||
 {};

 result.checks.ocrConsistency =
 check;
}

function applyAmountFormattingCheck(
 result
) {
 const amount =
 safeString(
 result?.documentData
 ?.amount
 );

 if (!amount) {
 return;
 }

 const check =
 normalizeCheck(
 result?.checks
 ?.amountConsistency
 );

 const parsed =
 parseAmount(
 amount
 );

 if (
 parsed === null
 ) {
 check.status =
 "unknown";

 check.evidence.push(
 `Belgedeki tutar sayısal olarak çözümlenemedi: ${amount}.`
 );
 } else {
 /*
 * Türkçe para formatı için
 * makul örnekleri kabul ediyoruz.
 */
 const looksTurkish =
 /^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/.test(
 amount
 .replace(
 /₺|TL|TRY/gi,
 ""
 )
 .trim()
 );

 const looksEnglish =
 /^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$/.test(
 amount
 .replace(
 /\$|USD/gi,
 ""
 )
 .trim()
 );

 if (
 looksTurkish ||
 looksEnglish
 ) {
 check.evidence.push(
 `Tutar biçimi çözümlenebilir: ${amount} = ${parsed}.`
 );
 } else {
 /*
 * Biçim olağandışıysa sadece
 * uyarı olarak sakla.
 */
 check.evidence.push(
 `Tutar biçimi standart para gösterimlerinden farklı olabilir: ${amount}.`
 );
 }
 }

 result.checks =
 result.checks ||
 {};

 result.checks.amountConsistency =
 check;
}

function finalizeRiskEngine(
 result,
 {
 amountForensics = null,
 paddleText = "",
 tesseractText = "",
 } = {}
) {
 /*
 * Önce deterministic bulguları
 * uygula.
 */
 applyStrongAmountForensics(
 result,
 amountForensics
 );

 applyOCRConsistency(
 result,
 paddleText,
 tesseractText
 );

 applyAmountFormattingCheck(
 result
 );

 /*
 * Check statuslarından temel
 * risk puanını hesapla.
 */
 const calculated =
 getRiskScoreFromResult(
 result
 );

 /*
 * Modelin overallRisk değeri burada
 * nihai sonuç olarak kullanılmaz.
 */
 result.overallRisk =
 calculated.score;

 /*
 * Kritik fail varsa minimum risk
 * seviyesini koru.
 */
 applyRiskCeiling(
 result
 );

 result.overallRisk =
 clampScore(
 result.overallRisk
 );

 result.riskLabel =
 getFinalRiskLabel(
 result.overallRisk
 );

 result.riskExplanation =
 buildRiskExplanation(
 result
 );

 result.riskEvidence =
 buildRiskMotorEvidence(
 result
 );

 return result;
}

function makeErrorResult(
 message,
 category = "processing"
) {
 return {
 documentType:
 "unknown",

 bank:
 "Bilinmiyor",

 documentData:
 normalizeDocumentData(
 {}
 ),

 checks:
 normalizeChecks(
 {}
 ),

 amountAnalysis:
 normalizeAmountAnalysis(
 {}
 ),

 findings: [
 {
 severity:
 "high",
 category,
 description:
 message,
 evidence:
 message,
 },
 ],

 overallRisk:
 85,

 summary:
 message,

 riskLabel:
 "Çok Yüksek Risk",

 riskExplanation: {
 score: 85,
 label:
 "Çok Yüksek Risk",
 failedChecks: [],
 passedChecks: [],
 unknownChecks: [],
 },

 riskEvidence: [],
 };
}

async function processDocument(
 filePath,
 {
 mimeType = "",
 providedInfo = null,
 tempDir = null,
 } = {}
) {
 console.log(
 "VERIFYDOC PROCESS DOCUMENT:",
 {
 filePath,
 mimeType,
 }
 );

 if (
 isVideoFile(
 mimeType,
 filePath
 )
 ) {
 return await processVideoDocument(
 filePath,
 {
 providedInfo,
 tempDir,
 }
 );
 }

 if (
 isPdfFile(
 mimeType,
 filePath
 )
 ) {
 return await processPdfDocument(
 filePath,
 {
 providedInfo,
 tempDir,
 }
 );
 }

 if (
 isImageFile(
 mimeType,
 filePath
 )
 ) {
 return await processImageDocument(
 filePath,
 {
 providedInfo,
 }
 );
 }

 throw new Error(
 `Desteklenmeyen dosya türü: ${mimeType || "unknown"}`
 );
}

function getIncomingFile(
 files
) {
 if (
 !files ||
 typeof files !==
 "object"
 ) {
 return null;
 }

 const possibleKeys = [
 "file",
 "document",
 "image",
 "video",
 "upload",
 ];

 for (
 const key of possibleKeys
 ) {
 const value =
 files[key];

 if (
 Array.isArray(value) &&
 value.length
 ) {
 return value[0];
 }

 if (
 value &&
 typeof value ===
 "object"
 ) {
 return value;
 }
 }

 /*
 * Son çare:
 * multipart parser'ın verdiği
 * ilk dosyayı kullan.
 */
 for (
 const value of Object.values(
 files
 )
 ) {
 if (
 Array.isArray(value) &&
 value[0]?.filepath
 ) {
 return value[0];
 }

 if (
 value?.filepath
 ) {
 return value;
 }
 }

 return null;
}

function parseProvidedInfo(
 fields
) {
 if (
 !fields ||
 typeof fields !==
 "object"
 ) {
 return null;
 }

 const raw =
 fields.providedInfo ??
 fields.info ??
 fields.expectedInfo;

 if (
 raw === undefined ||
 raw === null
 ) {
 /*
 * Bazı istemciler bilgileri
 * ayrı form alanları olarak gönderebilir.
 */
 const result = {};

 const keys = [
 "amount",
 "senderIBAN",
 "receiverIBAN",
 "senderName",
 "receiverName",
 "date",
 "time",
 "transactionId",
 "referenceNo",
 ];

 for (
 const key of keys
 ) {
 if (
 fields[key] !==
 undefined &&
 fields[key] !==
 null &&
 String(
 fields[key]
 ).trim() !== ""
 ) {
 result[key] =
 Array.isArray(
 fields[key]
 )
 ? fields[key][0]
 : fields[key];
 }
 }

 return Object.keys(
 result
 ).length
 ? result
 : null;
 }

 if (
 typeof raw ===
 "object"
 ) {
 return raw;
 }

 const rawString =
 Array.isArray(raw)
 ? raw[0]
 : String(raw);

 try {
 return JSON.parse(
 rawString
 );
 } catch {
 /*
 * JSON değilse amount olarak
 * gönderilmiş olma ihtimaline karşı
 * basit fallback.
 */
 return {
 amount:
 rawString,
 };
 }
}
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

if (
type === "image" ||
type === "statement"
) {

console.log(
"PADDLEOCR IMAGE ANALİZİ BAŞLIYOR..."
);

paddleImageOCR =
await runPaddleOCR(
filePath
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
"unknown" kullan.

=====================================================
TUTAR ANALİZİ
=====================================================

Ana işlem tutarını özellikle kontrol et.

Aşağıdaki tutar alanlarını birbirleriyle karşılaştır:

1. Ana işlem tutarı
2. Varsa üst/alt özet tutarı
3. Varsa yazıyla tutar
4. Varsa toplam tutar
5. Varsa komisyon / masraf
6. Varsa bakiye değişimi
7. Varsa başka yerde tekrar eden tutar

Aynı işlemi temsil eden tutarlar birbirini desteklemelidir.

Özellikle şu durumlara dikkat et:

- 1.700,00 ↔ 1.700,01
- 1.700,00 ↔ 1.700,10
- 1.700,00 ↔ 1.700,000
- 1700 ↔ 1.700
- 1.700,00 ↔ 17.000,00
- 1.700,00 ↔ 700,00
- 1.700,00 ↔ 1.070,00
- rakamların eksik/fazla olması
- virgül/nokta yerinin değişmesi
- son iki ondalık hanenin farklı olması
- aynı rakamın farklı font/stroke ile görünmesi

Fakat yalnızca görsel benzerlikten hareketle
"değiştirilmiştir" iddiasında bulunma.

=====================================================
KARAKTER DÜZEYİ TUTAR KONTROLÜ
=====================================================

Özellikle ana tutar alanındaki rakamları tek tek incele.

Şunları karşılaştır:

- rakamların stroke kalınlığı
- koyuluk
- kenar keskinliği
- font ağırlığı
- baseline hizası
- karakter yüksekliği
- karakter genişliği
- rakamlar arası boşluk
- virgül/nokta şekli
- son iki ondalık hanenin görünümü
- aynı karakterlerin birbirine benzerliği

Örneğin:

"1700,00"

içindeki:

"1"
"7"
"0"
"0"
","
"0"
"0"

karakterlerini mümkün olduğunca ayrı ayrı değerlendir.

Bir veya iki karakter diğerlerinden belirgin şekilde
farklı görünüyorsa bunu "localized visual inconsistency"
olarak değerlendir.

Ancak:

- JPEG sıkıştırması
- ekran görüntüsü
- yeniden boyutlandırma
- tarama kalitesi
- gölge
- belge arka planı
- anti-aliasing

gibi faktörlerin de böyle fark oluşturabileceğini unutma.

Bu nedenle tek başına renk/koyuluk farkı kesin sahtecilik
kanıtı değildir.

=====================================================
SAHTECİLİK İÇİN GÜÇLÜ KANITLAR
=====================================================

Aşağıdakiler birlikte görülüyorsa şüphe seviyesini artır:

- aynı tutarın farklı bölümlerde farklı olması
- yazıyla tutar ile rakamsal tutarın uyuşmaması
- karakter düzeyinde lokal font/stroke farkı
- yalnızca tek veya birkaç karakterin belirgin şekilde
farklı render edilmiş görünmesi
- hizalama bozukluğu
- karakter aralığında anormallik
- tutar alanında lokal blur/sharpness farkı
- tutar çevresinde farklı compression/noise davranışı
- belgenin geri kalanıyla tutar alanının görsel olarak
uyumsuz olması

=====================================================
NEGATİF KANIT
=====================================================

Sadece:

- hafif renk farkı
- hafif koyuluk farkı
- JPEG artefaktı
- görüntü sıkıştırması
- küçük keskinlik farkı

görülüyorsa bunu otomatik olarak sahtecilik olarak işaretleme.

=====================================================
REFERANS BELGE
=====================================================

Varsa reference_image de karşılaştırma amacıyla
kullanılabilir.

Fakat reference_image üzerinde bulunmayan bir bilgiyi
asıl belgede varmış gibi kabul etme.

Referans yalnızca:

- layout
- font
- alan sırası
- etiketler
- tipik hizalama
- görsel yapı

karşılaştırması için yardımcıdır.

ASLI BELGE HER ZAMAN ÖNCELİKLİDİR.

=====================================================
SONUÇ
=====================================================

Tutar konusunda kesin olmayan bir fark varsa:

"unknown"

veya

"warning"

seviyesinde değerlendir.

Görüntü açıkça desteklemiyorsa "fail" verme.

`,

},

{
type:
"input_image",

image_url:
imageDataUrl,

},

];


// =====================================================
// PDF
// =====================================================

} else if (
type === "pdf"
) {

const pdfTextContext =
extractedPdfText.trim()
?
`

=====================================================
PDF YEREL METİN ÇIKARMA SONUCU
=====================================================

Aşağıdaki metin PDF'in yerel text extraction
sonucudur.

Bu metin yardımcı veridir.

ASLINDA BELGE ÜZERİNDE GÖRÜLEN BİLGİLER
HER ZAMAN ÖNCELİKLİDİR.

PDF yerel metni:

${extractedPdfText}

`
:
"";


content = [

{
type:
"input_text",

text: `${PROMPT}

=====================================================
PDF ANALİZİ
=====================================================

Bu dosya PDF formatındadır.

PDF'in hem:

1. görsel içeriğini
2. çıkarılmış metin içeriğini
3. varsa OCR sonucunu
4. belge yapısını
5. font/layout davranışını

birlikte değerlendir.

${pdfTextContext}

=====================================================
TUTAR ANALİZİ
=====================================================

Ana işlem tutarını özellikle incele.

Aynı tutarın PDF içinde tekrarlandığı alanları
karşılaştır.

Özellikle:

- ana tutar
- yazıyla tutar
- toplam
- komisyon
- işlem özeti
- bakiye değişimi

arasında mantıksal tutarlılık ara.

Tutarın yalnızca tek bir yerde bulunması halinde
uydurma karşılaştırma yapma.

=====================================================
PDF FORENSICS
=====================================================

PDF yapısında aşağıdaki belirtilere dikkat et:

- farklı font kullanımı
- font subset farklılıkları
- aynı satır içinde farklı font
- karakter spacing anormalliği
- text positioning anormalliği
- farklı encoding davranışı
- farklı render karakteristikleri
- metadata tutarsızlığı
- sayfa yapısındaki anormallikler
- overlay text ihtimali
- aynı bilginin farklı katmanlarda bulunması

Bunlar yalnızca destekleyici kanıttır.

Tek başına PDF metadata farklılığı sahtecilik kanıtı değildir.

=====================================================
GÖRSEL TUTAR FORENSICS
=====================================================

Tutar alanında:

- karakter koyuluğu
- stroke kalınlığı
- edge sharpness
- baseline
- karakter yüksekliği
- karakter genişliği
- spacing
- virgül/nokta
- son iki ondalık

gibi özellikleri incele.

Bir veya birkaç karakterin diğerlerinden belirgin şekilde
ayrılması durumunda localized visual inconsistency
olarak bildir.

Fakat compression / rasterization / scan gibi etkileri
de dikkate al.

=====================================================
KESİNLİK
=====================================================

Kesin kanıt yoksa:

"unknown"

veya

"warning"

kullan.

Belge üzerinde açıkça desteklenmeyen bir tutarı
veya değişikliği icat etme.

`,

},

{
type:
"input_file",

file_id:
`data:application/pdf;base64,${base64}`,

},

];


// =====================================================
// FALLBACK — PDF INPUT FILE ÇALIŞMAZSA
// =====================================================

} else {

content = [

{
type:
"input_text",

text: `${PROMPT}

=====================================================
GENEL BELGE ANALİZİ
=====================================================

Bu belgeyi görsel olarak analiz et.

Belge üzerinde açıkça görünmeyen hiçbir bilgiyi
uydurma.

Ana işlem tutarını özellikle kontrol et.

Aynı tutarın farklı bölümlerde tekrarlandığı yerleri
karşılaştır.

Karakter düzeyinde:

- stroke
- koyuluk
- font ağırlığı
- hizalama
- spacing
- karakter boyutu
- kenar keskinliği

farklarını incele.

Lokal farklılıklar varsa bunları kanıt seviyesine göre
"warning" veya "unknown" olarak değerlendir.

Tek başına hafif renk/koyuluk farkını sahtecilik olarak
kabul etme.

`,

},

{
type:
"input_image",

image_url:
imageDataUrl,

},

];

}


// =====================================================
// OPENAI REQUEST
// =====================================================

console.log(
"OPENAI ANALİZİ BAŞLIYOR..."
);

const response =
await fetch(
"https://api.openai.com/v1/responses",
{

method:
"POST",

headers: {

"Authorization":
`Bearer ${process.env.OPENAI_API_KEY}`,

"Content-Type":
"application/json",

},

body:
JSON.stringify({

model:
"gpt-5.6-terra",

input:
content,

text: {

format: {

type:
"json_schema",

name:
"verifydoc_result",

strict:
true,

schema:
RESPONSE_SCHEMA,

},

},

}),
}
);


console.log(
"OPENAI STATUS:",
response.status
);

const responseText =
await response.text();

console.log(
"OPENAI RESPONSE LENGTH:",
responseText.length
);

if (
!response.ok
) {

console.error(
"OPENAI HATASI:",
responseText
);

throw new Error(
`OpenAI API hatası. HTTP ${response.status}: ${responseText.slice(0, 1000)}`
);
}


// =====================================================
// OPENAI RESPONSE PARSE
// =====================================================

let openAIResponse;

try {

openAIResponse =
JSON.parse(
responseText
);

}
catch (error) {

console.error(
"OPENAI JSON PARSE HATASI:",
error
);

console.error(
"OPENAI RAW RESPONSE:",
responseText.slice(
0,
3000
)
);

throw new Error(
"OpenAI response JSON olarak parse edilemedi."
);

}


// =====================================================
// OUTPUT TEXT
// =====================================================

let outputText =
"";

if (
typeof openAIResponse?.output_text ===
"string"
) {

outputText =
openAIResponse.output_text;

}
else if (
Array.isArray(
openAIResponse?.output
)
) {

for (
const item
of openAIResponse.output
) {

if (
Array.isArray(
item?.content
)
) {

for (
const part
of item.content
) {

if (
typeof part?.text ===
"string"
) {

outputText +=
part.text;

}

}

}

}

}

console.log(
"OPENAI OUTPUT TEXT LENGTH:",
outputText.length
);

if (
!outputText.trim()
) {

console.error(
"OPENAI OUTPUT YOK:",
JSON.stringify(
openAIResponse
).slice(
0,
5000
)
);

throw new Error(
"OpenAI API boş output döndürdü."
);
}


// =====================================================
// PARSE AI RESULT
// =====================================================

result =
parseAIResponse(
outputText
);


// =====================================================
// AMOUNT PRESERVATION
// =====================================================

if (
result?.documentData
) {

result.documentData.amount =
preserveAmount(
result.documentData.amount
);

}

if (
amountForensics
) {

result.amountForensics =
amountForensics;

}


// =====================================================
// PROVIDED INFO KARŞILAŞTIRMA
// =====================================================

const informationCheck =
compareProvidedInfoWithDocument(
providedInfo,
result?.documentData
);

if (
informationCheck?.enabled
) {

result.informationCheck =
informationCheck;

}


// =====================================================
// DETERMINISTIC RISK ENGINE
// =====================================================

const riskEngine =
calculateDeterministicRisk(
result?.checks,
result?.documentData
);


// =====================================================
// AMOUNT FORENSICS — RİSK MOTORU ENTEGRASYONU
// =====================================================

if (
amountForensics?.status ===
"warning"
) {

if (
amountForensics.severity ===
"strong"
) {

riskEngine.score =
Math.max(
riskEngine.score,
85
);

if (
result?.checks?.amountConsistency
) {

result.checks.amountConsistency.status =
"fail";

result.checks.amountConsistency.score =
Math.max(
Number(
result.checks.amountConsistency.score
) || 0,
85
);

const existingEvidence =
Array.isArray(
result.checks.amountConsistency.evidence
)
?
result.checks.amountConsistency.evidence
:
[];

result.checks.amountConsistency.evidence = [
...existingEvidence,
amountForensics.evidence
];

}

}

}


// =====================================================
// FINAL SCORE
// =====================================================

const finalScore =
Math.max(
0,
Math.min(
100,
Number(
riskEngine.score
) || 0
)
);


// =====================================================
// FINAL LABEL
// =====================================================

let finalLabel;

if (
finalScore >=
85
) {

finalLabel =
"ÇOK YÜKSEK RİSK";

}
else if (
finalScore >=
60
) {

finalLabel =
"YÜKSEK RİSK";

}
else if (
finalScore >=
46
) {

finalLabel =
"ORTA RİSK";

}
else {

finalLabel =
"DÜŞÜK RİSK";

}


// =====================================================
// FINAL EVIDENCE
// =====================================================

const finalEvidence = [];

if (
amountForensics?.status ===
"warning"
) {

finalEvidence.push(
amountForensics.evidence
);

}

if (
Array.isArray(
riskEngine.evidence
)
) {

finalEvidence.push(
...riskEngine.evidence
);

}

if (
informationCheck?.warnings?.length
) {

finalEvidence.push(
...informationCheck.warnings
);

}


// =====================================================
// RESULT NORMALIZATION
// =====================================================

result.score =
finalScore;

result.risk =
finalLabel;

result.suspicious =
finalScore >=
46;

result.evidence =
finalEvidence;

result.riskEngine =
{

score:
finalScore,

label:
finalLabel,

checks:
riskEngine.checks,

};


// =====================================================
// DEBUG
// =====================================================

console.log(
"FINAL SCORE:",
finalScore
);

console.log(
"FINAL LABEL:",
finalLabel
);

console.log(
"FINAL SUSPICIOUS:",
result.suspicious
);

console.log(
"FINAL EVIDENCE COUNT:",
finalEvidence.length
);

console.log(
"AMOUNT FORENSICS:",
JSON.stringify(
amountForensics
)
);


// =====================================================
// RESPONSE
// =====================================================

const duration =
Date.now() -
startTime;

console.log(
"VERIFYDOC API TAMAMLANDI:",
duration,
"ms"
);

return res
.status(200)
.json({

success:
true,

fileName,

type,

bank:
bank ||
null,

reference:
reference?.fileName ||
null,

...result,

});

}
catch (
error
) {

console.error(
"=============================="
);

console.error(
"VERIFYDOC API ERROR"
);

console.error(
error
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
error?.message ||
"Beklenmeyen sunucu hatası.",

});

}

}
