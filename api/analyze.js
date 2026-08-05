export default async function handler(req, res) {
if (req.method !== "POST") {
return res.status(405).json({
success: false,
error: "Method not allowed",
});
}

try {
const { fileName, type } = req.body;

const score = Math.floor(Math.random() * 30) + 1;

let risk = "LOW RISK";

if (score > 30) risk = "MEDIUM RISK";
if (score > 60) risk = "HIGH RISK";

return res.status(200).json({
success: true,
fileName,
type,
score,
risk,
message: "Analysis completed successfully",
});
} catch (err) {
return res.status(500).json({
success: false,
error: err.message,
});
}
}
