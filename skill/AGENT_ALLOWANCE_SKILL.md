# AGENT_ALLOWANCE_SKILL.md — Skill cho AI Agent (1 prompt duy nhất)

> Dán toàn bộ prompt trong khung dưới đây vào Claude Code / Codex đã đăng
> nhập Agentic Wallet (baw CLI, Developer Mode). Prompt này là bản đầy đủ của
> SPEC §7 / BRD FR-10.
>
> Địa chỉ contract: **TBD** — điền sau khi deploy mainnet (AgentAllowance và
> Badge). Cho tới lúc đó, skill vẫn quét và revoke được qua dữ liệu public
> trên BSC, nhưng điểm chưa thể xác nhận on-chain.

```text
TASK: Keep my Binance Agentic Wallet's token approvals clean, using
AgentAllowance.

You are helping me manage the ERC-20 token approvals of my own Agentic
Wallet on BNB Smart Chain (chain ID 56). My wallet holds an Agent ID
(.ai name). Only ever act on MY wallet — never look up or act on anyone
else's wallet.

1. SCAN — every day, scan ALL ERC-20 allowances of my wallet on BNB Smart
   Chain (chain ID 56):
   - For each token + spender pair, read the current allowance with
     allowance(owner, spender) and check whether it is unlimited
     (allowance == 2^256 - 1).
   - Check whether the spender contract is source-verified on BscScan
     (getsourcecode). A spender with no code (EOA) counts as NOT verified.
   - Find the last use of each approval from the most recent Approval /
     Transfer event for that (token, spender) pair. An approval unused
     for more than 90 days is STALE.
   - Only count approvals created in the scoring period
     18/11/2026 08:00 UTC → 09/12/2026 08:00 UTC. If the BscScan API is
     unavailable, mark the spender status "unknown" and do NOT deduct
     points for unverified-spender flags until data is available.
2. SCORE — compute my Hygiene Score (0–100) with the public formula:
   - Start at 100.
   - Minus 15 per UNLIMITED approval to an UNVERIFIED spender.
   - Minus 10 per UNLIMITED approval to a VERIFIED spender.
   - Minus 10 per LIMITED approval to an UNVERIFIED spender.
   - Minus 5 per STALE approval (allowance > 0, unused > 90 days).
   - One approval can carry two flags at once (e.g. unlimited AND stale)
     and both deductions apply.
   - After an approval is revoked inside the period, add back 50% of the
     points deducted for that flag (rounded down): +7 / +5 / +5 / +2.
     The score never goes below 0 or above 100.
   - Example: 1 unlimited approval to an unverified spender → 85.
     After revoking it → 92. Re-approving unlimited to the same spender
     brings the score back to 85.
   - Report the score as "estimated" unless it has been confirmed by the
     AgentAllowance verifier signature and recorded on-chain.
3. REPORT — report the Hygiene Score and every risky approval, riskiest
   first (unlimited approvals to unverified spenders first). For each one
   show: token, spender, amount (Unlimited or the exact number), whether
   the spender is verified, last use, and which flags apply.
4. REVOKE — for each risky approval, ASK ME BEFORE revoking it. Only
   after I explicitly say yes, call approve(spender, 0) on the token
   contract from my wallet. Never revoke without my confirmation for
   that specific approval.
5. CONFIRM — after each revoke, report: token, spender, transaction
   hash, and the new Hygiene Score. The score only improves once the
   Approval event (owner = my wallet, spender, value = 0) is visible
   on-chain.

SAFETY RULES — never break these:
- Never ask me for a seed phrase, private key, or password. Never ask
  for a pairing code or any login code for my wallet.
- Never send, approve, or sign any transaction without showing me the
  exact details first (token, spender, amount, and what the call does)
  and getting my explicit approval for that transaction.
- Never create a new approval with a value greater than 0. The only
  approval this skill ever sends is approve(spender, 0) to revoke.
- Never move funds. Never call transfer or transferFrom. Never send BNB
  to any contract.
- If you are unsure about a spender or a transaction, stop and ask me
  instead of guessing.

CONTRACTS (fill in after mainnet deploy):
- AgentAllowance: TBD
- Badge: TBD
- Agent ID (ERC-721): 0x60b9262456de011f7d15a54cdd8c48baaa8b022f
- Chain: BNB Smart Chain, chain ID 56
- Verifier: TBD (Render)
- Web app: TBD (Vercel)
```

## Ghi chú vận hành

- Chạy skill 1 lần/ngày trong kỳ 18/11–09/12/2026. Agent trade liên tục sẽ
  tạo approval mới, nên điểm có thể tụt lại sau khi đã dọn — đó là vòng lặp
  sản phẩm, không phải lỗi.
- Revoke rồi approve lại unlimited cho cùng spender thì điểm quay về mức cũ
  ở lần quét sau (chống farm điểm, BRD A1).
- Badge: Bronze 50–69, Silver 70–89, Gold 90–100 theo điểm đã xác nhận.
  Dưới 50 không mint mới; badge đã nhận không bị đốt khi điểm tụt.
