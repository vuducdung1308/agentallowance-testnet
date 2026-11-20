// server.js — Verifier AgentAllowance (SPEC §5).
// Làm 3 việc: quét approval (GET /scan), tính Hygiene Score, ký attestation EIP-712 (POST /score/attest).
// Không giữ khóa user, không gửi giao dịch thay user (chỉ ký).
// Env duy nhất: VERIFIER_PRIVATE_KEY, RPC_URL, AGENT_ALLOWANCE_ADDRESS, AGENT_ID_ADDRESS,
// BSCSCAN_API_KEY (tùy chọn). Key chỉ đọc từ env, không hardcode, không commit.
import express from "express";
import { ethers } from "ethers";
import {
  AGENT_ID_ADDRESS,
  CHAIN_ID,
  PERIOD_END,
  PERIOD_START,
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
];
const AGENT_ID_MIN_ABI = ["function balanceOf(address account) view returns (uint256)"];

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

const app = express();
app.use(express.json({ limit: "100kb" }));

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

app.use((_req, res) => res.status(404).json({ error: "Không có endpoint này" }));

app.listen(PORT, () => {
  console.log(`AgentAllowance verifier đang chạy trên port ${PORT}`);
  console.log(`  signerReady: ${signer !== null}, rpcReady: ${provider !== null}`);
  console.log(`  agentAllowance: ${AGENT_ALLOWANCE_ADDRESS || "(chưa cấu hình — TBD)"}`);
});
