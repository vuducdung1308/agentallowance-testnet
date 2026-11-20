# AgentAllowance

> **Ví Agent của bạn có sạch không?**
>
> AgentAllowance quét toàn bộ token approval của ví Agent ID trên BNB Chain,
> chấm Hygiene Score 0–100 và cho revoke 1 click những approval rủi ro.
> Dự án dự thi **Agent ID Hackathon** (Binance Wallet × BNB Chain), hạn nộp
> **09/12/2026 08:00 UTC**. Kỳ tính điểm: **18/11/2026 08:00 UTC →
> 09/12/2026 08:00 UTC**.

## Vấn đề

AI Agent được giao ví Agentic Wallet và tự approve token cho đủ loại contract,
nhưng không ai kiểm tra lại: approval unlimited cho spender chưa verify,
approval nằm im hàng tháng không dùng — đó là cửa để spender rút sạch token
bất cứ lúc nào. Người dùng đã có Revoke.cash; agent thì chưa có gì native
trên BSC và gắn với Agent ID.

## Cách hoạt động

1. **Scan** — Verifier quét toàn bộ ERC-20 allowance của ví Agent ID trên BSC:
   token, spender, số lượng, có phải unlimited không, spender đã verify source
   trên BscScan chưa, lần dùng gần nhất.
2. **Score** — Hygiene Score 0–100 theo công thức công khai (mục dưới). Điểm
   có 2 trạng thái: **tạm tính** (tính từ dữ liệu public) và **đã xác nhận**
   (verifier ký EIP-712, ghi on-chain qua `attestScore()`).
3. **Revoke** — Bấm Revoke ở từng dòng approval rủi ro. App chỉ gửi
   `approve(spender, 0)` từ ví người dùng, luôn có màn hình xác nhận của ví.
   Verifier xác nhận revoke qua Approval event trên token contract rồi mới
   cộng điểm lại.
4. **Attest** — Người dùng bấm "Yêu cầu xác nhận điểm", verifier ký
   attestation, frontend gửi `attestScore()` lên chain. Đủ band điểm thì
   badge soulbound được mint tự động trong cùng giao dịch, ví lên leaderboard.

## Công thức Hygiene Score

```
Hygiene Score = 100 điểm ban đầu
  − 15 mỗi cờ UNLIMITED_APPROVE cho spender CHƯA verify
  − 10 mỗi cờ UNLIMITED_APPROVE cho spender ĐÃ verify
  − 10 mỗi cờ LIMITED_APPROVE cho spender CHƯA verify
  −  5 mỗi cờ STALE_APPROVAL (allowance không dùng > 90 ngày)
  Revoke (approve 0) trong kỳ, cộng lại 50% số điểm đã trừ cho cờ đó
  (làm tròn xuống): +7 / +5 / +5 / +2
  Điểm tối thiểu 0 (floor), tối đa 100 (cap). Làm tròn xuống số nguyên.
```

- "Unlimited" = `allowance == type(uint256).max`.
- Một approval có thể mang 2 cờ cùng lúc (vừa unlimited vừa stale) và bị trừ cả hai.
- Chỉ tính approval trong kỳ 18/11–09/12 08:00 UTC. Approval trước kỳ không tính.
- Chưa có BscScan API key: spender ghi **"chưa rõ"**, không trừ điểm cờ
  chưa-verify cho tới khi có dữ liệu.
- `lastUsed = null` (không tìm thấy event): không gắn cờ STALE, hiển thị
  "không rõ lần dùng gần nhất".

### Ví dụ

| Tình huống | Điểm |
| --- | --- |
| Ví sạch: không approval nào mang cờ | 100, badge Gold |
| 1 cờ unlimited, spender chưa verify | 85, badge Silver |
| Sau đó revoke approval đó (verifier xác nhận qua Approval event) | 92, badge Gold |
| Approve lại unlimited cho cùng spender chưa verify, quét lại | 85, badge Silver |
| 2 cờ unlimited chưa verify + 1 cờ limited chưa verify + 1 cờ stale | 55, badge Bronze |
| 10 cờ unlimited chưa verify (trừ 150) | 0 (floor), không badge |
| 1 cờ stale | 95; revoke xong → 97 |

### Badge theo band điểm đã xác nhận

| Tier | Band điểm |
| --- | --- |
| Bronze | 50–69 |
| Silver | 70–89 |
| Gold | 90–100 |
| (không badge) | 0–49 |

Dưới 50 không mint badge mới; badge đã nhận **không bị đốt** khi điểm tụt.
Badge là ERC-721 soulbound (không chuyển nhượng), 1 ví tối đa 1 badge.

## Bảng quyền owner (công khai)

Owner là Safe 2-of-3 dùng lại của SafeStreak:
`0x4B49e3ec5DA3A4152033e85C932401c475056dAa`.

| Quyền | Ai | Ghi chú |
| --- | --- | --- |
| `setVerifier` | Owner (Safe 2-of-3) | Đổi verifier khi lộ khóa |
| `setBadge` | Owner (Safe 2-of-3) | Gán/đổi địa chỉ Badge.sol |
| `pause` / `unpause` | Owner (Safe 2-of-3) | Chỉ dừng attest, không dừng đọc |
| Mọi thứ khác | Không ai | Không mint, không thuế, không đóng băng user, không rút tiền, không sửa/xóa điểm đã attest. Không proxy, không selfdestruct, không delegatecall. Contract không payable (không receive/fallback) |

## Cấu trúc repo

```
agentallowance/
├── contracts/                  # Foundry, Solidity 0.8.24 — ĐÃ BUILD 20/11
│   ├── src/AgentAllowance.sol  # Điểm đã xác nhận (EIP-712), không proxy, không payable
│   ├── src/Badge.sol           # ERC-721 soulbound tự viết (không phụ thuộc ngoài)
│   ├── test/AgentAllowance.t.sol # 21 test (SPEC §11.1 T1–T12 + bổ sung)
│   ├── test/Badge.t.sol        # 10 test badge
│   ├── test/MockAgentID.sol    # Mock CHỈ DÙNG CHO TEST, không deploy mainnet
│   ├── script/Deploy.s.sol     # Deploy Badge rồi AgentAllowance (env AGENT_ID/OWNER/VERIFIER)
│   └── foundry.toml            # solc 0.8.24, optimizer on
├── frontend/                   # Trang tĩnh thuần, KHÔNG build step
│   ├── index.html              # 1 file HTML, các view là section ẩn/hiện
│   ├── styles.css              # CSS viết tay, font Nunito, gradient vàng Binance
│   ├── app.js                  # JS thuần, ethers v6 qua CDN
│   ├── abi.json                # ABI thật từ forge build (AgentAllowance 31 entries, Badge 28 entries), KHÔNG viết tay
│   ├── config.js               # Config duy nhất: chain, địa chỉ, verifier URL
│   ├── assets/                 # Bộ 7 hình minh họa flat illustration (FR-13, SPEC §6.7): hero-audit, scan-clean, scan-flags, report-card, podium, dashboard, empty-state — webp, tự host, tổng 816 KB
│   └── vercel.json             # Cấu hình Vercel tối giản
├── verifier/                   # Node.js + Express, Render — ĐÃ BUILD 20/11
│   ├── server.js               # GET /health, GET /scan, POST /score/attest
│   ├── score.js                # Quét approval + gắn cờ + tính điểm (SPEC §4, §5)
│   ├── test-eip712.mjs         # Test nhanh round-trip EIP-712 (sign → recover)
│   ├── package.json
│   └── .env.example            # Mẫu biến môi trường (không giá trị thật)
├── scripts/                    # ĐÃ BUILD 20/11
│   ├── countAgentIds.mjs       # Đếm Agent ID duy nhất từ event ScoreAttested trong kỳ
│   ├── leaderboard.mjs         # Leaderboard điểm mới nhất (hòa điểm: đạt sớm hơn xếp trên)
│   └── package.json
├── skill/
│   └── AGENT_ALLOWANCE_SKILL.md  # 1 prompt duy nhất cho Claude Code/Codex
├── docs/                       # BRD + SPEC (không sửa)
└── README.md                   # file này
```

Tài liệu gốc: `BRD___AgentAllowance__Agent_ID_Hackathon.md` (v0.1) và
`SPEC___AgentAllowance__Agent_ID_Hackathon.md` (v0.1) trong
`~/workspace/user/files/`. Nếu SPEC và BRD mâu thuẫn, **BRD thắng**.

## Cách chạy local

### Frontend

```bash
cd frontend
python3 -m http.server 8000
# Mở http://localhost:8000
```

Không có build step, không cần `npm install`. Frontend load ethers v6 qua CDN
(`cdn.jsdelivr.net/npm/ethers@6.13.4`). Cần mạng để load CDN + Google Fonts.

`frontend/abi.json` là **ABI thật từ forge build** (AgentAllowance 31 entries,
Badge 28 entries), KHÔNG viết tay. Địa chỉ contract + verifier URL vẫn TBD cho
tới khi deploy mainnet 26/11.

### Verifier

Node.js + Express, ethers v6. Endpoints: `GET /health`
(`{ok, chainId: 56, agentAllowanceAddress, signerReady, rpcReady}` — không crash
khi thiếu env), `GET /scan?agent=0x...` (danh sách approval + cờ + điểm tạm tính,
không ký), `POST /score/attest` (`{agent, periodStart, periodEnd}` — bắt buộc quét
lại trạng thái hiện tại trước khi ký, BRD A1; trả `{agent, score, periodStart,
periodEnd, nonce, deadline, signature}`, deadline = lúc ký + 15 phút).
Env duy nhất: `VERIFIER_PRIVATE_KEY`, `RPC_URL`, `AGENT_ALLOWANCE_ADDRESS` (TBD),
`AGENT_ID_ADDRESS`, `BSCSCAN_API_KEY` (tùy chọn) — xem `verifier/.env.example`.
Quét qua BscScan API nếu có key, fallback RPC `eth_getLogs` chia chunk (cần RPC
đọc được log như Ankr / NodeReal; public BSC RPC có thể từ chối `eth_getLogs`).
Chạy local: `cd verifier && npm install && npm start` (cần `.env`).

## Kết quả build & verify (contract + verifier + scripts — 20/11/2026, chạy thật)

- **forge test: 31 passed, 0 failed, 0 skipped** (2 suite: AgentAllowance 21 test,
  Badge 10 test — phủ SPEC §11.1 T1–T12: chữ ký đúng/sai, nonce dùng lại, deadline
  hết hạn, ví không Agent ID, setVerifier/setBadge chỉ owner, pause chặn attest,
  score 101, gửi BNB revert, badge đúng band + đổi band + giữ tier khi < 50,
  badge không chuyển nhượng, totalAgents chỉ tăng lần đầu).
- **node --check: OK** cho `verifier/server.js`, `verifier/score.js`,
  `verifier/test-eip712.mjs`, `scripts/countAgentIds.mjs`, `scripts/leaderboard.mjs`.
- **Công thức điểm: 13/13 case PASS** theo SPEC §11.2 S1–S6 + BRD T4/T6, gồm
  `buildFlagsForPair` trực tiếp: unlimited chưa verify → 85, revoke xong → 92,
  spender `"unknown"` → không trừ (100), limited + stale cùng lúc → 85,
  `lastUsed = null` → không gắn STALE (90).
- **EIP-712 round-trip (Node): PASS** — `ethers.verifyTypedData` recover khớp
  signer (domain `AgentAllowance`/`1`/chainId 56).
- **Server với env giả: chạy được**, `/health` trả
  `{"ok":true,"chainId":56,"agentAllowanceAddress":null,"signerReady":false,"rpcReady":false}`;
  `/scan` thiếu RPC → 503 rõ ràng; `/score/attest` thiếu khóa → 503; `/scan` sai
  địa chỉ → 400.
- **End-to-end Anvil (chainId 56): PASS** — deploy MockAgentID + Badge +
  AgentAllowance, mint Agent ID, nối Badge ↔ AgentAllowance, verifier
  `/score/attest` trả score 100 (ví sạch) + chữ ký, gửi `attestScore` on-chain
  thành công (status 1, phát `BadgeMinted` + `ScoreAttested`); kiểm tra lại:
  `getScore = 100`, `tierOf = 3 (Gold)`, `tokenIdOf = 1`, `totalAgents = 1`,
  `handleOf = "tester.ai"`. (Anvil mặc định chainId 31337 thì chữ ký verifier
  chain 56 không khớp domain — đúng hành vi EIP-712; đã chạy lại Anvil với
  `--chain-id 56` để khớp mainnet.)
- **Lưu ý:** Solidity không cho phép error và event cùng tên `Paused` trong một
  contract, nên 2 event `Paused`/`Unpaused` của SPEC §3.4 được gộp thành
  `PauseChanged(bool paused, address indexed by)`; custom error `Paused()` được
  giữ nguyên (test T7 kiểm tra revert `Paused`). **Slither đã chạy 21/11 (v0.11.6,
  solc 0.8.24): 0 High, 0 Medium, 11 INFO đã xem xét, không cần sửa code** —
  xem `TESTNET.md`. `/scan` qua BscScan API và public BSC RPC chưa test live
  (chưa có BscScan API key, chưa deploy mainnet); đường RPC fallback đã chạy
  được trên testnet qua NodeReal (xem `TESTNET.md`).

## Cách deploy

### Frontend → Vercel

1. Tạo project Vercel từ repo GitHub (thư mục `frontend/`).
2. Không có Build Command, không có Output Directory đặc biệt — Vercel phục
   vụ file tĩnh.
3. Điền địa chỉ thật vào `frontend/config.js` rồi redeploy:
   - `agentAllowanceAddress`: **TBD** (sau deploy mainnet)
   - `badgeAddress`: **TBD** (sau deploy mainnet)
   - `verifierUrl`: **TBD** (sau deploy Render)
   - `agentIdAddress`: `0x60b9262456de011f7d15a54cdd8c48baaa8b022f` (đã chốt)
   - `chainId`: 56, `rpcUrl`: `https://bsc-dataseed.binance.org/`

### Verifier → Render

Deploy service Node.js (Free, Singapore) từ repo, set secret
`VERIFIER_PRIVATE_KEY` + `BSCSCAN_API_KEY` + `AGENT_ALLOWANCE_ADDRESS` trong
Render secrets, kiểm tra `/health` trả `ok=true`.

### Thứ tự deploy

1. Deploy contract mainnet (owner = Safe, verifier = địa chỉ verifier mới) →
   verify source trên BscScan.
2. Deploy verifier lên Render, kiểm tra `/health`.
3. Sửa `frontend/config.js`, deploy lên Vercel, kiểm tra trang live.
4. Công bố: X + Binance Square + skill prompt.

## Checklist go-live

- [ ] forge test pass 100%, Slither không cảnh báo High
- [ ] Contract verified trên BscScan, owner = Safe, verifier đúng
- [ ] `frontend/abi.json` đã thay bằng ABI thật từ forge build
- [ ] Verifier `/health` trả ok, `signerReady` + `rpcReady` = true
- [ ] Verifier `/scan` trả đúng danh sách approval của ví test (đối chiếu BscScan)
- [ ] Frontend live trên Vercel, `config.js` chứa đúng địa chỉ contract + verifier URL
- [ ] 1 lần quét + revoke thật end-to-end trên mainnet bằng Agentic Wallet
- [ ] Hygiene Score của ví test tính đúng (S1–S7 trong SPEC §11.2)
- [ ] README ghi bảng quyền owner + công thức điểm công khai

## Tuân thủ & cảnh báo (FR-11, FR-12)

- Hygiene Score chỉ phản ánh trạng thái approval tại thời điểm quét, dựa trên
  dữ liệu công khai. Điểm này **không phải bảo chứng an toàn tuyệt đối và
  không phải tư vấn đầu tư**.
- Không có phần thưởng tài chính dưới bất kỳ hình thức nào: không hứa lợi
  nhuận, không phát token, không airdrop, không thưởng tiền mặt. Badge chỉ là
  NFT soulbound ghi nhận band điểm, không có giá trị tiền tệ.
- Frontend chỉ dùng injected provider EIP-1193 trong trình duyệt dApp của
  Binance App. Không WalletConnect, không QR, không pairing code.
- Frontend chỉ tạo `approve(spender, 0)` để revoke, không bao giờ tạo approve
  với giá trị > 0. Không thu seed phrase, private key, API secret.
- Hồ sơ chỉ hiển thị ví đang kết nối. Không có tra cứu theo tên .ai để xem
  tài sản người khác. Leaderboard chỉ hiện tên .ai + điểm.

## Câu hỏi mở

| # | Nội dung | Trạng thái |
| --- | --- | --- |
| Q1 | BscScan API key — dùng chung key của SafeStreak hay key riêng? | Mở — Dũng cung cấp. Fallback khi chưa có key: spender ghi "chưa rõ", không trừ điểm cờ chưa-verify |
| Q2 | Team khác nộp AgentAllowance gồm những ai? | Mở — Dũng quyết định |
| Q3 | Tên repo GitHub chính thức | Mở — đề xuất `agentallowance`, Dũng chốt trước khi tạo repo 21/11 |
| Q4 | Địa chỉ contract AgentAllowance / Badge sau deploy mainnet | TBD |
| Q5 | URL verifier sau deploy Render | TBD |
| Q6 | URL frontend sau deploy Vercel | TBD |
