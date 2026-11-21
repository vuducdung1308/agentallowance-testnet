// server.js — Verifier AgentAllowance (SPEC §5).
// Làm 3 việc: quét approval (GET /scan), tính Hygiene Score, ký attestation EIP-712 (POST /score/attest).
// Không giữ khóa user, không gửi giao dịch thay user (chỉ ký).
// Env duy nhất: VERIFIER_PRIVATE_KEY, RPC_URL, AGENT_ALLOWANCE_ADDRESS, AGENT_ID_ADDRESS,
// BSCSCAN_API_KEY (tùy chọn). Key chỉ đọc từ env, không hardcode, không commit.
import express from "express";
import { ethers } from "ethers";
import {
  AGENT_ID_ADDRESS,
  APPROVAL_TOPIC,
  CHAIN_ID,
  PERIOD_END,
  PERIOD_START,
  SCORE_ATTESTED_TOPIC,
  getPeriodLogs,
  padTopic,
  scanApprovals,
} from "./score.js";

const PORT = Number(process.env.PORT || 3000);
const RPC_URL = process.env.RPC_URL || "";
const AGENT_ALLOWANCE_ADDRESS = process.env.AGENT_ALLOWANCE_ADDRESS || "";
const AGENT_ID = process.env.AGENT_ID_ADDRESS || AGENT_ID_ADDRESS;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY || "";
const VERIFIER_PRIVATE_KEY = process.env.VERIFIER_PRIVATE_KEY || "";

// --- Provider / signer (thiếu env vẫn khởi động được, /health báo rõ) ---
let provider = null;
if (RPC_URL) {
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  } catch (e) {
    console.error("RPC_URL không hợp lệ:", e.message);
    provider = null;
  }
}

let signer = null;
if (VERIFIER_PRIVATE_KEY) {
  try {
    signer = new ethers.Wallet(VERIFIER_PRIVATE_KEY);
  } catch (e) {
    console.error("VERIFIER_PRIVATE_KEY không hợp lệ:", e.message);
    signer = null;
  }
}

const AGENT_ALLOWANCE_MIN_ABI = [
  "function nonces(address agent) view returns (uint256)",
  "function verifier() view returns (address)",
  "function totalAgents() view returns (uint256)",
];
const AGENT_ID_MIN_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function handleOf(address account) view returns (string)",
];

function agentAllowanceContract() {
  if (!provider || !AGENT_ALLOWANCE_ADDRESS) return null;
  return new ethers.Contract(AGENT_ALLOWANCE_ADDRESS, AGENT_ALLOWANCE_MIN_ABI, provider);
}

// EIP-712 domain + types (khớp contract AgentAllowance.sol).
function eip712Domain() {
  return {
    name: "AgentAllowance",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: AGENT_ALLOWANCE_ADDRESS,
  };
}
const SCORE_TYPES = {
  ScoreAttestation: [
    { name: "agent", type: "address" },
    { name: "score", type: "uint256" },
    { name: "periodStart", type: "uint64" },
    { name: "periodEnd", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

// --- Leaderboard / thống kê / lịch sử (SPEC §6, §10) ---
// Frontend KHÔNG tự đọc log được: public BSC RPC chặn eth_getLogs, nên
// leaderboard + stats + lịch sử điểm trên trang luôn trống (lỗi 21/11).
// Verifier có RPC đọc được log nên đếm thay: đọc event ScoreAttested và
// Approval trong kỳ rồi trả JSON cho frontend. Cache ngắn 120 giây vì đọc
// log toàn kỳ tốn vài chục giây trên mainnet cuối kỳ.
const SCORE_ATTESTED_IFACE = new ethers.Interface([
  "event ScoreAttested(address indexed agent, uint256 score, uint64 periodStart, uint64 periodEnd, address verifier)",
]);

function shortAddress(addr) {
  const a = String(addr || "");
  return a.length > 10 ? a.slice(0, 6) + "..." + a.slice(-4) : a;
}

async function blockTimestamps(provider, blockNumbers) {
  const uniq = [...new Set(blockNumbers.map(Number))];
  const map = new Map();
  await Promise.all(
    uniq.map(async (n) => {
      try {
        const b = await provider.getBlock(n);
        if (b) map.set(n, Number(b.timestamp));
      } catch {
        // Không lấy được timestamp thì dùng blockNumber làm thứ tự thời gian.
      }
    }),
  );
  return map;
}

const LEADERBOARD_TTL_MS = 120_000;
let leaderboardCache = { at: 0, data: null };
const historyCache = new Map(); // agent (lowercase) -> { at, data }

async function computeLeaderboard() {
  const now = Date.now();
  if (leaderboardCache.data && now - leaderboardCache.at < LEADERBOARD_TTL_MS) {
    return leaderboardCache.data;
  }
  if (!provider || !AGENT_ALLOWANCE_ADDRESS) {
    throw new Error("Verifier chưa cấu hình RPC_URL / AGENT_ALLOWANCE_ADDRESS");
  }
  const contract = agentAllowanceContract();
  const [totalAgents, attestedLogs, approvalLogs] = await Promise.all([
    contract.totalAgents(),
    getPeriodLogs(provider, { topics: [SCORE_ATTESTED_TOPIC], address: AGENT_ALLOWANCE_ADDRESS }),
    getPeriodLogs(provider, { topics: [APPROVAL_TOPIC] }),
  ]);

  // Điểm mới nhất mỗi ví (theo blockNumber, logIndex) + attestedAt từ timestamp block.
  const decoded = attestedLogs
    .map((log) => {
      try {
        const parsed = SCORE_ATTESTED_IFACE.parseLog(log);
        return {
          agent: ethers.getAddress(parsed.args.agent),
          score: Number(parsed.args.score),
          periodStart: Number(parsed.args.periodStart),
          periodEnd: Number(parsed.args.periodEnd),
          blockNumber: Number(log.blockNumber),
          logIndex: Number(log.logIndex),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  const tsMap = await blockTimestamps(provider, decoded.map((d) => d.blockNumber));
  const latest = new Map();
  for (const d of decoded) {
    const attestedAt = tsMap.get(d.blockNumber) ?? d.blockNumber;
    latest.set(d.agent, { ...d, attestedAt });
  }
  const rows = [...latest.values()].sort((a, b) => b.score - a.score || a.attestedAt - b.attestedAt);

  // Tên .ai mỗi ví (đọc handleOf trên contract Agent ID; lỗi thì dùng địa chỉ rút gọn).
  const agentId = new ethers.Contract(AGENT_ID, AGENT_ID_MIN_ABI, provider);
  const handles = await Promise.all(
    rows.map(async (r) => {
      try {
        const h = await agentId.handleOf(r.agent);
        return h || shortAddress(r.agent);
      } catch {
        return shortAddress(r.agent);
      }
    }),
  );
  rows.forEach((r, i) => {
    r.handle = handles[i];
  });

  const bands = { "0-49": 0, "50-69": 0, "70-89": 0, "90-100": 0 };
  for (const r of rows) {
    if (r.score < 50) bands["0-49"]++;
    else if (r.score < 70) bands["50-69"]++;
    else if (r.score < 90) bands["70-89"]++;
    else bands["90-100"]++;
  }

  // Tổng approval / revoke trong kỳ: đếm event Approval toàn chain.
  // value > 0 = cấp approval; value == 0 = revoke (approve(spender, 0)).
  // Log không chuẩn (data không phải uint256 32 byte) thì bỏ qua, không đếm.
  let approvals = 0;
  let revokes = 0;
  for (const log of approvalLogs) {
    if (typeof log.data !== "string" || log.data.length !== 66) continue;
    if (BigInt(log.data) === 0n) revokes++;
    else approvals++;
  }

  const data = {
    totalAgents: Number(totalAgents),
    approvals,
    revokes,
    bands,
    rows: rows.map((r) => ({
      agent: r.agent,
      handle: r.handle,
      score: r.score,
      attestedAt: r.attestedAt,
      blockNumber: r.blockNumber,
    })),
    updatedAt: Math.floor(now / 1000),
  };
  leaderboardCache = { at: now, data };
  return data;
}

async function computeHistory(agent) {
  const key = agent.toLowerCase();
  const now = Date.now();
  const cached = historyCache.get(key);
  if (cached && now - cached.at < LEADERBOARD_TTL_MS) return cached.data;
  if (!provider || !AGENT_ALLOWANCE_ADDRESS) {
    throw new Error("Verifier chưa cấu hình RPC_URL / AGENT_ALLOWANCE_ADDRESS");
  }
  const logs = await getPeriodLogs(provider, {
    topics: [SCORE_ATTESTED_TOPIC, padTopic(agent)],
    address: AGENT_ALLOWANCE_ADDRESS,
  });
  const decoded = logs
    .map((log) => {
      try {
        const parsed = SCORE_ATTESTED_IFACE.parseLog(log);
        return {
          score: Number(parsed.args.score),
          periodStart: Number(parsed.args.periodStart),
          periodEnd: Number(parsed.args.periodEnd),
          blockNumber: Number(log.blockNumber),
          logIndex: Number(log.logIndex),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const tsMap = await blockTimestamps(provider, decoded.map((d) => d.blockNumber));
  const history = decoded.map((d) => ({
    score: d.score,
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    attestedAt: tsMap.get(d.blockNumber) ?? d.blockNumber,
    blockNumber: d.blockNumber,
  }));
  const data = { agent: ethers.getAddress(agent), history, updatedAt: Math.floor(now / 1000) };
  historyCache.set(key, { at: now, data });
  return data;
}

const app = express();
app.use(express.json({ limit: "100kb" }));

// --- CORS: frontend chạy trên GitHub Pages (origin khác) gọi /scan và
// /score/attest từ trình duyệt, nên mọi response phải có
// Access-Control-Allow-Origin. Không có header này, trình duyệt chặn response
// dù server trả 200 (lỗi đã gặp 21/11: quét trên trang luôn báo thất bại
// trong khi curl trực tiếp vẫn 200). API này chỉ đọc dữ liệu công khai và ký
// theo yêu cầu, không dùng cookie hay credential, nên "*" là đủ và an toàn.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// --- GET /health ---
app.get("/health", async (_req, res) => {
  let rpcReady = false;
  if (provider) {
    try {
      // Timeout 4s: Render Free ngủ dậy chậm, nhưng /health không được treo.
      await Promise.race([
        provider.getBlockNumber(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("rpc timeout")), 4000)),
      ]);
      rpcReady = true;
    } catch {
      rpcReady = false;
    }
  }
  res.json({
    ok: true,
    chainId: CHAIN_ID,
    agentAllowanceAddress: AGENT_ALLOWANCE_ADDRESS || null,
    signerReady: signer !== null,
    rpcReady,
  });
});

// --- GET /scan?agent=0x... ---
app.get("/scan", async (req, res) => {
  const agent = req.query.agent;
  if (!agent || !ethers.isAddress(agent)) {
    return res.status(400).json({ error: "Thiếu hoặc sai địa chỉ agent (?agent=0x...)" });
  }
  if (!provider) {
    return res.status(503).json({ error: "RPC_URL chưa cấu hình, không quét được approval" });
  }
  try {
    const result = await scanApprovals(agent, { provider, bscscanApiKey: BSCSCAN_API_KEY || null });
    return res.json(result);
  } catch (e) {
    console.error("GET /scan lỗi:", e);
    return res.status(500).json({ error: `Quét approval thất bại: ${e.message}` });
  }
});

// --- POST /score/attest ---
// Body: { agent, periodStart, periodEnd }.
// BẮT BUỘC quét lại trạng thái approval hiện tại trước khi ký (BRD A1).
app.post("/score/attest", async (req, res) => {
  const { agent, periodStart, periodEnd } = req.body || {};
  if (!agent || !ethers.isAddress(agent)) {
    return res.status(400).json({ error: "Thiếu hoặc sai địa chỉ agent" });
  }
  if (!Number.isInteger(periodStart) || !Number.isInteger(periodEnd) || periodStart >= periodEnd) {
    return res.status(400).json({ error: "periodStart phải < periodEnd (epoch giây)" });
  }
  if (!signer) {
    return res.status(503).json({ error: "Verifier chưa cấu hình khóa (VERIFIER_PRIVATE_KEY)" });
  }
  if (!AGENT_ALLOWANCE_ADDRESS || !ethers.isAddress(AGENT_ALLOWANCE_ADDRESS)) {
    return res.status(503).json({ error: "Contract AgentAllowance chưa cấu hình (AGENT_ALLOWANCE_ADDRESS)" });
  }
  if (!provider) {
    return res.status(503).json({ error: "RPC_URL chưa cấu hình" });
  }

  try {
    // 1. Kiểm tra ví có Agent ID (đọc on-chain, nếu RPC lỗi thì báo 503).
    const agentId = new ethers.Contract(AGENT_ID, AGENT_ID_MIN_ABI, provider);
    const balance = await agentId.balanceOf(agent);
    if (balance === 0n) {
      return res.status(400).json({ error: "Ví không có Agent ID" });
    }

    // 2. Quét lại trạng thái approval HIỆN TẠI rồi tính điểm (BRD A1).
    const scan = await scanApprovals(agent, { provider, bscscanApiKey: BSCSCAN_API_KEY || null });
    const score = scan.score;

    // 3. Nonce = nonces(agent) đọc từ contract.
    const contract = agentAllowanceContract();
    const nonce = await contract.nonces(agent);

    // 4. Ký EIP-712, deadline = lúc ký + 15 phút (tối đa theo SPEC).
    const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
    const value = { agent, score, periodStart, periodEnd, nonce, deadline };
    const signature = await signer.signTypedData(eip712Domain(), SCORE_TYPES, value);

    return res.json({ agent, score, periodStart, periodEnd, nonce: Number(nonce), deadline, signature });
  } catch (e) {
    console.error("POST /score/attest lỗi:", e);
    return res.status(500).json({ error: `Ký attestation thất bại: ${e.message}` });
  }
});

// --- GET /leaderboard ---
// Trả toàn bộ số liệu cho trang Bảng xếp hạng + Thống kê:
// { totalAgents, approvals, revokes, bands, rows: [{agent, handle, score, attestedAt, blockNumber}], updatedAt }.
app.get("/leaderboard", async (_req, res) => {
  try {
    return res.json(await computeLeaderboard());
  } catch (e) {
    console.error("GET /leaderboard lỗi:", e);
    return res.status(500).json({ error: `Không lấy được leaderboard: ${e.message}` });
  }
});

// --- GET /history?agent=0x... ---
// Lịch sử điểm đã xác nhận của 1 ví (mới nhất trước), cho tab Hồ sơ.
app.get("/history", async (req, res) => {
  const agent = req.query.agent;
  if (!agent || !ethers.isAddress(agent)) {
    return res.status(400).json({ error: "Thiếu hoặc sai địa chỉ agent (?agent=0x...)" });
  }
  try {
    return res.json(await computeHistory(agent));
  } catch (e) {
    console.error("GET /history lỗi:", e);
    return res.status(500).json({ error: `Không lấy được lịch sử điểm: ${e.message}` });
  }
});

app.use((_req, res) => res.status(404).json({ error: "Không có endpoint này" }));

app.listen(PORT, () => {
  console.log(`AgentAllowance verifier đang chạy trên port ${PORT}`);
  console.log(`  signerReady: ${signer !== null}, rpcReady: ${provider !== null}`);
  console.log(`  agentAllowance: ${AGENT_ALLOWANCE_ADDRESS || "(chưa cấu hình — TBD)"}`);
});
