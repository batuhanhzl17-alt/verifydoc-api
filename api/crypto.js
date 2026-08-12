// =====================================================
// VERIFYDOC - TRON CRYPTO SECURITY ANALYSIS
// TRC20 TOKEN + TRON WALLET + TRX
// =====================================================

export const config = {
 api: {
 bodyParser: true,
 },
};

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
// TRON ADDRESS
// =====================================================

function isValidTronAddress(address) {
 if (!address) return false;

 return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(
 address
 );
}


// =====================================================
// TRONSCAN REQUEST
// =====================================================

async function tronScanRequest(endpoint) {

 const apiKey =
 process.env.TRONSCAN_API_KEY;

 if (!apiKey) {
 throw new Error(
 "TRONSCAN_API_KEY Vercel Environment Variables içinde bulunamadı."
 );
 }

 const response = await fetch(
 `${TRONSCAN_API}${endpoint}`,
 {
 method: "GET",

 headers: {
 "TRON-PRO-API-KEY": apiKey,
 "Accept": "application/json",
 },
 }
 );

 const text = await response.text();

 let data;

 try {
 data = JSON.parse(text);
 } catch {
 throw new Error(
 `TRONSCAN JSON olmayan cevap döndürdü: ${text.slice(0, 200)}`
 );
 }

 if (!response.ok) {
 throw new Error(
 data?.message ||
 `TRONSCAN API hata verdi: ${response.status}`
 );
 }

 return data;
}


// =====================================================
// TOKEN ANALYSIS
// =====================================================

function calculateTokenRisk(
 token,
 security
) {

 let risk = 0;

 const warnings = [];


 // TOKEN LEVEL

 const tokenLevel =
 Number(
 security?.token_level
 );

 if (tokenLevel === 4) {

 risk += 45;

 warnings.push(
 "TRONSCAN tokenı güvensiz olarak işaretliyor."
 );

 } else if (tokenLevel === 3) {

 risk += 30;

 warnings.push(
 "TRONSCAN tokenı şüpheli olarak işaretliyor."
 );

 } else if (tokenLevel === 0) {

 risk += 10;

 warnings.push(
 "Token güvenlik seviyesi bilinmiyor."
 );
 }


 // VIP

 if (
 security?.is_vip === false
 ) {

 risk += 5;

 warnings.push(
 "Token TRONSCAN VIP/kurumsal token olarak doğrulanmamış."
 );
 }


 // SUPPLY

 if (
 Number(
 security?.increase_total_supply
 ) === 1
 ) {

 risk += 20;

 warnings.push(
 "Toplam token arzı artırılabilir."
 );
 }


 // BLACKLIST

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


 // OPEN SOURCE

 if (
 security?.open_source === false
 ) {

 risk += 10;

 warnings.push(
 "Token kontratı açık kaynak olarak doğrulanmamış."
 );
 }


 // PROXY

 if (
 security?.is_proxy === true
 ) {

 risk += 10;

 warnings.push(
 "Token proxy kontrat kullanıyor."
 );
 }


 // LIQUIDITY

 const liquidity =
 Number(
 security?.sun_liquidity || 0
 );

 if (liquidity === 0) {

 risk += 15;

 warnings.push(
 "SunSwap likiditesi bulunamadı veya sıfır görünüyor."
 );

 } else if (liquidity < 1000) {

 risk += 10;

 warnings.push(
 "Token likiditesi çok düşük."
 );
 }


 risk = Math.min(
 100,
 risk
 );


 let label;

 if (risk <= 20) {

 label = "LOW RISK";

 } else if (risk <= 45) {

 label = "MODERATE RISK";

 } else if (risk <= 70) {

 label = "HIGH RISK";

 } else {

 label = "VERY HIGH RISK";
 }


 return {
 score: risk,
 label,
 warnings,
 };
}


// =====================================================
// WALLET RISK
// =====================================================

function calculateWalletRisk(
 account,
 transfers,
 security
) {

 let risk = 0;

 const warnings = [];


 // ---------------------------------------------------
 // ACCOUNT RISK
 // ---------------------------------------------------

 if (
 account?.risk === true ||
 account?.risk === "true"
 ) {

 risk += 60;

 warnings.push(
 "TRONSCAN bu adresi riskli olarak işaretliyor."
 );
 }


 // ---------------------------------------------------
 // PUBLIC RISK TAG
 // ---------------------------------------------------

 if (
 account?.publicTag
 ) {

 warnings.push(
 `Adres etiketi: ${account.publicTag}`
 );
 }


 // ---------------------------------------------------
 // VIP
 // ---------------------------------------------------

 if (
 account?.vip === true
 ) {

 warnings.push(
 "Adres TRONSCAN üzerinde doğrulanmış/VIP bir hesap olarak işaretli."
 );

 }


 // ---------------------------------------------------
 // TRANSACTIONS
 // ---------------------------------------------------

 const transactionCount =
 Number(
 account?.transactions || 0
 );

 if (
 transactionCount === 0
 ) {

 risk += 10;

 warnings.push(
 "Adres için işlem geçmişi bulunamadı."
 );
 }


 // ---------------------------------------------------
 // TRC20 TRANSFERS
 // ---------------------------------------------------

 const transferCount =
 Array.isArray(transfers)
 ? transfers.length
 : 0;

 if (
 transferCount > 0
 ) {

 warnings.push(
 `Son işlemler arasında ${transferCount} TRC20 transferi bulundu.`
 );

 } else {

 warnings.push(
 "Son TRC20 transferleri bulunamadı."
 );
 }


 // ---------------------------------------------------
 // ACCOUNT CREATED
 // ---------------------------------------------------

 if (
 account?.date_created
 ) {

 const created =
 Number(
 account.date_created
 );

 const ageDays =
 (
 Date.now() -
 created * 1000
 ) /
 86400000;

 if (
 ageDays < 7
 ) {

 risk += 15;

 warnings.push(
 "Adres çok yeni oluşturulmuş görünüyor."
 );

 } else if (
 ageDays < 30
 ) {

 risk += 5;

 warnings.push(
 "Adres nispeten yeni."
 );
 }
 }


 // ---------------------------------------------------
 // CAP
 // ---------------------------------------------------

 risk =
 Math.min(
 100,
 risk
 );


 let label;

 if (
 risk <= 20
 ) {

 label = "LOW RISK";

 } else if (
 risk <= 45
 ) {

 label = "MODERATE RISK";

 } else if (
 risk <= 70
 ) {

 label = "HIGH RISK";

 } else {

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


 // OPTIONS

 if (
 req.method === "OPTIONS"
 ) {

 return res
 .status(200)
 .end();
 }


 // POST

 if (
 req.method !== "POST"
 ) {

 return res
 .status(405)
 .json({
 success: false,
 error: "Method not allowed",
 });
 }


 try {

 console.log(
 "=============================="
 );

 console.log(
 "TRON CRYPTO ANALYSIS START"
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
 "Geçerli bir TRON adresi girin.",

 });
 }


 console.log(
 "ADDRESS:",
 address
 );


 // =================================================
 // 1. ÖNCE TOKEN KONTRATI OLARAK KONTROL
 // =================================================

 let tokenResponse = null;

 try {

 tokenResponse =
 await tronScanRequest(
 `/token_trc20?contract=${encodeURIComponent(
 address
 )}&showAll=1`
 );

 } catch (error) {

 console.log(
 "Token kontrolü başarısız:",
 error.message
 );
 }


 const token =
 tokenResponse
 ?.trc20_tokens?.[0] ||
 null;


 // =================================================
 // TOKEN BULUNDU
 // =================================================

 if (token) {

 console.log(
 "ADDRESS TYPE: TRC20 TOKEN"
 );


 let security = null;

 try {

 security =
 await tronScanRequest(
 `/security/token/data?address=${encodeURIComponent(
 address
 )}`
 );

 } catch (error) {

 console.log(
 "Token security alınamadı:",
 error.message
 );
 }


 const risk =
 calculateTokenRisk(
 token,
 security
 );


 return res
 .status(200)
 .json({

 success: true,

 address,

 addressType:
 "TOKEN_CONTRACT",

 network:
 "TRON",

 tokenType:
 "TRC20",

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
 token.name || null,

 symbol:
 token.symbol || null,

 contractName:
 token.contract_name || null,

 contractAddress:
 token.contract_address || address,

 issuer:
 token.issue_address || null,

 decimals:
 token.decimals ?? null,

 totalSupply:
 token.total_supply || null,

 holders:
 token.holders_count || null,

 transfers:
 token.transfer_num || null,

 transfers24h:
 token.transfer24h || null,

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
 security?.is_vip ??
 null,

 blacklist:
 security?.black_list_type ??
 null,

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


 disclaimer:
 "Bu sonuç blockchain verilerine dayalı otomatik güvenlik taramasıdır. Kesin olarak sahte veya gerçek olduğunu kanıtlamaz.",

 });
 }


 // =================================================
 // 2. TOKEN DEĞİL → CÜZDAN KONTROLÜ
 // =================================================

 console.log(
 "ADDRESS TYPE: WALLET"
 );


 // -------------------------------------------------
 // ACCOUNT DETAIL
 // -------------------------------------------------

 const account =
 await tronScanRequest(
 `/accountv2?address=${encodeURIComponent(
 address
 )}`
 );


 // -------------------------------------------------
 // TRC20 TRANSFERS
 // -------------------------------------------------

 let transferResponse = null;

 try {

 transferResponse =
 await tronScanRequest(
 `/token_trc20/transfers-with-status?address=${encodeURIComponent(
 address
 )}&limit=20&start=0`
 );

 } catch (error) {

 console.log(
 "TRC20 transfer alınamadı:",
 error.message
 );
 }


 const transfers =
 transferResponse?.token_transfers ||
 transferResponse?.data ||
 [];


 // -------------------------------------------------
 // WALLET RISK
 // -------------------------------------------------

 const risk =
 calculateWalletRisk(
 account,
 transfers,
 null
 );


 // -------------------------------------------------
 // RESULT
 // -------------------------------------------------

 return res
 .status(200)
 .json({

 success: true,

 address,

 addressType:
 "WALLET",

 network:
 "TRON",

 tokenType:
 null,

 isTRC20:
 false,

 riskScore:
 risk.score,

 riskLabel:
 risk.label,

 warnings:
 risk.warnings,


 wallet: {

 balanceTRX:
 account?.balance ??
 null,

 transactions:
 account?.transactions ??
 null,

 dateCreated:
 account?.date_created ??
 null,

 name:
 account?.name ||
 null,

 vip:
 account?.vip ??
 null,

 risk:
 account?.risk ??
 null,

 publicTag:
 account?.publicTag ??
 null,

 publicTagDesc:
 account?.publicTagDesc ??
 null,

 },


 recentTransfers:
 transfers
 .slice(0, 20)
 .map(
 (tx) => ({

 transactionHash:
 tx?.transaction_id ||
 tx?.transactionHash ||
 null,

 from:
 tx?.from_address ||
 tx?.fromAddress ||
 null,

 to:
 tx?.to_address ||
 tx?.toAddress ||
 null,

 token:
 tx?.tokenInfo
 ?.tokenAbbr ||
 tx?.tokenAbbr ||
 null,

 amount:
 tx?.quant ??
 tx?.amount ??
 null,

 timestamp:
 tx?.block_ts ??
 tx?.timestamp ??
 null,

 })
 ),


 disclaimer:
 "Bu sonuç blockchain verilerine dayalı otomatik güvenlik taramasıdır. Kesin olarak sahte veya gerçek olduğunu kanıtlamaz.",

 });


 } catch (error) {

 console.error(
 "TRON CRYPTO ANALYSIS ERROR:",
 error
 );


 return res
 .status(500)
 .json({

 success: false,

 error:
 error?.message ||
 "Crypto analizinde hata oluştu.",

 });
 }
}
