import OpenAI from "openai";

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY,
});

export const config = {
 api: {
 bodyParser: {
 sizeLimit: "20mb",
 },
 },
};

function response(res, status, data) {
 return res.status(status).json(data);
}

function getImageFromBody(body) {
 if (!body) return null;

 // JSON ile gönderilen seçenekler
 if (typeof body === "object") {
 if (body.image) return body.image;
 if (body.imageData) return body.imageData;
 if (body.base64) return body.base64;
 if (body.document) return body.document;
 }

 // Direkt string gönderilmişse
 if (typeof body === "string") {
 return body;
 }

 return null;
}

function normalizeImage(image) {
 if (!image) return null;

 // Zaten data URL ise
 if (image.startsWith("data:image/")) {
 return image;
 }

 // Base64 olarak geldiyse
 if (/^[A-Za-z0-9+/]+=*$/.test(image)) {
 return `data:image/jpeg;base64,${image}`;
 }

 // URL olarak geldiyse
 if (
 image.startsWith("http://") ||
 image.startsWith("https://")
 ) {
 return image;
 }

 return null;
}

/*
====================================================
 VERIFYDOC RISK ENGINE V2
====================================================

AI = Evidence Collector
Risk Engine = Final Scoring System

PASS = 0 - 24
REVIEW = 25 - 49
SUSPICIOUS = 50 - 74
HIGH RISK = 75 - 100
UNKNOWN = insufficient evidence
*/

function calculateRisk(ai) {
 let score = 0;
 const reasons = [];

 const add = (points, reason) => {
 score += points;
 if (reason) reasons.push(reason);
 };

 if (ai.document_quality === "poor") {
 add(15, "Document quality is poor");
 }

 if (ai.document_quality === "very_poor") {
 add(25, "Document quality is very poor");
 }

 if (ai.edits_detected === true) {
 add(30, "Possible digital editing detected");
 }

 if (ai.inconsistencies_detected === true) {
 add(25, "Internal inconsistencies detected");
 }

 if (ai.text_anomalies === true) {
 add(15, "Text anomalies detected");
 }

 if (ai.layout_anomalies === true) {
 add(15, "Layout anomalies detected");
 }

 if (ai.metadata_anomaly === true) {
 add(10, "Metadata anomaly detected");
 }

 if (ai.logo_anomaly === true) {
 add(15, "Logo or branding anomaly detected");
 }

 if (ai.font_anomaly === true) {
 add(10, "Font inconsistency detected");
 }

 if (ai.amount_anomaly === true) {
 add(20, "Amount or numerical anomaly detected");
 }

 if (ai.date_anomaly === true) {
 add(15, "Date anomaly detected");
 }

 if (ai.identity_anomaly === true) {
 add(25, "Identity information anomaly detected");
 }

 if (ai.missing_expected_fields === true) {
 add(15, "Expected document fields are missing");
 }

 if (ai.suspicious_language === true) {
 add(15, "Suspicious language or wording detected");
 }

 if (ai.ocr_uncertain === true) {
 add(10, "OCR interpretation is uncertain");
 }

 score = Math.min(100, Math.max(0, score));

 let decision = "PASS";

 if (score >= 75) {
 decision = "HIGH_RISK";
 } else if (score >= 50) {
 decision = "SUSPICIOUS";
 } else if (score >= 25) {
 decision = "REVIEW";
 }

 return {
 score,
 decision,
 reasons,
 };
}

async function analyzeImage(image) {
 const prompt = `
You are the evidence collection layer of VerifyDoc Risk Engine V2.

Analyze the supplied document image carefully.

IMPORTANT:
You are NOT the final decision maker.
Do not declare a document legally authentic or legally fraudulent.
Only collect visible evidence and anomalies.

Look for:

1. Document type
2. Document quality
3. Text anomalies
4. Font inconsistencies
5. Layout inconsistencies
6. Logo / branding anomalies
7. Date anomalies
8. Amount / number anomalies
9. Identity information anomalies
10. Missing expected fields
11. Signs of editing or manipulation
12. Suspicious wording
13. OCR uncertainty
14. Internal inconsistencies

Return ONLY valid JSON with this exact structure:

{
 "document_type": "",
 "document_quality": "good|acceptable|poor|very_poor|unknown",
 "edits_detected": false,
 "inconsistencies_detected": false,
 "text_anomalies": false,
 "layout_anomalies": false,
 "metadata_anomaly": false,
 "logo_anomaly": false,
 "font_anomaly": false,
 "amount_anomaly": false,
 "date_anomaly": false,
 "identity_anomaly": false,
 "missing_expected_fields": false,
 "suspicious_language": false,
 "ocr_uncertain": false,
 "categories": [],
 "checks": [],
 "limitations": [],
 "evidence": [],
 "summary": ""
}

Do not invent information that cannot be seen.
If something cannot be determined, use false or "unknown".
`;

 const completion = await openai.chat.completions.create({
 model: "gpt-4o",
 temperature: 0,
 response_format: {
 type: "json_object",
 },
 messages: [
 {
 role: "system",
 content: prompt,
 },
 {
 role: "user",
 content: [
 {
 type: "text",
 text: "Analyze this document image.",
 },
 {
 type: "image_url",
 image_url: {
 url: image,
 detail: "high",
 },
 },
 ],
 },
 ],
 });

 const content =
 completion.choices?.[0]?.message?.content;

 if (!content) {
 throw new Error("AI returned an empty response");
 }

 try {
 return JSON.parse(content);
 } catch {
 throw new Error("AI returned invalid JSON");
 }
}

export default async function handler(req, res) {
 /*
 ==================================================
 CORS
 ==================================================
 */

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

 /*
 ==================================================
 METHOD CHECK
 ==================================================
 */

 if (req.method !== "POST") {
 return response(res, 405, {
 success: false,
 error: "Method not allowed",
 });
 }

 /*
 ==================================================
 API KEY CHECK
 ==================================================
 */

 if (!process.env.OPENAI_API_KEY) {
 console.error("OPENAI_API_KEY is missing");

 return response(res, 500, {
 success: false,
 error: "Server configuration error",
 });
 }

 try {
 /*
 ================================================
 IMAGE EXTRACTION
 ================================================
 */

 const rawImage = getImageFromBody(req.body);

 if (!rawImage) {
 return response(res, 400, {
 success: false,
 error: "No image received",
 expected:
 "Send image, imageData, base64 or document",
 });
 }

 const image = normalizeImage(rawImage);

 if (!image) {
 return response(res, 400, {
 success: false,
 error: "Invalid image format",
 });
 }

 /*
 ================================================
 AI EVIDENCE COLLECTION
 ================================================
 */

 const aiResult = await analyzeImage(image);

 /*
 ================================================
 SERVER-SIDE RISK SCORING
 ================================================
 */

 const riskResult = calculateRisk(aiResult);

 /*
 ================================================
 FINAL RESPONSE
 ================================================
 */

 return response(res, 200, {
 success: true,

 result: {
 documentType:
 aiResult.document_type || "unknown",

 decision: riskResult.decision,

 score: riskResult.score,

 summary:
 aiResult.summary || "",

 categories:
 aiResult.categories || [],

 checks:
 aiResult.checks || [],

 evidence:
 aiResult.evidence || [],

 limitations:
 aiResult.limitations || [],
 },

 engine: {
 name: "VerifyDoc Risk Engine",
 version: "2.0",
 scoring:
 "server-side weighted analysis",
 },

 scoringDetails: {
 score: riskResult.score,
 decision: riskResult.decision,
 reasons: riskResult.reasons,
 },
 });
 } catch (error) {
 console.error(
 "VERIFYDOC API ERROR:",
 error
 );

 return response(res, 500, {
 success: false,
 error:
 error?.message ||
 "Analysis failed",
 });
 }
}
};

function clamp(value, min = 0, max = 100) {
 return Math.max(min, Math.min(max, value));
}

function calculateRisk(checks) {
 let totalWeight = 0;
 let weightedRisk = 0;

 const details = {};

 for (const [name, weight] of Object.entries(CHECK_WEIGHTS)) {
 const check = checks?.[name];

 if (!check) continue;

 const status = String(check.status || "unknown").toLowerCase();

 if (status === "unknown") {
 details[name] = {
 status: "unknown",
 contribution: 0,
 };
 continue;
 }

 const riskFactor = STATUS_RISK[status] ?? 0;

 totalWeight += weight;
 weightedRisk += weight * riskFactor;

 details[name] = {
 status,
 contribution: Number((weight * riskFactor).toFixed(2)),
 };
 }

 if (totalWeight === 0) {
 return {
 score: 0,
 details,
 };
 }

 const score = clamp(
 Math.round((weightedRisk / totalWeight) * 100)
 );

 return {
 score,
 details,
 };
}

function getRiskLabel(score) {
 if (score <= 20) return "LOW RISK";
 if (score <= 45) return "MODERATE RISK";
 if (score <= 70) return "HIGH RISK";
 return "VERY HIGH RISK";
}

function calculateConfidence(checks) {
 const values = Object.values(checks || {});

 const available = values.filter(
 (item) =>
 item &&
 String(item.status).toLowerCase() !== "unknown"
 );

 if (available.length === 0) return 0;

 const average =
 available.reduce(
 (sum, item) => sum + Number(item.confidence || 0),
 0
 ) / available.length;

 return clamp(Math.round(average));
}

function calculateCategories(checks) {
 const groups = {
 visualRisk: [
 "compressionArtifacts",
 "logoConsistency",
 "stampConsistency",
 "signatureConsistency",
 "imageQuality",
 ],

 textRisk: [
 "ocrConsistency",
 "fontConsistency",
 "fontSizeConsistency",
 "characterSpacing",
 "lineSpacing",
 "textAlignment",
 "baselineConsistency",
 ],

 layoutRisk: [
 "layoutIntegrity",
 "copyPasteRegions",
 "suspiciousElements",
 "documentTypeConsistency",
 ],

 financialDataRisk: [
 "dateConsistency",
 "amountConsistency",
 "currencyFormatting",
 "ibanFormatting",
 "swiftFormatting",
 "qrBarcodeConsistency",
 ],

 editingRisk: [
 "editingTraces",
 "photoshopArtifacts",
 "aiGeneratedIndicators",
 ],
 };

 const output = {};

 for (const [category, names] of Object.entries(groups)) {
 let totalWeight = 0;
 let weightedRisk = 0;

 for (const name of names) {
 const check = checks?.[name];

 if (!check) continue;

 const status = String(
 check.status || "unknown"
 ).toLowerCase();

 if (status === "unknown") continue;

 const weight = CHECK_WEIGHTS[name] || 1;
 const risk = STATUS_RISK[status] ?? 0;

 totalWeight += weight;
 weightedRisk += weight * risk;
 }

 output[category] =
 totalWeight === 0
 ? 0
 : clamp(
 Math.round(
 (weightedRisk / totalWeight) * 100
 )
 );
 }

 return output;
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
 error: "Method not allowed",
 });
 }

 try {
 const {
 image,
 fileName,
 type,
 } = req.body || {};

 if (!image) {
 return res.status(400).json({
 success: false,
 error: "No image received",
 });
 }

 const documentType =
 type || "Document";

 const prompt = `
You are VerifyDoc's forensic evidence collector.

Your job is NOT to decide the final risk score.

Your job is to inspect the uploaded ${documentType}
and return structured evidence.

IMPORTANT RULES:

1. Never invent evidence.
2. Never assume a document is authentic.
3. Never assume a document is fake.
4. Only report things visible or reasonably inferable
 from the supplied image.
5. If something cannot be determined, use "unknown".
6. Metadata must be "unknown" unless metadata is
 actually available.
7. A suspicious finding does not automatically prove fraud.
8. Poor image quality should reduce confidence rather
 than create false suspicious findings.

Check:

- OCR consistency
- Font consistency
- Font size consistency
- Character spacing
- Line spacing
- Text alignment
- Baseline consistency
- Compression artifacts
- Copy/paste regions
- Editing traces
- Photoshop-like artifacts
- AI-generated indicators
- Logo consistency
- Stamp consistency
- Signature consistency
- Date consistency
- Amount consistency
- Currency formatting
- IBAN formatting
- SWIFT/BIC formatting
- QR/barcode consistency
- Layout integrity
- Suspicious elements
- Document type consistency
- Image quality

For EVERY check return:

status:
"pass"
"review"
"suspicious"
"unknown"

confidence:
0-100

evidence:
short explanation based on visible evidence.

Return ONLY JSON.

Use exactly this structure:

{
 "checks": {
 "ocrConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "fontConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "fontSizeConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "characterSpacing": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "lineSpacing": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "textAlignment": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "baselineConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "compressionArtifacts": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "copyPasteRegions": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "editingTraces": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "photoshopArtifacts": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "aiGeneratedIndicators": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "logoConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "stampConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "signatureConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "dateConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "amountConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "currencyFormatting": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "ibanFormatting": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "swiftFormatting": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "qrBarcodeConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "layoutIntegrity": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "suspiciousElements": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "documentTypeConsistency": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 },

 "imageQuality": {
 "status": "",
 "confidence": 0,
 "evidence": ""
 }
 },

 "summary": "",
 "limitations": []
}
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
 text: prompt,
 },
 {
 type: "input_image",
 image_url:
 `data:image/jpeg;base64,${image}`,
 },
 ],
 },
 ],
 });

 let aiResult;

 try {
 aiResult = JSON.parse(
 response.output_text
 );
 } catch (error) {
 console.error(
 "AI JSON ERROR:",
 response.output_text
 );

 return res.status(500).json({
 success: false,
 error: "AI returned invalid JSON",
 });
 }

 /*
 ================================================
 HERE THE REAL VERIFYDOC ENGINE STARTS
 ================================================
 */

 const checks =
 aiResult.checks || {};

 const riskResult =
 calculateRisk(checks);

 const overallRisk =
 riskResult.score;

 const riskLabel =
 getRiskLabel(overallRisk);

 const confidence =
 calculateConfidence(checks);

 const categories =
 calculateCategories(checks);

 /*
 ================================================
 FINAL RESPONSE
 ================================================
 */

 return res.status(200).json({
 success: true,

 fileName:
 fileName || "document.jpg",

 type: documentType,

 overallRisk,

 riskLabel,

 confidence,

 summary:
 aiResult.summary ||
 "No summary available.",

 categories,

 checks,

 limitations:
 aiResult.limitations || [],

 engine: {
 name: "VerifyDoc Risk Engine",
 version: "2.0",
 scoring: "server-side weighted analysis",
 },

 scoringDetails:
 riskResult.details,
 });

 } catch (error) {
 console.error(
 "VERIFYDOC API ERROR:",
 error
 );

 return res.status(500).json({
 success: false,
 error:
 error.message ||
 "Analysis failed",
 });
 }
}
