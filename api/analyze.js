import OpenAI from "openai";

const openai = new OpenAI({
 apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
 res.setHeader("Access-Control-Allow-Origin", "*");
 res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
 res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
 const { image, fileName, type } = req.body;

 if (!image) {
 return res.status(400).json({
 success: false,
 error: "No image received",
 });
 }

 const documentType = type || "Document";

 const prompt = `
You are VerifyDoc AI, a professional document authenticity and forensic
visual-analysis assistant.

Analyze the uploaded ${documentType} image carefully.

IMPORTANT:
- Analyze ONLY evidence that is actually visible or inferable from the image.
- Never invent metadata, EXIF information, hidden layers, or forensic evidence
 that cannot be observed from the supplied image.
- A visually clean document is NOT automatically authentic.
- A suspicious finding does NOT automatically prove fraud.
- Your result is a risk assessment, not a legal certification.

Perform a structured visual forensic assessment.

CHECK THESE AREAS:

1. OCR / text consistency
2. Font family consistency
3. Font size consistency
4. Character spacing
5. Word spacing
6. Line spacing
7. Text alignment
8. Baseline consistency
9. Text sharpness consistency
10. Compression artifacts
11. Copy-paste appearance
12. Localized image manipulation
13. Photoshop-like editing traces
14. AI-generated image indicators
15. Document layout consistency
16. Logo consistency
17. Stamp consistency
18. Signature consistency
19. Date formatting
20. Amount formatting
21. Currency formatting
22. IBAN formatting
23. SWIFT/BIC formatting
24. QR/barcode consistency if visible
25. Overall document integrity

For every check, return:
- status: PASS, SUSPICIOUS, FAIL, or NOT_VISIBLE
- confidence: 0-100
- finding: short explanation

SCORING:

The final score represents RISK, not authenticity.

0-30 = LOW RISK
31-60 = MEDIUM RISK
61-100 = HIGH RISK

Use stronger weight for multiple independent suspicious findings.
Do not give a high-risk score based on one weak visual anomaly alone.

If important information cannot be inspected because of image quality,
return NOT_VISIBLE rather than guessing.

Also provide:
- overall assessment
- strongest findings
- recommended action

Do NOT say that the document is definitively genuine or definitively fake.

Return ONLY the requested JSON structure.
`;

 const response = await openai.responses.create({
 model: "gpt-4.1-mini",

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
 image_url: `data:image/jpeg;base64,${image}`,
 },
 ],
 },
 ],

 text: {
 format: {
 type: "json_schema",
 name: "verifydoc_analysis",
 strict: true,
 schema: {
 type: "object",
 additionalProperties: false,
 properties: {
 score: {
 type: "number",
 },

 risk: {
 type: "string",
 enum: ["LOW RISK", "MEDIUM RISK", "HIGH RISK"],
 },

 overallAssessment: {
 type: "string",
 },

 strongestFindings: {
 type: "array",
 items: {
 type: "string",
 },
 },

 recommendedAction: {
 type: "string",
 },

 checks: {
 type: "object",
 additionalProperties: false,
 properties: {
 ocr: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 fonts: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 fontSize: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 spacing: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 alignment: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 compression: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 editing: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 aiGenerated: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 layout: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 logo: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 stamp: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 signature: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 dateFormatting: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 amountFormatting: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 currency: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 iban: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 swift: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 qrBarcode: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },

 overallIntegrity: {
 type: "object",
 additionalProperties: false,
 properties: {
 status: {
 type: "string",
 enum: ["PASS", "SUSPICIOUS", "FAIL", "NOT_VISIBLE"],
 },
 confidence: {
 type: "number",
 },
 finding: {
 type: "string",
 },
 },
 required: ["status", "confidence", "finding"],
 },
 },

 required: [
 "ocr",
 "fonts",
 "fontSize",
 "spacing",
 "alignment",
 "compression",
 "editing",
 "aiGenerated",
 "layout",
 "logo",
 "stamp",
 "signature",
 "dateFormatting",
 "amountFormatting",
 "currency",
 "iban",
 "swift",
 "qrBarcode",
 "overallIntegrity",
 ],
 },
 },

 required: [
 "score",
 "risk",
 "overallAssessment",
 "strongestFindings",
 "recommendedAction",
 "checks",
 ],
 },
 },
 },
 });

 const result = JSON.parse(response.output_text);

 return res.status(200).json({
 success: true,
 fileName: fileName || "document.jpg",
 type: documentType,
 score: result.score,
 risk: result.risk,
 reason: result.overallAssessment,
 strongestFindings: result.strongestFindings,
 recommendedAction: result.recommendedAction,
 checks: result.checks,
 });

 } catch (err) {
 console.error("VERIFYDOC ERROR:", err);

 return res.status(500).json({
 success: false,
 error: err.message || "Analysis failed",
 });
 }
}
