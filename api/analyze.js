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

const prompt = `
You are a professional document forensic analyst.

Analyze this uploaded ${type || "document"} carefully.

Look for:
- OCR consistency
- Font consistency
- Font size differences
- Character spacing
- Line spacing
- Text alignment
- Baseline shifts
- Image compression artifacts
- Copy-paste regions
- Photoshop editing artifacts
- AI-generated image traces
- Metadata consistency
- Logo authenticity
- Stamp authenticity
- Signature authenticity
- Date consistency
- Amount formatting
- Currency formatting
- IBAN formatting
- SWIFT/BIC formatting
- QR code consistency
- Barcode consistency
- Overall layout integrity
- Missing or suspicious elements

Give a score from 0 to 100.

0-30 = LOW RISK
31-60 = MEDIUM RISK
61-100 = HIGH RISK

Return ONLY valid JSON in this exact structure:

{
"score": 0,
"risk": "LOW RISK",
"reason": "Short explanation.",
"checks": {
"ocr": true,
"fonts": true,
"layout": true,
"metadata": true,
"signature": true,
"logo": true,
"editing": false,
"aiGenerated": false
}
}

Do not return Markdown.
Do not put the JSON inside code fences.
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
});

const text = response.output_text;

const result = JSON.parse(text);

return res.status(200).json({
success: true,
fileName: fileName || "document.jpg",
type: type || "Document",
score: result.score,
risk: result.risk,
reason: result.reason,
checks: result.checks,
});

} catch (err) {
console.error("ANALYZE ERROR:", err);

return res.status(500).json({
success: false,
error: err.message || "Analysis failed",
});
}
}
