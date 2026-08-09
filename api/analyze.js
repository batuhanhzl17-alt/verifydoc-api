import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs/promises";

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

function parseMultipart(req) {

 return new Promise((resolve, reject) => {

 const form =
 formidable({

 multiples: false,

 keepExtensions: true,

 maxFileSize:
 25 * 1024 * 1024,

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

You are VerifyDoc, an AI-assisted document forensic screening system.

Analyze the supplied document carefully.

This is ONLY a screening assessment.

Never claim that a document is definitely authentic.

Never claim that a document is definitely fake.

Do not invent evidence.

Every finding must be based only on visible or actually available evidence.

If something cannot be reliably determined, use "unknown".

A clean-looking document does NOT prove authenticity.

Do not treat unknown checks as suspicious.

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

Evidence must be concise.

Do not invent evidence.

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

Return ONLY the JSON object matching the supplied schema.

`;


// =====================================================
// API
// =====================================================

export default async function handler(
 req,
 res
) {

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


 const mime =
 uploadedFile.mimetype ||
 "application/octet-stream";


 // -------------------------------------------------
 // OPENAI INPUT
 // -------------------------------------------------

 let content;


 // =================================================
 // IMAGE
 // =================================================

 if (
 type === "image"
 ) {

 const imageDataUrl =
 `data:${mime};base64,${base64}`;


 content = [

 {
 type: "input_text",

 text:
 PROMPT +
 `\n\nFilename: ${fileName}`,
 },

 {
 type: "input_image",

 image_url:
 imageDataUrl,

 detail: "high",
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

 text:
 PROMPT +
 `\n\nFilename: ${fileName}`,
 },

 {
 type: "input_file",

 filename: fileName,

 file_data:
 pdfDataUrl,

 },

 ];

 }


 // =================================================
 // VIDEO
 // =================================================

 else if (
 type === "video"
 ) {

 throw new Error(
 "Video analizi şu aşamada aktif değil. Önce görsel ve PDF analizini çalıştırıyoruz."
 );

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


 // -------------------------------------------------
 // PARSE
 // -------------------------------------------------

 const result =
 parseAIResponse(
 response.output_text
 );


 console.log(
 "ANALYSIS SUCCESS"
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
