// leaderboard.mjs — Leaderboard ví sạch nhất từ event ScoreAttested (SPEC §9, BRD FR-08).
// Lấy điểm đã xác nhận MỚI NHẤT của mỗi ví trong kỳ 18/11–09/12/2026 08:00 UTC,
// sắp xếp điểm giảm dần; hòa điểm thì ví đạt điểm đó sớm hơn (attestedAt sớm hơn) xếp trên.
// attestedAt = timestamp của block chứa event ScoreAttested mới nhất của ví đó.
// Env: RPC_URL (bắt buộc, cần RPC đọc được eth_getLogs), AGENT_ALLOWANCE_ADDRESS.
// Có thể ép block bằng PERIOD_START_BLOCK / PERIOD_END_BLOCK.
// Chạy: node leaderboard.mjs
import { ethers } from "ethers";

const PERIOD_START = 1794988800; // 18/11/2026 08:00 UTC
const PERIOD_END = 1796803200; // 09/12/2026 08:00 UTC
const AGENT_ALLOWANCE_ABI = [
  "event ScoreAttested(address indexed agent, uint256 score, uint64 periodStart, uint64 periodEnd, address verifier)",
];

const RPC_URL = process.env.RPC_URL || "";
const CONTRACT = process.env.AGENT_ALLOWANCE_ADDRESS || "";

if (!RPC_URL) {
  console.error("Thiếu RPC_URL (cần RPC đọc được eth_getLogs).");
  process.exit(1);
}
if (!CONTRACT || !ethers.isAddress(CONTRACT)) {
  console.error("Thiếu hoặc sai AGENT_ALLOWANCE_ADDRESS (chưa deploy thì ghi TBD, chưa chạy được script).");
  process.exit(1);
}

async function blockAtOrAfter(provider, ts) {
  let lo = 0;
  let hi = await provider.getBlockNumber();
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const block = await provider.getBlock(mid);
    if (!block) {
      hi = mid;
      continue;
    }
    if (block.timestamp < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bandOf(score) {
  if (score >= 90) return "90–100 (Gold)";
  if (score >= 70) return "70–89 (Silver)";
  if (score >= 50) return "50–69 (Bronze)";
  return "0–49";
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT, AGENT_ALLOWANCE_ABI, provider);

const fromBlock =
  Number(process.env.PERIOD_START_BLOCK || 0) || (await blockAtOrAfter(provider, PERIOD_START));
const toBlock =
  Number(process.env.PERIOD_END_BLOCK || 0) || (await blockAtOrAfter(provider, PERIOD_END));
console.log(`Quét ScoreAttested từ block ${fromBlock} đến ${toBlock} (kỳ 18/11–09/12/2026 08:00 UTC)...`);

const events = await contract.queryFilter("ScoreAttested", fromBlock, toBlock);
const blockTsCache = new Map();
async function blockTimestamp(bn) {
  if (!blockTsCache.has(bn)) {
    const b = await provider.getBlock(bn);
    blockTsCache.set(bn, b ? b.timestamp : 0);
  }
  return blockTsCache.get(bn);
}

// Điểm mới nhất mỗi ví: event sau cùng theo (blockNumber, logIndex).
const latest = new Map();
for (const e of events) {
  const agent = e.args.agent;
  const prev = latest.get(agent);
  if (
    !prev ||
    e.blockNumber > prev.blockNumber ||
    (e.blockNumber === prev.blockNumber && e.logIndex > prev.logIndex)
  ) {
    latest.set(agent, {
      agent,
      score: Number(e.args.score),
      blockNumber: e.blockNumber,
      logIndex: e.logIndex,
    });
  }
}

const rows = [];
for (const r of latest.values()) {
  r.attestedAt = await blockTimestamp(r.blockNumber);
  rows.push(r);
}
// Điểm giảm dần; hòa điểm thì attestedAt sớm hơn xếp trên.
rows.sort((a, b) => b.score - a.score || a.attestedAt - b.attestedAt);

console.log(`\nLeaderboard — ${rows.length} ví có điểm đã xác nhận trong kỳ:`);
console.log("Hạng | Ví | Điểm | Đạt lúc (UTC)");
rows.forEach((r, i) => {
  console.log(
    `${i + 1} | ${r.agent} | ${r.score} | ${new Date(r.attestedAt * 1000).toISOString()}`,
  );
});

const bands = { "0–49": 0, "50–69 (Bronze)": 0, "70–89 (Silver)": 0, "90–100 (Gold)": 0 };
for (const r of rows) bands[bandOf(r.score)] += 1;
console.log("\nPhân bố điểm theo band:", JSON.stringify(bands));
console.log(JSON.stringify(rows, null, 2));
