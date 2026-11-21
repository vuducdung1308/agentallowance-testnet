// score.js — Quét approval + gắn cờ + tính Hygiene Score (SPEC §4, §5).
// Dùng chung logic với frontend (công thức công khai, đối soát được từ dữ liệu public).
// ESM. Không chứa secret: mọi khóa đọc từ biến môi trường ở server.js.
import { ethers } from "ethers";

// --- Hằng số (SPEC §1.4, §4) ---
// Chain mặc định 56 (mainnet). Testnet chạy với CHAIN_ID=97 qua env.
export const CHAIN_ID = Number(process.env.CHAIN_ID || 56);
export const AGENT_ID_ADDRESS = "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";
// Kỳ tính điểm 18/11/2026 08:00 UTC → 09/12/2026 08:00 UTC.
export const PERIOD_START = 1794988800;
export const PERIOD_END = 1796803200;
export const STALE_DAYS = 90;
export const STALE_SECONDS = STALE_DAYS * 86400;

export const FLAG_POINTS = {
  UNLIMITED_APPROVE_UNVERIFIED: 15,
  UNLIMITED_APPROVE_VERIFIED: 10,
  LIMITED_APPROVE_UNVERIFIED: 10,
  STALE_APPROVAL: 5,
};

// Topic của event Approval(address,address,uint256) và Transfer(address,address,uint256).
export const APPROVAL_TOPIC = ethers.id("Approval(address,address,uint256)");
export const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
export const SCORE_ATTESTED_TOPIC = ethers.id("ScoreAttested(address,uint256,uint64,uint64,address)");
export const BSCSCAN_API_URL = "https://api.bscscan.com/api";

// --- Công thức điểm (SPEC §4.4) ---
// flags: [{ type, fixed }] — fixed = true nếu approval đó đã revoke (approve 0) trong kỳ.
// Cờ đã revoke vẫn bị trừ đủ điểm, rồi cộng lại floor(50%): +7 / +5 / +5 / +2.
export function computeScore(flags) {
  let score = 100;
  for (const f of flags) {
    const pts = FLAG_POINTS[f.type];
    if (pts === undefined) continue;
    score -= pts;
    if (f.fixed) score += Math.floor(pts * 0.5);
  }
  return Math.max(0, Math.min(100, Math.floor(score)));
}

// Tier badge theo band điểm (SPEC §3.8): 0 = chưa đủ band, 1 = Bronze, 2 = Silver, 3 = Gold.
export function tierForScore(score) {
  if (score >= 90) return 3;
  if (score >= 70) return 2;
  if (score >= 50) return 1;
  return 0;
}

// --- Gắn cờ cho 1 cặp (token, spender) (SPEC §4.3) ---
// allowance: BigInt hiện tại (0 = đã revoke). spenderVerified: true / false / "unknown".
// lastUsed: epoch giây của event Approval/Transfer gần nhất của cặp, null nếu không tìm thấy.
// revoked: true nếu event Approval cuối trong kỳ có value = 0.
// lastNonZeroAllowance: giá trị Approval > 0 gần nhất trước khi revoke (null nếu không có).
// revokeTimestamp: epoch giây của event revoke (null nếu không revoke).
// now: epoch giây hiện tại.
// Quy tắc chốt:
//  - spender "unknown" (chưa có BscScan API key / không có dữ liệu) -> KHÔNG trừ điểm cờ chưa-verify.
//  - spender là EOA (không có code) -> coi là CHƯA verify.
//  - lastUsed = null -> KHÔNG gắn cờ STALE.
export function buildFlagsForPair({
  allowance,
  spenderVerified,
  lastUsed,
  revoked,
  lastNonZeroAllowance,
  revokeTimestamp,
  now,
}) {
  const flags = [];
  const fixed = revoked === true;

  // Giá trị để xác định unlimited/limited: allowance hiện tại, hoặc giá trị trước khi revoke.
  let baseValue = null;
  if (allowance > 0n) baseValue = allowance;
  else if (fixed && lastNonZeroAllowance !== null && lastNonZeroAllowance > 0n) {
    baseValue = lastNonZeroAllowance;
  }
  if (baseValue !== null) {
    const unlimited = baseValue === ethers.MaxUint256;
    if (spenderVerified === true) {
      if (unlimited) flags.push({ type: "UNLIMITED_APPROVE_VERIFIED", fixed });
    } else if (spenderVerified === false) {
      // EOA cũng rơi vào nhánh này (coi là chưa verify).
      if (unlimited) flags.push({ type: "UNLIMITED_APPROVE_UNVERIFIED", fixed });
      else flags.push({ type: "LIMITED_APPROVE_UNVERIFIED", fixed });
    }
    // spenderVerified === "unknown": không trừ điểm cờ chưa-verify (fallback BRD).
  }

  // STALE: allowance còn hiệu lực mà lastUsed > 90 ngày; cặp đã revoke thì so với lúc revoke.
  if (lastUsed !== null && lastUsed !== undefined) {
    const refTime = fixed && revokeTimestamp ? revokeTimestamp : now;
    const active = allowance > 0n || fixed;
    if (active && refTime - lastUsed > STALE_SECONDS) {
      flags.push({ type: "STALE_APPROVAL", fixed });
    }
  }
  return flags;
}

// --- Đọc event ---

export function padTopic(address) {
  return ethers.zeroPadValue(ethers.getAddress(address), 32);
}

// BscScan: đổi timestamp -> số block (module=block&action=getblocknobytime).
async function bscscanBlockByTime(timestamp, closest, apiKey) {
  const url =
    `${BSCSCAN_API_URL}?module=block&action=getblocknobytime&timestamp=${timestamp}` +
    `&closest=${closest}&apikey=${apiKey}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status !== "1") throw new Error(`BscScan getblocknobytime lỗi: ${json.message || json.result}`);
  return Number(json.result);
}

// BscScan: đọc log Approval/Transfer của 1 ví trong khoảng block (phân trang).
async function bscscanGetLogs({ fromBlock, toBlock, topic0, topic1, apiKey }) {
  const logs = [];
  let page = 1;
  for (;;) {
    const url =
      `${BSCSCAN_API_URL}?module=logs&action=getLogs&fromBlock=${fromBlock}&toBlock=${toBlock}` +
      `&topic0=${topic0}&topic1=${topic1}&page=${page}&offset=1000&apikey=${apiKey}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== "1") {
      // "No records found" (status 0) nghĩa là không có log, không phải lỗi.
      if (json.message === "No records found" || json.result === "No records found") return logs;
      throw new Error(`BscScan getLogs lỗi: ${json.message || JSON.stringify(json.result)}`);
    }
    const batch = Array.isArray(json.result) ? json.result : [];
    logs.push(...batch);
    if (batch.length < 1000) break;
    page += 1;
  }
  return logs;
}

// RPC: đọc log theo chunk, đi ngược từ block mới nhất cho tới khi block timestamp < PERIOD_START.
// Dùng khi không có BscScan API key (public BSC RPC có thể từ chối eth_getLogs —
// khi đó cần RPC đọc được log như Ankr / NodeReal, xem README).
// CHẠY SONG SONG theo đợt (CONCURRENCY chunk/đợt) thay vì tuần tự từng chunk:
// tập chunk và điều kiện dừng GIỐNG HỆT bản tuần tự (neo từ latest, bước 2000,
// dừng ở chunk đầu tiên có fromBlock timestamp < PERIOD_START, chunk đó vẫn được lấy),
// nên kết quả quét không đổi — chỉ nhanh hơn. Trước đây quét testnet mất ~97 giây
// (tuần tự ~170 lệnh gọi); song song còn ~10–15 giây, mainnet 21 ngày còn dưới ~60 giây
// thay vì ~10 phút, đủ nhanh để không bị rớt request giữa đường (~100 giây).
const SCAN_CONCURRENCY = 8;
async function rpcGetLogsBackwards(provider, topics) {
  const latest = await provider.getBlockNumber();
  const logs = [];
  let toBlock = latest;
  for (;;) {
    // Gom tối đa SCAN_CONCURRENCY chunk liên tiếp (mới -> cũ) rồi gọi song song.
    const batch = [];
    let cursor = toBlock;
    for (let i = 0; i < SCAN_CONCURRENCY; i++) {
      const fromBlock = Math.max(cursor - 1999, 0);
      batch.push({ fromBlock, toBlock: cursor });
      if (fromBlock === 0) {
        cursor = -1;
        break;
      }
      cursor = fromBlock - 1;
    }
    const results = await Promise.all(
      batch.map((c) => provider.getLogs({ fromBlock: c.fromBlock, toBlock: c.toBlock, topics })),
    );
    for (const r of results) logs.push(...r);
    const lastFrom = batch[batch.length - 1].fromBlock;
    if (lastFrom === 0 || cursor === -1) break;
    // Điều kiện dừng như bản tuần tự: chunk cũ nhất của đợt chạm PERIOD_START.
    const boundary = await provider.getBlock(lastFrom);
    if (!boundary || boundary.timestamp < PERIOD_START) break;
    toBlock = lastFrom - 1;
  }
  return logs;
}

// --- Đọc log trong kỳ cho leaderboard / thống kê (SPEC §6, §10) ---
// Khác với rpcGetLogsBackwards (dừng theo timestamp của chunk), hàm này xác định
// CHÍNH XÁC block đầu tiên của kỳ bằng tìm nhị phân (~20 lần getBlock, cache
// lại vì PERIOD_START là hằng số), rồi đi ngược theo chunk song song từ latest
// xuống đúng block đó. Nhờ vậy số liệu "trong kỳ" không lẫn event trước kỳ.
// Dùng cho: ScoreAttested (leaderboard, band, lịch sử 1 ví) và Approval toàn
// chain (tổng approval / tổng revoke trong kỳ). Không động vào đường quét
// /scan (rpcGetLogsBackwards giữ nguyên).
const firstBlockCache = new Map();
async function firstBlockAtOrAfter(provider, timestamp) {
  if (firstBlockCache.has(timestamp)) return firstBlockCache.get(timestamp);
  const latest = await provider.getBlockNumber();
  const genesis = await provider.getBlock(0);
  if (genesis && genesis.timestamp >= timestamp) {
    firstBlockCache.set(timestamp, 0);
    return 0;
  }
  let lo = 0;
  let hi = latest;
  while (lo + 1 < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await provider.getBlock(mid);
    if (!b) {
      hi = mid;
      continue;
    }
    if (b.timestamp >= timestamp) hi = mid;
    else lo = mid;
  }
  firstBlockCache.set(timestamp, hi);
  return hi;
}

// topics: mảng topics cho eth_getLogs; address: lọc theo contract (tùy chọn).
// Trả về log thô (ethers Log) trong [block đầu kỳ, latest], mới -> cũ không
// đảm bảo thứ tự — bên gọi tự sắp xếp theo (blockNumber, logIndex) khi cần.
export async function getPeriodLogs(provider, { topics, address }) {
  const minBlock = await firstBlockAtOrAfter(provider, PERIOD_START);
  const latest = await provider.getBlockNumber();
  const logs = [];
  let toBlock = latest;
  while (toBlock >= minBlock) {
    const batch = [];
    let cursor = toBlock;
    for (let i = 0; i < SCAN_CONCURRENCY; i++) {
      const fromBlock = Math.max(cursor - 1999, minBlock);
      batch.push({ fromBlock, toBlock: cursor });
      if (fromBlock <= minBlock) {
        cursor = minBlock - 1;
        break;
      }
      cursor = fromBlock - 1;
    }
    const results = await Promise.all(
      batch.map((c) =>
        provider.getLogs({
          ...(address ? { address } : {}),
          fromBlock: c.fromBlock,
          toBlock: c.toBlock,
          topics,
        }),
      ),
    );
    for (const r of results) logs.push(...r);
    if (cursor < minBlock) break;
    toBlock = cursor;
  }
  return logs;
}

// Gom event Approval/Transfer trong kỳ thành danh sách cặp (token, spender).
// Trả về Map key "token-spender" -> { token, spender, events: [{value, timestamp, blockNumber, logIndex}], transfers: [timestamp] }.
function groupPairEvents(approvalLogs, transferLogs, getTimestamp) {
  const pairs = new Map();
  const keyOf = (token, spender) => `${token.toLowerCase()}-${spender.toLowerCase()}`;
  for (const log of approvalLogs) {
    const token = ethers.getAddress(log.address);
    const spender = ethers.getAddress("0x" + log.topics[2].slice(26));
    const value = BigInt(log.data);
    const timestamp = getTimestamp(log);
    const key = keyOf(token, spender);
    if (!pairs.has(key)) pairs.set(key, { token, spender, events: [], transfers: [] });
    pairs.get(key).events.push({
      value,
      timestamp,
      blockNumber: Number(log.blockNumber),
      logIndex: Number(log.logIndex),
    });
  }
  for (const log of transferLogs) {
    const spender = ethers.getAddress("0x" + log.topics[2].slice(26));
    const token = ethers.getAddress(log.address);
    const timestamp = getTimestamp(log);
    const key = keyOf(token, spender);
    if (!pairs.has(key)) pairs.set(key, { token, spender, events: [], transfers: [] });
    pairs.get(key).transfers.push(timestamp);
  }
  // Sắp xếp event theo (blockNumber, logIndex) để xác định "cuối kỳ" đúng thứ tự on-chain.
  for (const p of pairs.values()) {
    p.events.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
    p.transfers.sort((a, b) => a - b);
  }
  return pairs;
}

const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
];

// Kiểm tra spender đã verify source trên BscScan chưa.
// EOA (không có code) -> false (chưa verify). Không có key / API lỗi -> "unknown".
export async function checkSpenderVerified(spender, { provider, bscscanApiKey, cache }) {
  if (cache && cache.has(spender.toLowerCase())) return cache.get(spender.toLowerCase());
  let result = "unknown";
  try {
    if (provider) {
      const code = await provider.getCode(spender);
      if (code === "0x" || code === "0x0") {
        result = false; // EOA: không có source để kiểm tra -> chưa verify.
      } else if (bscscanApiKey) {
        const url =
          `${BSCSCAN_API_URL}?module=contract&action=getsourcecode&address=${spender}&apikey=${bscscanApiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        const row = Array.isArray(json.result) ? json.result[0] : null;
        if (row && row.SourceCode && row.SourceCode !== "" && row.ABI !== "Contract source code not verified") {
          result = true;
        } else if (row) {
          result = false;
        } else {
          result = "unknown";
        }
      }
      // Có code nhưng không có API key -> "unknown", không trừ điểm (fallback BRD).
    }
  } catch {
    result = "unknown";
  }
  if (cache) cache.set(spender.toLowerCase(), result);
  return result;
}

// --- Quét chính (SPEC §5.4) ---
// Trả về { agent, approvals, score, status: "estimated", periodStart, periodEnd, scannedAt }.
// approvals[]: { token, tokenSymbol, spender, spenderVerified, allowance (string),
//                unlimited, lastUsed (epoch giây | null), flags: [{type, fixed}] }.
export async function scanApprovals(agent, { provider, bscscanApiKey }) {
  const agentAddr = ethers.getAddress(agent);
  const now = Math.floor(Date.now() / 1000);
  const verifiedCache = new Map();

  let approvalLogs;
  let transferLogs;
  if (bscscanApiKey) {
    const fromBlock = await bscscanBlockByTime(PERIOD_START, "after", bscscanApiKey);
    const toBlock = await bscscanBlockByTime(Math.min(now, PERIOD_END), "before", bscscanApiKey);
    approvalLogs = await bscscanGetLogs({
      fromBlock,
      toBlock,
      topic0: APPROVAL_TOPIC,
      topic1: padTopic(agentAddr),
      apiKey: bscscanApiKey,
    });
    transferLogs = await bscscanGetLogs({
      fromBlock,
      toBlock,
      topic0: TRANSFER_TOPIC,
      topic1: padTopic(agentAddr),
      apiKey: bscscanApiKey,
    });
    // BscScan trả timeStamp trực tiếp; chuẩn hoá về dạng log ethers để dùng chung.
    const norm = (l) => ({
      address: l.address,
      topics: l.topics,
      data: l.data,
      blockNumber: l.blockNumber,
      logIndex: l.logIndex,
      _timestamp: Number(l.timeStamp),
    });
    approvalLogs = approvalLogs.map(norm);
    transferLogs = transferLogs.map(norm);
    const pairs = groupPairEvents(approvalLogs, transferLogs, (l) => l._timestamp);
    return buildScanResult(agentAddr, pairs, { provider, bscscanApiKey, verifiedCache, now });
  }

  // Fallback RPC: eth_getLogs chia chunk (cần RPC đọc được log).
  // Hai lượt quét (Approval + Transfer) độc lập nhau -> chạy song song.
  [approvalLogs, transferLogs] = await Promise.all([
    rpcGetLogsBackwards(provider, [APPROVAL_TOPIC, padTopic(agentAddr)]),
    rpcGetLogsBackwards(provider, [TRANSFER_TOPIC, padTopic(agentAddr)]),
  ]);
  // groupPairEvents cần timestamp đồng bộ -> resolve trước, song song theo block riêng biệt.
  const allLogs = [...approvalLogs, ...transferLogs];
  const distinctBns = [...new Set(allLogs.map((l) => Number(l.blockNumber)))];
  const tsByBn = new Map();
  await Promise.all(
    distinctBns.map(async (bn) => {
      const b = await provider.getBlock(bn);
      tsByBn.set(bn, b ? b.timestamp : 0);
    }),
  );
  for (const log of allLogs) log._timestamp = tsByBn.get(Number(log.blockNumber));
  const pairs = groupPairEvents(approvalLogs, transferLogs, (l) => l._timestamp);
  return buildScanResult(agentAddr, pairs, { provider, bscscanApiKey, verifiedCache, now });
}

async function buildScanResult(agentAddr, pairs, { provider, bscscanApiKey, verifiedCache, now }) {
  const approvals = [];
  const allFlags = [];
  for (const p of pairs.values()) {
    const token = new ethers.Contract(p.token, ERC20_MIN_ABI, provider);
    let allowance = 0n;
    let tokenSymbol = null;
    try {
      allowance = await token.allowance(agentAddr, p.spender);
    } catch {
      allowance = 0n; // token lạ / không đúng ERC-20: coi như 0, vẫn liệt kê cặp để đối soát.
    }
    try {
      tokenSymbol = await token.symbol();
    } catch {
      tokenSymbol = null;
    }

    const lastEvent = p.events.length > 0 ? p.events[p.events.length - 1] : null;
    const revoked = lastEvent !== null && lastEvent.value === 0n;
    let lastNonZeroAllowance = null;
    let revokeTimestamp = null;
    if (revoked) {
      revokeTimestamp = lastEvent.timestamp;
      for (let i = p.events.length - 2; i >= 0; i--) {
        if (p.events[i].value > 0n) {
          lastNonZeroAllowance = p.events[i].value;
          break;
        }
      }
    }
    // lastUsed: event Approval/Transfer gần nhất của cặp (null nếu không có event nào).
    const candidates = [
      ...p.events.map((e) => e.timestamp),
      ...p.transfers,
    ];
    const lastUsed = candidates.length > 0 ? Math.max(...candidates) : null;

    const spenderVerified = await checkSpenderVerified(p.spender, {
      provider,
      bscscanApiKey,
      cache: verifiedCache,
    });
    const flags = buildFlagsForPair({
      allowance,
      spenderVerified,
      lastUsed,
      revoked,
      lastNonZeroAllowance,
      revokeTimestamp,
      now,
    });
    allFlags.push(...flags);
    approvals.push({
      token: p.token,
      tokenSymbol,
      spender: p.spender,
      spenderVerified,
      allowance: allowance.toString(),
      unlimited: allowance === ethers.MaxUint256,
      lastUsed,
      flags,
    });
  }

  // Sắp xếp ổn định để kết quả dễ đọc: spender chưa verify / cờ nặng lên trước.
  approvals.sort((a, b) => b.flags.length - a.flags.length);
  return {
    agent: agentAddr,
    approvals,
    score: computeScore(allFlags),
    status: "estimated",
    periodStart: PERIOD_START,
    periodEnd: PERIOD_END,
    scannedAt: now,
  };
}
