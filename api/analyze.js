import OpenAI from "openai";

const openai = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({ error: "Method not allowed" });
}

try {
const { fileName, type } = req.body;

const prompt = `
A ${type} named "${fileName}" was uploaded.

Give me ONLY JSON.

{
"score": number,
"risk": "LOW" | "MEDIUM" | "HIGH",
"reason": "short explanation"
}
`;

const response = await openai.chat.completions.create({
model: "gpt-4.1-mini",
messages: [
{
role: "user",
content: prompt
}
]
});

const result = JSON.parse(response.choices[0].message.content);

res.status(200).json(result);

} catch (err) {
res.status(500).json({
error: err.message
});
}
}
