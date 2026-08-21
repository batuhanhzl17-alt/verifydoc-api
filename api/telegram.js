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


 // ===================================================
 // REPLY
 // ===================================================

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


 // ===================================================
 // INLINE KEYBOARD
 // ===================================================

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


 // ===================================================
 // PDF
 // ===================================================

 if (
 mime ===
 "application/pdf" ||

 name.endsWith(
 ".pdf"
 )
 ) {

 return "pdf";

 }


 // ===================================================
 // IMAGE
 // ===================================================

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


 // ===================================================
 // VIDEO
 // ===================================================

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
// ORİJİNAL MESAJDAN DOSYA BİLGİSİ ÇIKAR
// =====================================================

function extractFileFromMessage(
 message
) {

 // ===================================================
 // FOTOĞRAF
 // ===================================================

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


 // ===================================================
 // VIDEO
 // ===================================================

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


 // ===================================================
 // DOCUMENT
 // ===================================================

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
 "================================"
 );


 // ===================================================
 // FORM DATA
 // ===================================================

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


 // ===================================================
 // RESPONSE TEXT AL
 // ===================================================
 // JSON değilse artık:
 // Unexpected token 'R'
 // gibi hata yerine gerçek API cevabını göreceğiz.

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
 1000
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

${summary}

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

${summary}

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

Şimdi hangi belge/banka analizi yapılacağını seç:

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


 // ===================================================
 // BUTONA BASILDI
 // ===================================================

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
 //
 // Menü mesajını orijinal belgeye reply olarak
 // gönderdiğimiz için Telegram bize burada:
 //
 // menuMessage.reply_to_message
 //
 // alanını verir.

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
 // DOSYAYI ÇIKAR
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
 // HESAP ÖZETİ VİDEO KONTROLÜ
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
 // ANALİZ BAŞLADI MESAJI
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
 ? (
 fileInfo.type ===
 "image"
 ? "statement"
 : "statement"
 )
 : fileInfo.type,

 bank:
 statementMode
 ? null
 : bank,

 statementMode,

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
${error?.message || "Bilinmeyen hata"}

Belgeyi tekrar göndermene gerek yok; önce hata mesajını kontrol edebilirsin.`,
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

Dosyayı tekrar yüklemen gerekmez.`
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

butonları otomatik çıkacak.`
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

Belgeyi gönderdikten sonra banka seçimleri otomatik çıkacak.`
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
 //
 // Burada ANALİZ YAPMIYORUZ.
 //
 // Önce butonları gösteriyoruz.
 //
 // Menü mesajı orijinal belgeye reply oluyor.
 //
 // Kullanıcı butona bastığında callback içinden
 // originalMessage alınacak.

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

 // ===================================================
 // GET
 // ===================================================

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
