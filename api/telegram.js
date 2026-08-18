// =====================================================
// VERIFYDOC TELEGRAM BOT
// =====================================================

const TELEGRAM_BOT_TOKEN =
 process.env.TELEGRAM_BOT_TOKEN;

const ANALYZE_URL =
 "https://verifydoc-api.vercel.app/api/analyze";


// =====================================================
// TELEGRAM API
// =====================================================

async function telegram(method, body) {

 const response = await fetch(
 `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
 {
 method: "POST",
 headers: {
 "Content-Type": "application/json",
 },
 body: JSON.stringify(body),
 }
 );

 const data = await response.json();

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
 chat_id: chatId,
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
 file_id: fileId,
 }
 );

 if (!file.file_path) {

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
 buffer: Buffer.from(arrayBuffer),
 filePath: file.file_path,
 };

}


// =====================================================
// BANKA BELİRLE
// =====================================================

function detectBank(text) {

 if (!text) {
 return null;
 }

 const value =
 text
 .toLowerCase()
 .trim()
 .replace(/\s+/g, "");

 if (
 value.includes("garanti") ||
 value.includes("garantibbva")
 ) {

 return "garanti";

 }

 if (
 value.includes("akbank")
 ) {

 return "akbank";

 }

 return null;

}


// =====================================================
// DOSYAYI ANALYZE GÖNDER
// =====================================================

async function analyzeFile({

 buffer,
 fileName,
 mimeType,
 type,
 bank,

}) {

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


 let fieldName = "file";

 if (type === "image") {
 fieldName = "image";
 }

 if (type === "video") {
 fieldName = "video";
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
 method: "POST",
 body: form,
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
// SONUCU TELEGRAM'A GÖNDER
// =====================================================

async function sendAnalysisResult(
 chatId,
 result
) {

 const score =
 Number(result?.score) || 0;

 const confidence =
 Number(result?.confidence) || 0;

 const riskLabel =
 result?.riskLabel ||
 "UNKNOWN";

 const summary =
 result?.summary ||
 "Analiz tamamlandı.";


 let emoji = " ";

 if (score >= 71) {

 emoji = " ";

 } else if (score >= 46) {

 emoji = " ";

 } else if (score >= 21) {

 emoji = " ";

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
// ANA HANDLER
// =====================================================

export default async function handler(
 req,
 res
) {

 // ---------------------------------------------------
 // TELEGRAM SADECE POST
 // ---------------------------------------------------

 if (req.method !== "POST") {

 return res
 .status(200)
 .json({
 ok: true,
 message:
 "VerifyDoc Telegram endpoint aktif."
 });

 }


 try {

 if (!TELEGRAM_BOT_TOKEN) {

 throw new Error(
 "TELEGRAM_BOT_TOKEN Vercel Environment Variables içinde bulunamadı."
 );

 }


 const update =
 req.body;


 console.log(
 "TELEGRAM UPDATE ALINDI"
 );


 const message =
 update?.message;


 if (!message) {

 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 const chatId =
 message?.chat?.id;


 const text =
 message?.text ||
 message?.caption ||
 "";


 // =================================================
 // START
 // =================================================

 if (
 typeof message?.text === "string" &&
 message.text.startsWith("/start")
 ) {

 await sendMessage(
 chatId,

` VerifyDoc'a hoş geldin.

Dekont veya belge göndererek otomatik inceleme yaptırabilirsin.

Banka seçmek için:

/akbank
/garanti

Ardından belgeyi gönder.

Örnek:

/garanti

sonra Garanti dekontunu gönder.`

 );


 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 // =================================================
 // BANKA KOMUTU
 // =================================================

 if (
 message?.text === "/akbank"
 ) {

 await sendMessage(
 chatId,
 " Akbank seçildi.\n\nŞimdi Akbank dekontunu gönder."
 );

 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 if (
 message?.text === "/garanti"
 ) {

 await sendMessage(
 chatId,
 " Garanti BBVA seçildi.\n\nŞimdi Garanti dekontunu gönder."
 );

 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 // =================================================
 // DOSYA YOKSA
 // =================================================

 const hasPhoto =
 Array.isArray(message.photo) &&
 message.photo.length > 0;

 const hasDocument =
 !!message.document;

 const hasVideo =
 !!message.video;


 if (
 !hasPhoto &&
 !hasDocument &&
 !hasVideo
 ) {

 await sendMessage(
 chatId,
` Lütfen analiz etmek istediğin dekontu gönder.

Desteklenen:
• PDF
• Fotoğraf
• Video

Banka seçimi:
 /akbank
 /garanti`
 );

 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 // =================================================
 // BANKA
 // =================================================

 const bank =
 detectBank(text);


 if (!bank) {

 await sendMessage(
 chatId,

` Önce bankayı belirtmem gerekiyor.

Lütfen dekontu açıklamasına:

garanti

veya

akbank

yazarak gönder.

Örneğin:

Garanti dekontu`

 );

 return res
 .status(200)
 .json({
 ok: true,
 });

 }


 // =================================================
 // DOSYA BİLGİLERİ
 // =================================================

 let fileId;
 let fileName;
 let mimeType;
 let type;


 // -------------------------------------------------
 // FOTOĞRAF
 // -------------------------------------------------

 if (hasPhoto) {

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


 // -------------------------------------------------
 // DOCUMENT
 // -------------------------------------------------

 else if (hasDocument) {

 fileId =
 message.document.file_id;

 fileName =
 message.document.file_name ||
 "telegram-document";

 mimeType =
 message.document.mime_type ||
 "application/octet-stream";


 if (
 mimeType === "application/pdf" ||
 fileName.toLowerCase().endsWith(".pdf")
 ) {

 type =
 "pdf";

 } else if (
 mimeType.startsWith("image/")
 ) {

 type =
 "image";

 } else {

 type =
 "pdf";

 }

 }


 // -------------------------------------------------
 // VIDEO
 // -------------------------------------------------

 else if (hasVideo) {

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
 // ANALİZ BAŞLIYOR
 // =================================================

 await sendMessage(
 chatId,

` Belge alındı.

 Banka: ${
 bank === "garanti"
 ? "Garanti BBVA"
 : "Akbank"
}

 VerifyDoc analiz başlatıyor...`
 );


 // =================================================
 // TELEGRAM'DAN İNDİR
 // =================================================

 const downloaded =
 await downloadTelegramFile(
 fileId
 );


 // =================================================
 // VERIFYDOC'A GÖNDER
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
 // SONUCU GÖNDER
 // =================================================

 await sendAnalysisResult(
 chatId,
 result
 );


 return res
 .status(200)
 .json({
 ok: true,
 });


 } catch (error) {

 console.error(
 "TELEGRAM BOT ERROR:",
 error
 );


 try {

 const update =
 req.body;

 const chatId =
 update?.message?.chat?.id;


 if (chatId) {

 await sendMessage(
 chatId,

` Analiz sırasında hata oluştu.

Hata:
${error?.message || "Bilinmeyen hata"}

Lütfen tekrar deneyin.`
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


 return res
 .status(200)
 .json({
 ok: false,
 });

 }

}
