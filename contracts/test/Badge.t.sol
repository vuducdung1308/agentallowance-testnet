// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Badge} from "../src/Badge.sol";

/// @notice Test Badge soulbound theo SPEC §3.8 + §11.1 (T10, T11).
contract BadgeTest is Test {
    Badge internal badge;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    event BadgeMinted(address indexed agent, uint256 indexed tokenId, uint8 tier);
    event BadgeTierUpdated(address indexed agent, uint256 indexed tokenId, uint8 oldTier, uint8 newTier);

    function setUp() public {
        badge = new Badge(owner);
        // Test contract đóng vai AgentAllowance để gọi mintOrUpdateTier trực tiếp.
        vm.prank(owner);
        badge.setAgentAllowance(address(this));
    }

    function test_bands() public {
        assertEq(badge.tierForScore(0), 0);
        assertEq(badge.tierForScore(49), 0);
        assertEq(badge.tierForScore(50), 1); // Bronze
        assertEq(badge.tierForScore(69), 1);
        assertEq(badge.tierForScore(70), 2); // Silver
        assertEq(badge.tierForScore(89), 2);
        assertEq(badge.tierForScore(90), 3); // Gold
        assertEq(badge.tierForScore(100), 3);
    }

    function test_below50NoMint() public {
        badge.mintOrUpdateTier(alice, 40);
        assertEq(badge.tierOf(alice), 0);
        assertEq(badge.tokenIdOf(alice), 0);
        assertEq(badge.balanceOf(alice), 0);
    }

    function test_mintBronzeThenUpgrade() public {
        vm.expectEmit(true, true, false, true, address(badge));
        emit BadgeMinted(alice, 1, 1);
        badge.mintOrUpdateTier(alice, 55);
        assertEq(badge.tierOf(alice), 1);
        assertEq(badge.tokenIdOf(alice), 1);
        assertEq(badge.balanceOf(alice), 1);
        assertEq(badge.ownerOf(1), alice);

        vm.expectEmit(true, true, false, true, address(badge));
        emit BadgeTierUpdated(alice, 1, 1, 2);
        badge.mintOrUpdateTier(alice, 75);
        assertEq(badge.tierOf(alice), 2);
        assertEq(badge.tokenIdOf(alice), 1); // 1 ví tối đa 1 badge, cùng tokenId

        badge.mintOrUpdateTier(alice, 95);
        assertEq(badge.tierOf(alice), 3);
        assertEq(badge.tokenIdOf(alice), 1);
    }

    function test_keepTierBelow50() public {
        badge.mintOrUpdateTier(alice, 95);
        assertEq(badge.tierOf(alice), 3);
        // Điểm tụt dưới 50: giữ nguyên Gold, không đốt.
        badge.mintOrUpdateTier(alice, 40);
        assertEq(badge.tierOf(alice), 3);
        assertEq(badge.tokenIdOf(alice), 1);
        assertEq(badge.balanceOf(alice), 1);
    }

    function test_sameBandNoEvent() public {
        badge.mintOrUpdateTier(alice, 55);
        vm.recordLogs();
        badge.mintOrUpdateTier(alice, 60); // vẫn Bronze: không phát event
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_transferAlwaysReverts() public {
        badge.mintOrUpdateTier(alice, 95);
        uint256 tokenId = badge.tokenIdOf(alice);

        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.transferFrom(alice, bob, tokenId);

        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.safeTransferFrom(alice, bob, tokenId);

        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.safeTransferFrom(alice, bob, tokenId, "");

        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.approve(bob, tokenId);

        vm.prank(alice);
        vm.expectRevert(Badge.Soulbound.selector);
        badge.setApprovalForAll(bob, true);
    }

    function test_mintOnlyAgentAllowanceOrOwner() public {
        vm.prank(alice);
        vm.expectRevert(Badge.NotAuthorized.selector);
        badge.mintOrUpdateTier(alice, 95);

        // Owner được gọi (sửa chữa thủ công).
        vm.prank(owner);
        badge.mintOrUpdateTier(bob, 80);
        assertEq(badge.tierOf(bob), 2);
    }

    function test_setAgentAllowanceOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(Badge.NotOwner.selector);
        badge.setAgentAllowance(alice);

        vm.prank(owner);
        vm.expectRevert(Badge.ZeroAddress.selector);
        badge.setAgentAllowance(address(0));
    }

    function test_constructorZeroOwner() public {
        vm.expectRevert(Badge.ZeroAddress.selector);
        new Badge(address(0));
    }

    function test_nameSymbol() public view {
        assertEq(badge.name(), "AgentAllowance Badge");
        assertEq(badge.symbol(), "AAB");
    }
}
