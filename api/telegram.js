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
 replyMarkup = null
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

 console.log(
 "TELEGRAM SEND:",
 JSON.stringify(body)
 );

 return telegram(
 "sendMessage",
 body
 );

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
 /\b([A-Z]{2}\s?\d{2}(?:\s?\d{4}){4,7})\b/i
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
 type ===
 "image"
 ) {

 fieldName =
 "image";

 }


 if (
 type ===
 "video"
 ) {

 fieldName =
 "video";

 }


 form.append(
 fieldName,
 blob,
 fileName
 );


 // ===================================================
 // API
 // ===================================================

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

 const text =

`${emoji} VERIFYDOC HESAP ÖZETİ ANALİZİ

Risk Skoru: ${score}/100

Risk Seviyesi:
${riskLabel}

Güven:
${confidence}/100

━━━━━━━━━━━━━━

${summary}${comparisonWarning}

━━━━━━━━━━━━━━

Bu sonuç yalnızca otomatik ön inceleme sonucudur.
Kesin gerçeklik veya sahtecilik kararı değildir.`;


 await sendMessage(
 chatId,
 text,
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


 const text =

`${emoji} VERIFYDOC ANALİZ SONUCU

${bank ? `Banka: ${getBankDisplayName(bank)}\n` : ""}Risk Skoru: ${score}/100

Risk Seviyesi:
${riskLabel}

Güven:
${confidence}/100

━━━━━━━━━━━━━━

${summary}${comparisonWarning}

━━━━━━━━━━━━━━

Bu sonuç yalnızca otomatik ön inceleme sonucudur.
Kesin gerçeklik veya sahtecilik kararı değildir.`;


 await sendMessage(
 chatId,
 text,
 replyToMessageId
 );

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

Şimdi hangi analiz yapılacağını seç:

 Normal dekont için bankayı seç.
 Hesap özeti için "Hesap Özeti" seçeneğine bas.

Seçtiğinde aynı gönderdiğin belge otomatik olarak analiz edilecek.
Tekrar yüklemen gerekmeyecek.`;


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


 await answerCallbackQuery(
 callbackId,
 "Analiz hazırlanıyor..."
 );


 const chatId =
 menuMessage?.chat?.id;


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

` Hesap özeti seçildi.

 ${fileInfo.fileName}

 VerifyDoc hesap özetini analiz ediyor...

Dosyayı tekrar göndermene gerek yok.`;

 }

 else {

 startText =

` ${getBankDisplayName(bank)} seçildi.

 ${fileInfo.fileName}

 VerifyDoc analiz ediyor...

Dosyayı tekrar göndermene gerek yok.`;

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

 const downloaded =
 await downloadTelegramFile(
 fileInfo.fileId
 );


 // =================================================
 // VERIFYDOC
 // =================================================

 const result =
 await analyzeFile({

 buffer:
 downloaded.buffer,

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
