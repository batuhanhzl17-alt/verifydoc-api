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
const { image, fileName, type } = req.body || {};

if (!image) {
return res.status(400).json({
success: false,
error: "No image received",
});
}

const prompt = `
You are VerifyDoc, an AI-assisted document forensic screening system.

Analyze the uploaded document image carefully.

IMPORTANT:
- Never claim a document is definitely authentic or definitely fake.
- Do not invent evidence.
- If something cannot be reliably determined from the image, return "unknown".
- Separate visible evidence from assumptions.
- A clean-looking document does NOT prove authenticity.
- Metadata cannot be verified from a screenshot/photo unless metadata is actually available.
- The result is a forensic screening assessment, not a legal determination.

Analyze:

1. OCR/text consistency
2. Font consistency
3. Font size consistency
4. Character spacing
5. Line spacing
6. Text alignment
7. Baseline consistency
8. Image compression artifacts
9. Copy/paste regions
10. Clone/editing traces
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
22. Overall layout consistency
23. Missing or suspicious elements
24. Document type consistency
25. Image quality limitations

For every check return:
- status: "pass", "review", "suspicious", or "unknown"
- score: 0-100 where 0 means no detected risk and 100 means very strong suspicious evidence
- evidence: concise explanation based ONLY on visible evidence

Calculate category scores:

visualRisk
textRisk
layoutRisk
financialDataRisk
editingRisk

Then calculate overallRisk from 0-100.

Risk labels:
0-20 = LOW RISK
21-45 = MODERATE RISK
46-70 = HIGH RISK
71-100 = VERY HIGH RISK

Also provide confidence from 0-100.

Return ONLY valid JSON.

Required JSON structure:

{
"overallRisk": 0,
"riskLabel": "LOW RISK",
"confidence": 0,

"summary": "",

"categories": {
"visualRisk": 0,
"textRisk": 0,
"layoutRisk": 0,
"financialDataRisk": 0,
"editingRisk": 0
},

"checks": {
"ocrConsistency": {
"status": "pass",
"score": 0,
"evidence": ""
},
"fontConsistency": {
"status": "pass",
"score": 0,
"evidence": ""
},
"fontSizeConsistency": {
"status": "pass",
"score": 0,
"evidence": ""
},
"characterSpacing": {
"status": "pass",
"score": 0,
"evidence": ""
},
"lineSpacing": {
"status": "pass",
"score": 0,
"evidence": ""
},
"textAlignment": {
"status": "pass",
"score": 0,
"evidence": ""
},
"baselineConsistency": {
"status": "pass",
"score": 0,
"evidence": ""
},
"compressionArtifacts": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"copyPasteRegions": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"editingTraces": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"photoshopArtifacts": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"aiGeneratedIndicators": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"logoConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"stampConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"signatureConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"dateConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"amountConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"currencyFormatting": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"ibanFormatting": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"swiftFormatting": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"qrBarcodeConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"layoutIntegrity": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"suspiciousElements": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"documentTypeConsistency": {
"status": "unknown",
"score": 0,
"evidence": ""
},
"imageQuality": {
"status": "unknown",
"score": 0,
"evidence": ""
}
},

"limitations": []
}
`;

const response = await openai.responses.create({
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
image_url: `data:image/jpeg;base64,${image}`,
},
],
},
],
});

const text = response.output_text;

let result;

try {
result = JSON.parse(text);
} catch (parseError) {
console.error("JSON parse error:", text);

return res.status(500).json({
success: false,
error: "AI returned invalid JSON",
});
}

return res.status(200).json({
success: true,
fileName: fileName || "document.jpg",
type: type || "Document",
...result,
});
} catch (err) {
console.error("VerifyDoc API error:", err);

return res.status(500).json({
success: false,
error: err.message || "Analysis failed",
});
}
}
