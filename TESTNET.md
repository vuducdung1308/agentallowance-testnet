# AgentAllowance — Testnet Trial (BSC testnet, chain 97)

Deploy tối 2026-11-20 (sớm hơn kế hoạch 25/11, theo quyết định của Dũng).
Trial only — deployer giữ cả 3 vai (owner/verifier), khác mainnet (Safe 2-of-3 + verifier riêng).

## Địa chỉ (chain 97)

| Contract | Địa chỉ |
| --- | --- |
| MockAgentID | 0x245201A41FA4849eB0D38DdE3b6490f9555599d5 |
| MockERC20 (MTT) | 0x6698bA989e76AF912EdB68406c903Db9480896D8 |
| Badge | 0xb4ea93C12e2A3a0045f8B40957212AdE8F625ebF |
| AgentAllowance | 0xB71763d4B3697ba237955809a8F13f6f312Ef0E4 |
| Deployer / Owner / Verifier | 0xBf8B6D020C7f74F3B4bFeE3cBD84649ee936b9Ab (ví test SafeStreak, key trong safestreak/hidden_files/) |
| Test spender (EOA) | 0x000000000000000000000000000000000000dEaD |

## Đã verify on-chain (2026-11-20)

- MockAgentID `balanceOf(deployer)` = 1, handle `agentallowance.test`.
- AgentAllowance: owner = verifier = deployer, AGENT_ID = MockAgentID, badge = Badge.
- Badge: agentAllowance = AgentAllowance.
- MockERC20 `allowance(deployer, 0xdEaD…)` = 2^256 − 1 (unlimited).
- Deployer còn 0,6993 tBNB sau deploy (tốn ~0,0004 tBNB).

## Giao dịch (thứ tự theo script DeployTestnet.s.sol)

| # | Loại | Tx hash |
| --- | --- | --- |
| 1 | CREATE MockAgentID | 0xb9e4c7050abb218f40802598343ca3ee7cbe50f441a47851545771cf17e2fc07 |
| 2 | CALL mint(deployer, "agentallowance.test") | 0xb479b8ee7e1383332facf4d47ceb3ea21950f1f07431b8bc29a328326340effe |
| 3 | CREATE MockERC20 | 0x0008cfc73ac9ef1dc66b5a185ad07db98b79ab8d5928b7db46580a0867d356cf |
| 4 | CALL mint(deployer, 1.000.000 MTT) | 0x3b62d0be54c51e509e721350ffe57d82943ebb169f358e6489910e39eb853b99 |
| 5 | CREATE Badge | 0xf8fafa08e18ad55004b92333274d9c38110e26cdec978674a79430c920f1b4b7 |
| 6 | CREATE AgentAllowance | 0xd53c052dd81f7a7fa9e5bb528b6f2b413fbc4f6b4bbd901a3f7410144cc335ea |
| 7 | CALL Badge.setAgentAllowance | 0x00fafb7eaefa172faa994649d796cb046851f773faa99700c5efe0e4be99a03b |
| 8 | CALL AgentAllowance.setBadge | 0x72687bbe386bad755ff0d8c65d2a2cc9f0d386c7ab429903d9c2414f11524850 |
| 9 | CALL approve(0xdEaD…, max) | 0x0d4a69a0409d335cc56251f6d33befeb694e5847b98132a4c8622b919ee51eab |

## Lưu ý deploy

- Lỗi gặp: testnet RPC yêu cầu gas tip tối thiểu 0,1 gwei; forge ước tính tip 1 wei nên broadcast lỗi `gas tip cap 1, minimum needed 100000000`. `--resume` giữ lại tx cũ nên không sửa được. Cách sửa: `--start-fresh --legacy --gas-price 3000000000` (legacy tx, gas 3 gwei) thì deploy thành công.
- Chi tiết đầy đủ trong `contracts/broadcast/DeployTestnet.s.sol/97/run-latest.json`.

## Verifier (chạy local, chưa deploy Render)

- Env: `RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545`, `AGENT_ALLOWANCE_ADDRESS=0xB71763d4B3697ba237955809a8F13f6f312Ef0E4`, `AGENT_ID_ADDRESS=0x245201A41FA4849eB0D38DdE3b6490f9555599d5`, `VERIFIER_PRIVATE_KEY` = key ví test (chỉ testnet), không có `BSCSCAN_API_KEY`.
- Spender test là EOA nên verifier xếp `spenderVerified=false` mà không cần key → cờ UNLIMITED_APPROVE_UNVERIFIED (−15) vẫn kích hoạt được. Spender là contract mà không có key sẽ là `unknown`, không trừ điểm (fallback BRD).
- Sửa 20/11 trong trial: `CHAIN_ID` trong `score.js` giờ đọc từ env (mặc định 56); chạy testnet với `CHAIN_ID=97` — trước đó `/health` báo sai chainId 56 và chữ ký EIP-712 sẽ sai domain trên testnet. Đã cập nhật SPEC §5.3.

### Kết quả end-to-end (đã verify on-chain, 20/11)

| Bước | Kết quả |
| --- | --- |
| Attest lần 1: điểm 85 (1 cờ unlimited → spender EOA chưa verify, −15) | Tx 0x31d0d8dc8746aacda934d858ecb02119a5b3dd94e1a1dd7c1a86b9a47da7611a, block 143857680. `getScore` = 85, `totalAgents` = 1, badge mint tự động: balance 1, `tierOf` = 2 (Silver), nonce → 1 |
| Revoke: `approve(0xdEaD…, 0)` trên MTT | Tx 0x3ba1f3a32696e933cabf98c9f5e00bb74a60f21440e39b56ed1a58178d3f50f4, block 143857760, status success, `allowance` đọc lại = 0, event Approval(value 0) đã phát |
| Attest lần 2: điểm 92 (85 + 7 cộng lại sau revoke) | Tx 0x054442dc0144b18ae2efe43f59d02c6fe477351c702751480373b468df86f8cc, block 143857788. `getScore` = 92, badge cùng 1 token nâng tier: `tierOf` = 3 (Gold), balance vẫn 1, nonce → 2 |

Chữ ký EIP-712 test bằng key verifier testnet trực tiếp (domain chainId 97, verifyingContract = AgentAllowance testnet) — contract chấp nhận, chứng tỏ domain/types khớp SPEC. Đường ký của chính verifier server (`POST /score/attest`) chưa chạy được vì bước quét bị chặn (xem dưới).

### Etherscan API key (đã có, test 20/11 — connector `custom.etherscan`)

- Key free đã kết nối và kiểm chứng bằng gọi thật: chain 1 (Ethereum) trả OK; `getsourcecode` trên chain 56 và 97 chạy được; nhưng `getLogs`, `getblocknobytime`, `balance` trên chain 56/97 đều trả `Free API access is not supported for this chain` — gói free KHÔNG phủ BSC cho các module đó.
- Endpoint V1 BscScan (`api.bscscan.com`, `api-testnet.bscscan.com`) đã chết: mainnet 301 về trang migration, testnet báo deprecated — kể cả khi có key.
- **Kết luận: key Etherscan free KHÔNG mở được đường `/scan` trên BSC.** Vẫn cần 1 key RPC đọc log miễn phí (Ankr Freemium hoặc NodeReal MegaNode) hoặc gói Etherscan trả phí.
- Tin tốt: `getsourcecode` chain 56 trả về full source đã verify cho cả 2 contract SafeStreak mainnet (SafeStreak + Badge) — BscScan hiện hiển thị cả 2 là đã verify (nhiều khả năng import từ Sourcify exact_match hôm 20/11). Helper dùng để kiểm tra: `~/workspace/custom-connectors/custom.etherscan/bin/etherscan.py` (đã test, xem `~/workspace/custom-connectors/custom.etherscan/CONNECTOR.md`).

### Ankr API key (đã có, test 20/11 — connector `custom.ankr`)

- Key tạo 20/11 qua form bảo mật (project `AgentAllowance`, gói Freemium), connector `custom.ankr`, helper `~/workspace/custom-connectors/custom.ankr/bin/ankr.py` (xem `CONNECTOR.md` cùng thư mục).
- **Đã kiểm chứng bằng gọi thật: BSC mainnet (`bsc`) OK** — `eth_blockNumber` trả `0x807c2b3`. Key hợp lệ.
- **BSC testnet CHƯA dùng được:** `bsc_testnet`, `bnb_testnet`, `bsc-testnet` đều trả HTTP 403 `API key is not allowed to access blockchain` — project chưa bật chain testnet, không phải key sai (key sai hoặc slug sai đã loại trừ vì mainnet cùng key chạy được).
- Blockscout testnet (`bsctestnet.blockscout.com/api`) thử thay thế: trả `default backend - 404`, không dùng được.
- **Cần Dũng làm:** vào Ankr dashboard (ankr.com/rpc/) → Chains List → tìm `BNB Smart Chain Testnet` → gắn/bật cho project `AgentAllowance`. Sau đó test lại bằng `python3 ~/workspace/custom-connectors/custom.ankr/bin/ankr.py rpc --chain bsc_testnet --method eth_blockNumber`.
- Bài học kỹ thuật: helper `url_with_surrogate_path_segment` của dynamic_credentials quote surrogate (`:` → `%3A`) khiến lớp egress không nhận ra token `hsurr:` và Ankr trả nginx 404 — phải đặt surrogate THÔ vào path (dấu `:` hợp lệ trong path segment). Đã ghi trong `CONNECTOR.md`.
- Khi testnet bật được: chạy proxy local `ankr.py proxy --chain bsc_testnet --port 8546`, khởi động lại verifier với `RPC_URL=http://127.0.0.1:8546 CHAIN_ID=97`, rồi test full loop qua verifier: approve lại → `/scan` kỳ vọng 85 → `/score/attest` → revoke → `/scan` kỳ vọng 92 → attest. (Lưu ý: badge sẽ hạ Gold → Silver khi attest 85 rồi lên lại Gold khi attest 92 — đúng hành vi `mintOrUpdateTier`.)

### NodeReal MegaNode (đã kiểm chứng, test 20/11 — connector `custom.nodereal` đang chờ key riêng)

- Ankr KHÔNG có testnet cho project này (Dũng xác nhận 20/11: Chains List không có testnet). NodeReal là hướng thay thế.
- Endpoint: `https://bsc-testnet.nodereal.io/v1/<key>` (testnet), `https://bsc-mainnet.nodereal.io/v1/<key>` (mainnet). 1 key dùng chung cả 2 chain. Key tạo tại nodereal.io/meganode (đăng nhập GitHub/Discord), gửi qua form bảo mật.
- **Đã kiểm chứng bằng key công khai trong tài liệu NodeReal** (`e9a36765…`, chỉ dùng để test, giới hạn 2000 CU/phút/IP): `eth_blockNumber` OK; `eth_getLogs` trả đúng 2 event Approval của ví test (approve max tx 0x0d4a69a0… + approve 0 tx 0x3ba1f3a3…). Blockscout testnet API thử thay thế trả 404, không dùng được.
- **Vòng test full qua verifier server (20/11, key công khai, CHAIN_ID=97, PORT=3001, không có BSCSCAN_API_KEY → đường RPC fallback):**
  - Approve lại unlimited MTT → 0xdEaD: tx 0x0a708e383c59bf6e41e9e4cc9e47f044f3287dd2699a2e3a44cd66d972f83474, status 1.
  - `GET /scan` → score **85**, 1 approval MTT unlimited, spenderVerified false, flag UNLIMITED_APPROVE_UNVERIFIED fixed false. Mất ~6 phút (quét chunk 2000 block ngược từ latest về PERIOD_START, ~35 chunk, gọi tuần tự qua key công khai dùng chung).
  - `POST /score/attest` → ký EIP-712 điểm 85, nonce 2, deadline +15 phút. Gửi `attestScore` lên chain: tx 0x178fadf8af43ae84fea8134af5dd6ae887088b989720ad377ea82ad634ba7654, block 143864755, status 1 → latestScore = 85, nonce → 3, badge hạ Gold → **Silver** (band 70–89), balance vẫn 1.
  - Revoke approve(0): tx 0xc3ff684bd8310044636a8c74face3249308d57ca86b2eec85f68955059e3534f, status 1, allowance đọc lại = 0.
  - `GET /scan` lần 2 → score **92**, flag fixed true. `POST /score/attest` → ký điểm 92, nonce 3. Gửi lên chain: tx 0xa8f96e0fa1962d6d6af77bc97317b530307edac825ca0364dbd24005d0c60036, block 143866658, status 1 → latestScore = 92, attestedAt 1795194097, nonce → 4, badge lên lại **Gold** (tier 3), balance vẫn 1.
  - **Kết luận: đường `/scan` + `/score/attest` của verifier đã chạy end-to-end thật trên testnet.** Lưu ý: `getScore(address)` trong contract trả về struct ScoreAttestation (không phải uint256) — script gửi phải đọc `latestScore(address)` với tuple đầy đủ; lần attest 85 đọc sai ABI nên in ra số rác, trạng thái on-chain vẫn đúng.
  - Verifier local đã dừng sau test. Muốn chạy lại: xem lệnh ở mục Frontend (đổi RPC_URL sang key NodeReal riêng khi đã có).
- Còn chờ: key NodeReal riêng của Dũng (đã gửi form bảo mật 20/11) → kiểm chứng bằng gọi thật, rồi dùng cho verifier Render mainnet 26/11.

### Key NodeReal riêng (đã có, kiểm chứng 21/11 — connector `custom.nodereal`)

- Key riêng tạo 21/11 qua form bảo mật, connector `custom.nodereal`, helper `~/workspace/custom-connectors/custom.nodereal/bin/nodereal.py` (xem `CONNECTOR.md` cùng thư mục). Key dùng chung testnet + mainnet.
- **Đã kiểm chứng bằng gọi thật qua helper (21/11):** testnet `eth_blockNumber` = 0x893c2b3; mainnet `eth_blockNumber` = 0x8085f71; testnet `eth_getLogs` trả đúng 2 event Approval (approve max tx 0x0d4a69a0… block 143857175 + approve 0 tx 0x3ba1f3a3… block 143857760). Key hợp lệ, đọc được log cả 2 chain.
- Dùng cho: verifier Render mainnet 26/11 (`RPC_URL=https://bsc-mainnet.nodereal.io/v1/<key>` trong Render secret — key KHÔNG nằm trong code/repo) và script leaderboard local. Không dùng key công khai `e9a36765…` cho bản thật (dùng chung, giới hạn 2000 CU/phút/IP).

### Slither (chạy 21/11 — 0 High, 0 Medium)

- Chạy bằng Slither 0.11.6 (venv riêng, solc 0.8.24) trên `contracts/`: phân tích 4 contract, **11 kết quả, toàn mức INFO, không có High hay Medium** → đạt checklist SPEC §12.2 ("Slither không cảnh báo High").
- 11 kết quả đã xem xét, không cần sửa code trước deploy mainnet:
  - `incorrect-equality` (2): `balanceOf(...) == 0` để kiểm tra Agent ID — balance ERC-721 chỉ có 0 hoặc 1 nên `== 0` là kiểm tra đúng, không phải lỗi.
  - `reentrancy-events` (1): `mintOrUpdateTier` gọi trước event `ScoreAttested` — không rủi ro: mọi state (nonce +1, latestScore, profile) đều cập nhật TRƯỚC khi gọi; Badge là contract của mình, không chuyển ETH, không gọi ra ngoài.
  - `timestamp` (1): `block.timestamp > deadline` — kiểm tra deadline 15 phút chuẩn, miner chỉ lệch được vài giây.
  - `assembly` (1): `_recover` dùng inline assembly để ecrecover — mẫu chuẩn.
  - `missing-inheritance` (1): Badge nên kế thừa IBadge — chỉ là gợi ý thẩm mỹ.
  - `naming-convention` (1): `AGENT_ID` viết hoa — đúng quy ước cho hằng immutable, Slither báo nhầm.
  - `constable-states` (2): `Badge.name`/`symbol` nên là constant — tiết kiệm gas nhỏ.
  - `immutable-states` (2): `owner` 2 contract nên là immutable — tiết kiệm gas nhỏ.
- Quyết định: giữ nguyên code (đã test E2E trên testnet), không sửa các gợi ý thẩm mỹ/gas trước deploy mainnet để tránh phải test lại.

## Mainnet prep (21/11 — deploy thật 26/11)

- **Verifier mainnet:** `0x70326DbDE3573638E34B3c268FC89fA43c4c8FDD` — ví mới do Muse tạo 21/11 (chỉ ký EIP-712, không gửi giao dịch nên **không cần nạp tiền**). Đã kiểm chứng trên mainnet: balance 0, nonce 0, EOA mới chưa dùng. Khóa riêng CHỈ nằm trong `~/workspace/agentallowance/hidden_files/verifier-wallet.json` (0600, không nằm trong repo/chat/memory) — ngày 26/11 dán vào Render secret `VERIFIER_PRIVATE_KEY`.
- **Owner:** Safe 2-of-3 dùng lại của SafeStreak `0x4B49e3ec5DA3A4152033e85C932401c475056dAa`.
- **Deploy 26/11 (theo SPEC §12.1):** deploy contract mainnet bằng ví tạm (nạp đủ gas) → verify source trên BscScan → deploy verifier lên Render (env theo SPEC §5.3, RPC_URL = NodeReal mainnet qua key riêng) → sửa `frontend/config.js` (địa chỉ contract + verifier URL) → deploy Vercel → kiểm tra `/health` + 1 lần quét/revoke thật bằng Agentic Wallet.
- **Còn mở:** team thứ hai gồm những ai (chưa biết); ví deployer tạm mainnet chưa tạo (tạo ngày 26/11, nạp gas rồi dùng).

## Frontend (test local)

- Đã thử `config.js` testnet (chainId 97, địa chỉ testnet, verifier local): serve local, index/config/app/ảnh đều 200, JS pass. **Đã trả lại config mainnet (chain 56, TBD) ngay sau đó** — kiểm tra lại trước khi deploy Vercel.
- Verifier local đã dừng sau trial. Muốn chạy lại: `cd verifier && VERIFIER_PRIVATE_KEY=<key test> RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545 AGENT_ALLOWANCE_ADDRESS=0xB71763d4B3697ba237955809a8F13f6f312Ef0E4 AGENT_ID_ADDRESS=0x245201A41FA4849eB0D38DdE3b6490f9555599d5 CHAIN_ID=97 PORT=3001 node server.js` (thêm `BSCSCAN_API_KEY=<key>` khi đã có key).
