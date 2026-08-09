import OpenAI from "openai";

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

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
"imageQuality"
];

const CHECK_SCHEMA = Object.fromEntries(
CHECK_NAMES.map((name) => [
name,
{
type: "object",
properties: {
status: {
type: "string",
enum: ["pass", "review", "suspicious", "unknown"]
},
score: {
type: "integer",
minimum: 0,
maximum: 100
},
evidence: {
type: "string"
}
},
required: ["status", "score", "evidence"],
additionalProperties: false
}
])
);

const RESPONSE_SCHEMA = {
type: "object",
properties: {
overallRisk: {
type: "integer",
minimum: 0,
maximum: 100
},

riskLabel: {
type: "string",
enum: [
"LOW RISK",
"MODERATE RISK",
"HIGH RISK",
"VERY HIGH RISK"
]
},

confidence: {
type: "integer",
minimum: 0,
maximum: 100
},

summary: {
type: "string"
},

categories: {
type: "object",
properties: {
visualRisk: {
type: "integer",
minimum: 0,
maximum: 100
},
textRisk: {
type: "integer",
minimum: 0,
maximum: 100
},
layoutRisk: {
type: "integer",
minimum: 0,
maximum: 100
},
financialDataRisk: {
type: "integer",
minimum: 0,
maximum: 100
},
editingRisk: {
type: "integer",
minimum: 0,
maximum: 100
}
},
required: [
"visualRisk",
"textRisk",
"layoutRisk",
"financialDataRisk",
"editingRisk"
],
additionalProperties: false
},

checks: {
type: "object",
properties: CHECK_SCHEMA,
required: CHECK_NAMES,
additionalProperties: false
},

limitations: {
type: "array",
items: {
type: "string"
}
}
},

required: [
"overallRisk",
"riskLabel",
"confidence",
"summary",
"categories",
"checks",
"limitations"
],

additionalProperties: false
};

function normalizeImage(image) {
if (!image || typeof image !== "string") {
throw new Error("No image received");
}

const value = image.trim();

if (
/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(value)
) {
return value;
}

if (/^https?:\/\//i.test(value)) {
return value;
}

const clean = value.replace(/\s/g, "");

if (!/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) {
throw new Error(
"Invalid image format. Send a data URL, image URL, or raw base64."
);
}

return `data:image/jpeg;base64,${clean}`;
}

function parseJsonSafely(text) {
if (!text || typeof text !== "string") {
throw new Error("AI returned an empty response");
}

const cleaned = text
.trim()
.replace(/^```json\s*/i, "")
.replace(/^```\s*/i, "")
.replace(/\s*```$/i, "");

try {
return JSON.parse(cleaned);
} catch {
const start = cleaned.indexOf("{");
const end = cleaned.lastIndexOf("}");

if (start >= 0 && end > start) {
return JSON.parse(
cleaned.slice(start, end + 1)
);
}

throw new Error("AI returned invalid JSON");
}
}

export default async function handler(req, res) {
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

if (req.method === "OPTIONS") {
return res.status(200).end();
}

if (req.method !== "POST") {
return res.status(405).json({
success: false,
error: "Method not allowed"
});
}

try {
const body = req.body || {};

const image = body.image;

const fileName =
body.fileName || "document.jpg";

const type =
body.type || "Document";

const imageUrl =
normalizeImage(image);

const prompt = `
You are VerifyDoc, an AI-assisted document forensic screening system.

Analyze the uploaded document image carefully.

This is a screening assessment only, not a legal determination.

Never claim that a document is definitely authentic or definitely fake.

Do not invent evidence.

If something cannot be reliably determined from the image, use status "unknown" and explain why.

A clean-looking document does NOT prove authenticity.

Metadata cannot be verified from a screenshot or photo unless metadata is actually available.

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

For every check:

- status must be pass, review, suspicious, or unknown
- score must be 0-100
- 0 means no detected suspicious evidence
- 100 means very strong suspicious evidence
- evidence must be concise
- evidence must be based ONLY on visible evidence

Calculate these category scores:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

Calculate overallRisk from 0-100 using the evidence across all checks.

Do not treat unknown checks as suspicious.

Risk labels:

0-20 = LOW RISK
21-45 = MODERATE RISK
46-70 = HIGH RISK
71-100 = VERY HIGH RISK

Confidence must be 0-100.

Confidence should decrease when the image is:

- blurry
- cropped
- low resolution
- partially hidden
- poorly lit
- otherwise insufficient

Return ONLY the JSON object matching the supplied schema.
`;

const response =
await openai.responses.create({
model: "gpt-5",

input: [
{
role: "user",

content: [
{
type: "input_text",
text: prompt
},

{
type: "input_image",
image_url: imageUrl,
detail: "high"
}
]
}
],

text: {
format: {
type: "json_schema",
name: "verifydoc_analysis",
strict: true,
schema: RESPONSE_SCHEMA
}
}
});

const result =
parseJsonSafely(
response.output_text
);

return res.status(200).json({
success: true,
fileName,
type,
...result
});

} catch (err) {

console.error(
"VerifyDoc API error:",
err
);

return res.status(500).json({
success: false,
error:
err?.message ||
"Analysis failed"
});
}
}
