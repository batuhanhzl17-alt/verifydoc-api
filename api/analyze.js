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
You are a professional forensic document analyst.

Analyze this receipt or bank document.

Return ONLY valid JSON:

{
"score": number,
"risk": "LOW RISK" | "MEDIUM RISK" | "HIGH RISK",
"reason": "Short explanation"
}

Rules:
- score must be between 0 and 100.
- LOW = 0-30
- MEDIUM = 31-60
- HIGH = 61-100
- Look for OCR inconsistencies, editing artifacts, font mismatch, spacing problems, duplicated areas, suspicious metadata indicators, compression anomalies and visual manipulation.
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
