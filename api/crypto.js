// =====================================================
// VERIFYDOC - TRC20 CRYPTO SECURITY ANALYSIS
// TRC20 TOKEN + TRON WALLET
// =====================================================

export const config = {
 api: {
 bodyParser: true,
 },
};


// =====================================================
// TRONSCAN
// =====================================================

const TRONSCAN_API =
 "https://apilist.tronscanapi.com/api";


// =====================================================
// CORS
// =====================================================

function setCors(res) {
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
 "Content-Type"
 );
}


// =====================================================
// TRON ADRES KONTROLÜ
// =====================================================

function isValidTronAddress(address) {

 if (!address) {
 return false;
 }

 return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
 address
 );
}


// =====================================================
// TRONSCAN İSTEK
// =====================================================

async function tronScanRequest(
 endpoint
) {

 // =====================================================
// TRON CÜZDAN KONTROLÜ
// =====================================================

async function getAccountData(address) {

return tronScanRequest(
`/accountv2?address=${encodeURIComponent(address)}`
);

}

 const apiKey =
 process.env.TRONSCAN_API_KEY;

 if (!apiKey) {
 throw new Error(
 "TRONSCAN_API_KEY Vercel Environment Variables içinde bulunamadı."
 );
 }

 const response =
 await fetch(
 `${TRONSCAN_API}${endpoint}`,
 {
 method: "GET",

 headers: {
 "TRON-PRO-API-KEY":
 apiKey,

 "Accept":
 "application/json",
 },
 }
 );


 if (!response.ok) {

 throw new Error(
 `TRONSCAN API hata verdi: ${response.status}`
 );

 }


 return response.json();

}


// =====================================================
// RİSK SKORU
// =====================================================

function calculateRisk(
 token,
 security,
 contract
) {

 let risk = 0;

 const warnings = [];

 // ---------------------------------------------------
 // TOKEN BULUNAMADI
 // ---------------------------------------------------

 if (!token) {

 return {
 score: 100,

 label:
 "VERY HIGH RISK",

 warnings: [
 "Bu adres için geçerli bir TRC20 token bulunamadı.",
 ],
 };

 }


 // ---------------------------------------------------
 // TOKEN LEVEL
 // ---------------------------------------------------

 const tokenLevel =
 Number(
 security?.token_level
 );


 if (tokenLevel === 4) {

 risk += 45;

 warnings.push(
 "TRONSCAN tokenı güvensiz olarak işaretliyor."
 );

 }

 else if (tokenLevel === 3) {

 risk += 30;

 warnings.push(
 "TRONSCAN tokenı şüpheli olarak işaretliyor."
 );

 }

 else if (tokenLevel === 0) {

 risk += 10;

 warnings.push(
 "Token güvenlik seviyesi bilinmiyor."
 );

 }


 // ---------------------------------------------------
 // VIP
 // ---------------------------------------------------

 if (
 security?.is_vip === false
 ) {

 risk += 5;

 warnings.push(
 "Token TRONSCAN VIP/kurumsal token olarak doğrulanmamış."
 );

 }


 // ---------------------------------------------------
 // SUPPLY ARTIRMA
 // ---------------------------------------------------

 if (
 Number(
 security?.increase_total_supply
 ) === 1
 ) {

 risk += 20;

 warnings.push(
 "Toplam token arzının artırılabilmesi mümkün."
 );

 }


 // ---------------------------------------------------
 // BLACKLIST
 // ---------------------------------------------------

 if (
 Number(
 security?.black_list_type
 ) === 1
 ) {

 risk += 10;

 warnings.push(
 "Token blacklist/freeze özelliğine sahip olabilir."
 );

 }


 // ---------------------------------------------------
 // OPEN SOURCE
 // ---------------------------------------------------

 if (
 security?.open_source === false
 ) {

 risk += 10;

 warnings.push(
 "Token kontratı açık kaynak olarak doğrulanmamış."
 );

 }


 // ---------------------------------------------------
 // PROXY
 // ---------------------------------------------------

 if (
 security?.is_proxy === true
 ) {

 risk += 10;

 warnings.push(
 "Token proxy kontrat kullanıyor."
 );

 }


 // ---------------------------------------------------
 // LIQUIDITY
 // ---------------------------------------------------

 const liquidity =
 Number(
 security?.sun_liquidity || 0
 );


 if (
 liquidity === 0
 ) {

 risk += 15;

 warnings.push(
 "SunSwap likiditesi bulunamadı veya sıfır görünüyor."
 );

 }

 else if (
 liquidity < 1000
 ) {

 risk += 10;

 warnings.push(
 "Token likiditesi çok düşük."
 );

 }


 // ---------------------------------------------------
 // HOLDER SAYISI
 // ---------------------------------------------------

 const holders =
 Number(
 token?.holders_count || 0
 );


 if (
 holders === 0
 ) {

 risk += 20;

 warnings.push(
 "Token için holder bilgisi bulunamadı."
 );

 }

 else if (
 holders < 10
 ) {

 risk += 15;

 warnings.push(
 "Tokenın holder sayısı çok düşük."
 );

 }

 else if (
 holders < 100
 ) {

 risk += 5;

 warnings.push(
 "Tokenın holder sayısı düşük."
 );

 }


 // ---------------------------------------------------
 // CONTRACT VERIFICATION
 // ---------------------------------------------------

 const verifyStatus =
 Number(
 contract?.verify_status
 );


 if (
 verifyStatus === 0
 ) {

 risk += 15;

 warnings.push(
 "Smart contract doğrulanmamış."
 );

 }

 else if (
 verifyStatus === 1
 ) {

 risk += 5;

 warnings.push(
 "Smart contract yalnızca kısmen doğrulanmış."
 );

 }


 // ---------------------------------------------------
 // FEEDBACK RISK
 // ---------------------------------------------------

 if (
 contract?.feedbackRisk === true
 ) {

 risk += 30;

 warnings.push(
 "Kontrat için TRONSCAN üzerinde risk geri bildirimi bulunuyor."
 );

 }


 // ---------------------------------------------------
 // RED TAG
 // ---------------------------------------------------

 if (
 contract?.redTag
 ) {

 risk += 35;

 warnings.push(
 "Kontrat üzerinde TRONSCAN risk etiketi bulunuyor."
 );

 }


 risk =
 Math.min(
 100,
 risk
 );


 let label;


 if (risk <= 20) {

 label = "LOW RISK";

 }

 else if (risk <= 45) {

 label = "MODERATE RISK";

 }

 else if (risk <= 70) {

 label = "HIGH RISK";

 }

 else {

 label = "VERY HIGH RISK";

 }


 return {
 score: risk,
 label,
 warnings,
 };

}


// =====================================================
// API
// =====================================================

export default async function handler(
 req,
 res
) {

 setCors(res);


 // ---------------------------------------------------
 // OPTIONS
 // ---------------------------------------------------

 if (
 req.method === "OPTIONS"
 ) {

 return res
 .status(200)
 .end();

 }


 // ---------------------------------------------------
 // POST
 // ---------------------------------------------------

 if (
 req.method !== "POST"
 ) {

 return res
 .status(405)
 .json({
 success: false,
 error:
 "Method not allowed",
 });

 }


 try {

 console.log(
 "=============================="
 );

 console.log(
 "TRC20 ANALYSIS START"
 );


 // -------------------------------------------------
 // ADDRESS
 // -------------------------------------------------

 const address =
 String(
 req.body?.address || ""
 ).trim();


 if (
 !isValidTronAddress(
 address
 )
 ) {

 return res
 .status(400)
 .json({

 success: false,

 error:
 "Geçerli bir TRON/TRC20 kontrat adresi girin.",

 });

 }


 console.log(
 "ADDRESS:",
 address
 );


 // -------------------------------------------------
 // TRONSCAN TOKEN DATA
 // -------------------------------------------------

 const tokenResponse =
 await tronScanRequest(
 `/token_trc20?contract=${encodeURIComponent(
 address
 )}&showAll=1`
 );


 const token =
 tokenResponse
 ?.trc20_tokens?.[0] || null;

  // -------------------------------------------------
// TRON CÜZDAN DATA
// -------------------------------------------------

let account = null;

try {

 account = await tronScanRequest(
 `/accountv2?address=${encodeURIComponent(address)}`
 );

} catch (accountError) {

 console.error(
 "Cüzdan bilgisi alınamadı:",
 accountError
 );

}


 // -------------------------------------------------
 // SECURITY DATA
 // -------------------------------------------------

 const security =
 await tronScanRequest(
 `/security/token/data?address=${encodeURIComponent(
 address
 )}`
 );


 // -------------------------------------------------
 // CONTRACT DATA
 // -------------------------------------------------

 let contract = null;


 try {

 const contractResponse =
 await tronScanRequest(
 `/contract?contract=${encodeURIComponent(
 address
 )}`
 );


 contract =
 contractResponse
 ?.data?.[0] || null;

 }

 catch (contractError) {

 console.error(
 "Contract bilgisi alınamadı:",
 contractError
 );

 }


 // -------------------------------------------------
 // TOKEN YOK
 // -------------------------------------------------

 if (!token) {

 return res
 .status(200)
 .json({

 success: true,

 address,

 isTRC20: false,

 riskScore: 100,

 riskLabel:
 "VERY HIGH RISK",

 warnings: [
 "Bu adres TRONSCAN üzerinde geçerli bir TRC20 token olarak bulunamadı.",
 ],

 token: null,

 security,

 contract,

 });

 }


 // -------------------------------------------------
 // RİSK
 // -------------------------------------------------

 const risk =
 calculateRisk(
 token,
 security,
 contract
 );


 // -------------------------------------------------
 // RESULT
 // -------------------------------------------------

 const result = {

 success: true,

 network:
 "TRON",

 tokenType:
 "TRC20",

 address,

 isTRC20:
 true,

 riskScore:
 risk.score,

 riskLabel:
 risk.label,

 warnings:
 risk.warnings,

 token: {

 name:
 token.name,

 symbol:
 token.symbol,

 contractName:
 token.contract_name,

 issuer:
 token.issue_address,

 decimals:
 token.decimals,

 totalSupply:
 token.total_supply,

 holders:
 token.holders_count,

 transfers:
 token.transfer_num,

 transfers24h:
 token.transfer24h,

 priceUsd:
 token.market_info
 ?.priceInUsd ||
 null,

 liquidityUsd:
 token.market_info
 ?.liquidity ||
 null,

 marketCapUsd:
 token.market_cap_usd ||
 null,

 },

 security: {

 vip:
 security?.is_vip ?? null,

 blacklist:
 security?.black_list_type ?? null,

 canIncreaseSupply:
 security?.increase_total_supply ??
 null,

 tokenLevel:
 security?.token_level ??
 null,

 hasUrl:
 security?.has_url ??
 null,

 swapToken:
 security?.swap_token ??
 null,

 liquidity:
 security?.sun_liquidity ??
 null,

 openSource:
 security?.open_source ??
 null,

 proxy:
 security?.is_proxy ??
 null,

 },

 contract: {

 verified:
 contract?.verify_status ??
 null,

 creator:
 contract?.creator?.address ||
 null,

 feedbackRisk:
 contract?.feedbackRisk ??
 null,

 redTag:
 contract?.redTag ||
 null,

 blueTag:
 contract?.blueTag ||
 null,

 publicTag:
 contract?.publicTag ||
 null,

 activeDays:
 contract?.activeDay ??
 null,

 },

 disclaimer:
 "Bu sonuç blockchain verilerine dayalı otomatik güvenlik taramasıdır. Kesin olarak sahte veya gerçek olduğunu kanıtlamaz.",

 };


 console.log(
 "TRC20 ANALYSIS SUCCESS"
 );


 return res
 .status(200)
 .json(result);


 }

 catch (error) {

 console.error(
 "TRC20 ANALYSIS ERROR:",
 error
 );


 return res
 .status(500)
 .json({

 success: false,

 error:
 error?.message ||
 "TRC20 analizinde hata oluştu.",

 });

 }

}
