import OpenAI from "openai";

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY,
});

// Vercel JSON body limitini artır
export const config = {
 api: {
 bodyParser: {
 sizeLimit: "10mb",
 },
 },
};

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


function parseJsonSafely(text) {
 if (!text || typeof text !== "string") {
 throw new Error(
 "AI returned an empty response"
 );
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

 throw new Error(
 "AI returned invalid JSON"
 );
 }
}


function validateDataUrl(value) {
 if (
 !value ||
 typeof value !== "string"
 ) {
 throw new Error(
 "Dosya verisi alınamadı."
 );
 }

 const trimmed = value.trim();

 if (
 !trimmed.startsWith("data:")
 ) {
 throw new Error(
 "Geçersiz dosya formatı."
 );
 }

 return trimmed;
}


export default async function handler(req, res) {

 // ==========================
 // CORS
 // ==========================

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


 // ==========================
 // METHOD
 // ==========================

 if (req.method !== "POST") {
 return res.status(405).json({
 success: false,
 error: "Method not allowed",
 });
 }


 try {

 console.log(
 "=============================="
 );

 console.log(
 "VERIFYDOC API REQUEST"
 );


 // ==========================
 // BODY
 // ==========================

 const body = req.body || {};

 const fileData =
 body.fileData ||
 body.image ||
 body.file;

 const fileName =
 body.fileName ||
 "document";

 const fileType =
 body.type ||
 "image";


 console.log(
 "FILE NAME:",
 fileName
 );

 console.log(
 "FILE TYPE:",
 fileType
 );

 console.log(
 "HAS FILE DATA:",
 !!fileData
 );


 if (!fileData) {
 throw new Error(
 "No file received"
 );
 }


 const dataUrl =
 validateDataUrl(fileData);


 // ==========================
 // PROMPT
 // ==========================

 const prompt = `
You are VerifyDoc, an AI-assisted document forensic screening system.

Analyze the supplied document carefully.

This is a screening assessment only, not a legal determination.

Never claim that a document is definitely authentic or definitely fake.

Do not invent evidence.

If something cannot be reliably determined from the supplied document, use status "unknown" and explain why.

A clean-looking document does NOT prove authenticity.

Metadata cannot be verified unless metadata is actually supplied.

Analyze visible evidence only.

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

Do not treat unknown checks as suspicious.

Calculate:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

Calculate overallRisk from 0-100.

Risk labels:

0-20 = LOW RISK
21-45 = MODERATE RISK
46-70 = HIGH RISK
71-100 = VERY HIGH RISK

Confidence must be 0-100.

Confidence should decrease when the document is:

- blurry
- cropped
- low resolution
- partially hidden
- poorly lit
- otherwise insufficient

Return ONLY the JSON object matching the supplied schema.
`;


 // ==========================
 // OPENAI CONTENT
 // ==========================

 let content;


 // ==========================
 // IMAGE
 // ==========================

 if (
 fileType === "image"
 ) {

 console.log(
 "OPENAI INPUT: IMAGE"
 );

 content = [
 {
 type: "input_text",
 text: prompt,
 },

 {
 type: "input_image",
 image_url: dataUrl,
 detail: "high",
 },
 ];
 }


 // ==========================
 // PDF
 // ==========================

 else if (
 fileType === "pdf"
 ) {

 console.log(
 "OPENAI INPUT: PDF"
 );

 content = [
 {
 type: "input_text",
 text: prompt,
 },

 {
 type: "input_file",
 file_data: dataUrl,
 },
 ];
 }


 // ==========================
 // VIDEO
 // ==========================

 else {

 throw new Error(
 "Video analizi şu anda desteklenmiyor. Lütfen JPG, PNG veya PDF yükleyin."
 );
 }


 // ==========================
 // OPENAI
 // ==========================

 console.log(
 "OPENAI REQUEST START"
 );


 const response =
 await openai.responses.create({

 model: "gpt-5",

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


 // ==========================
 // RESULT
 // ==========================

 const result =
 parseJsonSafely(
 response.output_text
 );


 console.log(
 "ANALYSIS SUCCESS"
 );


 return res.status(200).json({

 success: true,

 fileName,

 type: fileType,

 ...result,

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
 "Analysis failed",

 });
 }
}
