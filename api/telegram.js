import { waitUntil } from "@vercel/functions";

// =====================================================
// VERIFYDOC TELEGRAM BOT
// =====================================================

const TELEGRAM_BOT_TOKEN =
process.env.TELEGRAM_BOT_TOKEN;

const ANALYZE_URL =
"https://verifydoc-api.vercel.app/api/analyze";


// =====================================================
// AYNI UPDATE'I İKİ KEZ İŞLEMEMEK
// =====================================================

const processedUpdates =
new Set();


// =====================================================
// TELEGRAM API
// =====================================================

async function telegram(
method,
body
) {

if (!TELEGRAM_BOT_TOKEN) {

throw new Error(
"TELEGRAM_BOT_TOKEN bulunamadı."
);

}

const response =
await fetch(
`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
{
method: "POST",

headers: {
"Content-Type":
"application/json",
},

body:
JSON.stringify(body),
}
);

const data =
await response.json();

if (!data.ok) {

throw new Error(
data.description ||
`Telegram ${method} hatası`
);

}

return data.result;

}


// =====================================================
// MESAJ GÖNDER
// =====================================================

async function sendMessage(
chatId,
text
) {

return telegram(
"sendMessage",
{
chat_id:
chatId,

text,
}
);

}


// =====================================================
// TELEGRAM DOSYASINI İNDİR
// =====================================================

async function downloadTelegramFile(
fileId
) {

const file =
await telegram(
"getFile",
{
file_id:
fileId,
}
);


if (!file?.file_path) {

throw new Error(
"Telegram dosya yolu döndürmedi."
);

}


const fileUrl =
`https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;


const response =
await fetch(fileUrl);


if (!response.ok) {

throw new Error(
"Telegram dosyası indirilemedi."
);

}


const arrayBuffer =
await response.arrayBuffer();


return {

buffer:
Buffer.from(
arrayBuffer
),

filePath:
file.file_path,

};

}


// =====================================================
// BANKA BELİRLE
// =====================================================

function detectBank(
text
) {

if (
!text ||
typeof text !== "string"
) {

return null;

}


const value =
text
.toLowerCase()
.trim()
.replace(
/\s+/g,
""
);


// =================================================
// GARANTİ
// =================================================

if (
value.includes(
"garanti"
) ||
value.includes(
"garantibbva"
)
) {

return "garanti";

}


// =================================================
// AKBANK
// =================================================

if (
value.includes(
"akbank"
)
) {

return "akbank";

}


// =================================================
// ENPARA
// =================================================

if (
value.includes(
"enpara"
) ||
value.includes(
"enparacom"
)
) {

return "enpara";

}


// =================================================
// VAKIFBANK
// =================================================

if (
value.includes(
"vakıfbank"
) ||
value.includes(
"vakifbank"
)
) {

return "vakifbank";

}


// =================================================
// İŞ BANKASI
// =================================================

if (
value.includes(
"işbankası"
) ||
value.includes(
"isbankasi"
) ||
value.includes(
"işbank"
) ||
value.includes(
"isbank"
)
) {

return "isbankasi";

}


return null;

}


// =====================================================
// DOSYAYI VERIFYDOC'A GÖNDER
// =====================================================

async function analyzeFile({

buffer,
fileName,
mimeType,
type,
bank,

}) {

console.log(
"VERIFYDOC'A GÖNDERİLİYOR:"
);

console.log(
"TYPE:",
type
);

console.log(
"MIME:",
mimeType
);

console.log(
"FILE:",
fileName
);

console.log(
"BANK:",
bank
);


const form =
new FormData();


form.append(
"type",
type
);


form.append(
"fileName",
fileName
);


form.append(
"bank",
bank
);


const blob =
new Blob(
[buffer],
{
type:
mimeType ||
"application/octet-stream",
}
);


let fieldName =
"file";


if (
type === "image"
) {

fieldName =
"image";

}


if (
type === "video"
) {

fieldName =
"video";

}


form.append(
fieldName,
blob,
fileName
);


const response =
await fetch(
ANALYZE_URL,
{
method:
"POST",

body:
form,
}
);


const result =
await response.json();


if (!response.ok) {

throw new Error(
result?.error ||
"VerifyDoc analiz API hatası."
);

}


return result;

}


// =====================================================
// ANALİZ SONUCUNU TELEGRAM'A GÖNDER
// =====================================================

async function sendAnalysisResult(
chatId,
result
) {

const score =
Number(
result?.score
) || 0;


const confidence =
Number(
result?.confidence
) || 0;


const riskLabel =
result?.riskLabel ||
"UNKNOWN";


const summary =
result?.summary ||
"Analiz tamamlandı.";


let emoji =
"🟢";


if (
score >= 71
) {

emoji =
"🔴";

}

else if (
score >= 46
) {

emoji =
"🟠";

}

else if (
score >= 21
) {

emoji =
"🟡";

}


const text =

`${emoji} VERIFYDOC ANALİZ SONUCU

Risk Skoru: ${score}/100

Risk Seviyesi:
${riskLabel}

Güven:
${confidence}/100

━━━━━━━━━━━━━━

${summary}

━━━━━━━━━━━━━━

Bu sonuç yalnızca otomatik ön inceleme sonucudur.
Kesin gerçeklik veya sahtecilik kararı değildir.`;


await sendMessage(
chatId,
text
);

}


// =====================================================
// DOSYA TİPİ BELİRLE
// =====================================================

function determineDocumentType(
mimeType,
fileName
) {

const mime =
(
mimeType ||
""
).toLowerCase();


const name =
(
fileName ||
""
).toLowerCase();


// PDF

if (
mime ===
"application/pdf" ||
name.endsWith(".pdf")
) {

return "pdf";

}


// IMAGE

if (
mime.startsWith(
"image/"
) ||

name.endsWith(".jpg") ||
name.endsWith(".jpeg") ||
name.endsWith(".png") ||
name.endsWith(".webp")
) {

return "image";

}


// VIDEO

if (
mime.startsWith(
"video/"
) ||

name.endsWith(".mp4") ||
name.endsWith(".mov") ||
name.endsWith(".avi") ||
name.endsWith(".mkv") ||
name.endsWith(".webm")
) {

return "video";

}


return null;

}


// =====================================================
// BANKA GÖRÜNÜR ADI
// =====================================================

function getBankDisplayName(
bank
) {

if (
bank === "garanti"
) {

return "Garanti BBVA";

}

if (
bank === "akbank"
) {

return "Akbank";

}

if (
bank === "enpara"
) {

return "Enpara";

}

if (
bank === "vakifbank"
) {

return "VakıfBank";

}

if (
bank === "isbankasi"
) {

return "İş Bankası";

}

return bank;

}


// =====================================================
// GERÇEK ANALİZ İŞLEMİ
// =====================================================

async function processTelegramUpdate(
update
) {

const message =
update?.message;


if (!message) {

return;

}


const chatId =
message?.chat?.id;


if (!chatId) {

return;

}


const text =
message?.text ||
message?.caption ||
"";


// =================================================
// START
// =================================================

if (
typeof message?.text ===
"string" &&
message.text.startsWith(
"/start"
)
) {

await sendMessage(
chatId,

`🤖 VerifyDoc'a hoş geldin.

Dekont veya belge göndererek otomatik inceleme yaptırabilirsin.

Banka seçimi:

/akbank
/garanti
/enpara
/vakifbank
/isbankasi

Ardından belgeyi gönder.

İstersen belge açıklamasına banka adını da yazabilirsin.

Örneğin:

İş Bankası dekontu`
);

return;

}


// =================================================
// AKBANK
// =================================================

if (
message?.text ===
"/akbank"
) {

await sendMessage(
chatId,
"🏦 Akbank seçildi.\n\nŞimdi Akbank dekontunu gönder."
);

return;

}


// =================================================
// GARANTİ
// =================================================

if (
message?.text ===
"/garanti"
) {

await sendMessage(
chatId,
"🏦 Garanti BBVA seçildi.\n\nŞimdi Garanti dekontunu gönder."
);

return;

}


// =================================================
// ENPARA
// =================================================

if (
message?.text ===
"/enpara"
) {

await sendMessage(
chatId,
"🏦 Enpara seçildi.\n\nŞimdi Enpara dekontunu gönder."
);

return;

}


// =================================================
// VAKIFBANK
// =================================================

if (
message?.text ===
"/vakifbank"
) {

await sendMessage(
chatId,
"🏦 VakıfBank seçildi.\n\nŞimdi VakıfBank dekontunu gönder."
);

return;

}


// =================================================
// İŞ BANKASI
// =================================================

if (
message?.text ===
"/isbankasi"
) {

await sendMessage(
chatId,
"🏦 İş Bankası seçildi.\n\nŞimdi İş Bankası dekontunu gönder."
);

return;

}


// =================================================
// DOSYA KONTROLÜ
// =================================================

const hasPhoto =
Array.isArray(
message?.photo
) &&
message.photo.length >
0;


const hasDocument =
!!message?.document;


const hasVideo =
!!message?.video;


if (
!hasPhoto &&
!hasDocument &&
!hasVideo
) {

await sendMessage(
chatId,

`📄 Lütfen analiz etmek istediğin belgeyi gönder.

Desteklenen:

• PDF
• Fotoğraf
• Video

Banka seçimi:

/akbank
/garanti
/enpara
/vakifbank
/isbankasi`
);

return;

}


// =================================================
// BANKA
// =================================================

const bank =
detectBank(
text
);


if (!bank) {

await sendMessage(
chatId,

`🏦 Bankayı belirtmem gerekiyor.

Dekontu gönderirken açıklama kısmına:

Garanti
Akbank
Enpara
VakıfBank
İş Bankası

yaz.

Örneğin:

İş Bankası dekontu`
);

return;

}


// =================================================
// DOSYA BİLGİLERİ
// =================================================

let fileId =
null;

let fileName =
null;

let mimeType =
null;

let type =
null;


// =================================================
// FOTOĞRAF
// =================================================

if (
hasPhoto
) {

const photo =
message.photo[
message.photo.length - 1
];


fileId =
photo.file_id;


fileName =
"telegram-photo.jpg";


mimeType =
"image/jpeg";


type =
"image";

}


// =================================================
// VIDEO
// =================================================

else if (
hasVideo
) {

fileId =
message.video.file_id;


fileName =
"telegram-video.mp4";


mimeType =
message.video.mime_type ||
"video/mp4";


type =
"video";

}


// =================================================
// DOCUMENT
// =================================================

else if (
hasDocument
) {

fileId =
message.document.file_id;


fileName =
message.document.file_name ||
"telegram-document";


mimeType =
message.document.mime_type ||
"application/octet-stream";


type =
determineDocumentType(
mimeType,
fileName
);


if (!type) {

throw new Error(
`Desteklenmeyen dosya türü: ${mimeType}`
);

}

}


console.log(
"================================"
);

console.log(
"TELEGRAM FILE TYPE:",
type
);

console.log(
"TELEGRAM MIME:",
mimeType
);

console.log(
"TELEGRAM FILE NAME:",
fileName
);

console.log(
"TELEGRAM BANK:",
bank
);

console.log(
"================================"
);


// =================================================
// ANALİZ BAŞLADI
// =================================================

await sendMessage(
chatId,

`🔎 Belge alındı.

🏦 Banka: ${getBankDisplayName(bank)}

📁 Dosya türü: ${type}

⏳ VerifyDoc analiz başlatıyor...`
);


// =================================================
// TELEGRAM'DAN İNDİR
// =================================================

const downloaded =
await downloadTelegramFile(
fileId
);


// =================================================
// VERIFYDOC ANALİZİ
// =================================================

const result =
await analyzeFile({

buffer:
downloaded.buffer,

fileName,

mimeType,

type,

bank,

});


// =================================================
// SONUÇ
// =================================================

await sendAnalysisResult(
chatId,
result
);

}


// =====================================================
// ANA TELEGRAM HANDLER
// =====================================================

export default async function handler(
req,
res
) {

// =================================================
// GET
// =================================================

if (
req.method !== "POST"
) {

return res
.status(200)
.json({

ok: true,

message:
"VerifyDoc Telegram endpoint aktif.",

});

}


try {

const update =
req.body;


console.log(
"================================"
);

console.log(
"TELEGRAM UPDATE ALINDI"
);

console.log(
"UPDATE ID:",
update?.update_id
);

console.log(
"================================"
);


// =================================================
// UPDATE ID KONTROLÜ
// =================================================

const updateId =
update?.update_id;


if (
updateId !== undefined
) {

if (
processedUpdates.has(
updateId
)
) {

console.log(
"DUPLICATE UPDATE:",
updateId
);


return res
.status(200)
.json({
ok: true,
duplicate: true,
});

}


processedUpdates.add(
updateId
);


// Set'in sonsuza kadar büyümemesi için
// yaklaşık 10 dakika sonra temizle.

setTimeout(
() => {

processedUpdates.delete(
updateId
);

},
10 * 60 * 1000
);

}


// =================================================
// ANALİZİ ARKA PLANDA ÇALIŞTIR
// =================================================

waitUntil(
processTelegramUpdate(
update
)
.catch(
async (error) => {

console.error(
"TELEGRAM PROCESS ERROR:",
error
);


try {

const chatId =
update
?.message
?.chat
?.id;


if (
chatId
) {

await sendMessage(
chatId,

`❌ Analiz sırasında hata oluştu.

Hata:
${error?.message || "Bilinmeyen hata"}`
);

}

} catch (
telegramError
) {

console.error(
"TELEGRAM ERROR MESSAGE FAILED:",
telegramError
);

}

}
)
);


// =================================================
// TELEGRAM'A HEMEN 200
// =================================================

return res
.status(200)
.json({

ok: true,

});


} catch (
error
) {

console.error(
"TELEGRAM WEBHOOK ERROR:",
error
);


return res
.status(200)
.json({

ok: false,

});

}

}
