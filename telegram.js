const TELEGRAM_TOKEN =
process.env.TELEGRAM_BOT_TOKEN;

const API_URL =
"https://verifydoc-api.vercel.app/api/analyze";

async function telegram(method, body) {
const response = await fetch(
`https://api.telegram.org/bot${TELEGRAM_TOKEN}/${method}`,
{
method: "POST",
headers: {
"Content-Type": "application/json",
},
body: JSON.stringify(body),
}
);

return response.json();
}

export default async function handler(req, res) {

if (req.method !== "POST") {
return res.status(200).json({
ok: true,
});
}

try {

const update = req.body;

const message =
update?.message;

if (!message) {
return res.status(200).json({
ok: true,
});
}

const chatId =
message.chat.id;

const text =
message.text || "";

// ==============================
// START
// ==============================

if (text === "/start") {

await telegram(
"sendMessage",
{
chat_id: chatId,

text:
`🛡️ VerifyDoc

Belge sahtecilik / tutarlılık analiz sistemine hoş geldiniz.

Analiz etmek istediğiniz belgeyi gönderin.

Desteklenen:
📄 PDF
🖼️ JPG
🖼️ PNG`,
}
);

return res.status(200).json({
ok: true,
});

}

// ==============================
// TEST
// ==============================

await telegram(
"sendMessage",
{
chat_id: chatId,

text:
`✅ VerifyDoc botu çalışıyor.

Şimdilik dosya analiz modülünü bağlıyoruz.`,
}
);

return res.status(200).json({
ok: true,
});

} catch (error) {

console.error(
"TELEGRAM ERROR:",
error
);

return res.status(200).json({
ok: true,
});

}

}
