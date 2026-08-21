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
// CHAT → SEÇİLİ BANKA
// =====================================================

const selectedBanks =
new Map();


// =====================================================
// CHAT → ANALİZ MODU
// =====================================================
// normal = normal dekont analizi
// statement = hesap özeti analizi

const selectedModes =
new Map();


// =====================================================
// CHAT → BEKLEYEN BELGE
// =====================================================
// Kullanıcı belgeyi gönderir.
// Banka butonuna basılana kadar belge bilgileri burada tutulur.
//
// ÖNEMLİ:
// Dosyanın binary içeriğini değil,
// Telegram file_id değerini tutuyoruz.
//
// Kullanıcı banka seçtiğinde aynı dosya
// Telegram'dan tekrar indirilip analize gönderilir.
// =====================================================

const pendingDocuments =
new Map();


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
method:
"POST",

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
//
// Normal mesaj:
// sendMessage(chatId, text)
//
// Reply mesaj:
// sendMessage(chatId, text, messageId)
//
// Sadece analiz sonucu reply yapılır.
// =====================================================

async function sendMessage(
chatId,
text,
replyToMessageId = null
) {

const body = {

chat_id:
chatId,

text:
text,

};


// =================================================
// REPLY PARAMETRESİ
// =================================================

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
false,

};

}


console.log(
"TELEGRAM REPLY MESSAGE ID:",
replyToMessageId
);


console.log(
"TELEGRAM SEND BODY:",
JSON.stringify(body)
);


return telegram(
"sendMessage",
body
);

}


// =====================================================
// INLINE BUTONLU BANKA SEÇİM MENÜSÜ
// =====================================================
//
// Belge gönderildikten sonra gösterilir.
//
// Kullanıcı tekrar belge göndermez.
// Butona basarak aynı belgeyi seçer.
// =====================================================

async function sendBankSelection(
chatId
) {

return telegram(
"sendMessage",
{

chat_id:
chatId,

text:

` Belge alındı.

 Bankayı seç:

Belgeyi tekrar göndermene gerek yok.
Aşağıdaki butonlardan birine bas.`,

reply_markup:

{

inline_keyboard:

[

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

},

}
);

}


// =====================================================
// CALLBACK CEVAPLA
// =====================================================

async function answerCallbackQuery(
callbackQueryId,
text = ""
) {

return telegram(
"answerCallbackQuery",
{

callback_query_id:
callbackQueryId,

text:

text,

show_alert:
false,

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
await fetch(
fileUrl
);


if (!response.ok) {

throw new Error(
`Telegram dosyası indirilemedi. HTTP ${response.status}`
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


// =================================================
// ZİRAAT
// =================================================

if (
value.includes(
"ziraat"
)
) {

return "ziraat";

}


// =================================================
// DENİZBANK
// =================================================

if (
value.includes(
"denizbank"
)
) {

return "denizbank";

}


// =================================================
// HALKBANK
// =================================================

if (
value.includes(
"halkbank"
)
) {

return "halkbank";

}


// =================================================
// YAPI KREDİ
// =================================================

if (
value.includes(
"yapikredi"
) ||
value.includes(
"yapıkredi"
)
) {

return "yapikredi";

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
statementMode,

}) {

console.log(
"================================"
);

console.log(
"VERIFYDOC'A GÖNDERİLİYOR"
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
"STATEMENT MODE:",
statementMode
);

console.log(
"================================"
);


// =================================================
// FORM DATA
// =================================================

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


// =================================================
// HESAP ÖZETİ MODU
// =================================================

if (
statementMode
) {

form.append(
"statementMode",
"true"
);

}


// =================================================
// BANKA
// =================================================
//
// Hesap özetinde banka gönderilmez.
// Böylece referans kullanılmaz.
// =================================================

if (
bank
) {

form.append(
"bank",
bank
);

}


// =================================================
// DOSYA
// =================================================

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


// =================================================
// API
// =================================================

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


// =================================================
// RESPONSE'U ÖNCE TEXT OLARAK AL
// =================================================
// Böylece API JSON yerine:
// "Request Entity Too Large"
// "Request En..."
// veya başka bir hata döndürürse
// JSON parse hatası oluşmaz.
// =================================================

const responseText =
await response.text();


console.log(
"VERIFYDOC API HTTP STATUS:",
response.status
);


console.log(
"VERIFYDOC API RESPONSE:",
responseText.slice(
0,
2000
)
);


// =================================================
// RESPONSE JSON PARSE
// =================================================

let result;


try {

result =
JSON.parse(
responseText
);

}

catch {

throw new Error(

`VerifyDoc API geçerli JSON döndürmedi. HTTP ${response.status}. Cevap: ${responseText.slice(0,500)}`

);

}


// =================================================
// HTTP ERROR
// =================================================

if (
!response.ok
) {

throw new Error(
result?.error ||
result?.message ||
`VerifyDoc analiz API hatası. HTTP ${response.status}`
);

}


return result;

}


// =====================================================
// ANALİZ SONUCUNU TELEGRAM'A GÖNDER
// =====================================================

async function sendAnalysisResult(
chatId,
result,
statementMode,
replyToMessageId
) {

console.log(
"================================"
);

console.log(
"ANALİZ SONUCU GÖNDERİLİYOR"
);

console.log(
"REPLY TO:",
replyToMessageId
);

console.log(
"================================"
);


// =================================================
// NORMAL ANALİZ
// =================================================

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


// =================================================
// VİDEO ANALİZİ
// =================================================

if (
result?.videoAnalysis
) {

const videoAnalysis =
result.videoAnalysis;


const videoConfidence =
Number(
videoAnalysis?.confidence
) || 0;


const videoSuspicious =
videoAnalysis?.suspicious === true;


const verdict =
videoAnalysis?.verdict ||
"inconclusive";


const reasons =
Array.isArray(
videoAnalysis?.reasons
)
?
videoAnalysis.reasons
:
[];


const observations =
Array.isArray(
videoAnalysis?.observations
)
?
videoAnalysis.observations
:
[];


const recommendation =
videoAnalysis?.recommendation ||
"";


let videoText =

` VERIFYDOC VİDEO ANALİZ SONUCU

Sonuç:
${verdict}

Şüpheli:
${videoSuspicious ? "EVET" : "HAYIR"}

Güven:
${videoConfidence}/100

━━━━━━━━━━━━━━`;


if (
reasons.length
) {

videoText +=

`\n\nNedenler:\n• ${
reasons.join(
"\n• "
)
}`;

}


if (
observations.length
) {

videoText +=

`\n\nGözlemler:\n• ${
observations.join(
"\n• "
)
}`;

}


if (
recommendation
) {

videoText +=

`\n\nÖneri:\n${recommendation}`;

}


videoText +=

`\n\n━━━━━━━━━━━━━━

Bu sonuç yalnızca otomatik ön inceleme sonucudur.
Kesin gerçeklik veya sahtecilik kararı değildir.`;


await sendMessage(
chatId,
videoText,
replyToMessageId
);


return;

}


// =================================================
// HESAP ÖZETİ SONUCU
// =================================================

if (
statementMode
) {

let statementEmoji =
" ";


if (
score >= 71
) {

statementEmoji =
" ";

}

else if (
score >= 46
) {

statementEmoji =
" ";

}

else if (
score >= 21
) {

statementEmoji =
" ";

}


const statementText =

`${statementEmoji} VERIFYDOC HESAP ÖZETİ ANALİZİ

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
statementText,
replyToMessageId
);


return;

}


// =================================================
// NORMAL ANALİZ SKORU
// =================================================

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
text,
replyToMessageId
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
)
.toLowerCase();


const name =
(
fileName ||
""
)
.toLowerCase();


// =================================================
// PDF
// =================================================

if (
mime ===
"application/pdf" ||
name.endsWith(
".pdf"
)
) {

return "pdf";

}


// =================================================
// IMAGE
// =================================================

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


// =================================================
// VIDEO
// =================================================

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
// CALLBACK → BEKLEYEN BELGEYİ ANALİZ ET
// =====================================================

async function processCallbackQuery(
callbackQuery
) {

const chatId =
callbackQuery
?.message
?.chat
?.id;


const callbackId =
callbackQuery
?.id;


const callbackData =
callbackQuery
?.data;


if (
!chatId ||
!callbackId ||
!callbackData
) {

return;

}


console.log(
"================================"
);

console.log(
"TELEGRAM CALLBACK"
);

console.log(
"CHAT:",
chatId
);

console.log(
"DATA:",
callbackData
);

console.log(
"================================"
);


// =================================================
// TELEGRAM BUTONUNA CEVAP
// =================================================

await answerCallbackQuery(
callbackId,
"Seçim alındı. Analiz başlatılıyor..."
);


// =================================================
// BEKLEYEN DOSYA
// =================================================

const pending =
pendingDocuments.get(
chatId
);


if (
!pending
) {

await sendMessage(
chatId,

` Bekleyen belge bulunamadı.

Lütfen belgeyi tekrar gönder.`

);

return;

}


// =================================================
// HESAP ÖZETİ
// =================================================

if (
callbackData ===
"mode:statement"
) {

console.log(
"HESAP ÖZETİ BUTONUNA BASILDI"
);


// =================================================
// HESAP ÖZETİ VİDEO KONTROLÜ
// =================================================

if (
pending.type ===
"video"
) {

await sendMessage(
chatId,

` Hesap özeti analizi için video desteklenmiyor.

Lütfen PDF veya fotoğraf yükle.`

);

return;

}


await sendMessage(
chatId,

` Hesap Özeti seçildi.

 Dosya:
${pending.fileName}

 VerifyDoc hesap özeti analizini başlatıyor...`
);


// =================================================
// TELEGRAM'DAN DOSYAYI İNDİR
// =================================================

const downloaded =
await downloadTelegramFile(
pending.fileId
);


// =================================================
// VERIFYDOC
// =================================================

const result =
await analyzeFile({

buffer:
downloaded.buffer,

fileName:
pending.fileName,

mimeType:
pending.mimeType,

type:
"statement",

bank:
null,

statementMode:
true,

});


// =================================================
// SONUÇ
// =================================================

await sendAnalysisResult(
chatId,

result,

true,

pending.messageId
);


// =================================================
// TEMİZLE
// =================================================

pendingDocuments.delete(
chatId
);

selectedBanks.delete(
chatId
);

selectedModes.delete(
chatId
);


console.log(
"BEKLEYEN HESAP ÖZETİ TEMİZLENDİ:",
chatId
);


return;

}


// =================================================
// BANKA BUTONU
// =================================================

if (
callbackData.startsWith(
"bank:"
)
) {

const selectedBank =
callbackData.replace(
"bank:",
""
);


console.log(
"SEÇİLEN BANKA:",
selectedBank
);


// =================================================
// SEÇİMİ KAYDET
// =================================================

selectedBanks.set(
chatId,
selectedBank
);

selectedModes.set(
chatId,
"normal"
);


// =================================================
// KULLANICIYA BİLGİ
// =================================================

await sendMessage(
chatId,

` ${getBankDisplayName(selectedBank)} seçildi.

 Dosya:
${pending.fileName}

 VerifyDoc analiz başlatıyor...`
);


// =================================================
// TELEGRAM'DAN DOSYAYI İNDİR
// =================================================

const downloaded =
await downloadTelegramFile(
pending.fileId
);


// =================================================
// VERIFYDOC
// =================================================

const result =
await analyzeFile({

buffer:
downloaded.buffer,

fileName:
pending.fileName,

mimeType:
pending.mimeType,

type:
pending.type,

bank:
selectedBank,

statementMode:
false,

});


// =================================================
// SONUÇ → İLK BELGEYE REPLY
// =================================================

await sendAnalysisResult(
chatId,

result,

false,

pending.messageId
);


// =================================================
// TEMİZLE
// =================================================

pendingDocuments.delete(
chatId
);

selectedBanks.delete(
chatId
);

selectedModes.delete(
chatId
);


console.log(
"BEKLEYEN BELGE TEMİZLENDİ:",
chatId
);


return;

}


}


// =====================================================
// GERÇEK MESAJ İŞLEMİ
// =====================================================

async function processTelegramMessage(
message
) {

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


// =================================================
// ORİJİNAL TELEGRAM MESAJ ID
// =================================================

const messageId =
message?.message_id;


console.log(
"ORIGINAL TELEGRAM MESSAGE ID:",
messageId
);


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

` VerifyDoc'a hoş geldin.

Dekont, hesap özeti veya belge göndererek otomatik inceleme yaptırabilirsin.

Artık belgeyi önce gönderebilirsin.
Belgeyi gönderdikten sonra banka seçim butonları çıkacaktır.

Banka seç:

 Akbank
 Garanti BBVA
 Enpara
 VakıfBank
 İş Bankası
 Ziraat
 Denizbank
 Halkbank
 Yapı Kredi

Ayrıca:

 Hesap Özeti

seçeneği bulunur.

Belgeyi tekrar yüklemen gerekmez.`

);

return;

}


// =================================================
// ESKİ KOMUTLAR
// =================================================
// İstersen hâlâ kullanılabilir.
// Ancak yeni sistemde belge gönderildikten sonra
// butonlarla seçim yapmak daha kolaydır.
// =================================================

if (
message?.text ===
"/hesapozeti"
) {

selectedModes.set(
chatId,
"statement"
);


selectedBanks.delete(
chatId
);


await sendMessage(
chatId,

` Hesap Özeti modu seçildi.

Şimdi PDF veya fotoğraf gönder.`

);

return;

}


if (
message?.text ===
"/akbank"
) {

selectedBanks.set(
chatId,
"akbank"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Akbank seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/garanti"
) {

selectedBanks.set(
chatId,
"garanti"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Garanti BBVA seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/enpara"
) {

selectedBanks.set(
chatId,
"enpara"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Enpara seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/vakifbank"
) {

selectedBanks.set(
chatId,
"vakifbank"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" VakıfBank seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/isbankasi"
) {

selectedBanks.set(
chatId,
"isbankasi"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" İş Bankası seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/ziraat"
) {

selectedBanks.set(
chatId,
"ziraat"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Ziraat Bankası seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/denizbank"
) {

selectedBanks.set(
chatId,
"denizbank"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Denizbank seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/halkbank"
) {

selectedBanks.set(
chatId,
"halkbank"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Halkbank seçildi.\n\nŞimdi dekontu gönder."
);

return;

}


if (
message?.text ===
"/yapikredi"
) {

selectedBanks.set(
chatId,
"yapikredi"
);

selectedModes.set(
chatId,
"normal"
);


await sendMessage(
chatId,
" Yapı Kredi seçildi.\n\nŞimdi dekontu gönder."
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

` Lütfen analiz etmek istediğin belgeyi gönder.

Desteklenen:

• PDF
• Fotoğraf
• Video

Belgeyi gönderdikten sonra banka seçme butonları otomatik çıkacaktır.

 Hesap Özeti butonu da aynı menüde bulunur.`

);

return;

}


// =================================================
// ANALİZ MODU
// =================================================

const selectedMode =
selectedModes.get(
chatId
);


const statementMode =
selectedMode ===
"statement";


// =================================================
// BANKA
// =================================================
//
// Eski komut sistemi kullanıldıysa banka burada
// alınabilir.
//
// Yeni sistemde normalde banka henüz yoktur.
// =================================================

let bank =
null;


if (
!statementMode
) {

const detectedBank =
detectBank(
text
);


const selectedBank =
selectedBanks.get(
chatId
);


bank =
detectedBank ||
selectedBank;


console.log(
"DETECTED BANK:",
detectedBank ||
"YOK"
);


console.log(
"SELECTED BANK:",
selectedBank ||
"YOK"
);


console.log(
"FINAL BANK:",
bank ||
"YOK"
);

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
statementMode
?
"telegram-hesap-ozeti.jpg"
:
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

if (
statementMode
) {

await sendMessage(
chatId,

` Hesap özeti analizi için video desteklenmiyor.

Lütfen hesap özetini PDF veya fotoğraf olarak gönder.`

);

return;

}


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


if (
!type
) {

throw new Error(
`Desteklenmeyen dosya türü: ${mimeType}`
);

}


if (
statementMode &&
type ===
"video"
) {

await sendMessage(
chatId,

` Hesap özeti analizi için video desteklenmiyor.

Lütfen hesap özetini PDF veya fotoğraf olarak gönder.`

);

return;

}

}


// =================================================
// LOG
// =================================================

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
bank ||
"YOK"
);

console.log(
"TELEGRAM STATEMENT MODE:",
statementMode
);

console.log(
"TELEGRAM ORIGINAL MESSAGE ID:",
messageId
);

console.log(
"================================"
);


// =================================================
// ESKİDEN BANKA SEÇİLMİŞSE
// =================================================
//
// /akbank gibi eski komut kullanılmışsa,
// doğrudan analiz yapılabilir.
//
// Yeni sistemde banka seçilmemişse
// aşağıdaki menü gösterilir.
// =================================================

if (
!statementMode &&
bank
) {

await sendMessage(
chatId,

` Belge alındı.

 Banka:
${getBankDisplayName(bank)}

 Dosya türü:
${type}

 VerifyDoc analiz başlatıyor...`

);


// =================================================
// DOSYAYI İNDİR
// =================================================

const downloaded =
await downloadTelegramFile(
fileId
);


// =================================================
// ANALİZ
// =================================================

const result =
await analyzeFile({

buffer:
downloaded.buffer,

fileName,

mimeType,

type,

bank,

statementMode:
false,

});


// =================================================
// SONUÇ
// =================================================

await sendAnalysisResult(
chatId,

result,

false,

messageId
);


// =================================================
// TEMİZLE
// =================================================

selectedBanks.delete(
chatId
);

selectedModes.delete(
chatId
);

return;

}


// =================================================
// HESAP ÖZETİ KOMUTU İLE GELDİYSE
// =================================================

if (
statementMode
) {

await sendMessage(
chatId,

` Hesap özeti alındı.

 Dosya türü:
${type}

 VerifyDoc hesap özeti analizini başlatıyor...`

);


const downloaded =
await downloadTelegramFile(
fileId
);


const result =
await analyzeFile({

buffer:
downloaded.buffer,

fileName,

mimeType,

type:
"statement",

bank:
null,

statementMode:
true,

});


await sendAnalysisResult(
chatId,

result,

true,

messageId
);


selectedBanks.delete(
chatId
);

selectedModes.delete(
chatId
);

return;

}


// =====================================================
// YENİ SİSTEM
// =====================================================
//
// Buraya geldiysek:
// belge geldi,
// banka henüz seçilmedi.
//
// Belgeyi pending olarak sakla.
// Sonra banka butonlarını göster.
//
// TEKRAR BELGE İSTENMEZ.
// =====================================================

pendingDocuments.set(
chatId,

{

fileId,

fileName,

mimeType,

type,

messageId,

createdAt:
Date.now(),

}
);


console.log(
"================================"
);

console.log(
"BEKLEYEN BELGE KAYDEDİLDİ"
);

console.log(
"CHAT:",
chatId
);

console.log(
"FILE:",
fileName
);

console.log(
"TYPE:",
type
);

console.log(
"MESSAGE ID:",
messageId
);

console.log(
"================================"
);


// =================================================
// BANKA SEÇİM MENÜSÜ
// =================================================

await sendBankSelection(
chatId
);


// =================================================
// ÖNCEKİ SEÇİMLERİ TEMİZLE
// =================================================

selectedBanks.delete(
chatId
);

selectedModes.delete(
chatId
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

ok:
true,

duplicate:
true,

});

}


processedUpdates.add(
updateId
);


// =================================================
// UPDATE ID TEMİZLE
// =================================================

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
// CALLBACK QUERY Mİ?
// =================================================
//
// Butona basıldığında Telegram update içinde
// callback_query gelir.
// =================================================

if (
update?.callback_query
) {

waitUntil(

processCallbackQuery(
update.callback_query
)

.catch(
async (error) => {

console.error(
"CALLBACK PROCESS ERROR:",
error
);


try {

const callbackChatId =
update
?.callback_query
?.message
?.chat
?.id;


if (
callbackChatId
) {

await sendMessage(
callbackChatId,

` Analiz sırasında hata oluştu.

Hata:
${error?.message || "Bilinmeyen hata"}`

);

}

}

catch (
telegramError
) {

console.error(
"CALLBACK ERROR MESSAGE FAILED:",
telegramError
);

}

}

)

);


return res
.status(200)
.json({

ok:
true,

});

}


// =================================================
// NORMAL MESAJ
// =================================================

if (
update?.message
) {

waitUntil(

processTelegramMessage(
update.message
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

` Analiz sırasında hata oluştu.

Hata:
${error?.message || "Bilinmeyen hata"}`

);

}

}

catch (
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

}


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
