import OpenAI from "openai";

/*
|--------------------------------------------------------------------------
| VERIFYDOC API - IMAGE ANALYSIS ENDPOINT
|--------------------------------------------------------------------------
| Vercel Serverless Function
| Endpoint:
| POST /api/analyze
|
| Supported image inputs:
| 1. { image: "data:image/jpeg;base64,..." }
| 2. { image: "https://example.com/image.jpg" }
| 3. { imageUrl: "https://example.com/image.jpg" }
| 4. { imageBase64: "...." }
|--------------------------------------------------------------------------
*/

export const config = {
api: {
bodyParser: {
sizeLimit: "20mb",
},
},
};

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

function send(res, status, data) {
return res.status(status).json(data);
}

function isObject(value) {
return (
value !== null &&
typeof value === "object" &&
!Array.isArray(value)
);
}

function cleanString(value) {
if (typeof value !== "string") {
return "";
}

return value.trim();
}

/*
|--------------------------------------------------------------------------
| Get image from request
|--------------------------------------------------------------------------
*/

function getImageFromBody(body) {
if (!body) {
return null;
}

/*
|--------------------------------------------------------------------------
| JSON body
|--------------------------------------------------------------------------
*/

if (isObject(body)) {
// Most common
if (body.image) {
return body.image;
}

// Alternative
if (body.imageUrl) {
return body.imageUrl;
}

// Alternative
if (body.imageBase64) {
const base64 = cleanString(body.imageBase64);

if (!base64) {
return null;
}

// Already a data URL
if (base64.startsWith("data:image/")) {
return base64;
}

return `data:image/jpeg;base64,${base64}`;
}

// Other possible names
if (body.file) {
return body.file;
}

if (body.document) {
return body.document;
}

if (body.documentImage) {
return body.documentImage;
}
}

/*
|--------------------------------------------------------------------------
| If body itself is a string
|--------------------------------------------------------------------------
*/

if (typeof body === "string") {
const value = body.trim();

if (!value) {
return null;
}

if (
value.startsWith("http://") ||
value.startsWith("https://") ||
value.startsWith("data:image/")
) {
return value;
}

return `data:image/jpeg;base64,${value}`;
}

return null;
}

/*
|--------------------------------------------------------------------------
| Validate image
|--------------------------------------------------------------------------
*/

function validateImage(image) {
if (!image) {
return {
valid: false,
error: "No image received",
};
}

if (typeof image !== "string") {
return {
valid: false,
error: "Image must be a string",
};
}

const value = image.trim();

if (!value) {
return {
valid: false,
error: "Image is empty",
};
}

/*
|--------------------------------------------------------------------------
| Data URL
|--------------------------------------------------------------------------
*/

if (value.startsWith("data:image/")) {
return {
valid: true,
image: value,
};
}

/*
|--------------------------------------------------------------------------
| Remote image URL
|--------------------------------------------------------------------------
*/

if (
value.startsWith("https://") ||
value.startsWith("http://")
) {
return {
valid: true,
image: value,
};
}

/*
|--------------------------------------------------------------------------
| Raw base64
|--------------------------------------------------------------------------
*/

const looksLikeBase64 =
/^[A-Za-z0-9+/=\s]+$/.test(value) &&
value.length > 100;

if (looksLikeBase64) {
return {
valid: true,
image: `data:image/jpeg;base64,${value.replace(/\s/g, "")}`,
};
}

return {
valid: false,
error: "Unsupported image format",
};
}

/*
|--------------------------------------------------------------------------
| Extract JSON from AI response
|--------------------------------------------------------------------------
*/

function extractJson(text) {
if (!text || typeof text !== "string") {
return null;
}

let cleaned = text.trim();

/*
|--------------------------------------------------------------------------
| Remove markdown code fences
|--------------------------------------------------------------------------
*/

cleaned = cleaned
.replace(/^```json\s*/i, "")
.replace(/^```\s*/i, "")
.replace(/\s*```$/i, "")
.trim();

/*
|--------------------------------------------------------------------------
| Try direct JSON
|--------------------------------------------------------------------------
*/

try {
return JSON.parse(cleaned);
} catch (_) {
// Continue
}

/*
|--------------------------------------------------------------------------
| Find JSON object inside response
|--------------------------------------------------------------------------
*/

const start = cleaned.indexOf("{");
const end = cleaned.lastIndexOf("}");

if (start !== -1 && end !== -1 && end > start) {
const possibleJson = cleaned.slice(start, end + 1);

try {
return JSON.parse(possibleJson);
} catch (_) {
return null;
}
}

return null;
}

/*
|--------------------------------------------------------------------------
| Normalize result
|--------------------------------------------------------------------------
*/

function normalizeResult(result) {
if (!result || typeof result !== "object") {
return {
authenticity: "unknown",
confidence: 0,
documentType: "unknown",
verdict: "unable_to_analyze",
reasons: [],
warnings: [
"The analysis result could not be parsed.",
],
};
}

return {
authenticity:
result.authenticity ??
result.status ??
"unknown",

confidence:
typeof result.confidence === "number"
? result.confidence
: 0,

documentType:
result.documentType ??
result.document_type ??
"unknown",

verdict:
result.verdict ??
"unknown",

reasons:
Array.isArray(result.reasons)
? result.reasons
: [],

warnings:
Array.isArray(result.warnings)
? result.warnings
: [],

extractedData:
result.extractedData ??
result.extracted_data ??
{},

securityFeatures:
result.securityFeatures ??
result.security_features ??
[],

anomalies:
Array.isArray(result.anomalies)
? result.anomalies
: [],

rawAnalysis:
result.rawAnalysis ??
null,
};
}

/*
|--------------------------------------------------------------------------
| Main AI analysis
|--------------------------------------------------------------------------
*/

async function analyzeDocument(image) {
/*
|--------------------------------------------------------------------------
| Check API key
|--------------------------------------------------------------------------
*/

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
throw new Error(
"OPENAI_API_KEY environment variable is missing"
);
}

const openai = new OpenAI({
apiKey,
});

/*
|--------------------------------------------------------------------------
| System instructions
|--------------------------------------------------------------------------
*/

const systemPrompt = `
You are VerifyDoc Risk Engine.

Your task is to analyze an uploaded document image for
visual signs of authenticity, manipulation, alteration,
inconsistency, or suspicious characteristics.

IMPORTANT:

- Do NOT claim absolute authenticity.
- Do NOT claim that an image alone can prove a document is genuine.
- Give a risk-oriented assessment.
- Separate visible observations from conclusions.
- If the image quality is insufficient, say so.
- Never invent information that cannot be seen.
- Do not infer sensitive personal information unnecessarily.

Analyze:

1. Document type
2. Visible text
3. Layout consistency
4. Typography consistency
5. Alignment
6. Spacing
7. Logos
8. Seals
9. Signatures
10. Dates
11. Numbers
12. Fonts
13. Compression artifacts
14. Pixel-level inconsistencies visible in the image
15. Signs of editing
16. Missing or suspicious security features
17. Overall risk

Return ONLY valid JSON.
No markdown.
No explanation outside JSON.

Required JSON structure:

{
"authenticity": "likely_authentic | suspicious | likely_manipulated | unknown",
"confidence": 0,
"documentType": "",
"verdict": "",
"reasons": [],
"warnings": [],
"extractedData": {},
"securityFeatures": [],
"anomalies": []
}

confidence must be between 0 and 100.

If something cannot be determined from the image,
use "unknown" rather than guessing.
`;

/*
|--------------------------------------------------------------------------
| User instruction
|--------------------------------------------------------------------------
*/

const userPrompt = `
Analyze this document image.

Assess whether there are visible signs of manipulation,
alteration, inconsistency, or suspicious editing.

Be conservative.
Do not state that the document is definitively genuine
or definitively fake based only on the image.
`;

/*
|--------------------------------------------------------------------------
| OpenAI request
|--------------------------------------------------------------------------
*/

const response = await openai.responses.create({
model: "gpt-4.1-mini",

input: [
{
role: "system",
content: [
{
type: "input_text",
text: systemPrompt,
},
],
},

{
role: "user",
content: [
{
type: "input_text",
text: userPrompt,
},

{
type: "input_image",
image_url: image,
},
],
},
],

temperature: 0.1,
});

/*
|--------------------------------------------------------------------------
| Get output text
|--------------------------------------------------------------------------
*/

const outputText =
response.output_text ||
"";

if (!outputText) {
throw new Error(
"OpenAI returned an empty response"
);
}

/*
|--------------------------------------------------------------------------
| Parse result
|--------------------------------------------------------------------------
*/

const parsed = extractJson(outputText);

if (!parsed) {
return {
...normalizeResult(null),
rawAnalysis: outputText,
};
}

return normalizeResult(parsed);
}

/*
|--------------------------------------------------------------------------
| HTTP Handler
|--------------------------------------------------------------------------
*/

export default async function handler(req, res) {
/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
*/

res.setHeader(
"Access-Control-Allow-Origin",
"*"
);

res.setHeader(
"Access-Control-Allow-Methods",
"POST, OPTIONS"
);

res.setHeader(
"Access-Control-Allow-Headers",
"Content-Type, Authorization"
);

/*
|--------------------------------------------------------------------------
| OPTIONS
|--------------------------------------------------------------------------
*/

if (req.method === "OPTIONS") {
return res.status(200).end();
}

/*
|--------------------------------------------------------------------------
| Method check
|--------------------------------------------------------------------------
*/

if (req.method !== "POST") {
return send(res, 405, {
success: false,
error: "Method not allowed",
allowedMethods: ["POST", "OPTIONS"],
});
}

/*
|--------------------------------------------------------------------------
| Main processing
|--------------------------------------------------------------------------
*/

try {
/*
|--------------------------------------------------------------------------
| Check body
|--------------------------------------------------------------------------
*/

if (!req.body) {
return send(res, 400, {
success: false,
error: "Request body is missing",
});
}

/*
|--------------------------------------------------------------------------
| Extract image
|--------------------------------------------------------------------------
*/

const rawImage = getImageFromBody(req.body);

/*
|--------------------------------------------------------------------------
| Validate image
|--------------------------------------------------------------------------
*/

const validation = validateImage(rawImage);

if (!validation.valid) {
return send(res, 400, {
success: false,
error: validation.error,
});
}

/*
|--------------------------------------------------------------------------
| Analyze
|--------------------------------------------------------------------------
*/

const result = await analyzeDocument(
validation.image
);

/*
|--------------------------------------------------------------------------
| Return successful response
|--------------------------------------------------------------------------
*/

return send(res, 200, {
success: true,

data: result,

engine: {
name: "VerifyDoc Risk Engine",
version: "3.0",
provider: "OpenAI",
scoring: "AI-assisted visual risk analysis",
},

timestamp: new Date().toISOString(),
});
} catch (error) {
/*
|--------------------------------------------------------------------------
| Server error logging
|--------------------------------------------------------------------------
*/

console.error(
"VERIFYDOC API ERROR:",
error
);

/*
|--------------------------------------------------------------------------
| Safe error message
|--------------------------------------------------------------------------
*/

const message =
error?.message ||
"Analysis failed";

return send(res, 500, {
success: false,
error: message,
});
}
}
