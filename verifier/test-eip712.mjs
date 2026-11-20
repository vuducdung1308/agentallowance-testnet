// test-eip712.mjs — Test nhanh round-trip EIP-712 (sign -> recover).
// Dùng ví test NGẪU NHIÊN tạo trong bộ nhớ (không phải khóa thật), chỉ để kiểm tra
// domain "AgentAllowance" / version "1" / chainId 56 / type ScoreAttestation khớp contract.
// Chạy: node test-eip712.mjs
import { ethers } from "ethers";

const verifyingContract =
  process.env.AGENT_ALLOWANCE_ADDRESS || "0x0000000000000000000000000000000000000001";

const domain = {
  name: "AgentAllowance",
  version: "1",
  chainId: 56,
  verifyingContract,
};
const types = {
  ScoreAttestation: [
    { name: "agent", type: "address" },
    { name: "score", type: "uint256" },
    { name: "periodStart", type: "uint64" },
    { name: "periodEnd", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
};

const wallet = ethers.Wallet.createRandom(); // ví test ngẫu nhiên, không phải khóa thật
const agent = ethers.Wallet.createRandom().address;
const value = {
  agent,
  score: 92,
  periodStart: 1794988800,
  periodEnd: 1796803200,
  nonce: 0,
  deadline: Math.floor(Date.now() / 1000) + 15 * 60,
};

const signature = await wallet.signTypedData(domain, types, value);
const recovered = ethers.verifyTypedData(domain, types, value, signature);

console.log("domain:", JSON.stringify(domain));
console.log("value:", JSON.stringify(value));
console.log("signer:   ", wallet.address);
console.log("recovered:", recovered);
console.log("signature:", signature.slice(0, 18) + "... (rút gọn)");
if (recovered.toLowerCase() === wallet.address.toLowerCase()) {
  console.log("EIP-712 ROUND-TRIP: PASS (recover khớp signer)");
} else {
  console.log("EIP-712 ROUND-TRIP: FAIL (recover không khớp signer)");
  process.exit(1);
}
