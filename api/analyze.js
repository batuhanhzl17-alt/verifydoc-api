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

const ENGINE = {
 name: "VerifyDoc Risk Engine",
 version: "2.0",
 scoring: "server-side weighted analysis",
};

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

const ALLOWED_TYPES = [
 "image/jpeg",
 "image/jpg",
 "image/png",
 "image/webp",
];

/* -------------------------------------------------------
 BASIC HELPERS
------------------------------------------------------- */

function send(res, status, data) {
 return res.status(status).json(data);
}

function clean(value) {
 if (value === null || value === undefined) return "";
 return String(value).trim();
}

function number(value, fallback = 0) {
 const n = Number(value);
 return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min = 0, max = 100) {
 return Math.min(max, Math.max(min, number(value)));
}

function array(value) {
 if (Array.isArray(value)) return value;
 if (value === undefined || value === null) return [];
 return [value];
}

/* -------------------------------------------------------
 CORS
------------------------------------------------------- */

function setCors(res) {
 res.setHeader("Access-Control-Allow-Origin", "*");
 res.setHeader(
 "Access-Control-Allow-Methods",
 "POST, OPTIONS"
 );
 res.setHeader(
 "Access-Control-Allow-Headers",
 "Content-Type, Authorization"
 );
 res.setHeader("Cache-Control", "no-store");
}

/* -------------------------------------------------------
 IMAGE EXTRACTION
------------------------------------------------------- */

function getImageFromBody(body) {
 if (!body || typeof body !== "object") {
 return null;
 }

 if (body.image) return body.image;
 if (body.imageUrl) return body.imageUrl;
 if (body.file) return body.file;
 if (body.document) return body.document;

 return null;
}

/* -------------------------------------------------------
 IMAGE VALIDATION
------------------------------------------------------- */

function validateImage(image) {
 if (!image) {
 return {
 ok: false,
 error: "No image received",
 };
 }

 if (typeof image !== "string") {
 return {
 ok: false,
 error: "Image must be a string",
 };
 }

 /* DATA URL */

 if (image.startsWith("data:")) {
 const match = image.match(
 /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s
 );

 if (!match) {
 return {
 ok: false,
 error: "Invalid image data",
 };
 }

 const mime = match[1].toLowerCase();
 const base64 = match[2].replace(/\s/g, "");

 if (!ALLOWED_TYPES.includes(mime)) {
 return {
 ok: false,
 error: `Unsupported image type: ${mime}`,
 };
 }

 const estimatedSize =
 Math.floor((base64.length * 3) / 4);

 if (estimatedSize > MAX_IMAGE_SIZE) {
 return {
 ok: false,
 error: "Image is larger than 20 MB",
 };
 }

 return {
 ok: true,
 value: image,
 type: mime,
 };
 }

 /* PUBLIC URL */

 try {
 const url = new URL(image);

 if (
 url.protocol !== "http:" &&
 url.protocol !== "https:"
 ) {
 return {
 ok: false,
 error: "Invalid image URL",
 };
 }

 return {
 ok: true,
 value: image,
 type: "url",
 };
 } catch {
 return {
 ok: false,
 error: "Invalid image URL",
 };
 }
}

/* -------------------------------------------------------
 JSON CLEANING
------------------------------------------------------- */

function cleanAIResponse(text) {
 let output = clean(text);

 output = output
 .replace(/^```json/i, "")
 .replace(/^```/i, "")
 .replace(/```$/i, "")
 .trim();

 const start = output.indexOf("{");
 const end = output.lastIndexOf("}");

 if (start !== -1 && end !== -1) {
 output = output.substring(start, end + 1);
 }

 return output;
}

function parseAIResponse(text) {
 const cleaned = cleanAIResponse(text);

 if (!cleaned) {
 throw new Error("Empty AI response");
 }

 try {
 return JSON.parse(cleaned);
 } catch {
 throw new Error("AI returned invalid JSON");
 }
}

/* -------------------------------------------------------
 DOCUMENT NORMALIZATION
------------------------------------------------------- */

function normalizeDocument(document) {
 const d =
 document && typeof document === "object"
 ? document
 : {};

 return {
 type: clean(d.type) || "bank_receipt",

 bankName: clean(d.bankName),

 accountHolder: clean(d.accountHolder),

 senderName: clean(d.senderName),

 receiverName: clean(d.receiverName),

 senderIban: clean(d.senderIban),

 receiverIban: clean(d.receiverIban),

 amount: clean(d.amount),

 currency: clean(d.currency),

 transactionDate: clean(d.transactionDate),

 transactionTime: clean(d.transactionTime),

 reference: clean(d.reference),

 transactionId: clean(d.transactionId),

 statusText: clean(d.statusText),

 extractedText: clean(d.extractedText).slice(
 0,
 12000
 ),
 };
}

/* -------------------------------------------------------
 CATEGORIES
------------------------------------------------------- */

function normalizeCategories(categories) {
 return array(categories).map((category, index) => {
 if (typeof category === "string") {
 return {
 id: `category_${index + 1}`,
 name: category,
 score: 0,
 status: "unknown",
 details: "",
 };
 }

 const c =
 category && typeof category === "object"
 ? category
 : {};

 return {
 id:
 clean(c.id) ||
 `category_${index + 1}`,

 name:
 clean(c.name) ||
 "Unnamed category",

 score: clamp(c.score),

 status:
 clean(c.status).toLowerCase() ||
 "unknown",

 details: clean(c.details),
 };
 });
}

/* -------------------------------------------------------
 CHECKS
------------------------------------------------------- */

function normalizeChecks(checks) {
 return array(checks).map((check, index) => {
 if (typeof check === "string") {
 return {
 id: `check_${index + 1}`,
 name: check,
 status: "unknown",
 severity: "medium",
 score: 0,
 details: "",
 evidence: "",
 };
 }

 const c =
 check && typeof check === "object"
 ? check
 : {};

 return {
 id:
 clean(c.id) ||
 `check_${index + 1}`,

 name:
 clean(c.name) ||
 "Unnamed check",

 status:
 clean(c.status).toLowerCase() ||
 "unknown",

 severity:
 clean(c.severity).toLowerCase() ||
 "medium",

 score: clamp(c.score),

 details: clean(c.details),

 evidence: clean(c.evidence),
 };
 });
}

/* -------------------------------------------------------
 LIMITATIONS
------------------------------------------------------- */

function normalizeLimitations(value) {
 return array(value)
 .map((item) => {
 if (typeof item === "string") {
 return item.trim();
 }

 if (item && typeof item === "object") {
 return {
 type: clean(item.type),
 message: clean(item.message),
 severity: clean(item.severity),
 };
 }

 return "";
 })
 .filter(Boolean);
}

/* -------------------------------------------------------
 AI RISK
------------------------------------------------------- */

function getAIRisk(result) {
 const risk =
 result &&
 typeof result.riskResult === "object"
 ? result.riskResult
 : {};

 return {
 score: clamp(risk.score),

 level:
 clean(risk.level).toLowerCase() ||
 "low",

 reasons: array(risk.reasons)
 .map(clean)
 .filter(Boolean),

 details:
 risk.details &&
 typeof risk.details === "object"
 ? risk.details
 : {},
 };
}

/* -------------------------------------------------------
 SERVER SIDE RISK ENGINE
------------------------------------------------------- */

function calculateRisk({
 aiRisk,
 checks,
 categories,
 limitations,
}) {
 let score = clamp(aiRisk.score);

 let failed = 0;
 let warnings = 0;
 let critical = 0;

 for (const check of checks) {
 const status = clean(check.status).toLowerCase();
 const severity = clean(check.severity).toLowerCase();

 if (
 status === "fail" ||
 status === "failed" ||
 status === "mismatch" ||
 status === "suspicious"
 ) {
 failed++;

 score += 4;

 if (
 severity === "high" ||
 severity === "critical"
 ) {
 critical++;
 score += 8;
 }
 }

 if (
 status === "warning" ||
 status === "unknown" ||
 status === "inconclusive"
 ) {
 warnings++;
 score += 1;
 }
 }

 score += limitations.length * 2;

 if (categories.length) {
 const scores = categories
 .map((x) => number(x.score))
 .filter(Number.isFinite);

 if (scores.length) {
 const average =
 scores.reduce((a, b) => a + b, 0) /
 scores.length;

 score =
 score * 0.65 +
 average * 0.35;
 }
 }

 score = Math.round(clamp(score));

 let level = "low";

 if (score >= 80) {
 level = "critical";
 } else if (score >= 60) {
 level = "high";
 } else if (score >= 30) {
 level = "medium";
 }

 return {
 score,
 level,
 failedChecks: failed,
 warningChecks: warnings,
 criticalFailures: critical,
 };
}

/* -------------------------------------------------------
 DECISION
------------------------------------------------------- */

function makeDecision(risk, checks, limitations) {
 const serious = checks.some((check) => {
 const status = clean(check.status).toLowerCase();
 const severity =
 clean(check.severity).toLowerCase();

 return (
 (
 status === "fail" ||
 status === "failed" ||
 status === "suspicious" ||
 status === "mismatch"
 ) &&
 (
 severity === "high" ||
 severity === "critical"
 )
 );
 });

 if (serious || risk.score >= 80) {
 return {
 status: "suspicious",
 confidence: 90,
 reason:
 "High-risk inconsistencies detected.",
 };
 }

 if (risk.score >= 60) {
 return {
 status: "manual_review",
 confidence: 75,
 reason:
 "Additional manual review is recommended.",
 };
 }

 if (
 limitations.length > 0 ||
 risk.score >= 30
 ) {
 return {
 status: "inconclusive",
 confidence: 60,
 reason:
 "Some verification checks could not be confirmed.",
 };
 }

 return {
 status: "verified",
 confidence: 85,
 reason:
 "No significant inconsistency was detected.",
 };
}

/* -------------------------------------------------------
 AI PROMPT
------------------------------------------------------- */

function createPrompt(documentType) {
 return `
You are VerifyDoc Risk Engine 2.0.

Analyze the supplied document image.

Document type:
${documentType}

This is a DOCUMENT VERIFICATION task.

Do not create, modify, reproduce or improve the document.
Only analyze what is visible in the supplied image.

For a bank/payment receipt inspect:

- bank name
- sender
- receiver
- sender IBAN
- receiver IBAN
- amount
- currency
- date
- time
- reference number
- transaction ID
- payment status
- internal consistency
- missing fields
- unreadable fields
- obvious visual inconsistencies
- possible image manipulation indicators

Never invent unreadable information.

If something cannot be determined:
return an empty value or mark the relevant check as unknown.

Do not call a document fraudulent solely because something
cannot be read.

Return ONLY valid JSON.

Required structure:

{
 "document": {
 "type": "",
 "bankName": "",
 "accountHolder": "",
 "senderName": "",
 "receiverName": "",
 "senderIban": "",
 "receiverIban": "",
 "amount": "",
 "currency": "",
 "transactionDate": "",
 "transactionTime": "",
 "reference": "",
 "transactionId": "",
 "statusText": "",
 "extractedText": ""
 },

 "categories": [
 {
 "id": "identity",
 "name": "Identity",
 "score": 0,
 "status": "pass",
 "details": ""
 },
 {
 "id": "transaction",
 "name": "Transaction",
 "score": 0,
 "status": "pass",
 "details": ""
 },
 {
 "id": "amount",
 "name": "Amount",
 "score": 0,
 "status": "pass",
 "details": ""
 },
 {
 "id": "visual",
 "name": "Visual consistency",
 "score": 0,
 "status": "pass",
 "details": ""
 }
 ],

 "checks": [
 {
 "id": "",
 "name": "",
 "status": "pass",
 "severity": "low",
 "score": 0,
 "details": "",
 "evidence": ""
 }
 ],

 "limitations": [],

 "riskResult": {
 "score": 0,
 "level": "low",
 "reasons": [],
 "details": {}
 }
}
`;
}

/* -------------------------------------------------------
 OPENAI VISION
------------------------------------------------------- */

async function analyzeImage(image, documentType) {
 const prompt = createPrompt(documentType);

 const result =
 await openai.responses.create({
 model:
 process.env.OPENAI_VISION_MODEL ||
 "gpt-4.1-mini",

 temperature: 0,

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
 image_url: image,
 detail: "high",
 },
 ],
 },
 ],
 });

 return result.output_text || "";
}

/* -------------------------------------------------------
 FINAL RESULT
------------------------------------------------------- */

function buildResult(aiResult, documentType) {
 const document =
 normalizeDocument(
 aiResult.document
 );

 document.type = documentType;

 const categories =
 normalizeCategories(
 aiResult.categories
 );

 const checks =
 normalizeChecks(
 aiResult.checks
 );

 const limitations =
 normalizeLimitations(
 aiResult.limitations
 );

 const aiRisk =
 getAIRisk(aiResult);

 const risk =
 calculateRisk({
 aiRisk,
 checks,
 categories,
 limitations,
 });

 const decision =
 makeDecision(
 risk,
 checks,
 limitations
 );

 return {
 success: true,

 document,

 categories,

 checks,

 limitations,

 decision,

 riskResult: {
 score: risk.score,

 level: risk.level,

 reasons: aiRisk.reasons,

 details: {
 ...aiRisk.details,

 failedChecks:
 risk.failedChecks,

 warningChecks:
 risk.warningChecks,

 criticalFailures:
 risk.criticalFailures,
 },
 },

 engine: ENGINE,

 meta: {
 analyzedAt:
 new Date().toISOString(),

 analysisType:
 "document_verification",
 },
 };
}

/* -------------------------------------------------------
 MAIN HANDLER
------------------------------------------------------- */

export default async function handler(
 req,
 res
) {
 setCors(res);

 /* OPTIONS */

 if (req.method === "OPTIONS") {
 return res.status(204).end();
 }

 /* METHOD */

 if (req.method !== "POST") {
 return send(res, 405, {
 success: false,
 error: "Method not allowed",
 allowedMethods: [
 "POST",
 "OPTIONS",
 ],
 });
 }

 /* API KEY */

 if (!process.env.OPENAI_API_KEY) {
 console.error(
 "OPENAI_API_KEY is missing"
 );

 return send(res, 500, {
 success: false,
 error:
 "OPENAI_API_KEY is not configured",
 });
 }

 try {
 const body =
 req.body &&
 typeof req.body === "object"
 ? req.body
 : {};

 const documentType =
 clean(body.documentType) ||
 "bank_receipt";

 const image =
 getImageFromBody(body);

 /* IMAGE */

 const validation =
 validateImage(image);

 if (!validation.ok) {
 return send(res, 400, {
 success: false,
 error: validation.error,
 });
 }

 /* AI */

 const aiText =
 await analyzeImage(
 validation.value,
 documentType
 );

 /* JSON */

 let aiResult;

 try {
 aiResult =
 parseAIResponse(aiText);
 } catch (error) {
 console.error(
 "AI PARSE ERROR:",
 error
 );

 return send(res, 502, {
 success: false,
 error:
 "AI analysis returned an invalid result",
 });
 }

 /* ENGINE */

 const finalResult =
 buildResult(
 aiResult,
 documentType
 );

 return send(
 res,
 200,
 finalResult
 );

 } catch (error) {
 console.error(
 "VERIFYDOC API ERROR:",
 error
 );

 return send(res, 500, {
 success: false,

 error:
 error?.message ||
 "Analysis failed",

 engine: ENGINE,
 });
 }
}
