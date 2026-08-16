import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import ffmpegPath from "ffmpeg-static";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const REFERENCE_DIR =
path.join(process.cwd(), "references");

const REFERENCE_MAP = {
akbank: "akbank.pdf",
};

function getReferenceFile(bank) {

if (!bank) {
return null;
}

const key =
bank
.toLowerCase()
.trim()
.replace(/\s+/g, "");

const fileName =
REFERENCE_MAP[key];

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

 const referencePath =
 getReferenceFile(bank);

 if (!referencePath) {
 return null;
 }

 try {

 const buffer =
 await fs.readFile(
 referencePath
 );

 if (!buffer?.length) {
 return null;
 }

 console.log(
 "REFERENCE LOADED:",
 referencePath
 );

 return {
 bank,
 fileName:
 path.basename(referencePath),
 base64:
 buffer.toString("base64"),
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

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY,
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

const CHECK_SCHEMA = Object.fromEntries(

 CHECK_NAMES.map((name) => [

 name,

 {
 type: "object",

 properties: {

 status: {
 type: "string",

 enum: [
 "pass",
 "review",
 "suspicious",
 "unknown",
 ],
 },

 score: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 evidence: {
 type: "string",
 },

 },

 required: [
 "status",
 "score",
 "evidence",
 ],

 additionalProperties: false,
 },

 ])

);


const RESPONSE_SCHEMA = {

 type: "object",

 properties: {

 overallRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 riskLabel: {
 type: "string",

 enum: [
 "LOW RISK",
 "MODERATE RISK",
 "HIGH RISK",
 "VERY HIGH RISK",
 ],
 },

 confidence: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 summary: {
 type: "string",
 },

 categories: {

 type: "object",

 properties: {

 visualRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 textRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 layoutRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 financialDataRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 editingRisk: {
 type: "integer",
 minimum: 0,
 maximum: 100,
 },

 },

 required: [
 "visualRisk",
 "textRisk",
 "layoutRisk",
 "financialDataRisk",
 "editingRisk",
 ],

 additionalProperties: false,
 },

 checks: {

 type: "object",

 properties: CHECK_SCHEMA,

 required: CHECK_NAMES,

 additionalProperties: false,
 },

 limitations: {

 type: "array",

 items: {
 type: "string",
 },

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
 ],

 additionalProperties: false,
};


// =====================================================
// FORMIDABLE
// =====================================================

// =====================================================
// FORMIDABLE
// =====================================================

function parseMultipart(req) {

return new Promise((resolve, reject) => {

const form = formidable({
multiples: false,
keepExtensions: true,
maxFileSize: 25 * 1024 * 1024,
});

form.parse(
req,
(err, fields, files) => {

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

});

}


// =====================================================
// VIDEO → FRAME ÇIKARMA
// =====================================================

async function extractVideoFrames(videoPath) {

const outputDir =
`/tmp/verifydoc-${Date.now()}`;

await fs.mkdir(
outputDir,
{
recursive: true,
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

 if (Array.isArray(value)) {

 return value[0];

 }

 return value;

}


// =====================================================
// DOSYA BUL
// =====================================================

function findUploadedFile(files) {

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


 if (Array.isArray(value)) {

 return value[0];

 }


 return value;

 }


 return null;

}
// =====================================================
// MİKRO KARAKTER / RAKAM TUTARLILIK ANALİZİ
// =====================================================

function analyzeTextCharacterConsistency(text) {

if (
!text ||
typeof text !== "string"
) {

return {
score: 0,
suspicious: false,
reason: "Analiz edilecek metin bulunamadı.",
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
score: 0,
suspicious: false,
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
score: 0,
suspicious: false,
reason:
"Aynı rakamın yeterli tekrarı bulunamadı.",
};

}

/*
* Bu aşamada OCR metnindeki karakterleri
* karşılaştırıyoruz.
*
* ÖNEMLİ:
* Bu fonksiyon tek başına görüntüdeki
* piksel/font farkını kesin olarak ölçmez.
*
* Asıl görsel değerlendirme GPT tarafından
* yapılmaya devam eder.
*/

return {
score: 0,
suspicious: false,
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
// ANA TUTAR VE KARAKTER KOORDİNATLARINI BUL
// =====================================================

async function locateAmountCharacters(
base64,
mime
) {

if (!base64) {
return null;
}

try {

const imageDataUrl =
`data:${mime || "image/jpeg"};base64,${base64}`;

const response =
await openai.responses.create({

model: "gpt-5-mini",

input: [
{
role: "user",

content: [

{
type: "input_text",

text: `
Bu belgeyi adli görsel inceleme amacıyla analiz et.

Özellikle belgedeki ANA İŞLEM TUTARINI bul.

Örneğin:

1000 TL
1.000,00 TL
1000,00 EUR
€1,000.00

gibi ana tutarı tespit et.

ÇOK ÖNEMLİ:

Tutar içerisindeki HER karakterin görüntü üzerindeki
yaklaşık koordinatlarını ayrı ayrı belirle.

Örneğin:

1000,00

için:

1
0
0
0
,
0
0

şeklinde ayrı karakterler döndür.

Koordinatlar 0-1000 arasında normalize edilmelidir.

x = karakterin sol kenarı
y = karakterin üst kenarı
width = karakter genişliği
height = karakter yüksekliği

Ana işlem tutarını;

- IBAN
- hesap numarası
- işlem numarası
- tarih
- referans numarası
- başka bir tutar

ile karıştırma.

Belgede ana işlem tutarı açıkça bulunamıyorsa:

amount = null
characters = []

döndür.

SADECE JSON döndür.
`,
},

{
type: "input_image",

image_url:
imageDataUrl,

detail: "high",
},

],
},
],

text: {

format: {

type: "json_schema",

name:
"amount_character_locations",

strict: true,

schema: {

type: "object",

properties: {

amount: {
type: ["string", "null"],
},

characters: {

type: "array",

items: {

type: "object",

properties: {

char: {
type: "string",
},

x: {
type: "number",
},

y: {
type: "number",
},

width: {
type: "number",
},

height: {
type: "number",
},

},

required: [
"char",
"x",
"y",
"width",
"height",
],

additionalProperties: false,

},

},

},

required: [
"amount",
"characters",
],

additionalProperties: false,

},

},

},

});

const result =
JSON.parse(
response.output_text
);

console.log(
"AMOUNT LOCATION:",
result
);

return result;

} catch (error) {

console.error(
"AMOUNT LOCATION ERROR:",
error
);

return null;

}

}



// =====================================================
// TUTAR ALANI - KARAKTER / FONT TUTARLILIK ANALİZİ
// =====================================================

async function analyzeAmountCharacters(
base64,
mime,
amountCharacters
) {

try {

if (
!base64 ||
!amountCharacters ||
!amountCharacters.length
) {

return {
suspicious: false,
score: 0,
fontConsistent: true,
suspiciousCharacters: [],
comparisons: [],
evidence:
"Tutar karakterleri analiz edilemedi."
};

}

const imageDataUrl =
`data:${mime || "image/jpeg"};base64,${base64}`;

const characterInfo =
amountCharacters.map(
(item, index) => ({
index,
char: item.char,
x: item.x,
y: item.y,
width: item.width,
height: item.height
})
);

console.log(
"======================================"
);

console.log(
"AMOUNT FONT ANALYSIS START"
);

console.log(
"CHARACTERS:",
characterInfo
);


const response =
await openai.responses.create({

model: "gpt-5-mini",

input: [

{
role: "user",

content: [

{
type: "input_text",

text: `
Sen belge ve finansal doküman görsellerindeki
TUTAR ALANI KARAKTERLERİNİN GÖRSEL TUTARLILIĞINI
inceleyen bir analiz sistemisin.

AMAÇ:

Ana işlem tutarındaki karakterlerin aynı belge
içerisindeki diğer karakterlerle görsel olarak
tutarlı olup olmadığını değerlendir.

Örneğin ana tutar:

1250 TL

ise:

1
2
5
0

karakterlerini incele.

Farklı rakamların doğal olarak farklı şekilleri vardır.
Bir rakam diğer rakamdan farklı görünüyor diye
şüpheli kabul etme.

Önemli olan aynı karakterin veya aynı yazı
karakteristiğinin tutarlı olup olmadığıdır.

İNCELE:

1. Karakter yüksekliği
2. Karakter genişliği
3. Stroke kalınlığı
4. Kenar yumuşaklığı
5. Anti-aliasing
6. Piksel/render görünümü
7. Font ağırlığı
8. Baseline hizalaması
9. Dikey hizalama
10. Genel font karakteristiği
11. Aynı tutardaki diğer karakterlerle görsel tutarlılık


Fotoğraf açısı, perspektif, ışık, JPEG sıkıştırması,
bulanıklık ve görüntü kalitesi kaynaklı küçük farkları
sahtecilik olarak değerlendirme.

Tek başına küçük bir farklılık şüpheli değildir.

Gerçekten belirgin bir görsel tutarsızlık varsa
suspicious değerini true yap.

Yeterli görsel kanıt yoksa bunu şüpheli kabul etme.

Ana tutar karakterleri:

${JSON.stringify(
characterInfo,
null,
2
)}

SADECE GEÇERLİ JSON DÖNDÜR.

JSON FORMAT:

{
"fontConsistent": true,
"suspicious": false,
"score": 0,
"suspiciousCharacters": [],
"comparisons": [],
"evidence": ""
}

comparisons içerisindeki örnek:

{
"char": "5",
"index": 0,
"consistency": 94,
"reason": "Karakter diğer görsel karakteristiklerle tutarlı."
}

SKOR:

0-20 = çok düşük şüphe
21-40 = düşük şüphe
41-60 = orta şüphe
61-80 = yüksek şüphe
81-100 = çok yüksek şüphe

unknown veya belirlenemeyen durumları
şüpheli olarak değerlendirme.

Tüm açıklamalar Türkçe olmalıdır.
`
},

{
type: "input_image",

image_url: imageDataUrl,

detail: "high"
}

]
}

],

text: {

format: {

type: "json_schema",

name: "amount_font_analysis",

strict: true,

schema: {

type: "object",

properties: {

fontConsistent: {
type: "boolean"
},

suspicious: {
type: "boolean"
},

score: {
type: "integer",
minimum: 0,
maximum: 100
},

suspiciousCharacters: {

type: "array",

items: {
type: "string"
}

},

comparisons: {

type: "array",

items: {

type: "object",

properties: {

char: {
type: "string"
},

index: {
type: "integer"
},

consistency: {
type: "integer",
minimum: 0,
maximum: 100
},

reason: {
type: "string"
}

},

required: [
"char",
"index",
"consistency",
"reason"
],

additionalProperties: false

}

},

evidence: {
type: "string"
}

},

required: [
"fontConsistent",
"suspicious",
"score",
"suspiciousCharacters",
"comparisons",
"evidence"
],

additionalProperties: false

}

}

}

});


const result =
JSON.parse(
response.output_text
);


let score =
Number(result.score);

if (
!Number.isFinite(score)
) {
score = 0;
}

score =
Math.max(
0,
Math.min(
100,
Math.round(score)
)
);


const suspiciousCharacters =
Array.isArray(
result.suspiciousCharacters
)
? result.suspiciousCharacters
: [];


const comparisons =
Array.isArray(
result.comparisons
)
? result.comparisons
: [];


const suspicious =
result.suspicious === true ||
suspiciousCharacters.length > 0;


console.log(
"AMOUNT FONT ANALYSIS RESULT:",
{
suspicious,
score,
suspiciousCharacters
}
);


return {

suspicious,

score,

fontConsistent:
result.fontConsistent !== false,

suspiciousCharacters,

comparisons,

evidence:
result.evidence ||
"Tutar karakterleri görsel olarak analiz edildi."

};


} catch (error) {

console.error(
"AMOUNT FONT ANALYSIS ERROR:"
);

console.error(error);


return {

suspicious: false,

score: 0,

fontConsistent: true,

suspiciousCharacters: [],

comparisons: [],

evidence:
"Tutar karakterlerinin görsel analizi gerçekleştirilemedi."

};

}

}


// =====================================================
// TUTAR KARAKTER ÇAPRAZ KARŞILAŞTIRMA
// =====================================================

async function analyzeAmountCharacterCrossCheck(
base64,
mime,
amountCharacters
) {

try {

if (
!base64 ||
!amountCharacters ||
!amountCharacters.length
) {

return {

suspicious: false,

score: 0,

comparisons: [],

suspiciousCharacters: [],

evidence:
"Belge içi karakter karşılaştırması için yeterli veri bulunamadı."

};

}


const imageDataUrl =
`data:${mime || "image/jpeg"};base64,${base64}`;


const amountInfo =
amountCharacters.map(
(item, index) => ({

index,

char: item.char,

x: item.x,

y: item.y,

width: item.width,

height: item.height

})
);


const response =
await openai.responses.create({

model: "gpt-5-mini",

input: [

{

role: "user",

content: [

{

type: "input_text",

text: `
Sen belge adli inceleme sisteminin
KARAKTER ÇAPRAZ KARŞILAŞTIRMA modülüsün.

Ana işlem tutarındaki karakterleri aynı belgede
başka yerlerde bulunan aynı karakterlerle
görsel olarak karşılaştır.

Örneğin ana tutar:

1250 TL

ise 1, 2, 5 ve 0 karakterlerini incele.

Belgede başka bir yerde aynı karakter bulunuyorsa
referans olarak kullan.

Karakterin:

- font görünümünü
- stroke kalınlığını
- genişliğini
- yüksekliğini
- kenar yumuşaklığını
- anti-aliasing görünümünü
- piksel/render karakteristiğini
- baseline hizalamasını

karşılaştır.

Fotoğraf kalitesi, perspektif, ışık, JPEG sıkıştırması
ve bulanıklık kaynaklı küçük farklılıkları şüpheli
olarak değerlendirme.

Aynı karakterin belgede başka yerde bulunmaması
şüpheli değildir.

Yeterli referans yoksa consistency değerini
"unknown" olarak belirt.

Ana işlem tutarı karakterleri:

${JSON.stringify(
amountInfo,
null,
2
)}


SADECE GEÇERLİ JSON DÖNDÜR.

FORMAT:

{
"suspicious": false,
"score": 0,
"comparisons": [],
"suspiciousCharacters": [],
"evidence": ""
}

comparison formatı:

{
"amountCharacter": "5",
"referenceFound": true,
"referenceCount": 3,
"consistency": 94,
"status": "consistent",
"reason": "Karakter diğer referanslarla görsel olarak tutarlı."
}

status sadece:

"consistent"
"potentially_different"
"unknown"

olabilir.

unknown durumunu şüpheli kabul etme.

Tek bir küçük karakter farklılığı kesin sahtecilik
anlamına gelmez.

Sadece gerçekten belirgin görsel tutarsızlık varsa
suspicious değerini true yap.

Tüm açıklamalar Türkçe olmalıdır.
`
},

{

type: "input_image",

image_url: imageDataUrl,

detail: "high"

}

]

}

],

text: {

format: {

type: "json_schema",

name: "amount_character_cross_check",

strict: true,

schema: {

type: "object",

properties: {

suspicious: {
type: "boolean"
},

score: {
type: "integer",
minimum: 0,
maximum: 100
},

comparisons: {

type: "array",

items: {

type: "object",

properties: {

amountCharacter: {
type: "string"
},

referenceFound: {
type: "boolean"
},

referenceCount: {
type: "integer"
},

consistency: {
type: "integer",
minimum: 0,
maximum: 100
},

status: {
type: "string",

enum: [
"consistent",
"potentially_different",
"unknown"
]
},

reason: {
type: "string"
}

},

required: [
"amountCharacter",
"referenceFound",
"referenceCount",
"consistency",
"status",
"reason"
],

additionalProperties: false

}

},

suspiciousCharacters: {

type: "array",

items: {
type: "string"
}

},

evidence: {
type: "string"
}

},

required: [
"suspicious",
"score",
"comparisons",
"suspiciousCharacters",
"evidence"
],

additionalProperties: false

}

}

}

});


const result =
JSON.parse(
response.output_text
);


let score =
Number(result.score);

if (
!Number.isFinite(score)
) {
score = 0;
}


score =
Math.max(
0,
Math.min(
100,
Math.round(score)
)
);


return {

suspicious:
result.suspicious === true,

score,

comparisons:
Array.isArray(
result.comparisons
)
? result.comparisons
: [],

suspiciousCharacters:
Array.isArray(
result.suspiciousCharacters
)
? result.suspiciousCharacters
: [],

evidence:
result.evidence ||
"Belge içi karakter karşılaştırması tamamlandı."

};


} catch (error) {

console.error(
"AMOUNT CROSS CHECK ERROR:",
error
);


return {

suspicious: false,

score: 0,

comparisons: [],

suspiciousCharacters: [],

evidence:
"Belge içi karakter karşılaştırması gerçekleştirilemedi."

};

}

}
// =====================================================
// JSON RESPONSE
// =====================================================

function parseAIResponse(text) {

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
 /\s*```$/i,
 ""
 );


 try {

 return JSON.parse(cleaned);

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

Sen VerifyDoc isimli AI destekli belge inceleme sistemisin.

AMAÇ:
Belgede olası dijital manipülasyon, tutarsızlık, montaj,
olağandışı tipografi, finansal veri tutarsızlığı ve düzenleme
izlerini tespit etmek.

Bu yalnızca bir ÖN İNCELEMEDİR.

Belgenin kesinlikle gerçek veya kesinlikle sahte olduğunu söyleme.
Kanıt olmayan hiçbir bulgu üretme.
Görülemeyen veya doğrulanamayan bilgiler için "unknown" kullan.
Unknown durumunu şüpheli kabul etme.

TÜM cevaplar TÜRKÇE olmalıdır.
Türkçe karakterleri koru:
ç, ğ, ı, İ, ö, ş, ü.

=====================================================
25 KONTROL
=====================================================

Aşağıdaki tüm alanları değerlendir:

1. OCR/text consistency
2. Font consistency
3. Font size consistency
4. Character spacing
5. Line spacing
6. Text alignment
7. Baseline consistency
8. Compression artifacts
9. Copy/paste regions
10. Editing traces
11. Photoshop-like artifacts
12. AI-generated indicators
13. Logo/branding consistency
14. Stamp consistency
15. Signature consistency
16. Date consistency
17. Amount consistency
18. Currency formatting
19. IBAN formatting
20. SWIFT/BIC formatting
21. QR/barcode consistency
22. Layout integrity
23. Suspicious or missing elements
24. Document type consistency
25. Image/document quality

Her kontrol için:

status:
"pass", "review", "suspicious" veya "unknown"

score:
0-100

0 = şüpheli kanıt yok
100 = çok güçlü şüpheli kanıt

evidence:
Kısa ve somut Türkçe açıklama.

=====================================================
GÖRSEL İNCELEME
=====================================================

Özellikle şunları kontrol et:

- font ve yazı karakteri tutarlılığı
- font boyutu
- karakter aralıkları
- satır aralıkları
- hizalama
- baseline
- rakamların görünümü
- tutar alanı
- tarih alanı
- IBAN
- SWIFT/BIC
- logo
- kaşe
- imza
- QR/barcode
- yapıştırılmış veya sonradan eklenmiş bölgeler
- farklı sıkıştırma veya render bölgeleri
- Photoshop benzeri düzenleme izleri
- AI üretimi görüntü belirtileri
- belge genel yerleşimi

Küçük farklılıkları tek başına sahtecilik olarak değerlendirme.

Fotoğraf açısı, perspektif, ışık, bulanıklık, JPEG sıkıştırması
ve görüntü kalitesinden kaynaklanan doğal farklılıkları şüpheli
olarak değerlendirme.

Birden fazla bağımsız ve anlamlı tutarsızlık olmadıkça risk
artırma.

=====================================================
TÜRKÇE KARAKTERLER
=====================================================

ç, ğ, ı, İ, ö, ş, ü karakterlerini dikkatle incele.

Karakterlerin:

- şekli
- fontu
- boyutu
- spacing
- baseline
- render görünümü

çevredeki metinle tutarlı mı kontrol et.

Bir karakterin okunmasının zor olması tek başına şüpheli değildir.

Görüntü kalitesi nedeniyle "ı/i", "İ/I", "ş/s" gibi karakterler
kesin ayırt edilemiyorsa unknown kullan.

=====================================================
BANKA / KURUM ŞABLONU
=====================================================

Görülebiliyorsa belgeyi oluşturan banka veya kurumu belirle.

Yeterli kanıt yoksa kurum adı tahmin etme ve unknown kullan.

Kurum belirlenebiliyorsa:

- logo
- başlık
- font
- font ağırlığı
- tarih formatı
- tutar formatı
- IBAN formatı
- sender/recipient alanları
- işlem bilgileri
- renkler
- bölüm sıralaması
- footer
- QR/barcode

arasında iç tutarlılığı kontrol et.

Farklı banka uygulamaları, mobil/web sistemleri, belge sürümleri,
işlem türleri veya yazılım sürümleri farklı tasarım oluşturabilir.

Bu nedenle başka bir örnekten farklı olması tek başına sahtecilik
kanıtı değildir.

=====================================================
REFERANS DEKONT
=====================================================

Sağlanan referans dekont varsa:

- şablon
- yerleşim
- tipografi
- logo
- tarih formatı
- tutar formatı
- IBAN formatı
- genel görsel yapı

açısından karşılaştır.

Referansla birebir aynı olmamasını sahtecilik olarak değerlendirme.

Referans dekontu kesin gerçeklik kanıtı olarak kullanma.

=====================================================
PDF / GÖRÜNTÜ KALİTESİ
=====================================================

PDF olması tek başına düşük kalite anlamına gelmez.

Belge:

- native digital PDF
- scanned PDF
- image-based PDF
- photograph converted to PDF
- mixed PDF

olabilir.

Bunu kesin belirleyemiyorsan unknown kullan.

Sadece gerçekten görülen:

- bulanıklık
- pixelation
- compression
- scan noise
- cropping
- glare
- shadow
- perspective distortion
- okunamayan karakterler

gibi sorunları kalite sınırlaması olarak belirt.

Belge analiz için yeterliyse gereksiz şekilde düşük kalite uyarısı verme.

=====================================================
RİSK
=====================================================

Şu kategorileri 0-100 arasında değerlendir:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

overallRisk 0-100 arasında olmalıdır.

Risk:

0-20 LOW RISK
21-45 MODERATE RISK
46-70 HIGH RISK
71-100 VERY HIGH RISK

confidence 0-100 olmalıdır.

Görüntü kalitesi veya eksik bilgi nedeniyle güven düşükse
confidence değerini düşür.

Temiz görünen belgeyi otomatik olarak gerçek kabul etme.

Şüpheli görünen belgeyi de otomatik olarak sahte kabul etme.

=====================================================
SON KURAL
=====================================================

Her bulgu yalnızca görüntüde gerçekten görülen veya mevcut veriden
desteklenen kanıta dayanmalıdır.

Kanıt yoksa unknown kullan.

SADECE verilen JSON schema'ya uygun JSON döndür.

`;

// =====================================================
// API
// =====================================================

export default async function handler(
 req,
 res
) {
let result ;
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

 success: false,

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
const startTime = Date.now();


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
 findUploadedFile(files);


 if (!uploadedFile) {

 throw new Error(
 "Dosya alınamadı. image, file veya video alanı bulunamadı."
 );

 }


 const type =
 first(fields?.type) ||
 "document";


 const fileName =
 first(fields?.fileName) ||
 uploadedFile.originalFilename ||
 "document";


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


 // -------------------------------------------------
 // DOSYA
 // -------------------------------------------------

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


 if (!buffer?.length) {

 throw new Error(
 "Dosya boş."
 );

 }


 // -------------------------------------------------
 // BASE64
 // -------------------------------------------------

 const base64 =
 buffer.toString(
 "base64"
 );


 let mime = uploadedFile.mimetype;

if (
type === "image" &&
(!mime || !mime.startsWith("image/"))
) {
const extension =
path.extname(fileName).toLowerCase();

if (extension === ".png") {
mime = "image/png";
} else if (
extension === ".webp"
) {
mime = "image/webp";
} else if (
extension === ".jpg" ||
extension === ".jpeg"
) {
mime = "image/jpeg";
} else {
mime = "image/jpeg";
}
}

if (
type === "pdf" &&
(!mime || !mime.includes("pdf"))
) {
mime = "application/pdf";
}

if (
type === "video" &&
(!mime || !mime.startsWith("video/"))
) {
mime = "video/mp4";
}

console.log(
"FINAL MIME:",
mime
);

  // =====================================================
// REFERANS DEKONT
// =====================================================

// Şimdilik sistemdeki Akbank referansı kullanılıyor.
const reference =
 await loadReferenceFile("akbank");

console.log(
 "REFERENCE:",
 reference?.fileName || "YOK"
);

// =====================================================
// TUTAR KARAKTER ANALİZİ
// =====================================================

let amountLocation = null;

let amountCharacters = [];

let amountAnalysis = {
 suspicious: false,
 score: 0,
 fontConsistent: true,
 suspiciousCharacters: [],
 comparisons: [],
 evidence:
 "Tutar karakter analizi bu dosya türünde çalıştırılmadı."
};

let amountCharacterCrossCheck = {
 suspicious: false,
 score: 0,
 comparisons: [],
 suspiciousCharacters: [],
 evidence:
 "Belge içi karakter karşılaştırması bu dosya türünde çalıştırılmadı."
};


// =====================================================
// SADECE IMAGE İÇİN
// =====================================================

if (type === "image") {

 console.log(
 "IMAGE AMOUNT ANALYSIS START"
 );
  
// ANA TUTARIN KARAKTER KOORDİNATLARINI BUL
 amountLocation = await locateAmountCharacters(
base64,
mime
);

// =====================================================
// TUTAR KARAKTER / FONT ANALİZİ
// =====================================================

const amountCharacters =
Array.isArray(amountLocation)
? amountLocation
: (
amountLocation?.characters ||
[]
);

 amountAnalysis =
await analyzeAmountCharacters(
base64,
mime,
amountCharacters
);

console.log(
"AMOUNT FONT ANALYSIS:",
amountAnalysis
);

// =====================================================
// BELGE İÇİ AYNI KARAKTER ÇAPRAZ ANALİZİ
// =====================================================

 amountCharacterCrossCheck =
await analyzeAmountCharacterCrossCheck(
base64,
mime,
amountLocation?.characters || []
);

console.log(
"AMOUNT CHARACTER CROSS CHECK:",
amountCharacterCrossCheck
);
}
  
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
 type: "input_text",

 text: `${PROMPT}
   
=====================================================
REFERANS DEKONT
=====================================================

Bu analizde ayrıca bir referans dekont sağlanmıştır.

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

Filename: ${fileName}`,
 },

 {
 type: "input_image",

 image_url:
 imageDataUrl,

 detail: "auto",
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
type: "input_text",

text: `${PROMPT}

=====================================================
REFERANS DEKONT
=====================================================

Bu analizde ayrıca bir referans dekont sağlanmıştır.

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
${fileName}
`,
},

{
type: "input_file",

 filename: fileName,

 file_data: pdfDataUrl,
 },

...(reference?.base64
? [
{
type: "input_file",

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

else if (type === "video") {

console.log("VIDEO ANALYSIS START");

const frames =
await extractVideoFrames(filePath);

console.log(
"VIDEO FRAMES EXTRACTED:",
frames.length
);

const videoResult =
await analyzeVideoFrames(frames);

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

success: true,

fileName,

type,

videoAnalysis:
videoResult,

});

} else {

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

 model: "gpt-5-mini",

 input: [

 {
 role: "user",

 content,
 },

 ],

 text: {

 format: {

 type: "json_schema",

 name:
 "verifydoc_analysis",

 strict: true,

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
((Date.now() - startTime) / 1000).toFixed(2),
"seconds"
);

 // -------------------------------------------------
 // PARSE
 // -------------------------------------------------

const result =
parseAIResponse(
 response.output_text
 );
// =====================================================
// ANA SKOR + TUTAR FONT SKORU
// =====================================================

const originalScore =
Number(result.overallRisk) || 0;

const amountScore =
Number(amountAnalysis?.score) || 0;

const finalScore =
Math.min(
100,
Math.round(
originalScore * 0.80 +
amountScore * 0.20
)
);

const finalSuspicious =
amountAnalysis?.suspicious === true ||
originalScore >=46;

const finalEvidence = [
amountAnalysis?.evidence
]
.filter(Boolean)
.join(" | ");

console.log(
"FINAL SCORE:",
finalScore
);

console.log(
"AMOUNT FONT SCORE:",
amountScore
);


 console.log(
 "ANALYSIS SUCCESS"
 );
console.log(
"TOTAL SURE:",
((Date.now() - startTime) / 1000).toFixed(2),
"seconds"
);

 console.log(
 "=============================="
 );


 return res
 .status(200)
 .json({
 success: true,

 fileName,

 type,

 ...result,

 // ANA SKOR
 score: finalScore,

 // ANA ŞÜPHE DURUMU
 suspicious: finalSuspicious,

 // BİRLEŞTİRİLMİŞ KANIT
 evidence: finalEvidence,

 // TUTAR ANALİZİ

 });


 } catch (err) {

 console.error(
 "=============================="
 );

 console.error(
 "VERIFYDOC API ERROR:"
 );

 console.error(err);


 console.error(
 "=============================="
 );


 return res
 .status(500)
 .json({

 success: false,

 error:
 err?.message ||
 "Analysis failed",

 });

 }

}
