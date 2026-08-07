import OpenAI from "openai";

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY,
});

/*
====================================================
VERIFYDOC RISK ENGINE V2
====================================================

AI = Evidence Collector
Risk Engine = Final Scoring System

PASS = 0 risk
REVIEW = low/moderate risk
SUSPICIOUS = high risk
UNKNOWN = no penalty

The final score is calculated HERE,
not by the AI.
====================================================
*/

const CHECK_WEIGHTS = {
 ocrConsistency: 7,
 fontConsistency: 6,
 fontSizeConsistency: 4,
 characterSpacing: 4,
 lineSpacing: 3,
 textAlignment: 4,
 baselineConsistency: 3,

 compressionArtifacts: 4,
 copyPasteRegions: 7,
 editingTraces: 12,
 photoshopArtifacts: 8,
 aiGeneratedIndicators: 8,

 logoConsistency: 3,
 stampConsistency: 2,
 signatureConsistency: 3,

 dateConsistency: 5,
 amountConsistency: 8,
 currencyFormatting: 3,

 ibanFormatting: 5,
 swiftFormatting: 3,
 qrBarcodeConsistency: 3,

 layoutIntegrity: 5,
 suspiciousElements: 10,
 documentTypeConsistency: 3,

 imageQuality: 2,
};

const STATUS_RISK = {
 pass: 0,
 review: 0.35,
 suspicious: 1,
 unknown: 0,
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
