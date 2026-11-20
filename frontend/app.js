/* AgentAllowance — frontend logic (vanilla JS, ethers v6 qua CDN).
 * ABI load từ abi.json (fetch), KHÔNG hardcode ABI trong file này.
 * Kết nối ví: injected EIP-1193 trong Binance App ONLY.
 * Revoke duy nhất bằng approve(spender, 0) — không bao giờ approve giá trị > 0.
 * Điểm tạm tính dùng chung công thức với verifier (xem computeScore).
 */

const FLAG_POINTS = {
  UNLIMITED_APPROVE_UNVERIFIED: 15,
  UNLIMITED_APPROVE_VERIFIED: 10,
  LIMITED_APPROVE_UNVERIFIED: 10,
  STALE_APPROVAL: 5,
};

// Cộng lại khi revoke trong kỳ = floor(50% số đã trừ): 15 -> 7, 10 -> 5, 5 -> 2.
function computeScore(flags) {
  let score = 100;
  for (const f of flags || []) {
    const pts = FLAG_POINTS[f.type];
    if (!pts) continue;
    score -= pts;
    if (f.fixed) score += Math.floor(pts * 0.5);
  }
  return Math.max(0, Math.min(100, Math.floor(score)));
}

function badgeTierOf(score) {
  if (score >= 90) return 3; // Gold
  if (score >= 70) return 2; // Silver
  if (score >= 50) return 1; // Bronze
  return 0; // chưa đủ band, không mint mới
}

const TIER_NAMES = { 0: "—", 1: "Bronze", 2: "Silver", 3: "Gold" };

const I18N = {
  vi: {
    tagline: "Kiểm soát approval cho ví Agent ID",
    connectWallet: "Kết nối ví",
    navHome: "Trang chủ",
    navScan: "Quét ví",
    navProfile: "Hồ sơ",
    navLeaderboard: "Bảng xếp hạng",
    navStats: "Thống kê",
    heroTitle: "Ví Agent của bạn có sạch không?",
    heroImgAlt: "Kiểm toán viên cầm kính lúp soi sổ cái nối thành chuỗi khối, bên cạnh là khiên bảo vệ",
    scanCleanAlt: "Khiên xanh và checklist toàn dấu tick: ví sạch, không có approval rủi ro",
    scanFlagsAlt: "Kính lúp soi một dòng approval bị khoanh đỏ",
    reportCardAlt: "Thẻ báo cáo kiểm toán với đồng hồ điểm, con dấu và huy chương",
    podiumAlt: "Bục vinh danh với huy chương vàng, bạc, đồng",
    dashboardAlt: "Bảng điều khiển với biểu đồ cột, đường cong tăng và khiên bảo vệ",
    emptyStateAlt: "Hộp rỗng mở ra với kính lúp và dấu hỏi thân thiện: chưa có dữ liệu approval",
    heroSub: "AgentAllowance quét toàn bộ token approval của ví Agent ID trên BNB Chain, chấm Hygiene Score 0–100 và cho revoke 1 click những approval rủi ro.",
    deadlineLabel: "Hết kỳ nộp bài:",
    ctaScan: "Quét ví của tôi",
    statAgents: "Agent ID đã quét",
    statApprovals: "Approval đã quét",
    statRevokes: "Lần revoke đã xác nhận",
    howTitle: "Cách hoạt động — 3 bước",
    step1: "Quét: verifier quét toàn bộ ERC-20 allowance của ví bạn trên BSC (chain 56), kiểm tra spender đã verify source trên BscScan chưa và lần dùng gần nhất.",
    step2: "Chấm điểm: Hygiene Score 0–100 theo công thức công khai. Điểm \"tạm tính\" chưa qua verifier; điểm \"đã xác nhận\" được verifier ký EIP-712 và ghi on-chain.",
    step3: "Revoke: bấm Revoke ở từng dòng approval rủi ro — app chỉ gửi approve(spender, 0), luôn có màn hình xác nhận của ví. Revoke xong điểm tăng lại một phần.",
    scoreTitle: "Công thức Hygiene Score",
    scoreFormula: "Bắt đầu 100 điểm. Trừ 15 mỗi cờ unlimited cho spender chưa verify; trừ 10 mỗi cờ unlimited cho spender đã verify; trừ 10 mỗi cờ limited cho spender chưa verify; trừ 5 mỗi cờ stale (không dùng > 90 ngày). Revoke trong kỳ được cộng lại 50% số đã trừ (làm tròn xuống): +7 / +5 / +5 / +2. Điểm tối thiểu 0, tối đa 100.",
    scoreExample: "Ví dụ: 1 cờ unlimited chưa verify → 85. Revoke xong → 92. Approve lại unlimited cho cùng spender → quay về 85.",
    scoreBadge: "Badge theo band điểm đã xác nhận: Bronze 50–69, Silver 70–89, Gold 90–100. Dưới 50 không mint mới; badge đã nhận không bị đốt khi điểm tụt.",
    disclaimer: "⚠️ Hygiene Score chỉ phản ánh trạng thái approval tại thời điểm quét, dựa trên dữ liệu công khai. Điểm này không phải bảo chứng an toàn tuyệt đối và không phải tư vấn đầu tư. AgentAllowance không hứa hẹn lợi nhuận, không phát token, không airdrop.",
    scanTitle: "Quét approval của ví bạn",
    scanHint: "Kết nối ví trong Binance App rồi bấm \"Quét lại\". Chỉ quét ví đang kết nối — không có ô nhập địa chỉ hay tên để xem ví người khác.",
    rescan: "Quét lại",
    scanEmpty: "Chưa có kết quả quét.",
    profileTitle: "Hồ sơ của bạn",
    profileVerified: "Điểm đã xác nhận:",
    profileEstimated: "Điểm tạm tính:",
    profileBadge: "Badge:",
    requestAttest: "Yêu cầu xác nhận điểm",
    scoreHistory: "Lịch sử điểm",
    leaderboardTitle: "Bảng xếp hạng ví sạch nhất",
    leaderboardHint: "Chỉ tính điểm đã xác nhận. Hòa điểm thì ví đạt điểm đó sớm hơn xếp trên. Ví chỉ có điểm \"tạm tính\" không lên bảng. Chỉ hiện tên .ai + điểm, không hiện địa chỉ ví đầy đủ.",
    colName: "Tên .ai",
    colScore: "Điểm",
    statsTitle: "Thống kê công khai",
    scoreDistribution: "Phân bố điểm theo band",
    colBand: "Band điểm",
    colCount: "Số ví",
    footer: "AgentAllowance — dự án dự thi Agent ID Hackathon. Kỳ tính điểm 18/11–09/12/2026 08:00 UTC. Owner: Safe 2-of-3 (dùng lại Safe SafeStreak). Owner chỉ có quyền setVerifier / setBadge / pause — không mint, không thuế, không đóng băng, không rút tiền, không proxy, không selfdestruct. Contract không nhận BNB.",
    connectFirst: "Hãy kết nối ví Agent ID trong Binance App trước.",
    noWallet: "Không tìm thấy ví. Hãy mở app này trong trình duyệt dApp của Binance App.",
    wrongChain: "Ví đang ở chain khác (cần BNB Chain, chain ID 56).",
    verifierNotReady: "Verifier chưa sẵn sàng (URL verifier đang là TBD — chưa deploy lên Render). Tính năng quét / xác nhận điểm sẽ khả dụng sau khi deploy verifier.",
    contractNotReady: "Contract chưa deploy (địa chỉ đang là TBD). Chức năng on-chain sẽ khả dụng sau khi deploy mainnet.",
    abiPlaceholder: "ABI đang là bản tạm (PLACEHOLDER) — chờ ABI thật từ forge build. Chức năng đọc contract tạm thời chưa khả dụng.",
    wakingVerifier: "Đang đánh thức verifier (Render Free có thể mất ~50 giây ở lần gọi đầu)…",
    scanDone: "Quét xong.",
    scanFailed: "Quét thất bại. Thử lại sau.",
    estimatedScore: "Điểm tạm tính",
    verifiedScore: "Điểm đã xác nhận",
    noApprovals: "Ví của bạn không có approval nào trong kỳ. Điểm tạm tính: 100.",
    unlimited: "Unlimited",
    verified: "Đã verify",
    unverified: "Chưa verify",
    unknown: "Chưa rõ",
    lastUsed: "Lần dùng gần nhất",
    lastUsedUnknown: "không rõ lần dùng gần nhất",
    revoke: "Revoke",
    revokeConfirm: "Xác nhận revoke?\nToken: {token}\nSpender: {spender}\nAllowance hiện tại: {allowance}\n\nApp sẽ gửi approve(spender, 0) từ ví của bạn. Bạn vẫn phải xác nhận lại trên màn hình ví.",
    revokeCancelled: "Đã hủy revoke.",
    revokeSent: "Đã gửi giao dịch revoke, đang chờ xác nhận on-chain…",
    revokeDone: "Revoke xong. Đang quét lại để cập nhật điểm…",
    revokeFailed: "Revoke thất bại. Thử lại sau.",
    attestConfirm: "Điểm của bạn: {score}/100.\nChữ ký verifier đã sẵn sàng (deadline 15 phút).\n\nBấm OK để gửi giao dịch attestScore() lên chain. Bạn vẫn phải xác nhận lại trên màn hình ví.",
    attestDone: "Điểm đã xác nhận: {score}/100.",
    attestFailed: "Xác nhận điểm thất bại. Thử lại sau.",
    attestNoScore: "Chưa có điểm tạm tính để xác nhận. Hãy quét ví trước.",
    noScoreHistory: "Chưa có lần xác nhận điểm nào.",
    noLeaderboard: "Chưa có ví nào lên bảng xếp hạng.",
    loading: "Đang tải…",
    days: "ngày",
    ended: "Đã hết kỳ nộp bài.",
    fixedFlag: "đã revoke trong kỳ",
  },
  en: {
    tagline: "Approval control for Agent ID wallets",
    connectWallet: "Connect wallet",
    navHome: "Home",
    navScan: "Scan",
    navProfile: "Profile",
    navLeaderboard: "Leaderboard",
    navStats: "Stats",
    heroTitle: "Is your Agent wallet clean?",
    heroImgAlt: "Auditor with a magnifying glass inspecting a ledger turning into a blockchain, next to a protective shield",
    scanCleanAlt: "Green shield and a checklist with all items ticked: clean wallet, no risky approvals",
    scanFlagsAlt: "Magnifying glass inspecting one approval line circled in red",
    reportCardAlt: "Audit report card with a score gauge, a seal stamp and a medal",
    podiumAlt: "Winners podium with gold, silver and bronze medals",
    dashboardAlt: "Dashboard with a bar chart, a rising curve and a protective shield",
    emptyStateAlt: "Open empty box with a magnifying glass and a friendly question mark: no approval data yet",
    heroSub: "AgentAllowance scans all token approvals of your Agent ID wallet on BNB Chain, scores a Hygiene Score 0–100, and lets you revoke risky approvals in one click.",
    deadlineLabel: "Submission deadline:",
    ctaScan: "Scan my wallet",
    statAgents: "Agent IDs scanned",
    statApprovals: "Approvals scanned",
    statRevokes: "Confirmed revokes",
    howTitle: "How it works — 3 steps",
    step1: "Scan: the verifier scans all ERC-20 allowances of your wallet on BSC (chain 56), checks whether each spender is source-verified on BscScan, and finds the last use.",
    step2: "Score: Hygiene Score 0–100 using the public formula. An \"estimated\" score is not yet verifier-signed; a \"verified\" score is signed by the verifier (EIP-712) and recorded on-chain.",
    step3: "Revoke: tap Revoke on any risky approval row — the app only sends approve(spender, 0), always with your wallet confirmation screen. After a revoke the score partly recovers.",
    scoreTitle: "Hygiene Score formula",
    scoreFormula: "Start at 100. Minus 15 per unlimited flag for an unverified spender; minus 10 per unlimited flag for a verified spender; minus 10 per limited flag for an unverified spender; minus 5 per stale flag (unused > 90 days). Revoking within the period adds back 50% of the deducted points (rounded down): +7 / +5 / +5 / +2. Minimum 0, maximum 100.",
    scoreExample: "Example: 1 unlimited unverified flag → 85. After revoke → 92. Re-approving unlimited to the same spender → back to 85.",
    scoreBadge: "Badge by verified score band: Bronze 50–69, Silver 70–89, Gold 90–100. Below 50 no new mint; a badge already received is never burned when the score drops.",
    disclaimer: "⚠️ The Hygiene Score only reflects approval state at scan time, based on public data. It is not a safety guarantee and not investment advice. AgentAllowance promises no profit, issues no token, and has no airdrop.",
    scanTitle: "Scan your wallet approvals",
    scanHint: "Connect your wallet in the Binance App, then tap \"Rescan\". Only your connected wallet is scanned — there is no address or name input to look up someone else's wallet.",
    rescan: "Rescan",
    scanEmpty: "No scan results yet.",
    profileTitle: "Your profile",
    profileVerified: "Verified score:",
    profileEstimated: "Estimated score:",
    profileBadge: "Badge:",
    requestAttest: "Request score attestation",
    scoreHistory: "Score history",
    leaderboardTitle: "Cleanest wallets leaderboard",
    leaderboardHint: "Verified scores only. On a tie, the wallet that reached the score earlier ranks higher. Wallets with only an \"estimated\" score are not listed. Only .ai names and scores are shown, never full wallet addresses.",
    colName: ".ai name",
    colScore: "Score",
    statsTitle: "Public stats",
    scoreDistribution: "Score distribution by band",
    colBand: "Score band",
    colCount: "Wallets",
    footer: "AgentAllowance — an Agent ID Hackathon project. Scoring period 18/11–09/12/2026 08:00 UTC. Owner: Safe 2-of-3 (reused SafeStreak Safe). Owner can only setVerifier / setBadge / pause — no mint, no tax, no freeze, no withdraw, no proxy, no selfdestruct. Contracts do not accept BNB.",
    connectFirst: "Please connect your Agent ID wallet in the Binance App first.",
    noWallet: "No wallet found. Please open this app inside the Binance App dApp browser.",
    wrongChain: "Wallet is on a different chain (BNB Chain, chain ID 56 is required).",
    verifierNotReady: "Verifier is not ready yet (verifier URL is still TBD — not deployed to Render). Scanning / score attestation will be available after the verifier is deployed.",
    contractNotReady: "Contracts are not deployed yet (address is TBD). On-chain features will be available after mainnet deployment.",
    abiPlaceholder: "ABI is still a PLACEHOLDER — waiting for the real ABI from the forge build. Reading contracts is temporarily unavailable.",
    wakingVerifier: "Waking up the verifier (Render Free can take ~50s on the first call)…",
    scanDone: "Scan complete.",
    scanFailed: "Scan failed. Please try again later.",
    estimatedScore: "Estimated score",
    verifiedScore: "Verified score",
    noApprovals: "Your wallet has no approvals in this period. Estimated score: 100.",
    unlimited: "Unlimited",
    verified: "Verified",
    unverified: "Unverified",
    unknown: "Unknown",
    lastUsed: "Last used",
    lastUsedUnknown: "last use unknown",
    revoke: "Revoke",
    revokeConfirm: "Confirm revoke?\nToken: {token}\nSpender: {spender}\nCurrent allowance: {allowance}\n\nThe app will send approve(spender, 0) from your wallet. You still need to confirm on your wallet screen.",
    revokeCancelled: "Revoke cancelled.",
    revokeSent: "Revoke transaction sent, waiting for on-chain confirmation…",
    revokeDone: "Revoke done. Rescanning to update your score…",
    revokeFailed: "Revoke failed. Please try again.",
    attestConfirm: "Your score: {score}/100.\nThe verifier signature is ready (15-minute deadline).\n\nTap OK to send the attestScore() transaction on-chain. You still need to confirm on your wallet screen.",
    attestDone: "Verified score: {score}/100.",
    attestFailed: "Score attestation failed. Please try again.",
    attestNoScore: "No estimated score to attest yet. Please scan your wallet first.",
    noScoreHistory: "No score attestations yet.",
    noLeaderboard: "No wallets on the leaderboard yet.",
    loading: "Loading…",
    days: "days",
    ended: "The submission period has ended.",
    fixedFlag: "revoked in this period",
  },
};

let lang = "vi";
let currentAccount = null;
let currentHandle = "";
let lastScan = null;
let abiCache = null;

function t(key, vars) {
  let s = (I18N[lang] && I18N[lang][key]) || I18N.vi[key] || key;
  if (vars) {
    for (const k of Object.keys(vars)) s = s.replace("{" + k + "}", String(vars[k]));
  }
  return s;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isTbd(v) {
  return !v || v === "TBD";
}

function shortAddress(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

function showNotice(el, msg, kind) {
  if (!el) return;
  el.innerHTML = msg
    ? '<div class="' + (kind === "error" ? "error-box" : "notice") + '">' + esc(msg) + "</div>"
    : "";
}

function setStatus(msg, kind) {
  showNotice(document.getElementById("statusBar"), msg, kind);
}

// ---------- i18n ----------
function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (I18N[lang][key] != null) el.textContent = I18N[lang][key];
  });
  document.querySelectorAll("[data-i18n-alt]").forEach((el) => {
    const key = el.getAttribute("data-i18n-alt");
    if (I18N[lang][key] != null) el.alt = I18N[lang][key];
  });
  const toggle = document.getElementById("langToggle");
  if (toggle) toggle.textContent = lang === "vi" ? "EN" : "VI";
  renderEstimatedScore();
  if (lastScan) renderScan(lastScan);
}

function toggleLang() {
  lang = lang === "vi" ? "en" : "vi";
  try { localStorage.setItem("aa-lang", lang); } catch (e) { /* ignore */ }
  applyI18n();
}

// ---------- Views ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === id));
  document.querySelectorAll("nav button").forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-view") === id);
  });
  if (id === "leaderboardSection") loadLeaderboard();
  if (id === "statsSection") loadStats();
  if (id === "profileView") loadProfile();
}

// ---------- Countdown ----------
function countdown() {
  const el = document.getElementById("countdown");
  if (!el) return;
  const target = new Date(CONFIG.submissionDeadline).getTime();
  const diff = target - Date.now();
  if (diff <= 0) { el.textContent = t("ended"); return; }
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  el.textContent = d + " " + t("days") + " " + String(h).padStart(2, "0") + ":" +
    String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

// ---------- ABI + contracts (load từ abi.json, không hardcode) ----------
async function loadAbi() {
  if (abiCache) return abiCache;
  try {
    const res = await fetch("abi.json");
    const data = await res.json();
    abiCache = data;
    return data;
  } catch (e) {
    abiCache = { AgentAllowance: [], Badge: [] };
    return abiCache;
  }
}

function abiReady(abi, key) {
  return abi && Array.isArray(abi[key]) && abi[key].length > 0;
}

function getReadProvider() {
  if (typeof ethers === "undefined") return null;
  return new ethers.JsonRpcProvider(CONFIG.rpcUrl);
}

async function getAgentAllowanceRead() {
  if (isTbd(CONFIG.agentAllowanceAddress)) return null;
  const abi = await loadAbi();
  if (!abiReady(abi, "AgentAllowance")) return null;
  const provider = getReadProvider();
  if (!provider) return null;
  return new ethers.Contract(CONFIG.agentAllowanceAddress, abi.AgentAllowance, provider);
}

async function getBadgeRead() {
  if (isTbd(CONFIG.badgeAddress)) return null;
  const abi = await loadAbi();
  if (!abiReady(abi, "Badge")) return null;
  const provider = getReadProvider();
  if (!provider) return null;
  return new ethers.Contract(CONFIG.badgeAddress, abi.Badge, provider);
}

// ---------- Wallet ----------
async function connectWallet() {
  if (!window.ethereum) { setStatus(t("noWallet"), "error"); return; }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts || !accounts.length) return;
    currentAccount = accounts[0];
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== CONFIG.chainId) setStatus(t("wrongChain"), "error");
    else setStatus("", "");
    const chip = document.getElementById("walletChip");
    currentHandle = await resolveHandle(currentAccount);
    if (chip) {
      chip.style.display = "";
      chip.textContent = currentHandle || shortAddress(currentAccount);
      chip.title = currentAccount;
    }
    const btn = document.getElementById("connectBtn");
    if (btn) btn.textContent = shortAddress(currentAccount);
    await loadScan();
    await loadProfile();
  } catch (e) {
    if (e && e.code === 4001) setStatus(t("revokeCancelled"), "error");
    else setStatus(t("connectFirst"), "error");
  }
}

async function resolveHandle(account) {
  try {
    const c = await getAgentAllowanceRead();
    if (c) {
      const h = await c.handleOf(account);
      if (h) return h;
    }
  } catch (e) { /* fallback: hiện địa chỉ rút gọn */ }
  return "";
}

// ---------- Scan ----------
async function loadScan() {
  const listEl = document.getElementById("approvalList");
  const emptyEl = document.getElementById("scanEmpty");
  const noticeEl = document.getElementById("scanNotice");
  if (!currentAccount) { showNotice(noticeEl, t("connectFirst"), "error"); return; }
  if (isTbd(CONFIG.verifierUrl)) {
    showNotice(noticeEl, t("verifierNotReady"));
    if (listEl) listEl.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "";
    return;
  }
  showNotice(noticeEl, t("wakingVerifier"));
  if (emptyEl) emptyEl.style.display = "none";
  try {
    const res = await fetch(
      CONFIG.verifierUrl.replace(/\/$/, "") + "/scan?agent=" + encodeURIComponent(currentAccount)
    );
    if (!res.ok) throw new Error("verifier HTTP " + res.status);
    const data = await res.json();
    lastScan = data;
    showNotice(noticeEl, t("scanDone"));
    renderScan(data);
  } catch (e) {
    showNotice(noticeEl, t("scanFailed"), "error");
  }
}

function collectFlags(scan) {
  const flags = [];
  for (const a of scan.approvals || []) {
    for (const f of a.flags || []) flags.push(f);
  }
  return flags;
}

function renderEstimatedScore() {
  const el = document.getElementById("estimatedScore");
  if (!el) return;
  if (!lastScan) { el.innerHTML = ""; return; }
  const score = computeScore(collectFlags(lastScan));
  el.innerHTML = '<p><span class="score-label">' + esc(t("estimatedScore")) + '</span><br>' +
    '<span class="score-big">' + score + '</span><span class="score-label"> / 100</span></p>';
}

function flagLabel(f) {
  const base = f.type;
  return f.fixed ? base + " (" + t("fixedFlag") + ")" : base;
}

// Hiện hình minh họa theo kết quả quét (§6.7): ví sạch → scan-clean,
// có cờ rủi ro chưa sửa → scan-flags; quét xong không có approval nào →
// empty-state; chưa quét thì ẩn cả ba.
function updateScanArtwork(scan) {
  const clean = document.getElementById("scanCleanImg");
  const flags = document.getElementById("scanFlagsImg");
  const empty = document.getElementById("emptyStateImg");
  const approvals = (scan && scan.approvals) || [];
  const hasRisk = approvals.some((a) => (a.flags || []).some((f) => !f.fixed));
  if (clean) clean.style.display = approvals.length && !hasRisk ? "" : "none";
  if (flags) flags.style.display = approvals.length && hasRisk ? "" : "none";
  if (empty) empty.style.display = approvals.length ? "none" : "";
}

function renderScan(scan) {
  const listEl = document.getElementById("approvalList");
  const emptyEl = document.getElementById("scanEmpty");
  if (!listEl) return;
  const approvals = scan.approvals || [];
  renderEstimatedScore();
  updateScanArtwork(scan);
  if (!approvals.length) {
    listEl.innerHTML = "";
    if (emptyEl) { emptyEl.textContent = t("noApprovals"); emptyEl.style.display = ""; }
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";
  listEl.innerHTML = approvals.map((a) => {
    const verifiedLabel = a.spenderVerified === true ? t("verified")
      : a.spenderVerified === false ? t("unverified") : t("unknown");
    const verifiedCls = a.spenderVerified === true ? "flag-ok"
      : a.spenderVerified === false ? "flag-risk" : "flag-warn";
    const amount = a.unlimited ? t("unlimited") : esc(String(a.allowanceDisplay || a.allowance || ""));
    const lastUsed = a.lastUsed
      ? new Date(a.lastUsed * 1000).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB")
      : t("lastUsedUnknown");
    const flagsHtml = (a.flags || []).map((f) =>
      '<span class="flag ' + (f.fixed ? "flag-fixed" : "flag-risk") + '">' + esc(flagLabel(f)) + "</span>"
    ).join("");
    const canRevoke = a.unlimited === true || Number(a.allowance) > 0;
    return '<li class="approval-item">' +
      '<div class="row"><span class="token">' + esc(a.tokenSymbol || a.token || "?") + '</span>' +
      "<span>" + esc(amount) + "</span></div>" +
      '<div class="meta">Spender: <a href="https://bscscan.com/address/' + esc(a.spender || "") +
      '" target="_blank" rel="noopener">' + esc(shortAddress(a.spender)) + "</a> " +
      '<span class="flag ' + verifiedCls + '">' + esc(verifiedLabel) + "</span></div>" +
      '<div class="meta">' + esc(t("lastUsed")) + ": " + esc(lastUsed) + "</div>" +
      '<div>' + flagsHtml + "</div>" +
      (canRevoke
        ? '<p><button type="button" class="btn btn-danger btn-small" data-revoke-token="' + esc(a.token || "") +
          '" data-revoke-spender="' + esc(a.spender || "") + '" data-revoke-symbol="' + esc(a.tokenSymbol || a.token || "") +
          '" data-revoke-allowance="' + esc(amount) + '">' + esc(t("revoke")) + "</button></p>"
        : "") +
      "</li>";
  }).join("");
  listEl.querySelectorAll("[data-revoke-token]").forEach((btn) => {
    btn.addEventListener("click", () => revokeApproval(
      btn.getAttribute("data-revoke-token"),
      btn.getAttribute("data-revoke-spender"),
      btn.getAttribute("data-revoke-symbol"),
      btn.getAttribute("data-revoke-allowance")
    ));
  });
}

// ---------- Revoke ----------
async function revokeApproval(token, spender, symbol, allowanceDisplay) {
  if (!currentAccount || !window.ethereum) { setStatus(t("connectFirst"), "error"); return; }
  const ok = window.confirm(t("revokeConfirm", {
    token: symbol || token, spender, allowance: allowanceDisplay || "",
  }));
  if (!ok) { setStatus(t("revokeCancelled")); return; }
  try {
    setStatus(t("revokeSent"));
    const iface = new ethers.Interface(["function approve(address spender, uint256 amount) returns (bool)"]);
    const data = iface.encodeFunctionData("approve", [spender, 0]);
    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{ from: currentAccount, to: token, data }],
    });
    const provider = getReadProvider();
    if (provider) await provider.waitForTransaction(txHash);
    setStatus(t("revokeDone"));
    await loadScan();
  } catch (e) {
    if (e && (e.code === 4001 || e.code === "ACTION_REJECTED")) setStatus(t("revokeCancelled"), "error");
    else setStatus(t("revokeFailed"), "error");
  }
}

// ---------- Profile ----------
async function loadProfile() {
  const noticeEl = document.getElementById("profileNotice");
  const scoreEl = document.getElementById("profileScore");
  const estEl = document.getElementById("profileEstimated");
  const badgeEl = document.getElementById("profileBadge");
  const handleEl = document.getElementById("profileHandle");
  const historyEl = document.getElementById("scoreHistory");
  if (!currentAccount) {
    if (handleEl) handleEl.textContent = "—";
    if (scoreEl) scoreEl.textContent = "—";
    if (estEl) estEl.textContent = "—";
    if (historyEl) historyEl.innerHTML = "";
    return;
  }
  if (handleEl) handleEl.textContent = currentHandle || shortAddress(currentAccount);
  if (estEl && lastScan) estEl.textContent = computeScore(collectFlags(lastScan)) + " / 100 (" + t("estimatedScore") + ")";
  if (isTbd(CONFIG.agentAllowanceAddress)) {
    showNotice(noticeEl, t("contractNotReady"));
    if (scoreEl) scoreEl.textContent = "—";
    return;
  }
  const abi = await loadAbi();
  if (!abiReady(abi, "AgentAllowance")) {
    showNotice(noticeEl, t("abiPlaceholder"), "error");
    return;
  }
  try {
    const c = await getAgentAllowanceRead();
    const s = await c.getScore(currentAccount);
    const score = Number(s.score || s[1] || 0);
    const attestedAt = Number(s.attestedAt || s[5] || 0);
    if (scoreEl) {
      scoreEl.textContent = attestedAt === 0
        ? "— (" + t("noScoreHistory") + ")"
        : score + " / 100 (" + t("verifiedScore") + ")";
    }
    const badge = await getBadgeRead();
    if (badge && badgeEl) {
      const tier = Number(await badge.tierOf(currentAccount));
      badgeEl.textContent = TIER_NAMES[tier] || "—";
      badgeEl.className = "badge-tier " + (tier === 3 ? "badge-gold" : tier === 2 ? "badge-silver" : tier === 1 ? "badge-bronze" : "badge-none");
    } else if (badgeEl) {
      const tier = badgeTierOf(score);
      badgeEl.textContent = attestedAt === 0 ? "—" : TIER_NAMES[tier];
      badgeEl.className = "badge-tier " + (tier === 3 ? "badge-gold" : tier === 2 ? "badge-silver" : tier === 1 ? "badge-bronze" : "badge-none");
    }
    if (historyEl) {
      const filter = c.filters.ScoreAttested(currentAccount);
      const events = await c.queryFilter(filter);
      if (!events.length) {
        historyEl.innerHTML = "<li>" + esc(t("noScoreHistory")) + "</li>";
      } else {
        historyEl.innerHTML = events.slice().reverse().map((ev) =>
          "<li>" + esc(String(Number(ev.args.score))) + " / 100 — " +
          esc(new Date(Number(ev.args.periodEnd || 0) * 1000).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB")) +
          "</li>"
        ).join("");
      }
    }
    showNotice(noticeEl, "");
  } catch (e) {
    showNotice(noticeEl, t("scanFailed"), "error");
  }
}

// ---------- Leaderboard ----------
async function loadLeaderboard() {
  const body = document.getElementById("leaderboardBody");
  const noticeEl = document.getElementById("leaderboardNotice");
  if (!body) return;
  if (isTbd(CONFIG.agentAllowanceAddress)) {
    showNotice(noticeEl, t("contractNotReady"));
    body.innerHTML = "";
    return;
  }
  const abi = await loadAbi();
  if (!abiReady(abi, "AgentAllowance")) {
    showNotice(noticeEl, t("abiPlaceholder"), "error");
    body.innerHTML = "";
    return;
  }
  body.innerHTML = '<tr><td colspan="3">' + esc(t("loading")) + "</td></tr>";
  try {
    const c = await getAgentAllowanceRead();
    const provider = getReadProvider();
    const events = await c.queryFilter(c.filters.ScoreAttested());
    const latest = new Map();
    for (const ev of events) {
      const agent = ev.args.agent;
      const score = Number(ev.args.score);
      const prev = latest.get(agent);
      if (!prev || ev.blockNumber > prev.blockNumber) {
        let ts = ev.blockNumber;
        try {
          const block = await provider.getBlock(ev.blockNumber);
          if (block) ts = Number(block.timestamp);
        } catch (e) { /* fallback: dùng blockNumber làm thứ tự thời gian */ }
        latest.set(agent, { agent, score, attestedAt: ts, blockNumber: ev.blockNumber });
      }
    }
    const rows = Array.from(latest.values())
      .sort((a, b) => (b.score - a.score) || (a.attestedAt - b.attestedAt));
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="3">' + esc(t("noLeaderboard")) + "</td></tr>";
      showNotice(noticeEl, "");
      return;
    }
    const names = await Promise.all(rows.map(async (r) => {
      try { return (await c.handleOf(r.agent)) || shortAddress(r.agent); }
      catch (e) { return shortAddress(r.agent); }
    }));
    body.innerHTML = rows.map((r, i) =>
      "<tr><td>" + (i + 1) + "</td><td>" + esc(names[i]) + "</td><td>" + r.score + "</td></tr>"
    ).join("");
    showNotice(noticeEl, "");
  } catch (e) {
    showNotice(noticeEl, t("scanFailed"), "error");
    body.innerHTML = "";
  }
}

// ---------- Stats ----------
async function loadStats() {
  const noticeEl = document.getElementById("statsNotice");
  if (isTbd(CONFIG.agentAllowanceAddress)) {
    showNotice(noticeEl, t("contractNotReady"));
    return;
  }
  const abi = await loadAbi();
  if (!abiReady(abi, "AgentAllowance")) {
    showNotice(noticeEl, t("abiPlaceholder"), "error");
    return;
  }
  try {
    const c = await getAgentAllowanceRead();
    const total = await c.totalAgents();
    const setNum = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    setNum("statAgents", Number(total));
    setNum("homeAgents", Number(total));
    const events = await c.queryFilter(c.filters.ScoreAttested());
    const latest = new Map();
    for (const ev of events) {
      const agent = ev.args.agent;
      if (!latest.has(agent) || ev.blockNumber > latest.get(agent).blockNumber) {
        latest.set(agent, { score: Number(ev.args.score), blockNumber: ev.blockNumber });
      }
    }
    const bands = { "0-49": 0, "50-69": 0, "70-89": 0, "90-100": 0 };
    for (const v of latest.values()) {
      if (v.score < 50) bands["0-49"]++;
      else if (v.score < 70) bands["50-69"]++;
      else if (v.score < 90) bands["70-89"]++;
      else bands["90-100"]++;
    }
    document.querySelectorAll("[data-band]").forEach((el) => {
      el.textContent = String(bands[el.getAttribute("data-band")] || 0);
    });
    showNotice(noticeEl, "");
  } catch (e) {
    showNotice(noticeEl, t("scanFailed"), "error");
  }
}

// ---------- Attest ----------
async function requestScoreAttestation() {
  if (!currentAccount) { setStatus(t("connectFirst"), "error"); return; }
  if (!lastScan) { setStatus(t("attestNoScore"), "error"); return; }
  if (isTbd(CONFIG.verifierUrl)) { setStatus(t("verifierNotReady"), "error"); return; }
  if (isTbd(CONFIG.agentAllowanceAddress)) { setStatus(t("contractNotReady"), "error"); return; }
  const score = computeScore(collectFlags(lastScan));
  try {
    const res = await fetch(CONFIG.verifierUrl.replace(/\/$/, "") + "/score/attest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: currentAccount, periodStart: CONFIG.periodStart, periodEnd: CONFIG.periodEnd }),
    });
    if (!res.ok) throw new Error("verifier HTTP " + res.status);
    const att = await res.json();
    const ok = window.confirm(t("attestConfirm", { score: att.score != null ? att.score : score }));
    if (!ok) { setStatus(t("revokeCancelled")); return; }
    const abi = await loadAbi();
    if (!abiReady(abi, "AgentAllowance")) { setStatus(t("abiPlaceholder"), "error"); return; }
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const c = new ethers.Contract(CONFIG.agentAllowanceAddress, abi.AgentAllowance, signer);
    const tx = await c.attestScore(
      att.agent, att.score, att.periodStart, att.periodEnd, att.nonce, att.deadline, att.signature
    );
    await tx.wait();
    setStatus(t("attestDone", { score: att.score }));
    await loadProfile();
    await loadLeaderboard();
  } catch (e) {
    if (e && (e.code === 4001 || e.code === "ACTION_REJECTED")) setStatus(t("revokeCancelled"), "error");
    else setStatus(t("attestFailed"), "error");
  }
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  try {
    const saved = localStorage.getItem("aa-lang");
    if (saved === "vi" || saved === "en") lang = saved;
  } catch (e) { /* ignore */ }
  applyI18n();
  countdown();
  setInterval(countdown, 1000);
  document.querySelectorAll("nav button").forEach((b) => {
    b.addEventListener("click", () => showView(b.getAttribute("data-view")));
  });
  document.getElementById("langToggle").addEventListener("click", toggleLang);
  document.getElementById("connectBtn").addEventListener("click", connectWallet);
  document.getElementById("ctaScan").addEventListener("click", () => { showView("scanView"); loadScan(); });
  document.getElementById("rescanBtn").addEventListener("click", loadScan);
  document.getElementById("attestBtn").addEventListener("click", requestScoreAttestation);
  if (window.ethereum) {
    window.ethereum.on("accountsChanged", (accs) => {
      currentAccount = accs && accs.length ? accs[0] : null;
      if (currentAccount) connectWallet();
    });
  }
  if (typeof ethers === "undefined") setStatus(t("scanFailed"), "error");
});
