import OpenAI from "openai";


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
// RESPONSE SCHEMA
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


limitations: {

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

"checks",

"limitations",

],


additionalProperties:
false,

};


// =====================================================
// BASE64 NORMALIZE
// =====================================================

function normalizeBase64(
value,
mimeType
) {

if (
!value ||
typeof value !== "string"
) {

throw new Error(
"Dosya verisi alınamadı."
);

}


const clean =
value.trim();


// Zaten data URL ise

if (
clean.startsWith(
"data:"
)
) {

return clean;

}


// Raw base64 ise

const base64 =
clean.replace(
/\s/g,
""
);


if (
!/^[A-Za-z0-9+/]+={0,2}$/.test(
base64
)
) {

throw new Error(
"Geçersiz Base64 dosya verisi."
);

}


return `data:${
mimeType ||
"application/octet-stream"
};base64,${base64}`;

}


// =====================================================
// JSON PARSE
// =====================================================

function parseJsonSafely(
text
) {

if (
!text ||
typeof text !==
"string"
) {

throw new Error(
"AI boş cevap döndürdü."
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

return JSON.parse(
cleaned
);

}

catch {

const start =
cleaned.indexOf(
"{"
);


const end =
cleaned.lastIndexOf(
"}"
);


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
"AI geçerli JSON döndürmedi."
);

}

}


// =====================================================
// HANDLER
// =====================================================

export default async function handler(
req,
res
) {


// ===================================================
// CORS
// ===================================================

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


// OPTIONS

if (
req.method ===
"OPTIONS"
) {

return res
.status(200)
.end();

}


// POST

if (
req.method !==
"POST"
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


// =================================================
// BODY
// =================================================

const body =
req.body || {};


const fileData =
body.fileData;


const fileName =
body.fileName ||
"document";


const type =
body.type ||
"image";


const mimeType =
body.mimeType ||
(
type === "pdf"
? "application/pdf"
: "image/jpeg"
);


console.log(
"=============================="
);

console.log(
"VERIFYDOC API"
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
mimeType
);

console.log(
"DATA:",
fileData
? "VAR"
: "YOK"
);

console.log(
"=============================="
);


// =================================================
// VALIDATION
// =================================================

if (!fileData) {

return res
.status(400)
.json({

success:
false,

error:
"Dosya verisi gönderilmedi. fileData eksik.",

});

}


if (
type !== "image" &&
type !== "pdf"
) {

return res
.status(400)
.json({

success:
false,

error:
"Desteklenmeyen dosya türü.",

});

}


// =================================================
// DATA URL
// =================================================

const dataUrl =
normalizeBase64(
fileData,
mimeType
);


// =================================================
// PROMPT
// =================================================

const prompt = `

You are VerifyDoc.

You are an AI-assisted document forensic screening system.

Analyze the supplied document carefully.

IMPORTANT:

This is a screening assessment only.

Never state that a document is definitely authentic.

Never state that a document is definitely fake.

Do not invent evidence.

Only use evidence that can actually be observed from the supplied document.

If something cannot be reliably determined, use:

status = "unknown"

and explain the limitation.

A clean-looking document does NOT prove authenticity.

A suspicious-looking element does NOT automatically prove fraud.

Do not treat unknown information as suspicious.

Analyze the entire document.

Look for signs of:

- image editing
- inconsistent typography
- inconsistent spacing
- altered numbers
- altered dates
- copy/paste regions
- compression differences
- Photoshop-like artifacts
- AI-generated artifacts
- inconsistent logos
- inconsistent stamps
- inconsistent signatures
- inconsistent IBAN
- inconsistent SWIFT/BIC
- inconsistent currency formatting
- inconsistent amounts
- suspicious QR/barcode areas
- layout problems
- missing document elements

Check exactly these 25 areas:

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
11. Photoshop artifacts
12. AI-generated indicators
13. Logo consistency
14. Stamp consistency
15. Signature consistency
16. Date consistency
17. Amount consistency
18. Currency formatting
19. IBAN formatting
20. SWIFT formatting
21. QR/barcode consistency
22. Layout integrity
23. Suspicious elements
24. Document type consistency
25. Image quality

For every check return:

status:
pass
review
suspicious
unknown

score:

0 = no suspicious evidence

100 = extremely strong suspicious evidence

Evidence must be concise.

Evidence must ONLY be based on visible information.

Calculate:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

Calculate overallRisk from 0 to 100.

Do NOT increase risk because of unknown checks.

Risk labels:

0-20 = LOW RISK

21-45 = MODERATE RISK

46-70 = HIGH RISK

71-100 = VERY HIGH RISK

Confidence must be 0-100.

Reduce confidence when:

- image is blurry
- image is low resolution
- document is cropped
- document is partially hidden
- lighting is poor
- important areas are unreadable
- document quality is insufficient

Also provide limitations.

Return ONLY the JSON object matching the supplied schema.

`;


// =================================================
// OPENAI CONTENT
// =================================================

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

text:
prompt,

},


{

type:
"input_image",

image_url:
dataUrl,

detail:
"high",

},

];

}


// =================================================
// PDF
// =================================================

else if (
type === "pdf"
) {

content = [

{

type:
"input_text",

text:
prompt,

},


{

type:
"input_file",

filename:
fileName,

file_data:
dataUrl,

},

];

}


// =================================================
// OPENAI
// =================================================

console.log(
"OPENAI REQUEST START"
);


const response =
await openai.responses.create({

model:
"gpt-5",

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


// =================================================
// OUTPUT
// =================================================

const output =
response.output_text;


const result =
parseJsonSafely(
output
);


// =================================================
// RESPONSE
// =================================================

return res
.status(200)
.json({

success:
true,

fileName,

type,

...result,

});

}


catch (err) {


console.error(
"VERIFYDOC API ERROR:",
err
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
