mport OpenAI from "openai";

const client = new OpenAI({
apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({
error: "Method not allowed",
});
}

try {
const { image } = req.body;

if (!image) {
return res.status(400).json({
error: "Image is required",
});
}

const response = await client.responses.create({
model: "gpt-5.5",
input: [
{
role: "system",
content: [
{
type: "input_text",
text: "You are an expert payment receipt fraud detector. Analyze the uploaded receipt and return a fraud risk score from 0 to 100, a risk level (LOW, MEDIUM, HIGH), and a short explanation."
}
]
},
{
role: "user",
content: [
{
type: "input_image",
image_url: image
}
]
}
]
});

return res.status(200).json({
success: true,
result: response.output_text
});

} catch (err) {
console.error(err);

return res.status(500).json({
success: false,
error: err.message
});
}
}
