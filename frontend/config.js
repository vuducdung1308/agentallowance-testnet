// AgentAllowance — cấu hình TESTNET (chain 97) cho bản xem thử.
// Bản mainnet trong repo agentallowance giữ nguyên chain 56 + TBD.
const CONFIG = {
  chainId: 97,
  agentAllowanceAddress: "0xB71763d4B3697ba237955809a8F13f6f312Ef0E4",
  badgeAddress: "0xb4ea93C12e2A3a0045f8B40957212AdE8F625ebF",
  agentIdAddress: "0x245201A41FA4849eB0D38DdE3b6490f9555599d5",
  rpcUrl: "https://data-seed-prebsc-1-s1.binance.org:8545",
  verifierUrl: "https://agentallowance-verifier-testnet.onrender.com",
  spaceIdMetadata: "https://agentid.prd.space.id/metadata/",
  // Kỳ tính điểm 18/11/2026 08:00 UTC → 09/12/2026 08:00 UTC (epoch giây).
  periodStart: 1794988800,
  periodEnd: 1796803200,
  // Hết kỳ nộp bài: 09/12/2026 08:00 UTC.
  submissionDeadline: "2026-12-09T08:00:00Z",
};
