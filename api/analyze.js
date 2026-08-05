export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({
error: "Method not allowed",
});
}

const scores = [7, 12, 18, 24, 31, 42, 56, 73];
const score = scores[Math.floor(Math.random() * scores.length)];

let risk = "LOW";
if (score > 30) risk = "MEDIUM";
if (score > 60) risk = "HIGH";

res.status(200).json({
success: true,
score,
risk,
message: "Document analyzed successfully"
});
}
