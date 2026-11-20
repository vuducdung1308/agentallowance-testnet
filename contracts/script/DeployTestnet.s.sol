// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockAgentID} from "../test/MockAgentID.sol";
import {MockERC20} from "../test/MockERC20.sol";
import {AgentAllowance} from "../src/AgentAllowance.sol";
import {Badge} from "../src/Badge.sol";

/// @notice Deploy trial TRÊN BSC TESTNET (chain 97) — chạy 1 lần duy nhất.
/// Deployer giữ cả 3 vai (owner/verifier) giống trial SafeStreak testnet.
/// Mainnet KHÔNG làm thế này: owner = Safe 2-of-3, verifier riêng.
/// Env bắt buộc: PRIVATE_KEY (qua --private-key).
/// Sau deploy, verifier chạy local với VERIFIER_PRIVATE_KEY = cùng key này (chỉ testnet).
contract DeployTestnet is Script {
    // Spender EOA cố tình chưa verify: verifier xếp false (không có code)
    // mà KHÔNG cần BscScan API key -> cờ UNLIMITED_APPROVE_UNVERIFIED (-15) kích hoạt được.
    address internal constant TEST_SPENDER = 0x000000000000000000000000000000000000dEaD;

    function run() external {
        vm.startBroadcast();
        address deployer = msg.sender;

        MockAgentID mockId = new MockAgentID();
        mockId.mint(deployer, "agentallowance.test");

        MockERC20 token = new MockERC20();
        token.mint(deployer, 1_000_000 ether);

        Badge badge = new Badge(deployer);
        AgentAllowance aa = new AgentAllowance(address(mockId), deployer, deployer);

        badge.setAgentAllowance(address(aa));
        aa.setBadge(address(badge));

        // Tạo 1 approval unlimited thật để verifier quét thấy cờ -15.
        token.approve(TEST_SPENDER, type(uint256).max);

        vm.stopBroadcast();

        console.log("MockAgentID:     ", address(mockId));
        console.log("MockERC20 (MTT): ", address(token));
        console.log("Badge:           ", address(badge));
        console.log("AgentAllowance:  ", address(aa));
        console.log("Deployer/Owner:  ", deployer);
        console.log("Test spender:    ", TEST_SPENDER);
    }
}
