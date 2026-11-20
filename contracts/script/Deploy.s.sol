// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentAllowance} from "../src/AgentAllowance.sol";
import {Badge} from "../src/Badge.sol";

/// @notice Deploy AgentAllowance + Badge.
/// Env bắt buộc: AGENT_ID, OWNER, VERIFIER.
/// Ví dụ (mainnet): AGENT_ID=0x60b9262456de011f7d15a54cdd8c48baaa8b022f
///   OWNER=0x4B49e3ec5DA3A4152033e85C932401c475056dAa (Safe 2-of-3 dùng lại của SafeStreak)
///   VERIFIER=<địa chỉ ví verifier>
/// @dev Badge deploy trước, owner của Badge = OWNER (Safe). Sau deploy, Safe phải gọi
/// 2 giao dịch (deployer KHÔNG tự gọi được vì không phải owner):
///   1) Badge.setAgentAllowance(<AgentAllowance>)
///   2) AgentAllowance.setBadge(<Badge>)
/// Sau đó verify source trên BscScan (cần BscScan API key).
contract Deploy is Script {
    function run() external {
        address agentId = vm.envAddress("AGENT_ID");
        address owner = vm.envAddress("OWNER");
        address verifier = vm.envAddress("VERIFIER");

        vm.startBroadcast();
        Badge badge = new Badge(owner);
        AgentAllowance aa = new AgentAllowance(agentId, owner, verifier);
        vm.stopBroadcast();

        console.log("Badge:          ", address(badge));
        console.log("AgentAllowance: ", address(aa));
        console.log("Agent ID:       ", agentId);
        console.log("Owner (Safe):   ", owner);
        console.log("Verifier:       ", verifier);
        console.log("---");
        console.log("SAU DEPLOY, Safe owner phai goi 2 giao dich:");
        console.log("  1) Badge.setAgentAllowance(<AgentAllowance>)");
        console.log("  2) AgentAllowance.setBadge(<Badge>)");
    }
}
