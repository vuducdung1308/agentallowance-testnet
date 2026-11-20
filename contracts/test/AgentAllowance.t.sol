// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentAllowance} from "../src/AgentAllowance.sol";
import {Badge} from "../src/Badge.sol";
import {MockAgentID} from "./MockAgentID.sol";

/// @notice Test AgentAllowance theo SPEC §11.1 (T1–T12).
/// @dev Khóa verifier dùng trong test là khóa test công khai của Anvil (account #0),
/// không phải khóa thật. ChainId đặt 56 để khớp domain EIP-712 mainnet.
contract AgentAllowanceTest is Test {
    // Khóa test công khai của Anvil account #0 (0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266).
    uint256 internal constant VERIFIER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f3ff80;

    // Kỳ tính điểm 18/11/2026 08:00 UTC → 09/12/2026 08:00 UTC.
    uint64 internal constant PERIOD_START = 1794988800;
    uint64 internal constant PERIOD_END = 1796803200;

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant SCORE_TYPEHASH = keccak256(
        "ScoreAttestation(address agent,uint256 score,uint64 periodStart,uint64 periodEnd,uint256 nonce,uint64 deadline)"
    );

    MockAgentID internal mockId;
    AgentAllowance internal aa;
    Badge internal badge;

    address internal owner = makeAddr("owner");
    address internal verifierAddr = vm.addr(VERIFIER_PK);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal noId = makeAddr("noId");

    event ScoreAttested(
        address indexed agent, uint256 score, uint64 periodStart, uint64 periodEnd, address verifier
    );
    event BadgeMinted(address indexed agent, uint256 indexed tokenId, uint8 tier);
    event BadgeTierUpdated(address indexed agent, uint256 indexed tokenId, uint8 oldTier, uint8 newTier);

    function setUp() public {
        vm.chainId(56); // domain EIP-712 dùng chainId 56 (BSC mainnet)
        mockId = new MockAgentID();
        aa = new AgentAllowance(address(mockId), owner, verifierAddr);
        badge = new Badge(owner);

        // Nối Badge <-> AgentAllowance (quyền owner).
        vm.prank(owner);
        aa.setBadge(address(badge));
        vm.prank(owner);
        badge.setAgentAllowance(address(aa));

        mockId.mint(alice, "alice.ai");
        mockId.mint(bob, "bob.ai");
        // noId cố tình không mint Agent ID.
    }

    // --- Helper: ký EIP-712 ScoreAttestation bằng khóa verifier ---

    function _sign(address agent, uint256 score, uint64 ps, uint64 pe, uint256 nonce, uint64 deadline)
        internal
        returns (bytes memory)
    {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("AgentAllowance")),
                keccak256(bytes("1")),
                block.chainid,
                address(aa)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(SCORE_TYPEHASH, agent, score, ps, pe, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attest(address caller, address agent, uint256 score, uint256 nonce, uint64 deadline) internal {
        bytes memory sig = _sign(agent, score, PERIOD_START, PERIOD_END, nonce, deadline);
        vm.prank(caller);
        aa.attestScore(agent, score, PERIOD_START, PERIOD_END, nonce, deadline, sig);
    }

    // --- T1: attest đúng, score = 87 ---

    function test_T1_attestOk() public {
        vm.expectEmit(true, false, false, true, address(aa));
        emit ScoreAttested(alice, 87, PERIOD_START, PERIOD_END, verifierAddr);
        _attest(alice, alice, 87, 0, uint64(block.timestamp + 15 minutes));

        AgentAllowance.ScoreAttestation memory s = aa.getScore(alice);
        assertEq(s.score, 87);
        assertEq(s.agent, alice);
        assertEq(s.periodStart, PERIOD_START);
        assertEq(s.periodEnd, PERIOD_END);
        assertEq(s.verifier, verifierAddr);
        assertGt(s.attestedAt, 0);

        (, , uint256 latestScore, , uint256 totalAttestations) = aa.profiles(alice);
        assertEq(latestScore, 87);
        assertEq(totalAttestations, 1);
        assertEq(aa.totalAgents(), 1);
        assertEq(aa.nonces(alice), 1);
    }

    // --- T2: chữ ký sai (ký bằng khóa khác) -> BadSignature ---

    function test_T2_badSignature() public {
        uint256 otherPk = 0xdeadbeef;
        bytes32 domainSeparator = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("AgentAllowance")),
                keccak256(bytes("1")),
                block.chainid,
                address(aa)
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(SCORE_TYPEHASH, alice, 87, PERIOD_START, PERIOD_END, uint256(0), uint64(block.timestamp + 900))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherPk, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        vm.prank(alice);
        vm.expectRevert(AgentAllowance.BadSignature.selector);
        aa.attestScore(alice, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 900), sig);
    }

    // --- T3: nonce dùng lại -> BadNonce ---

    function test_T3_nonceReuse() public {
        _attest(alice, alice, 87, 0, uint64(block.timestamp + 15 minutes));
        // Ký lại đúng nonce 0 (đã dùng) -> revert.
        bytes memory sig = _sign(alice, 90, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.BadNonce.selector);
        aa.attestScore(alice, 90, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);
    }

    // --- T4: deadline hết hạn -> Expired ---

    function test_T4_expiredDeadline() public {
        uint64 deadline = uint64(block.timestamp - 1);
        bytes memory sig = _sign(alice, 87, PERIOD_START, PERIOD_END, 0, deadline);
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.Expired.selector);
        aa.attestScore(alice, 87, PERIOD_START, PERIOD_END, 0, deadline, sig);
    }

    // --- T5: ví không có Agent ID -> NotAgentId ---

    function test_T5_noAgentId() public {
        bytes memory sig = _sign(noId, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(noId);
        vm.expectRevert(AgentAllowance.NotAgentId.selector);
        aa.attestScore(noId, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);
    }

    /// @notice Người khác (không Agent ID) gửi attest hộ ví có Agent ID cũng revert (BRD FR-01).
    function test_T5b_callerWithoutAgentId() public {
        bytes memory sig = _sign(alice, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(noId);
        vm.expectRevert(AgentAllowance.NotAgentId.selector);
        aa.attestScore(alice, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);
    }

    // --- T6: setVerifier từ ví không phải owner -> NotOwner ---

    function test_T6_setVerifierNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.NotOwner.selector);
        aa.setVerifier(makeAddr("newVerifier"));
    }

    function test_T6b_setBadgeNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.NotOwner.selector);
        aa.setBadge(makeAddr("newBadge"));
    }

    function test_T6c_setVerifierZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(AgentAllowance.ZeroAddress.selector);
        aa.setVerifier(address(0));
    }

    // --- T7: pause chặn attest, unpause thì attest được ---

    function test_T7_pauseBlocksAttest() public {
        vm.prank(owner);
        aa.pause();
        assertTrue(aa.paused());

        bytes memory sig = _sign(alice, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.Paused.selector);
        aa.attestScore(alice, 87, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);

        vm.prank(owner);
        aa.unpause();
        assertFalse(aa.paused());
        _attest(alice, alice, 87, 0, uint64(block.timestamp + 15 minutes));
        assertEq(aa.getScore(alice).score, 87);
    }

    function test_T7b_pauseNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.NotOwner.selector);
        aa.pause();
    }

    // --- T8: score = 101 -> InvalidScore ---

    function test_T8_score101() public {
        bytes memory sig = _sign(alice, 101, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.InvalidScore.selector);
        aa.attestScore(alice, 101, PERIOD_START, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);
    }

    function test_T8b_invalidPeriod() public {
        bytes memory sig = _sign(alice, 87, PERIOD_END, PERIOD_END, 0, uint64(block.timestamp + 15 minutes));
        vm.prank(alice);
        vm.expectRevert(AgentAllowance.InvalidPeriod.selector);
        aa.attestScore(alice, 87, PERIOD_END, PERIOD_END, 0, uint64(block.timestamp + 15 minutes), sig);
    }

    // --- T9: gửi BNB vào contract -> revert (không payable) ---

    function test_T9_sendBnbReverts() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(aa).call{value: 0.01 ether}("");
        assertFalse(ok, "contract phai tu choi BNB");
        vm.deal(address(this), 1 ether);
        (bool okBadge,) = address(badge).call{value: 0.01 ether}("");
        assertFalse(okBadge, "badge phai tu choi BNB");
    }

    // --- T10: badge tier đúng band + đổi band + giữ tier khi < 50 ---

    function test_T10_badgeTiers() public {
        // 55 -> Bronze (tier 1)
        _attest(alice, alice, 55, 0, uint64(block.timestamp + 15 minutes));
        assertEq(badge.tierOf(alice), 1);
        assertGt(badge.tokenIdOf(alice), 0);
        uint256 tokenId = badge.tokenIdOf(alice);

        // 75 -> Silver (tier 2), cùng tokenId
        _attest(alice, alice, 75, 1, uint64(block.timestamp + 15 minutes));
        assertEq(badge.tierOf(alice), 2);
        assertEq(badge.tokenIdOf(alice), tokenId);

        // 95 -> Gold (tier 3)
        _attest(alice, alice, 95, 2, uint64(block.timestamp + 15 minutes));
        assertEq(badge.tierOf(alice), 3);
        assertEq(badge.tokenIdOf(alice), tokenId);

        // 40 -> KHÔNG đốt: giữ nguyên Gold
        _attest(alice, alice, 40, 3, uint64(block.timestamp + 15 minutes));
        assertEq(badge.tierOf(alice), 3);
        assertEq(badge.tokenIdOf(alice), tokenId);
    }

    function test_T10b_noBadgeBelow50() public {
        _attest(bob, bob, 40, 0, uint64(block.timestamp + 15 minutes));
        assertEq(badge.tierOf(bob), 0);
        assertEq(badge.tokenIdOf(bob), 0);
    }

    // --- T11: badge không chuyển nhượng (xem Badge.t.sol cho bộ đầy đủ) ---

    function test_T11_badgeNotTransferable() public {
        _attest(alice, alice, 95, 0, uint64(block.timestamp + 15 minutes));
        uint256 tokenId = badge.tokenIdOf(alice);
        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.transferFrom(alice, bob, tokenId);
    }

    // --- T12: attest lần 2 cùng ví: totalAgents không tăng, totalAttestations = 2 ---

    function test_T12_secondAttestSameWallet() public {
        _attest(alice, alice, 87, 0, uint64(block.timestamp + 15 minutes));
        _attest(alice, alice, 92, 1, uint64(block.timestamp + 15 minutes));
        assertEq(aa.totalAgents(), 1);
        (, , , , uint256 totalAttestations) = aa.profiles(alice);
        assertEq(totalAttestations, 2);
        assertEq(aa.getScore(alice).score, 92);
    }

    // --- Bổ sung: view ---

    function test_getScoreEmptyForUnattested() public view {
        AgentAllowance.ScoreAttestation memory s = aa.getScore(noId);
        assertEq(s.score, 0);
        assertEq(s.attestedAt, 0);
    }

    function test_handleOf() public view {
        assertEq(aa.handleOf(alice), "alice.ai");
        assertEq(aa.handleOf(noId), "");
    }

    function test_setVerifierWorks() public {
        address newVerifier = makeAddr("newVerifier");
        vm.prank(owner);
        aa.setVerifier(newVerifier);
        assertEq(aa.verifier(), newVerifier);
    }
}
