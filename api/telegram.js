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
 text,
 replyToMessageId = null,
 replyMarkup = null,
 parseMode = null
) {

 const body = {

 chat_id:
 chatId,

 text:
 text,

 };

 if (
 replyToMessageId !== null &&
 replyToMessageId !== undefined
 ) {

 body.reply_parameters = {

 message_id:
 Number(
 replyToMessageId
 ),

 allow_sending_without_reply:
 true,

 };

 }

 if (
 replyMarkup
 ) {

 body.reply_markup =
 replyMarkup;

 }

 if (parseMode) {

 body.parse_mode = parseMode;

 }

 console.log(
 "TELEGRAM SEND:",
 JSON.stringify({
   chat_id: body.chat_id,
   textLength: String(body.text || "").length,
   reply_to_message_id: body.reply_parameters?.message_id || null,
   hasReplyMarkup: Boolean(body.reply_markup),
   parse_mode: body.parse_mode || null,
 })
 );

 return telegram(
 "sendMessage",
 body
 );

}


// =====================================================
// FOTOĞRAF GÖNDER
// =====================================================
// VerifyDoc analyze.js tarafından üretilen Base64 görüntüyü
// Telegram'a gerçek fotoğraf olarak gönderir.
// =====================================================

async function sendPhoto(
 chatId,
 imageBase64,
 caption = "",
 replyToMessageId = null
) {

 if (
 !imageBase64 ||
 typeof imageBase64 !== "string"
 ) {
 return null;
 }

 let base64 = imageBase64;
 let mimeType = "image/jpeg";

 const dataUrlMatch =
 base64.match(
 /^data:([^;]+);base64,(.+)$/s
 );

 if (dataUrlMatch) {
 mimeType = dataUrlMatch[1] || mimeType;
 base64 = dataUrlMatch[2];
 }

 const buffer =
 Buffer.from(
 base64,
 "base64"
 );

 if (!buffer.length) {
 throw new Error(
 "İşaretli dekont görüntüsü boş."
 );
 }

 const extension =
 mimeType.includes("png")
 ? "png"
 : "jpg";

 const form =
 new FormData();

 form.append(
 "chat_id",
 String(chatId)
 );

 if (caption) {
 form.append(
 "caption",
 String(caption)
 );
 }

 if (
 replyToMessageId !== null &&
 replyToMessageId !== undefined
 ) {
 form.append(
 "reply_parameters",
 JSON.stringify({
 message_id:
 Number(replyToMessageId),
 allow_sending_without_reply:
 true,
 })
 );
 }

 form.append(
 "photo",
 new Blob(
 [buffer],
 { type: mimeType }
 ),
 `verifydoc-difference.${extension}`
 );

 const response =
 await fetch(
 `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
 {
 method: "POST",
 body: form,
 }
 );

 const data =
 await response.json();

 if (!response.ok || !data.ok) {
 throw new Error(
 data?.description ||
 "Telegram işaretli dekont fotoğrafını gönderemedi."
 );
 }

 console.log(
 "TELEGRAM ANNOTATED PHOTO SENT"
 );

 return data.result;

}


// =====================================================
// CALLBACK CEVAPLA
// =====================================================

async function answerCallbackQuery(
 callbackQueryId,
 text = null
) {

 const body = {

 callback_query_id:
 callbackQueryId,

 };

 if (text) {

 body.text =
 text;

 }

 return telegram(
 "answerCallbackQuery",
 body
 );

}


// =====================================================
// INLINE KEYBOARD KALDIR
// =====================================================

async function removeInlineKeyboard(
 chatId,
 messageId
) {

 try {

 await telegram(
 "editMessageReplyMarkup",
 {

 chat_id:
 chatId,

 message_id:
 messageId,

 reply_markup: {

 inline_keyboard:
 [],

 },

 }
 );

 }

 catch (error) {

 console.error(
 "KEYBOARD REMOVE ERROR:",
 error
 );

 }

}


// =====================================================
// BANKA GÖRÜNÜR ADI
// =====================================================

function getBankDisplayName(
 bank
) {

 if (
 bank === "akbank"
 ) {

 return "Akbank";

 }

 if (
 bank === "garanti"
 ) {

 return "Garanti BBVA";

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

 if (
 bank === "ziraat"
 ) {

 return "Ziraat Bankası";

 }

 if (
 bank === "denizbank"
 ) {

 return "Denizbank";

 }

 if (
 bank === "halkbank"
 ) {

 return "Halkbank";

 }

 if (
 bank === "yapikredi"
 ) {

 return "Yapı Kredi";

 }

 if (
 bank === "qnb"
 ) {

 return "QNB";

 }

 if (
 bank === "ing"
 ) {

 return "ING";

 }

 if (
 bank === "teb"
 ) {

 return "TEB";

 }

 if (
 bank === "kuveytturk"
 ) {

 return "Kuveyt Türk";

 }

 return bank;

}


// =====================================================
// BANKA BUTONLARI
// =====================================================

function getBankKeyboard() {

 return {

 inline_keyboard: [

 [
 {
 text:
 " Akbank",

 callback_data:
 "bank:akbank",
 },

 {
 text:
 " Garanti BBVA",

 callback_data:
 "bank:garanti",
 },
 ],

 [
 {
 text:
 " Enpara",

 callback_data:
 "bank:enpara",
 },

 {
 text:
 " VakıfBank",

 callback_data:
 "bank:vakifbank",
 },
 ],

 [
 {
 text:
 " İş Bankası",

 callback_data:
 "bank:isbankasi",
 },

 {
 text:
 " Ziraat",

 callback_data:
 "bank:ziraat",
 },
 ],

 [
 {
 text:
 " Denizbank",

 callback_data:
 "bank:denizbank",
 },

 {
 text:
 " Halkbank",

 callback_data:
 "bank:halkbank",
 },
 ],

 [
 {
 text:
 " Yapı Kredi",

 callback_data:
 "bank:yapikredi",
 },

 {
 text:
 " QNB",

 callback_data:
 "bank:qnb",
 },
 ],

 [
 {
 text:
 " ING",

 callback_data:
 "bank:ing",
 },

 {
 text:
 " TEB",

 callback_data:
 "bank:teb",
 },
 ],

 [
 {
 text:
 " Kuveyt Türk",

 callback_data:
 "bank:kuveytturk",
 },
 ],

 [
 {
 text:
 " Hesap Özeti",

 callback_data:
 "mode:statement",
 },
 ],

 ],

 };

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


 if (
 mime ===
 "application/pdf" ||

 name.endsWith(
 ".pdf"
 )
 ) {

 return "pdf";

 }


 if (
 mime.startsWith(
 "image/"
 ) ||

 name.endsWith(
 ".jpg"
 ) ||

 name.endsWith(
 ".jpeg"
 ) ||

 name.endsWith(
 ".png"
 ) ||

 name.endsWith(
 ".webp"
 )
 ) {

 return "image";

 }


 if (
 mime.startsWith(
 "video/"
 ) ||

 name.endsWith(
 ".mp4"
 ) ||

 name.endsWith(
 ".mov"
 ) ||

 name.endsWith(
 ".avi"
 ) ||

 name.endsWith(
 ".mkv"
 ) ||

 name.endsWith(
 ".webm"
 )
 ) {

 return "video";

 }


 return null;

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


 if (
 !file?.file_path
 ) {

 throw new Error(
 "Telegram dosya yolu döndürmedi."
 );

 }


 const fileUrl =
 `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;


 const response =
 await fetch(
 fileUrl
 );


 if (
 !response.ok
 ) {

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
// KULLANICI AÇIKLAMASINDAN BEKLENEN BİLGİLERİ ÇIKAR
// =====================================================
//
// Örnek:
//
// Gönderen: Atıf Kale
// 1000 TL
// TR83 0013 4000 0266 0590 7001 01
// Alıcı: Mehmet Uşak
//
// Açıklama yoksa bütün alanlar null kalır.
//
// ÖNEMLİ:
// Önce para birimiyle birlikte yazılan tutar aranır.
// Böylece:
//
// 12.45
// 500 TL
//
// örneğinde 12.45 saat/tutar olarak yanlış alınmaz.
// =====================================================

function extractExpectedDetails(
 text
) {

 const result = {

 senderName:
 null,

 recipientName:
 null,

 amount:
 null,

 currency:
 null,

 iban:
 null,

 rawText:
 text ||
 "",

 };


 if (
 !text ||
 typeof text !== "string"
 ) {

 return result;

 }


 const normalized =
 text
 .replace(
 /\r/g,
 ""
 )
 .trim();


 if (!normalized) {

 return result;

 }


 const lines =
 normalized
 .split("\n")
 .map(
 line =>
 line
 .trim()
 .replace(
 /\s+/g,
 " "
 )
 )
 .filter(Boolean);


 // ===================================================
 // GÖNDEREN
 // ===================================================

 const senderMatch =
 normalized.match(
 /(?:gönderen|gonderen|sender)\s*[:\-]?\s*([^\n]+)/i
 );

 if (
 senderMatch?.[1]
 ) {

 result.senderName =
 senderMatch[1]
 .trim();

 }

 // ===================================================
 // ALICI
 // ===================================================

 const recipientMatch =
 normalized.match(
 /(?:alıcı|alici|recipient)\s*[:\-]?\s*([^\n]+)/i
 );

 if (
 recipientMatch?.[1]
 ) {

 result.recipientName =
 recipientMatch[1]
 .trim();

 }


 // ===================================================
 // IBAN
 // ===================================================

 const ibanMatch =
normalized.match(
/\b([A-Z]{2}\s?\d{2}(?:\s?\d{4}){5}\s?\d{2})\b/i
);

 if (
 ibanMatch?.[1]
 ) {

 result.iban =
 ibanMatch[1]
 .replace(
 /\s+/g,
 ""
 )
 .toUpperCase();

 }


 // ===================================================
 // TUTAR — ÖNCE PARA BİRİMİ İLE BİRLİKTE ARA
 // ===================================================

 const amountWithCurrencyMatch =
 normalized.match(
 /(?:^|\s)(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(TL|TRY|₺|EUR|EURO|USD|\$)(?=\s|$)/i
 );

 if (
 amountWithCurrencyMatch?.[1]
 ) {

 result.amount =
 amountWithCurrencyMatch[1];

 result.currency =
 amountWithCurrencyMatch[2]
 .toUpperCase();

 }


 // ===================================================
 // TL / TRY KONTROLÜ
 // ===================================================

 if (
 !result.currency &&
 /(?:TL|TRY|₺)/i.test(
 normalized
 )
 ) {

 result.currency =
 "TRY";

 }


 // ===================================================
 // ETİKETLİ TUTAR
 // ===================================================

 const labeledAmountMatch =
 normalized.match(
 /(?:tutar|miktar|amount)\s*[:\-]?\s*([0-9][0-9.,]*)\s*(TL|TRY|₺|EUR|EURO|USD|\$)?/i
 );

 if (
 labeledAmountMatch?.[1]
 ) {

 result.amount =
 labeledAmountMatch[1];

 if (
 labeledAmountMatch?.[2]
 ) {

 result.currency =
 labeledAmountMatch[2]
 .toUpperCase();

 }

 }


 // ===================================================
 // SADECE SAYI VERİLMİŞSE
 // ===================================================
 //
 // IBAN ve saat satırlarını tutar sanma.
 // ===================================================

 if (
 !result.amount
 ) {

 for (
 const line of lines
 ) {

 if (
 /iban/i.test(
 line
 )
 ) {

 continue;

 }

 if (
 /\bTR\d{2}/i.test(
 line
 )
 ) {

 continue;

 }

 // 12.45 gibi değerleri saat kabul et.

 if (
 /^\d{1,2}[.:]\d{2}$/.test(
 line
 )
 ) {

 continue;

 }

 const match =
 line.match(
 /^(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/
 );

 if (
 match
 ) {

 result.amount =
 match[1];

 break;

 }

 }

 }


 // ===================================================
 // YAPISIZ METİN İÇİN YARDIMCI ANALİZ
 // ===================================================

 const bankRegex =
 /\b(akbank|garanti(?:\s+bbva)?|garanti\s+bankası|enpara|vakıfbank|iş\s+bankası|isbankası|ziraat(?:\s+bankası)?|denizbank|halkbank|yapı\s+kredi)\b/i;


 const timeRegex =
 /^\d{1,2}[.:]\d{2}$/;


 const amountLineRegex =
 /^\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?\s*(?:TL|TRY|₺|EUR|EURO|USD|\$)$/i;


 const cleanLines =
 lines.filter(
 line => {

 if (
 /iban/i.test(
 line
 )
 ) {

 return false;

 }

 if (
 /\bTR\d{2}/i.test(
 line
 )
 ) {

 return false;

 }

 if (
 bankRegex.test(
 line
 )
 ) {

 return false;

 }

 if (
 timeRegex.test(
 line
 )
 ) {

 return false;

 }

 if (
 amountLineRegex.test(
 line
 )
 ) {

 return false;

 }

 if (
 /^\d{5,}$/.test(
 line.replace(
 /\s/g,
 ""
 )
 )
 ) {

 return false;

 }

 return true;

 }
 );


 // ===================================================
 // YAPISIZ GÖNDEREN / ALICI
 // ===================================================

 if (
 !result.senderName &&
 !result.recipientName &&
 cleanLines.length
 ) {

 const bankIndex =
 lines.findIndex(
 line =>
 bankRegex.test(
 line
 )
 );


 const amountIndex =
 lines.findIndex(
 line =>
 amountLineRegex.test(
 line
 )
 );


 // ---------------------------------------------------
 // BANKADAN ÖNCEKİ İSİM
 // ---------------------------------------------------

 if (
 bankIndex > 0
 ) {

 const beforeBank =
 lines
 .slice(
 0,
 bankIndex
 )
 .filter(
 line => {

 if (
 /^\d{5,}$/.test(
 line.replace(
 /\s/g,
 ""
 )
 )
 ) {

 return false;

 }

 if (
 timeRegex.test(
 line
 )
 ) {

 return false;

 }

 return true;

 }
 );


 if (
 beforeBank.length
 ) {

 result.senderName =
 beforeBank
 .join(" ")
 .trim();

 }

 }


 // ---------------------------------------------------
 // TUTARDAN SONRAKİ İSİM
 // ---------------------------------------------------

 if (
 amountIndex >= 0
 ) {

 const afterAmount =
 lines
 .slice(
 amountIndex + 1
 )
 .filter(
 line => {

 if (
 /iban/i.test(
 line
 )
 ) {

 return false;

 }

 if (
 /\bTR\d{2}/i.test(
 line
 )
 ) {

 return false;

 }

 if (
 bankRegex.test(
 line
 )
 ) {

 return false;

 }

 if (
 timeRegex.test(
 line
 )
 ) {

 return false;

 }

 return true;

 }
 );


 if (
 afterAmount.length
 ) {

 result.recipientName =
 afterAmount
 .join(" ")
 .trim();

 }

 }

 }


 // ===================================================
 // SON ÇARE
 // ===================================================

 if (
 !result.senderName &&
 cleanLines.length >= 2
 ) {

 result.senderName =
 cleanLines[0];

 }


 if (
 !result.recipientName &&
 cleanLines.length >= 2
 ) {

 result.recipientName =
 cleanLines[
 cleanLines.length - 1
 ];

 }


 console.log(
 "EXPECTED DETAILS:",
 JSON.stringify(
 result,
 null,
 2
 )
 );


 return result;

}


// =====================================================
// ORİJİNAL MESAJDAN DOSYA BİLGİSİ ÇIKAR
// =====================================================

function extractFileFromMessage(
 message
) {

 if (
 Array.isArray(
 message?.photo
 ) &&
 message.photo.length
 ) {

 const photo =
 message.photo[
 message.photo.length - 1
 ];

 return {

 fileId:
 photo.file_id,

 fileName:
 "telegram-photo.jpg",

 mimeType:
 "image/jpeg",

 type:
 "image",

 };

 }


 if (
 message?.video
 ) {

 return {

 fileId:
 message.video.file_id,

 fileName:
 "telegram-video.mp4",

 mimeType:
 message.video.mime_type ||
 "video/mp4",

 type:
 "video",

 };

 }


 if (
 message?.document
 ) {

 const fileName =
 message.document.file_name ||
 "telegram-document";


 const mimeType =
 message.document.mime_type ||
 "application/octet-stream";


 const type =
 determineDocumentType(
 mimeType,
 fileName
 );


 if (!type) {

 return null;

 }


 return {

 fileId:
 message.document.file_id,

 fileName,

 mimeType,

 type,

 };

 }


 return null;

}


// =====================================================
// VERIFYDOC API'YE DOSYA GÖNDER
// =====================================================

async function analyzeFile({

 buffer,
fileId,
 fileName,
 mimeType,
 type,
 bank,
 statementMode,

expectedDetails,

}) {

 console.log(
 "================================"
 );

 console.log(
 "VERIFYDOC ANALİZ BAŞLIYOR"
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
 bank ||
 "YOK"
 );

 console.log(
 "STATEMENT:",
 statementMode
 );

 console.log(
 "EXPECTED DETAILS:",
 expectedDetails
 );

 console.log(
 "================================"
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


 // ===================================================
 // HESAP ÖZETİ
 // ===================================================

 if (
 statementMode
 ) {

 form.append(
 "statementMode",
 "true"
 );

 }


 // ===================================================
 // BANKA
 // ===================================================

 if (
 bank
 ) {

 form.append(
 "bank",
 bank
 );

 }


 // ===================================================
 // KULLANICININ VERDİĞİ BEKLENEN BİLGİLER
 // ===================================================
 //
 // YENİ:
 // providedInfo JSON olarak API'ye gönderiliyor.
 //
 // Geriye dönük uyumluluk için eski alanlar da
 // gönderiliyor.
 // ===================================================

 if (
 expectedDetails
 ) {

 const hasExpectedDetails =
 Object.values(
 expectedDetails
 )
 .some(
 value =>
 value !== null &&
 value !== undefined &&
 String(value).trim() !== ""
 );


 if (
 hasExpectedDetails
 ) {

 form.append(
 "providedInfo",
 JSON.stringify({

 senderName:
 expectedDetails.senderName ||
 null,

 recipientName:
 expectedDetails.recipientName ||
 null,

 amount:
 expectedDetails.amount ||
 null,

 currency:
 expectedDetails.currency ||
 null,

 iban:
 expectedDetails.iban ||
 null,

 })
 );


 if (
 expectedDetails.senderName
 ) {

 form.append(
 "expectedSenderName",
 expectedDetails.senderName
 );

 }


 if (
 expectedDetails.recipientName
 ) {

 form.append(
 "expectedRecipientName",
 expectedDetails.recipientName
 );

 }


 if (
 expectedDetails.amount
 ) {

 form.append(
 "expectedAmount",
 expectedDetails.amount
 );

 }


 if (
 expectedDetails.currency
 ) {

 form.append(
 "expectedCurrency",
 expectedDetails.currency
 );

 }


 if (
 expectedDetails.iban
 ) {

 form.append(
 "expectedIban",
 expectedDetails.iban
 );

 }


 if (
 expectedDetails.rawText
 ) {

 form.append(
 "expectedRawText",
 expectedDetails.rawText
 );

 }

 }

 }


 // ===================================================
 // DOSYA
 // ===================================================

 let response;
 if (type === "video" && fileId) {
  const internalSecret = process.env.VERIFYDOC_TELEGRAM_ANALYSIS_SECRET;
  if (!internalSecret) throw new Error("VERIFYDOC_TELEGRAM_ANALYSIS_SECRET Vercel ortam değişkeninde tanımlı değil.");
  console.log("VIDEO TRANSFER MODE: Telegram file_id; file bytes are fetched by the analysis API");
  response = await fetch(ANALYZE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-verifydoc-telegram-secret": internalSecret,
    },
    body: JSON.stringify({
      source: "telegram-video",
      fileId,
      fileName,
      mimeType,
      type,
      bank: bank || null,
      statementMode: Boolean(statementMode),
      providedInfo: expectedDetails || null,
    }),
  });
 } else {
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  let fieldName = "file";
  if (type === "image") fieldName = "image";
  if (type === "video") fieldName = "video";
  form.append(fieldName, blob, fileName);
  response = await fetch(ANALYZE_URL, { method: "POST", body: form });
 }


 const responseText =
 await response.text();


 console.log(
 "VERIFYDOC HTTP STATUS:",
 response.status
 );

 console.log(
 "VERIFYDOC RAW RESPONSE:",
 responseText.slice(
 0,
 2000
 )
 );


 let result;


 try {

 result =
 JSON.parse(
 responseText
 );

 }

 catch {

 throw new Error(
 `VerifyDoc API JSON döndürmedi. HTTP ${response.status}: ${responseText.slice(0, 500)}`
 );

 }


 if (
 !response.ok
 ) {

 throw new Error(
 result?.error ||
 `VerifyDoc analiz API hatası. HTTP ${response.status}`
 );

 }


 return result;

}


// =====================================================
// KULLANICI BİLGİSİ KARŞILAŞTIRMA SONUCUNU FORMATLA
// =====================================================
//
// API'den öncelikle:
//
// informationCheck
//
// beklenir.
//
// Eski yapı için:
//
// comparison
//
// da desteklenir.
// =====================================================

function formatComparisonWarning(
 comparison
) {

 if (
 !comparison ||
 typeof comparison !== "object"
 ) {

 return "";

 }


 const provided =
 comparison?.provided ||
 null;


 const hasExpected =
 comparison?.enabled === true ||
 comparison?.hasExpectedDetails === true ||
 !!provided;


 if (
 !hasExpected
 ) {

 return "";

 }


 const matches =
 comparison?.matches ||
 {};


 const warnings =
 Array.isArray(
 comparison?.warnings
 )
 ? comparison.warnings
 : [];


 // ===================================================
 // MATCHES YAPISI
 // ===================================================

 const mismatchCount =
 Object.values(
 matches
 )
 .filter(
 value =>
 value === "mismatch" ||
 value === false
 )
 .length;


 const unknownCount =
 Object.values(
 matches
 )
 .filter(
 value =>
 value === "unknown" ||
 value === null
 )
 .length;


 // ===================================================
 // HER ŞEY UYUMLU
 // ===================================================

 if (
 mismatchCount === 0 &&
 unknownCount === 0 &&
 warnings.length === 0
 ) {

 return `

━━━━━━━━━━━━━━
 KULLANICI BİLGİSİ KONTROLÜ

 Girilen bilgiler dekontta görünen bilgilerle uyumlu görünüyor.

Bu kontrol risk skoruna dahil edilmemiştir.`;

 }


 // ===================================================
 // UYARI
 // ===================================================

 let text = `

━━━━━━━━━━━━━━
 KULLANICI BİLGİSİ KONTROLÜ`;


 if (
 mismatchCount > 0
 ) {

 text += `

 UYARI: Girilen bilgiler ile dekont arasında farklılık bulundu.`;

 }

 else {

 text += `

 Girilen bilgilerin bazıları dekont üzerinden güvenilir şekilde doğrulanamadı.`;

 }


 // ===================================================
 // API WARNINGS
 // ===================================================

 if (
 warnings.length
 ) {

 text +=

 `

${warnings
 .map(
 warning =>
 `• ${warning}`
 )
 .join(
 "\n"
 )}`;

 }


 // ===================================================
 // MATCHES'TEN OTOMATİK UYARI ÜRET
 // ===================================================

 const fieldNames = {

 senderName:
 "Gönderen adı",

 recipientName:
 "Alıcı adı",

 amount:
 "Tutar",

 currency:
 "Para birimi",

 iban:
 "IBAN",

 };


 for (
 const [
 field,
 value
 ]
 of Object.entries(
 matches
 )
 ) {

 if (
 value === "mismatch" ||
 value === false
 ) {

 text +=
 `\n• ${fieldNames[field] || field}: Uyuşmuyor.`;

 }

 }


 text += `

Bu kontrol risk skoruna dahil edilmemiştir.`;


 return text;

}


// =====================================================
// GEÇMİŞ ŞÜPHELİ KAYIT UYARISI
// =====================================================
// Bu bölüm yalnızca Analyze API gerçekten güçlü bir geçmiş eşleşmesi
// döndürdüğünde çalışır. Normal belgelerde hiçbir mesaj üretmez.
function formatHistoricalWarning(historicalMatch) {
  if (!historicalMatch?.matched) return '';

  const score = Number(historicalMatch.matchScore) || 0;
  const signals = Array.isArray(historicalMatch.matchedSignals)
    ? historicalMatch.matchedSignals
    : [];
  const previousCases = Array.isArray(historicalMatch.previousCases)
    ? historicalMatch.previousCases
    : [];

  const lines = [
    '',
    '⚠️ GEÇMİŞ ŞÜPHELİ KAYIT EŞLEŞMESİ',
    '',
    'Bu belge, daha önce şüpheli olarak kaydedilmiş bir kayıtla güçlü şekilde eşleşiyor.',
    '',
    signals.length ? `Eşleşen bilgiler: ${signals.join(', ')}` : 'Eşleşen güçlü kimlik/hesap bilgisi bulundu.',
    `Eşleşme: %${score}`,
    `Önceki şüpheli kayıt: ${Number(historicalMatch.previousCaseCount) || previousCases.length}`,
  ];

  const previousBank = previousCases[0]?.bank;
  if (previousBank) lines.push(`Önceki kayıt bankası: ${previousBank}`);

  lines.push(
    '',
    '⚠️ Bu eşleşme geçmişte şüpheli olarak işaretlenen kayıtlarla ilişki bulunduğunu gösterir.',
    'Detaylı inceleme önerilir.'
  );

  return lines.join('\n');
}

// =====================================================
// PDF STRUCTURE TRIAGE — EVIDENCE ONLY
// =====================================================
function formatPdfStructureForensics(triage) {
  if (triage?.available !== true) return '';
  const counts = triage.normalizedOperatorCounts || {};
  const lines = ['\n🧪 PDF YAPISAL TARAMA (Node.js)'];
  if (Number.isFinite(Number(triage.fileBytes))) {
    lines.push(`• PDF boyutu: ${Number(triage.fileBytes).toLocaleString('tr-TR')} bayt · ${triage.pageCount || '?'} sayfa`);
  }
  lines.push(`• PDF.js metin çizim işlemleri: ${counts.textShow ?? 0} · görsel işlemleri: ${counts.imagePaint ?? 0} · vektör yolları: ${counts.vectorPath ?? 0}`);
  lines.push('• PDF.js işlem sayıları Tj/TJ ham komutlarının birebir sayımı değildir; nesne sayıları tek başına düzenleme veya sahtecilik kanıtı olmaz.');
  return lines.join('\n');
}

// =====================================================
// FONT FORENSICS UYARISI
// =====================================================
function formatFontForensicsWarning(fontForensics) {
 const f = fontForensics || {};
 if (f.available !== true) return '';
 const score = Number(f.score) || 0;
 if (score < 18) return '';
 const targetOnly = Array.isArray(f.targetOnlyFamiliesAcrossReferences)
   ? f.targetOnlyFamiliesAcrossReferences.filter(Boolean).slice(0, 5)
   : [];
 const fieldMismatches = Array.isArray(f.comparisons?.[0]?.comparison?.fieldMismatches)
   ? f.comparisons[0].comparison.fieldMismatches.slice(0, 4)
   : [];
 const lines = ['\n🅰️ FONT ANALİZİ'];
 if (targetOnly.length) {
   lines.push(`• Referanslarda bulunmayan hedef font: ${targetOnly.join(', ')}`);
 }
 for (const item of fieldMismatches) {
   const ref = Array.isArray(item.referenceFonts) ? item.referenceFonts.join(', ') : '';
   const tar = Array.isArray(item.targetFonts) ? item.targetFonts.join(', ') : '';
   lines.push(`• ${item.labelText || item.field}: referans [${ref}] → hedef [${tar}]`);
 }
 if (lines.length === 1) {
   lines.push(`• Referans/hedef PDF font profili arasında farklılık sinyali bulundu (skor ${score}/100).`);
 }
 lines.push('• Font farkı tek başına sahtecilik kanıtı değildir; diğer forensic bulgularla birlikte değerlendirilir.');
 return lines.join('\n');
}

// =====================================================
// ANALİZ SONUCUNU GÖNDER
// =====================================================

async function sendAnalysisResult(
 chatId,
 result,
 replyToMessageId,
 statementMode
) {

 const score =
 Number(
 result?.score
 ) || 0;


 const hasConfidence = result?.confidence !== null &&
   result?.confidence !== undefined &&
   String(result.confidence).trim() !== '' &&
   Number.isFinite(Number(result.confidence));
 const confidence =
 hasConfidence
   ? Math.max(0, Math.min(100, Math.round(Number(result.confidence))))
   : null;


 const riskLabel =
 result?.riskLabel ||
 "UNKNOWN";


 const summary =
 result?.summary ||
 "Analiz tamamlandı.";

 const manualReviewRequired = result?.manualReviewRequired === true ||
   result?.fieldReviewStatus === 'CONTROL_REQUIRED' ||
   result?.semanticEvidenceFusion?.reviewStatus === 'CONTROL_REQUIRED';
 const suspiciousFinding = result?.suspicious === true;
 const reviewHeadline = manualReviewRequired
   ? '🟠 KONTROL GEREKLİ'
   : suspiciousFinding
     ? '🔴 ŞÜPHELİ BULGU VAR'
     : score >= 21
       ? '🟡 BULGULARI İNCELEYİN'
       : '🟢 BELİRGİN ŞÜPHELİ BULGU YOK';
 const confidenceLine = confidence === null
   ? 'Güven: Belirlenemedi'
   : `Güven: ${confidence}/100`;


 // ===================================================
 // EMOJI
 // ===================================================

 let emoji =
 " ";


 if (
 score >= 71
 ) {

 emoji =
 " ";

 }

 else if (
 score >= 46
 ) {

 emoji =
 " ";

 }

 else if (
 score >= 21
 ) {

 emoji =
 " ";

 }


 // Video reports get their own compact format so temporal cut candidates are
 // visible to the user instead of being buried in a generic image summary.
 if (result?.type === 'video') {
   const audit = result?.videoTemporalAudit || {};
   const duration = Number(result?.videoDurationSeconds ?? audit.durationSeconds);
   const formatTime = (seconds) => {
     const value = Math.max(0, Math.floor(Number(seconds) || 0));
     return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
   };
   const sceneCandidates = Array.isArray(audit.sceneChangeCandidates)
     ? audit.sceneChangeCandidates.map((item) => ({ ...item, signal: 'scene' }))
     : [];
   const adaptiveSceneAudit = audit.adaptiveSceneChange || {};
   const adaptiveSceneCandidates = Array.isArray(adaptiveSceneAudit.candidates)
     ? adaptiveSceneAudit.candidates.map((item) => ({ ...item, signal: 'adaptive-scene' }))
     : [];
   const secondDetector = audit.secondDetector || {};
   const lumaCandidates = Array.isArray(secondDetector.candidates)
     ? secondDetector.candidates.map((item) => ({ ...item, signal: 'luma' }))
     : [];
   // Report the strongest candidate from either detector. If both detectors
   // flag nearly the same moment, combine them into one user-facing event.
   const candidates = [...sceneCandidates, ...adaptiveSceneCandidates, ...lumaCandidates]
     .sort((a, b) => Number(a.timestampSeconds) - Number(b.timestampSeconds))
     .reduce((merged, item) => {
       const previous = merged[merged.length - 1];
       if (previous && Math.abs(Number(item.timestampSeconds) - Number(previous.timestampSeconds)) <= 0.5) {
         previous.signals.push(item.signal);
         // The two detector scores have different scales. Prefer the luma
         // timestamp when available instead of comparing unlike score values.
         if (item.signal === 'luma') {
           previous.timestampSeconds = item.timestampSeconds;
           previous.score = item.score;
           previous.signal = 'luma';
         }
       } else {
         merged.push({ ...item, signals: [item.signal] });
       }
       return merged;
     }, []);
   const formatSeconds = (seconds) => (Number(seconds) || 0).toFixed(2).replace('.', ',');
   const formatWindow = (seconds) => {
     const start = Math.max(0, Number(seconds) - 0.25);
     const end = Number(seconds) + 0.25;
     return `${start.toFixed(1).replace('.', ',')}–${end.toFixed(1).replace('.', ',')} saniye aralığını kontrol edin.`;
   };
   const status = !audit.available && !secondDetector.available
     ? '🟡 Zaman akışı kontrolü çalışmadı'
     : candidates.length
       ? '🟠 İnceleme önerilir'
       : '🟢 Taramada belirgin ani geçiş adayı bulunmadı';
   const candidateLines = candidates.slice(0, 5).flatMap((item) => {
     const timestamp = formatSeconds(item.timestampSeconds);
     if (item.signals.includes('luma')) {
       const measured = formatSeconds(item.score);
       const threshold = Number.isFinite(Number(secondDetector.adaptiveThreshold))
         ? formatSeconds(secondDetector.adaptiveThreshold)
         : null;
       return [
         `• Videonun ${timestamp} saniyesinde kareler arası görüntü farkı inceleme eşiğini aştı (${measured}${threshold ? `; eşik ${threshold}` : ''}).`,
         `• ${formatWindow(item.timestampSeconds)}`,
       ];
     }
    if (item.signals.includes('adaptive-scene')) {
      const threshold = Number.isFinite(Number(adaptiveSceneAudit.threshold))
        ? formatSeconds(adaptiveSceneAudit.threshold)
        : null;
      return [
        `• Videonun ${timestamp} saniyesinde, bu videonun olağan geçişlerine göre belirgin bir görüntü farkı adayı bulundu (${formatSeconds(item.score)}${threshold ? `; bağıl eşik ${threshold}` : ''}).`,
        `• ${formatWindow(item.timestampSeconds)}`,
      ];
    }
     return [
       `• Videonun ${timestamp} saniyesinde ani görüntü geçişi adayı bulundu (geçiş skoru ${item.score}).`,
       `• ${formatWindow(item.timestampSeconds)}`,
     ];
   });
   const coverage = audit.available
     ? `Zaman taraması: ${formatTime(audit.scannedSeconds)}${audit.fullDurationScanned ? ' / videonun tamamı' : ' / süre sınırı nedeniyle kısmi'}`
     : `Zaman taraması yapılamadı${audit.reason ? `: ${String(audit.reason).slice(0, 180)}` : '.'}`;
   const audioContentAudit = audit.audioContentAudit || {};
   const audioQuietIntervals = Array.isArray(audioContentAudit.quietIntervals) ? audioContentAudit.quietIntervals : [];
   const audioChangeAudit = audioContentAudit.changeAudit || {};
   const audioChangeCandidates = Array.isArray(audioChangeAudit.candidates) ? audioChangeAudit.candidates : [];
   const audioBoundaryAudit = audioContentAudit.boundaryAudit || {};
   const audioBoundaryCandidates = Array.isArray(audioBoundaryAudit.candidates) ? audioBoundaryAudit.candidates : [];
   const speechBoundaryContinuity = audioBoundaryAudit.speechBoundaryContinuity || {};
   const speechBoundaryItems = Array.isArray(speechBoundaryContinuity.boundaries) ? speechBoundaryContinuity.boundaries : [];
   const speechSegmentContinuity = audioBoundaryAudit.speechSegmentContinuity || {};
   const speechContinuitySegments = Array.isArray(speechSegmentContinuity.segments) ? speechSegmentContinuity.segments : [];
   const speechActivityAudit = audioContentAudit.speechActivityAudit || {};
   const speechActivitySegments = Array.isArray(speechActivityAudit.segments) ? speechActivityAudit.segments : [];
   const audioQuietLine = !audioContentAudit.available
     ? '🔊 Ses akışında düşük ses aralığı kontrolü yapılamadı.'
     : audioQuietIntervals.length
       ? `🔊 ${audioContentAudit.candidateCount} düşük ses aralığı adayı (≥0,20 sn, ≤−42 dB): ${audioQuietIntervals.slice(0, 3).map((item) => `${formatSeconds(item.startSeconds)}–${formatSeconds(item.endSeconds)} sn`).join(', ')}.`
       : '🔊 Ses taramasında ≥0,20 saniye süren düşük ses aralığı adayı bulunmadı.';
   const audioChangeLine = !audioChangeAudit.available
     ? 'Ses seviyesi/frekans dengesi değişim taraması yapılamadı.'
     : audioChangeCandidates.length
       ? `Ses seviyesi/frekans dengesi değişim adayı (${audioChangeAudit.candidateCount}): ${audioChangeCandidates.slice(0, 3).map((item) => `${formatSeconds(item.timestampSeconds)} sn (seviye ${formatSeconds(item.rmsDeltaDb)} dB, bant dengesi ${formatSeconds(item.highLowEnergyDeltaDb)} dB)`).join('; ')}.`
       : 'Belirgin ani ses seviyesi/frekans dengesi değişim adayı bulunmadı.';
   const audioBoundaryLine = !audioBoundaryAudit.available
     ? `Yerel ses sınırı taraması yapılamadı${audioBoundaryAudit.reason ? `: ${String(audioBoundaryAudit.reason).slice(0, 140)}` : '.'}`
     : audioBoundaryCandidates.length
       ? `🔎 Yerel ses profili sınırı adayı (${audioBoundaryAudit.candidateCount}): ${audioBoundaryCandidates.slice(0, 3).map((item) => `${formatSeconds(item.fromSeconds)}–${formatSeconds(item.toSeconds)} sn`).join('; ')}. Bu zamanlar ekleme kanıtı değildir; ses/ortam değişimleri de benzer iz bırakabilir.`
       : 'Belirgin yerel ses profili sınırı adayı bulunmadı; bu, ses eklenmediğini kanıtlamaz.';
   const speechActivityLine = !speechActivityAudit.available
     ? `Konuşma etkinliği taraması yapılamadı${speechActivityAudit.reason ? `: ${String(speechActivityAudit.reason).slice(0, 140)}` : '.'}`
     : speechActivitySegments.length
       ? `🗣️ Konuşma etkinliği (Silero VAD): ${speechActivitySegments.slice(0, 3).map((item) => `${formatSeconds(item.startSeconds)}–${formatSeconds(item.endSeconds)} sn`).join('; ')}${speechActivitySegments.length > 3 ? ` (+${speechActivitySegments.length - 3} aralık)` : ''}. Bu, sesin eklendiğini veya değiştirildiğini göstermez.`
       : 'Silero VAD taramasında belirgin konuşma aralığı bulunmadı; bu, videoda hiç konuşma olmadığı veya sesin değiştirilmediği anlamına gelmez.';
   const speechBoundaryLine = !speechActivityAudit.available
     ? ''
     : !speechBoundaryContinuity.available
       ? 'Konuşma başlangıç/bitiş çevresi ses profili karşılaştırılamadı.'
       : speechBoundaryItems.some((item) => item.available && item.profileChangeCandidate)
         ? `🧭 Konuşma aralığı sınırında ses profili farkı adayı: ${speechBoundaryItems.filter((item) => item.available && item.profileChangeCandidate).slice(0, 3).map((item) => `${formatSeconds(item.timestampSeconds)} sn (${item.edge === 'start' ? 'başlangıç' : 'bitiş'})`).join('; ')}. Bu tek başına sonradan ses ekleme kanıtı değildir.`
         : 'Konuşma başlangıç/bitiş çevresinde belirgin ses profili farkı adayı bulunmadı; bu, sesin eklenmediğini kanıtlamaz.';
   const audioReviewLine = [audioQuietLine, audioChangeLine, audioBoundaryLine, speechActivityLine, speechBoundaryLine].filter(Boolean).join('\n');
   const speechContinuityDetails = speechContinuitySegments.map((item) => {
     const ambient = item.ambientComparison;
     const ambientLine = ambient
       ? `Ortam/gürültü pencereleri ${item.ambientBeforeSeconds.join('–')} sn ve ${item.ambientAfterSeconds.join('–')} sn: seviye farkı ${Number(ambient.levelDeltaDb).toFixed(1)} dB, mel profil uzaklığı ${Number(ambient.melProfileDistance).toFixed(3)}, düşük/orta bant farkı ${Number(ambient.lowMidDeltaDb).toFixed(1)} dB, orta/yüksek bant farkı ${Number(ambient.highMidDeltaDb).toFixed(1)} dB, spektral düzlemsellik farkı ${Number(ambient.spectralFlatnessDelta).toFixed(3)}${item.ambientChangeCandidate ? ' — profil farkı adayı' : ''}.`
       : 'Konuşma öncesi/sonrası ortam sesi pencereleri karşılaştırmak için yeterli değil.';
     const tail = item.reverbTailProxy;
     const tailLine = tail?.available
       ? `Konuşma sonrası yankı kuyruğu göstergesi: konuşmadan erken kuyruğa düşüş ${tail.speechToEarlyTailDropDb} dB, erken/geç kuyruk seviye farkı ${tail.earlyToLateDecayDb} dB${tail.lateTailAbovePreSpeechRoomToneDb === null ? '' : `, geç kuyruk önceki ortam seviyesinin ${tail.lateTailAbovePreSpeechRoomToneDb} dB üstünde`}. Bu kaba bir seviye ölçümüdür, yankı teşhisi değildir.`
       : `Yankı kuyruğu göstergesi ölçülemedi: ${tail?.reason || 'yeterli örnek yok'}`;
     return `Konuşma ${formatSeconds(item.speechStartSeconds)}–${formatSeconds(item.speechEndSeconds)} sn. ${ambientLine} ${tailLine}`;
   });
   const aiCheck = result?.checks?.aiGeneratedIndicators || {};
   const aiEvidence = String(aiCheck.evidence || '').replace(/\s+/g, ' ').trim().slice(0, 420);
   const aiAssessment = aiCheck.status === 'fail'
     ? `🟠 Görsel model ön taramasında olası sentetik/değiştirilmiş görüntü sinyali: ${aiEvidence || 'Model görsel tutarsızlık bildirdi.'} Bu tek başına AI üretimini kanıtlamaz.`
     : aiCheck.status === 'pass'
       ? '⚪ Örneklenen karelerde belirgin görsel AI sinyali belirlenmedi; bu ön tarama AI üretimini dışlayamaz.'
       : '⚪ Örneklenen karelerle AI/görüntü sentezi yönünden güvenilir değerlendirme yapılamadı.';
   const compactCandidateLines = candidates.slice(0, 3).flatMap((item) => [
     `• ${formatSeconds(item.timestampSeconds)} sn: Geçiş adayı`,
     `• ${formatWindow(item.timestampSeconds)}`,
   ]);
   const compactAudioLines = [];
   if (audioQuietIntervals.length) {
     compactAudioLines.push(`• Düşük ses adayı: ${audioQuietIntervals.slice(0, 3).map((item) => `${formatSeconds(item.startSeconds)}–${formatSeconds(item.endSeconds)} sn`).join(', ')}`);
   }
   if (audioChangeCandidates.length) {
     compactAudioLines.push(`• Ani ses değişimi adayı: ${audioChangeCandidates.slice(0, 3).map((item) => `${formatSeconds(item.timestampSeconds)} sn`).join(', ')}`);
   }
   if (audioBoundaryCandidates.length) {
     compactAudioLines.push(`• Ses profili sınırı adayı: ${audioBoundaryCandidates.slice(0, 3).map((item) => `${formatSeconds(item.fromSeconds)}–${formatSeconds(item.toSeconds)} sn`).join(', ')}`);
   }
   if (speechActivitySegments.length) {
     compactAudioLines.push(`• Konuşma algılandı: ${speechActivitySegments.slice(0, 3).map((item) => `${formatSeconds(item.startSeconds)}–${formatSeconds(item.endSeconds)} sn`).join(', ')}`);
   }
   const continuityFindings = speechContinuitySegments.filter((item) => item.ambientChangeCandidate);
   if (continuityFindings.length) {
     compactAudioLines.push(`• Konuşma çevresi ortam profili fark adayı: ${continuityFindings.slice(0, 3).map((item) => `${formatSeconds(item.speechStartSeconds)}–${formatSeconds(item.speechEndSeconds)} sn`).join(', ')}`);
   }
   if (speechBoundaryItems.some((item) => item.available && item.profileChangeCandidate)) {
     compactAudioLines.push(`• Konuşma sınırında ses profili fark adayı: ${speechBoundaryItems.filter((item) => item.available && item.profileChangeCandidate).slice(0, 3).map((item) => `${formatSeconds(item.timestampSeconds)} sn`).join(', ')}`);
   }
   if (!audioContentAudit.available) compactAudioLines.push('• Ses taraması yapılamadı.');
   else if (!compactAudioLines.length) compactAudioLines.push('• Belirgin ses değişim adayı bulunmadı.');

   const visibleVideoText = [
     '🎞️ VİDEO ÖN İNCELEMESİ',
     status,
     `Otomatik risk puanı: ${score}/100 · ${confidenceLine}${Number.isFinite(duration) ? ` · Süre: ${formatTime(duration)}` : ''}`,
     '',
     'GÖRÜNTÜ',
     ...(compactCandidateLines.length ? compactCandidateLines : ['• Belirgin ani geçiş adayı bulunmadı.']),
     '',
     'SES',
     ...compactAudioLines,
     '',
     'AI ÖN TARAMASI',
     `• ${aiAssessment.replace(/^⚪\s*/u, '')}`,
     '',
   ].join('\n');
   const detailedVideoText = [
     String(summary).trim()
       .replace(/\s*Kareler arasında tutar, tarih, açıklama ve ekran öğelerinde sonradan ekleme[\s\S]*$/iu, '')
       .slice(0, 1800),
   ].filter(Boolean).join('\n');
   const fullVideoText = `${visibleVideoText}\n\n📖 AYRINTILI AÇIKLAMA\n\n${detailedVideoText}`;
   const chunks = [];
   let remaining = fullVideoText;
   while (remaining.length > 3900) {
     let cutAt = remaining.lastIndexOf('\n', 3900);
     if (cutAt < 2500) cutAt = 3900;
     chunks.push(remaining.slice(0, cutAt));
     remaining = remaining.slice(cutAt).replace(/^\n+/u, '');
   }
   if (remaining) chunks.push(remaining);
   let previousMessageId = replyToMessageId;
   for (const chunk of chunks) {
     const sent = await sendMessage(chatId, chunk, previousMessageId);
     if (sent?.message_id) previousMessageId = sent.message_id;
   }
   return;
 }


 // ===================================================
 // KULLANICI BİLGİSİ UYARISI
 // ===================================================
 //
 // YENİ API:
 // informationCheck
 //
 // ESKİ API:
 // comparison
 //
 // İkisini de destekliyoruz.
 // ===================================================

 const comparisonWarning =
 formatComparisonWarning(
 result?.informationCheck ||
 result?.comparison
 );


 // ===================================================
 // HESAP ÖZETİ
 // ===================================================

 if (
 statementMode
 ) {

 // V25: Hesap özeti çıktısı normal dekont ile aynı kullanıcı
 // mantığında olsun: yalnızca somut bulgular gösterilir.
 // Risk skoru / seviye / güven korunur; uzun AI paragrafı gösterilmez.
 const uniqueFindings = [];
 const seenFindingKeys = new Set();

 const addFinding = (title, detail) => {
   const cleanTitle = String(title || '').replace(/^[•\-–—\d.)\s]+/, '').trim();
   const cleanDetail = String(detail || '').trim();
   if (!cleanDetail) return;
   const key = `${cleanTitle}|${cleanDetail}`.toLocaleLowerCase('tr-TR');
   if (seenFindingKeys.has(key)) return;
   seenFindingKeys.add(key);
   uniqueFindings.push({ title: cleanTitle, detail: cleanDetail });
 };

 // 1) Deterministik referans farkları.
 const referenceFindings = Array.isArray(result?.primaryForensicFindings)
   ? result.primaryForensicFindings
   : (Array.isArray(result?.referenceForensicReport?.findings)
       ? result.referenceForensicReport.findings
       : []);

 // 2) Bakiye hesabı / işlem listesi gibi hesap özeti-specific bulguları.
 const balanceAnalysis = result?.balanceAnalysis || {};
 if (balanceAnalysis.calculationConsistent === false) {
   addFinding('Bakiye hesaplaması', balanceAnalysis.evidence || 'İşlem ve bakiye değerleri arasında matematiksel tutarsızlık bulundu.');
 }

 const transactionAnalysis = result?.transactionAnalysis || {};
 const rowByRowAudit = transactionAnalysis.rowByRowAudit || {};
 const statementPdfAudit = result?.statementPdfForensics || {};
 const rowAssociation = statementPdfAudit.transactionRowAssociation || {};
 const extractedRowCount = Number(rowByRowAudit.extractedRowCount ?? transactionAnalysis.rows?.length) || 0;
 const declaredRowCount = Number(rowByRowAudit.declaredTransactionCount) || 0;
 const matchedVisualRows = Number(rowAssociation.matchedRows) || 0;
 const unresolvedVisualRows = Number(rowAssociation.unresolvedRows) || 0;
 const balanceMismatchCount = Number(rowByRowAudit.balanceMismatchCount) || 0;
 const pageCount = Number(statementPdfAudit.pageCount ?? rowByRowAudit.pageCount) || 0;
 const pagesAnalyzed = Number(statementPdfAudit.pagesAnalyzed) || 0;
 const rowCountIncomplete = rowByRowAudit.rowsIncomplete === true ||
   Boolean(declaredRowCount && extractedRowCount < declaredRowCount);
 const pageCoverageIncomplete = rowByRowAudit.pageCoverageComplete === false ||
   (pageCount > 0 && pagesAnalyzed < pageCount);
 const bankIdentityConflict = result?.statementBankIdentityConflict === true ||
   (Array.isArray(result?.statementAuditFindings) && result.statementAuditFindings.some(item =>
     /banka kimliği kontrol gerektiriyor|referanslı analiz banka kimliğinde .* çelişti/i.test(String(item || ''))
   ));
 // The legacy manualReviewRequired flag also covers unresolved ROI mappings and
 // candidate-only PDF overlay signals. Those should advise a check, not imply
 // that a confirmed document problem was found.
 const verifiedStatementIssue = suspiciousFinding ||
   result?.confirmedManipulation === true || result?.verifiedEditing === true ||
   result?.editingConfirmed === true ||
   balanceAnalysis.calculationConsistent === false || balanceMismatchCount > 0 ||
   rowCountIncomplete || pageCoverageIncomplete || bankIdentityConflict;
 const statementNeedsReview = manualReviewRequired || unresolvedVisualRows > 0 ||
   Number(rowByRowAudit.duplicateCandidateCount) > 0 ||
   statementPdfAudit.reviewRequired === true;
 const statementReviewHeadline = verifiedStatementIssue
   ? '🟠 KONTROL GEREKLİ'
   : statementNeedsReview
     ? '🟡 KONTROL TAVSİYE EDİLİR'
     : suspiciousFinding || score >= 21
       ? '🟡 BULGULARI İNCELEYİN'
       : '🟢 BELİRGİN ŞÜPHELİ BULGU YOK';
 const statementCheckLine = rowByRowAudit.available
   ? `Satır kontrolü: ${extractedRowCount} işlem satırı, ${rowByRowAudit.balanceChecks || 0} bakiye geçişi; ${balanceMismatchCount ? `${balanceMismatchCount} fark` : 'bakiye farkı yok'}. PDF sayfaları: ${pagesAnalyzed}/${pageCount}.`
   : `Satır kontrolü: işlem satırları güvenilir biçimde çıkarılamadı. PDF sayfaları: ${pagesAnalyzed}/${pageCount}.`;
 const visualRowMatchLine = rowAssociation.available || unresolvedVisualRows > 0 || matchedVisualRows > 0
   ? `Görsel satır eşleşmesi: ${matchedVisualRows} eşleşti${unresolvedVisualRows ? `, ${unresolvedVisualRows} belirsiz` : ''}.`
   : '';
 const reviewReasonLine = unresolvedVisualRows > 0 && !verifiedStatementIssue
   ? `${unresolvedVisualRows} satırın tutar/bakiye kutusu PDF’deki görsel konumuyla güvenilir biçimde eşleştirilemedi. Bu belirsizlik tek başına silme veya değiştirme kanıtı değildir; ilgili satırları kontrol etmeniz tavsiye edilir.`
   : statementNeedsReview && !verifiedStatementIssue
     ? 'Bazı otomatik kontroller kesin sonuca ulaşamadı. Bu durum tek başına belge düzenlendiğini göstermez; raporlanan belirsiz noktaları kontrol etmeniz tavsiye edilir.'
     : '';
 for (const item of (Array.isArray(transactionAnalysis.suspiciousTransactions) ? transactionAnalysis.suspiciousTransactions : [])) {
   addFinding('Şüpheli işlem', item);
 }
 for (const item of (Array.isArray(transactionAnalysis.duplicateTransactions) ? transactionAnalysis.duplicateTransactions : [])) {
   addFinding('Tekrarlanan işlem', item);
 }

 // 3) Summary içindeki açık hata/şüphe cümlelerini al; temiz kontrol
 // cümlelerini ve teknik/genel ifadeleri kullanıcıya taşımama.
 const cleanPhrases = /belirgin bir tutarsızlık veya manipülasyon göstergesi tespit edilmedi|belirgin bir fark tespit edilmedi|belirgin bir fark bulunmadı|belirgin bir sorun tespit edilmedi|işlemler .* tutarlıdır|aritmetik olarak tutarlıdır|tek başına .* kanıtı değildir|kesin gerçek|otomatik ön inceleme/i;
 const suspiciousSentence = /tutarsız|uyumsuz|olağandışı|şüpheli|manipül|düzensiz|hatalı|fark bulundu|fark tespit|boş kal|anormal|uyarı|sahte|kopya|aritmetik/i;

 String(summary || '')
   .replace(/🔎\s*REFERANS KARŞILAŞTIRMASI[\s\S]*$/i, '')
   .split(/(?<=[.!?])\s+|\n+/)
   .map(x => x.trim())
   .filter(x => x && suspiciousSentence.test(x) && !cleanPhrases.test(x))
   .slice(0, 8)
   .forEach(x => addFinding('Belge incelemesi', x));

 // Referans bulgularını ayrı tut; ana bulgu listesinde tekrar etmeyelim.
 const referenceDetailKeys = new Set(referenceFindings.map(x =>
   String(x?.detail || '').trim().toLocaleLowerCase('tr-TR')
 ));
 const generalFindings = uniqueFindings.filter(x =>
   !referenceDetailKeys.has(String(x.detail || '').trim().toLocaleLowerCase('tr-TR'))
 );

 const lines = [
   `${emoji} VERIFYDOC ÖN İNCELEMESİ`,
   '',
   statementReviewHeadline,
   '',
   `${result?.bank ? `Banka: ${getBankDisplayName(result.bank)}\n` : ''}Risk Skoru: ${score}/100`,
   '',
   'Risk Seviyesi:',
   riskLabel,
   '',
   confidenceLine,
   '',
   statementCheckLine,
   ...(visualRowMatchLine ? [visualRowMatchLine] : []),
   ...(reviewReasonLine ? ['', reviewReasonLine] : []),
   '',
   '━━━━━━━━━━━━━━'
 ];

 if (generalFindings.length) {
   lines.push('', ...generalFindings.slice(0, 8).map((x, i) => `• ${x.detail}`));
 }

 if (referenceFindings.length) {
   lines.push('', '🔎 REFERANS KARŞILAŞTIRMASI', '', '🔴 FARKLAR');
   referenceFindings.slice(0, 8).forEach(x => {
     lines.push(`• ${x.title}: ${x.detail}`);
   });
 }

 if (!generalFindings.length && !referenceFindings.length) {
   lines.push('', 'Hatalı veya şüpheli bir kısım tespit edilmedi.');
 }

 lines.push(formatHistoricalWarning(result?.historicalMatch));
 lines.push('', '━━━━━━━━━━━━━━', '', 'Bu sonuç yalnızca otomatik ön inceleme sonucudur.', 'Güven puanı, bulguların güvenilirliğine dair model tahminidir; belgenin gerçeklik olasılığı değildir.', 'Kesin gerçeklik veya sahtecilik kararı değildir.');

 const text = lines.join('\n');

 await sendMessage(
 chatId,
 text,
 replyToMessageId
 );

 await sendAnnotatedDifferenceIfAvailable(
 chatId,
 result,
 replyToMessageId
 );

 return;

 }


 // ===================================================
 // NORMAL DEKONT
 // ===================================================

 const bank =
 result?.bank ||
 null;

 const summaryGeneral = String(summary || '')
   .replace(/🔎\s*REFERANS KARŞILAŞTIRMASI[\s\S]*$/i, '')
   .trim();
 const rawReferenceFindings = Array.isArray(result?.primaryForensicFindings)
   ? result.primaryForensicFindings
   : (Array.isArray(result?.referenceForensicReport?.findings)
       ? result.referenceForensicReport.findings
       : []);
 const criticalReferenceFindings = rawReferenceFindings
   .filter(item => /tutar|amount|iban/i.test(`${item?.title || ''} ${item?.detail || ''}`))
   .slice(0, 4)
   .map(item => ({
     title: /iban/i.test(`${item?.title || ''} ${item?.detail || ''}`)
       ? 'Alıcı IBAN’ı'
       : 'Tutar',
     detail: String(item?.detail || '').trim(),
   }))
   .filter(item => item.detail);
 const fallbackCriticalReferenceLines = criticalReferenceFindings.length
   ? []
   : (String(summary || '').match(/🔎\s*REFERANS KARŞILAŞTIRMASI[\s\S]*$/i)?.[0] || '')
       .split(/\n+/)
       .map(line => line.trim())
       .filter(line => /^•/.test(line) && /tutar|amount|iban/i.test(line))
       .slice(0, 4);


 const text =

`${emoji} VERIFYDOC ÖN İNCELEMESİ

${reviewHeadline}

Risk Seviyesi:
${riskLabel}

${confidenceLine}
${manualReviewRequired ? '\nRisk seviyesi ile kontrol durumu farklı ölçümlerdir. Kritik alanlarda belirsizlik veya karşılaştırma gerektiren bulgu olduğu için manuel kontrol gerekiyor.\n' : ''}

━━━━━━━━━━━━━━

${summaryGeneral}${criticalReferenceFindings.length || fallbackCriticalReferenceLines.length ? `\n\n🔎 KRİTİK ALAN REFERANS KONTROLÜ\n${criticalReferenceFindings.length ? criticalReferenceFindings.map(item => `• ${item.title}: ${item.detail}`).join('\n') : fallbackCriticalReferenceLines.join('\n')}` : ''}${comparisonWarning}${formatPdfStructureForensics(result?.pdfStructureForensics)}${formatFontForensicsWarning(result?.fontForensics)}${formatHistoricalWarning(result?.historicalMatch)}

━━━━━━━━━━━━━━

Bu sonuç yalnızca otomatik ön inceleme sonucudur.
Güven puanı, bulguların güvenilirliğine dair model tahminidir; belgenin gerçeklik olasılığı değildir.
Kesin gerçeklik veya sahtecilik kararı değildir.`;


 await sendMessage(
 chatId,
 text,
 replyToMessageId
 );

 await sendAnnotatedDifferenceIfAvailable(
 chatId,
 result,
 replyToMessageId
 );

}


// =====================================================
// İŞARETLİ DEKONTU GÖNDER
// =====================================================

async function sendAnnotatedDifferenceIfAvailable(
 chatId,
 result,
 replyToMessageId
) {

 const annotated =
 result?.annotatedReferenceDifference;

 if (
 annotated?.available !== true ||
 !annotated?.imageBase64
 ) {
 return;
 }

 try {

 await sendPhoto(
 chatId,
 annotated.imageBase64,
 "🔴 Referans karşılaştırmasında tespit edilen farklar dekont üzerinde işaretlendi.",
 replyToMessageId
 );

 console.log(
 "ANNOTATED REFERENCE DIFFERENCE SENT:",
 JSON.stringify({
 boxCount:
 annotated.boxCount || 0,
 gapMarkerCount:
 annotated.gapMarkerCount || 0,
 })
 );

 }
 catch (photoError) {

 console.error(
 "ANNOTATED PHOTO SEND ERROR:",
 photoError
 );

 }

}


// =====================================================
// DOSYA MENÜSÜ GÖNDER
// =====================================================

async function sendDocumentMenu(
 chatId,
 originalMessageId
) {

 const keyboard =
 getBankKeyboard();


 const text =

` Belge alındı.

Analiz için banka seçin.`;


 return sendMessage(
 chatId,
 text,
 originalMessageId,
 keyboard
 );

}


// =====================================================
// CALLBACK ANALİZİ
// =====================================================

async function processCallbackQuery(
 callbackQuery
) {

 const callbackId =
 callbackQuery?.id;


 const data =
 callbackQuery?.data;


 const menuMessage =
 callbackQuery?.message;


 if (
 !callbackId ||
 !menuMessage
 ) {

 return;

 }

 const chatId = menuMessage?.chat?.id;


 await answerCallbackQuery(
 callbackId,
 "Analiz hazırlanıyor..."
 );


 if (
 !chatId
 ) {

 return;

 }


 // ===================================================
 // ORİJİNAL BELGE MESAJI
 // ===================================================

 const originalMessage =
 menuMessage?.reply_to_message;


 if (
 !originalMessage
 ) {

 await sendMessage(
 chatId,

` Orijinal belge mesajı bulunamadı.

Lütfen belgeyi tekrar gönder.`
 );

 return;

 }


 // ===================================================
 // DOSYA
 // ===================================================

 const fileInfo =
 extractFileFromMessage(
 originalMessage
 );


 if (
 !fileInfo
 ) {

 await sendMessage(
 chatId,

` Belge dosyası okunamadı.

Lütfen belgeyi tekrar gönder.`
 );

 return;

 }


 // ===================================================
 // KULLANICININ AÇIKLAMASINI OKU
 // ===================================================

 const originalText =
 originalMessage?.caption ||
 originalMessage?.text ||
 "";


 const expectedDetails =
 extractExpectedDetails(
 originalText
 );


 console.log(
 "CALLBACK EXPECTED DETAILS:",
 JSON.stringify(
 expectedDetails,
 null,
 2
 )
 );


 // ===================================================
 // SEÇİM
 // ===================================================

 let bank =
 null;


 let statementMode =
 false;


 if (
 typeof data ===
 "string" &&
 data.startsWith(
 "bank:"
 )
 ) {

 bank =
 data.slice(
 "bank:".length
 );

 }


 else if (
 data ===
 "mode:statement"
 ) {

 statementMode =
 true;

 }


 else {

 await sendMessage(
 chatId,

 " Geçersiz analiz seçimi."
 );

 return;

 }


 // ===================================================
 // HESAP ÖZETİ VİDEO
 // ===================================================

 if (
 statementMode &&
 fileInfo.type ===
 "video"
 ) {

 await sendMessage(
 chatId,

` Hesap özeti analizi için video desteklenmiyor.

Lütfen hesap özetini PDF veya fotoğraf olarak gönder.`,
 originalMessage.message_id
 );

 return;

 }


 // ===================================================
 // BUTONLARI KALDIR
 // ===================================================

 await removeInlineKeyboard(
 chatId,
 menuMessage.message_id
 );


 // ===================================================
 // ANALİZ BAŞLADI
 // ===================================================

 let startText;


 if (
 statementMode
 ) {

 startText =

` Hesap Özeti seçildi.

Analiz ediliyor...`;

 }

 else {

 startText =

` ${getBankDisplayName(bank)} seçildi.

Analiz ediliyor...`;

 }


 await sendMessage(
 chatId,
 startText,
 originalMessage.message_id
 );


 try {

 // =================================================
 // TELEGRAM'DAN DOSYAYI İNDİR
 // =================================================

 const downloaded = fileInfo.type === "video" && !statementMode
  ? null
  : await downloadTelegramFile(fileInfo.fileId);


 // =================================================
 // VERIFYDOC
 // =================================================

 const result =
 await analyzeFile({

 buffer:
 downloaded?.buffer || null,

 fileId:
 fileInfo.fileId,

 fileName:
 fileInfo.fileName,

 mimeType:
 fileInfo.mimeType,

 type:
 statementMode
 ? "statement"
 : fileInfo.type,

 bank:
 statementMode
 ? null
 : bank,

 statementMode,

 expectedDetails,

 });


 // =================================================
 // SONUÇ
 // =================================================

 await sendAnalysisResult(
 chatId,
 result,
 originalMessage.message_id,
 statementMode
 );

 }

 catch (error) {

 console.error(
 "CALLBACK ANALYSIS ERROR:",
 error
 );


 await sendMessage(
 chatId,

` Analiz sırasında hata oluştu.

Hata:
${error?.message || "Bilinmeyen hata"}`,
 originalMessage.message_id
 );

 }

}


// =====================================================
// NORMAL MESAJ İŞLEME
// =====================================================

async function processNormalMessage(
 update
) {

 const message =
 update?.message;


 if (
 !message
 ) {

 return;

 }


 const chatId =
 message?.chat?.id;


 if (
 !chatId
 ) {

 return;

 }


 const text =
 message?.text ||
 message?.caption ||
 "";


 // ===================================================
 // START
 // ===================================================

 if (
 typeof message?.text ===
 "string" &&

 message.text.startsWith(
 "/start"
 )
 ) {

 await sendMessage(
 chatId,

` VerifyDoc'a hoş geldin.

 Dekont, hesap özeti veya belge gönder.

Belgeyi gönderdikten sonra banka seçimleri otomatik olarak çıkacak.

 Bankalardan birine basarsan normal dekont analizi yapılır.

 "Hesap Özeti" butonuna basarsan hesap özeti analizi yapılır.

Dosyayı tekrar yüklemen gerekmez.

İstersen belge açıklamasına kontrol edilmesini istediğin bilgileri de yazabilirsin.

Örneğin:

Gönderen: Atıf Kale
1000 TL
TR83 0013 4000 0266 0590 7001 01
Alıcı: Mehmet Uşak

Açıklama yazmazsan da analiz normal şekilde devam eder.`
 );

 return;

 }


 // ===================================================
 // KOMUTLAR
 // ===================================================

 if (
 typeof message?.text ===
 "string" &&

 message.text.startsWith(
 "/"
 )
 ) {

 await sendMessage(
 chatId,

` Önce analiz etmek istediğin belgeyi gönder.

Belgeyi gönderdikten sonra:

 Akbank
 Garanti BBVA
 Enpara
 VakıfBank
 İş Bankası
 Ziraat
 Denizbank
 Halkbank
 Yapı Kredi
 QNB
 ING
 TEB
 Kuveyt Türk
 Hesap Özeti

butonları otomatik çıkacak.

Açıklama yazmak zorunlu değildir.`
 );

 return;

 }


 // ===================================================
 // DOSYA KONTROL
 // ===================================================

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

` Lütfen analiz etmek istediğin belgeyi gönder.

Desteklenen:

• PDF
• Fotoğraf
• Video

Belgeyi gönderdikten sonra banka seçimleri otomatik çıkacak.

Açıklama yazmak zorunlu değildir.`
 );

 return;

 }


 // ===================================================
 // DOSYA TÜRÜ
 // ===================================================

 const fileInfo =
 extractFileFromMessage(
 message
 );


 if (
 !fileInfo
 ) {

 await sendMessage(
 chatId,

` Bu dosya türü desteklenmiyor.

Lütfen PDF, fotoğraf veya video gönder.`
 );

 return;

 }


 // ===================================================
 // MENÜ
 // ===================================================

 await sendDocumentMenu(
 chatId,
 message.message_id
 );

}


// =====================================================
// UPDATE İŞLE
// =====================================================

async function processTelegramUpdate(
 update
) {
const incomingChatId =
 update?.message?.chat?.id ||
 update?.callback_query?.message?.chat?.id;

 const incomingChatType =
 update?.message?.chat?.type ||
 update?.callback_query?.message?.chat?.type;

 // SADECE GRUPLARDA ÇALIŞ
 if (
 incomingChatType !== "group" &&
 incomingChatType !== "supergroup"
 ) {
 return;
 }

 // ===================================================
 // CALLBACK QUERY
 // ===================================================

 if (
 update?.callback_query
 ) {

 await processCallbackQuery(
 update.callback_query
 );

 return;

 }


 // ===================================================
 // NORMAL MESAJ
 // ===================================================

 if (
 update?.message
 ) {

 await processNormalMessage(
 update
 );

 return;

 }

}


// =====================================================
// ANA HANDLER
// =====================================================

export default async function handler(
 req,
 res
) {

 if (
 req.method !==
 "POST"
 ) {

 return res
 .status(200)
 .json({

 ok:
 true,

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
 "HAS MESSAGE:",
 !!update?.message
 );

 console.log(
 "HAS CALLBACK:",
 !!update?.callback_query
 );

 console.log(
"CALLBACK DATA:",
update?.callback_query?.data || "YOK"
);

 console.log(
 "================================"
 );


 // =================================================
 // UPDATE ID
 // =================================================

 const updateId =
 update?.update_id;


 if (
 updateId !==
 undefined
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

 ok:
 true,

 duplicate:
 true,

 });

 }


 processedUpdates.add(
 updateId
 );


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
 // ARKA PLANDA İŞLE
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
 update?.message?.chat?.id ||
 update?.callback_query?.message?.chat?.id;


 if (
 chatId
 ) {

 await sendMessage(
 chatId,

` VerifyDoc işlem hatası.

${error?.message || "Bilinmeyen hata"}`
 );

 }

 }

 catch (
 telegramError
 ) {

 console.error(
 "ERROR MESSAGE FAILED:",
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

 ok:
 true,

 });

 }

 catch (
 error
 ) {

 console.error(
 "TELEGRAM WEBHOOK ERROR:",
 error
 );

 return res
 .status(200)
 .json({

 ok:
 false,

 });

 }

}
