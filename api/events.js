import crypto from "node:crypto";
import { waitUntil } from "@vercel/functions";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ANALYZE_URL =
  process.env.VERIFYDOC_ANALYZE_URL ||
  "https://verifydoc-api.vercel.app/api/analyze";

const processedEvents = new Set();
let cachedBotUserId = null;

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifySlackSignature(rawBody, timestamp, signature) {
  if (!SLACK_SIGNING_SECRET || !timestamp || !signature) return false;
  const age = Math.floor(Date.now() / 1000) - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody.toString("utf8")}`;
  const expected = `v0=${crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(base).digest("hex")}`;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function slackApi(method, body = {}) {
  if (!SLACK_BOT_TOKEN) throw new Error("SLACK_BOT_TOKEN bulunamadı.");
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data?.error || `Slack ${method} hatası`);
  }
  return data;
}

async function getBotUserId() {
  if (cachedBotUserId) return cachedBotUserId;
  const data = await slackApi("auth.test");
  cachedBotUserId = data.user_id || null;
  return cachedBotUserId;
}

async function postMessage(channel, text, threadTs = null) {
  const body = { channel, text };
  if (threadTs) body.thread_ts = threadTs;
  return slackApi("chat.postMessage", body);
}

async function getSlackFile(fileId) {
  const data = await slackApi("files.info", { file: fileId });
  const file = data.file;
  if (!file) throw new Error("Slack dosya bilgisi alınamadı.");

  const url = file.url_private_download || file.url_private;
  if (!url) throw new Error("Slack dosyasının indirme URL'si bulunamadı.");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Slack dosyası indirilemedi. HTTP ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error("Slack dosyası boş.");

  return {
    buffer,
    fileName: file.name || `verifydoc-${fileId}`,
    mimeType: file.mimetype || "application/octet-stream",
    size: buffer.length,
  };
}

function determineType(mimeType, fileName) {
  const mime = String(mimeType || "").toLowerCase();
  const name = String(fileName || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(name)) return "image";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "document";
  return null;
}

async function analyzeFile({ buffer, fileName, mimeType, type }) {
  const form = new FormData();
  form.append("type", type);
  form.append("fileName", fileName);
  const fieldName = type === "image" ? "image" : "file";
  form.append(fieldName, new Blob([buffer], { type: mimeType }), fileName);

  const response = await fetch(ANALYZE_URL, { method: "POST", body: form });
  const responseText = await response.text();
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(`VerifyDoc API JSON döndürmedi. HTTP ${response.status}`);
  }
  if (!response.ok || result?.success === false) {
    throw new Error(result?.error || result?.message || `VerifyDoc API HTTP ${response.status}`);
  }
  return result?.result || result;
}

function getBankDisplayName(bank) {
  const names = {
    akbank: "Akbank", garanti: "Garanti BBVA", enpara: "Enpara", vakifbank: "VakıfBank",
    isbankasi: "İş Bankası", ziraat: "Ziraat Bankası", denizbank: "Denizbank", halkbank: "Halkbank",
    yapikredi: "Yapı Kredi", qnb: "QNB", ing: "ING", teb: "TEB", kuveytturk: "Kuveyt Türk",
  };
  return names[bank] || bank || "";
}

function formatComparisonWarning(comparison) {
  if (!comparison || typeof comparison !== "object") return "";
  const provided = comparison?.provided || null;
  const hasExpected = comparison?.enabled === true || comparison?.hasExpectedDetails === true || !!provided;
  if (!hasExpected) return "";
  const matches = comparison?.matches || {};
  const warnings = Array.isArray(comparison?.warnings) ? comparison.warnings : [];
  const mismatchCount = Object.values(matches).filter(v => v === "mismatch" || v === false).length;
  const unknownCount = Object.values(matches).filter(v => v === "unknown" || v === null).length;
  if (mismatchCount === 0 && unknownCount === 0 && warnings.length === 0) {
    return `\n\n━━━━━━━━━━━━━━\nKULLANICI BİLGİSİ KONTROLÜ\n\nGirilen bilgiler dekontta görünen bilgilerle uyumlu görünüyor.\n\nBu kontrol risk skoruna dahil edilmemiştir.`;
  }
  let text = `\n\n━━━━━━━━━━━━━━\nKULLANICI BİLGİSİ KONTROLÜ`;
  text += mismatchCount > 0
    ? `\n\n⚠️ UYARI: Girilen bilgiler ile dekont arasında farklılık bulundu.`
    : `\n\nGirilen bilgilerin bazıları dekont üzerinden güvenilir şekilde doğrulanamadı.`;
  if (warnings.length) text += `\n\n${warnings.map(w => `• ${w}`).join("\n")}`;
  const fieldNames = { senderName: "Gönderen adı", recipientName: "Alıcı adı", amount: "Tutar", currency: "Para birimi", iban: "IBAN" };
  for (const [field, value] of Object.entries(matches)) {
    if (value === "mismatch" || value === false) text += `\n• ${fieldNames[field] || field}: Uyuşmuyor.`;
  }
  text += `\n\nBu kontrol risk skoruna dahil edilmemiştir.`;
  return text;
}

function formatHistoricalWarning(historicalMatch) {
  if (!historicalMatch?.matched) return "";
  const score = Number(historicalMatch.matchScore) || 0;
  const signals = Array.isArray(historicalMatch.matchedSignals) ? historicalMatch.matchedSignals : [];
  const previousCases = Array.isArray(historicalMatch.previousCases) ? historicalMatch.previousCases : [];
  const lines = [
    "", "⚠️ GEÇMİŞ ŞÜPHELİ KAYIT EŞLEŞMESİ", "",
    "Bu belge, daha önce şüpheli olarak kaydedilmiş bir kayıtla güçlü şekilde eşleşiyor.", "",
    signals.length ? `Eşleşen bilgiler: ${signals.join(", ")}` : "Eşleşen güçlü kimlik/hesap bilgisi bulundu.",
    `Eşleşme: %${score}`,
    `Önceki şüpheli kayıt: ${Number(historicalMatch.previousCaseCount) || previousCases.length}`,
  ];
  const previousBank = previousCases[0]?.bank;
  if (previousBank) lines.push(`Önceki kayıt bankası: ${previousBank}`);
  lines.push("", "⚠️ Bu eşleşme geçmişte şüpheli olarak işaretlenen kayıtlarla ilişki bulunduğunu gösterir.", "Detaylı inceleme önerilir.");
  return lines.join("\n");
}

function formatFontForensicsWarning(fontForensics) {
  const f = fontForensics || {};
  if (f.available !== true) return "";
  const score = Number(f.score) || 0;
  if (score < 18) return "";
  const targetOnly = Array.isArray(f.targetOnlyFamiliesAcrossReferences) ? f.targetOnlyFamiliesAcrossReferences.filter(Boolean).slice(0, 5) : [];
  const fieldMismatches = Array.isArray(f.comparisons?.[0]?.comparison?.fieldMismatches) ? f.comparisons[0].comparison.fieldMismatches.slice(0, 4) : [];
  const lines = ["\n🅰️ FONT ANALİZİ"];
  if (targetOnly.length) lines.push(`• Referanslarda bulunmayan hedef font: ${targetOnly.join(", ")}`);
  for (const item of fieldMismatches) {
    const ref = Array.isArray(item.referenceFonts) ? item.referenceFonts.join(", ") : "";
    const tar = Array.isArray(item.targetFonts) ? item.targetFonts.join(", ") : "";
    lines.push(`• ${item.labelText || item.field}: referans [${ref}] → hedef [${tar}]`);
  }
  if (lines.length === 1) lines.push(`• Referans/hedef PDF font profili arasında farklılık sinyali bulundu (skor ${score}/100).`);
  lines.push("• Font farkı tek başına sahtecilik kanıtı değildir; diğer forensic bulgularla birlikte değerlendirilir.");
  return lines.join("\n");
}

function formatAnalysisResult(result) {
  const score = Number(result?.score) || 0;
  const confidence = Number(result?.confidence) || 0;
  const riskLabel = result?.riskLabel || "UNKNOWN";
  const summary = result?.summary || "Analiz tamamlandı.";
  const emoji = score >= 71 ? "🔴" : score >= 46 ? "🟠" : score >= 21 ? "🟡" : "🟢";
  const comparisonWarning = formatComparisonWarning(result?.informationCheck || result?.comparison);
  const text = `${emoji} VERIFYDOC ANALİZ SONUCU\n\n${result?.bank ? `Banka: ${getBankDisplayName(result.bank)}\n` : ""}Risk Skoru: ${score}/100\n\nRisk Seviyesi:\n${riskLabel}\n\nGüven:\n${confidence}/100\n\n━━━━━━━━━━━━━━\n\n${summary}${comparisonWarning}${formatFontForensicsWarning(result?.fontForensics)}${formatHistoricalWarning(result?.historicalMatch)}\n\n━━━━━━━━━━━━━━\n\nBu sonuç yalnızca otomatik ön inceleme sonucudur.\nKesin gerçeklik veya sahtecilik kararı değildir.`;
  return text;
}

async function uploadAnnotatedImage(channel, imageBase64, caption, threadTs = null) {
  if (!imageBase64 || typeof imageBase64 !== "string") return;
  let base64 = imageBase64;
  let mimeType = "image/jpeg";
  const match = base64.match(/^data:([^;]+);base64,(.+)$/s);
  if (match) { mimeType = match[1] || mimeType; base64 = match[2]; }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) return;
  const filename = mimeType.includes("png") ? "verifydoc-difference.png" : "verifydoc-difference.jpg";

  const ticketResponse = await slackApi("files.getUploadURLExternal", {
    filename,
    length: buffer.length,
  });
  const uploadResponse = await fetch(ticketResponse.upload_url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: buffer,
  });
  if (!uploadResponse.ok) throw new Error(`İşaretli görsel Slack'e yüklenemedi. HTTP ${uploadResponse.status}`);

  const completeBody = {
    files: [{ id: ticketResponse.file_id, title: filename }],
    channel_id: channel,
    initial_comment: caption || "",
  };
  if (threadTs) completeBody.thread_ts = threadTs;
  await slackApi("files.completeUploadExternal", completeBody);
}

async function processFileEvent(event, eventId) {
  const channel = event?.channel_id;
  const fileId = event?.file_id || event?.file?.id;
  if (!channel || !fileId) return;

  const botUserId = await getBotUserId();
  if (botUserId && event?.user_id === botUserId) return;

  const file = await getSlackFile(fileId);
  const type = determineType(file.mimeType, file.fileName);
  if (!type) return;

  await postMessage(channel, "🔎 VerifyDoc dekontu aldı. Analiz başlatıldı...");

  try {
    const result = await analyzeFile(file && { ...file, type });
    const resultText = formatAnalysisResult(result);
    const message = await postMessage(channel, resultText);
    const annotated = result?.annotatedReferenceDifference;
    if (annotated?.available === true && annotated?.imageBase64) {
      await uploadAnnotatedImage(channel, annotated.imageBase64, "🔴 Referans karşılaştırmasında tespit edilen farklar dekont üzerinde işaretlendi.", message?.ts || null);
    }
  } catch (error) {
    console.error("SLACK ANALYSIS ERROR", { eventId, error: error?.stack || error?.message || error });
    await postMessage(channel, `⚠️ Analiz sırasında hata oluştu.\n\nHata: ${error?.message || "Bilinmeyen hata"}`);
  }
}

async function handleEvent(payload) {
  if (payload?.type !== "event_callback") return;
  const eventId = payload?.event_id;
  if (eventId && processedEvents.has(eventId)) return;
  if (eventId) processedEvents.add(eventId);
  if (payload?.event?.type === "file_shared") await processFileEvent(payload.event, eventId);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
  if (!SLACK_BOT_TOKEN || !SLACK_SIGNING_SECRET) return res.status(500).json({ ok: false, error: "Slack environment variables eksik." });

  const rawBody = await readRawBody(req);
  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];
  if (!verifySlackSignature(rawBody, timestamp, signature)) return res.status(401).json({ ok: false, error: "Invalid Slack signature" });

  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { return res.status(400).json({ ok: false, error: "Invalid JSON" }); }

  if (payload?.type === "url_verification") return res.status(200).json({ challenge: payload.challenge });

  if (payload?.type === "event_callback") {
    waitUntil(handleEvent(payload).catch(error => console.error("SLACK EVENT ERROR", error?.stack || error)));
  }

  return res.status(200).json({ ok: true });
}
