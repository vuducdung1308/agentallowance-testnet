// countAgentIds.mjs — Đếm Agent ID duy nhất đã quét trong kỳ (SPEC §9, BRD L12).
// Nguồn: event ScoreAttested trên contract AgentAllowance, chỉ tính block trong kỳ
// 18/11/2026 08:00 UTC → 09/12/2026 08:00 UTC, lọc balanceOf(Agent ID) > 0.
// Env: RPC_URL (bắt buộc, cần RPC đọc được eth_getLogs), AGENT_ALLOWANCE_ADDRESS,
// AGENT_ID_ADDRESS (mặc định mainnet). Có thể ép block bằng PERIOD_START_BLOCK / PERIOD_END_BLOCK.
// Chạy: node countAgentIds.mjs
import { ethers } from "ethers";

const PERIOD_START = 1794988800; // 18/11/2026 08:00 UTC
const PERIOD_END = 1796803200; // 09/12/2026 08:00 UTC
const AGENT_ALLOWANCE_ABI = [
  "event ScoreAttested(address indexed agent, uint256 score, uint64 periodStart, uint64 periodEnd, address verifier)",
];
const AGENT_ID_ABI = ["function balanceOf(address account) view returns (uint256)"];

const RPC_URL = process.env.RPC_URL || "";
const CONTRACT = process.env.AGENT_ALLOWANCE_ADDRESS || "";
const AGENT_ID = process.env.AGENT_ID_ADDRESS || "0x60b9262456de011f7d15a54cdd8c48baaa8b022f";

if (!RPC_URL) {
  console.error("Thiếu RPC_URL (cần RPC đọc được eth_getLogs).");
  process.exit(1);
}
if (!CONTRACT || !ethers.isAddress(CONTRACT)) {
  console.error("Thiếu hoặc sai AGENT_ALLOWANCE_ADDRESS (chưa deploy thì ghi TBD, chưa chạy được script).");
  process.exit(1);
}

// Block đầu tiên có timestamp >= ts (tìm nhị phân).
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

const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT, AGENT_ALLOWANCE_ABI, provider);
const agentId = new ethers.Contract(AGENT_ID, AGENT_ID_ABI, provider);

const fromBlock =
  Number(process.env.PERIOD_START_BLOCK || 0) || (await blockAtOrAfter(provider, PERIOD_START));
const toBlock =
  Number(process.env.PERIOD_END_BLOCK || 0) || (await blockAtOrAfter(provider, PERIOD_END));
console.log(`Quét ScoreAttested từ block ${fromBlock} đến ${toBlock} (kỳ 18/11–09/12/2026 08:00 UTC)...`);

const events = await contract.queryFilter("ScoreAttested", fromBlock, toBlock);
const uniqueAgents = [...new Set(events.map((e) => e.args.agent))];
console.log(`Event ScoreAttested trong kỳ: ${events.length}, ví duy nhất: ${uniqueAgents.length}`);

const withAgentId = [];
for (const agent of uniqueAgents) {
  const bal = await agentId.balanceOf(agent);
  if (bal > 0n) withAgentId.push(agent);
}
console.log(`Ví có Agent ID (balanceOf > 0): ${withAgentId.length}`);
console.log(JSON.stringify({ count: withAgentId.length, agents: withAgentId }, null, 2));
