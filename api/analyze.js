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
You are a world-class AI forensic document examiner.

Analyze the uploaded document like a professional forensic laboratory.

Check all of the following:

1. OCR consistency
2. Font family consistency
3. Font size differences
4. Character spacing
5. Line spacing
6. Text alignment
7. Baseline shifts
8. Image compression artifacts
9. Clone stamp traces
10. Copy-paste regions
11. Photoshop editing artifacts
12. AI-generated image traces
13. Metadata consistency
14. Logo authenticity
15. Stamp authenticity
16. Signature authenticity
17. Date consistency
18. Amount formatting
19. Currency formatting
20. IBAN formatting
21. SWIFT/BIC formatting
22. QR code consistency (if present)
23. Barcode consistency (if present)
24. Overall layout integrity
25. Missing or suspicious elements

Return ONLY valid JSON in exactly this format:

{
"score": 0,
"risk": "LOW RISK",
"reason": "Maximum 80 words.",
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

Rules:
- score must be between 0 and 100.
- LOW = 0-30
- MEDIUM = 31-60
- HIGH = 61-100
- Return JSON only.
- Never return markdown.
- Never explain outside JSON.
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

const result = JSON.parse(text);

return res.status(200).json({
success: true,
fileName,
type,
score: result.score,
risk: result.risk,
reason: result.reason,
});

} catch (err) {
console.error(err);

return res.status(500).json({
success: false,
error: err.message,
});
}
}
