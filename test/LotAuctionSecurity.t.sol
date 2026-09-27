// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionTestBase} from "./helpers/AuctionTestBase.sol";
import {FeeToken, HostileToken, NoReturnToken, MockToken} from "./helpers/Tokens.sol";
import {LotAuction} from "../src/LotAuction.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract LotAuctionSecurityTest is AuctionTestBase {
    function testFeeOnTransferLotRecordsNetDeltaAndPaysNetOfOutgoingFee() public {
        FeeToken fee = new FeeToken(1000);
        fee.mint(SELLER, 100 ether);
        fee.mint(address(auction), 7 ether); // An unsolicited transfer is not part of this lot.
        vm.startPrank(SELLER);
        fee.approve(address(auction), 100 ether);
        uint256 id = auction.createLot(address(fee), 100 ether, RESERVE, 1 hours);
        vm.stopPrank();
        assertEq(auction.lot(id).lotAmount, 90 ether);
        assertEq(fee.balanceOf(address(auction)), 97 ether);
        _bid(id, ALICE, RESERVE);
        vm.warp(auction.lot(id).end);
        auction.settle(id);
        vm.prank(ALICE);
        auction.claimLot(id);
        assertEq(fee.balanceOf(ALICE), 81 ether);
        assertEq(fee.balanceOf(address(auction)), 7 ether);
        _assertSolvent();
    }

    function testZeroNetReceivedRevertsEntireDeposit() public {
        FeeToken fee = new FeeToken(10_000);
        fee.mint(SELLER, 100 ether);
        vm.startPrank(SELLER);
        fee.approve(address(auction), 100 ether);
        vm.expectRevert(LotAuction.NoTokensReceived.selector);
        auction.createLot(address(fee), 100 ether, RESERVE, 1 hours);
        vm.stopPrank();
        assertEq(auction.lotCount(), 0);
        assertEq(fee.balanceOf(SELLER), 100 ether);
        assertEq(fee.allowance(SELLER, address(auction)), 100 ether);
    }

    function testNoReturnTokenSupportsDepositAndClaim() public {
        NoReturnToken oldToken = new NoReturnToken();
        oldToken.mint(SELLER, LOT_AMOUNT);
        vm.startPrank(SELLER);
        oldToken.approve(address(auction), LOT_AMOUNT);
        uint256 id = auction.createLot(address(oldToken), LOT_AMOUNT, RESERVE, 1 hours);
        auction.cancel(id);
        auction.claimLot(id);
        vm.stopPrank();
        assertEq(oldToken.balanceOf(SELLER), LOT_AMOUNT);
        assertEq(oldToken.balanceOf(address(auction)), 0);
    }

    function testFalseReturnDepositReverts() public {
        HostileToken bad = _hostile();
        bad.configureTransfers(false, true);
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        auction.createLot(address(bad), LOT_AMOUNT, RESERVE, 1 hours);
        assertEq(auction.lotCount(), 0);
        assertEq(bad.balanceOf(address(auction)), 0);
    }

    function testRevertingLotCannotBlockSettlementOrOtherUsersAndClaimCanRetry() public {
        HostileToken bad = _hostile();
        vm.prank(SELLER);
        uint256 id = auction.createLot(address(bad), LOT_AMOUNT, RESERVE, 1 hours);
        uint256 healthy = _create();
        _bid(id, ALICE, RESERVE);
        _bid(healthy, BOB, RESERVE);
        bad.configureTransfers(true, false);
        vm.warp(auction.lot(id).end);
        auction.settle(id);
        auction.settle(healthy);
        vm.prank(ALICE);
        vm.expectRevert(HostileToken.TransferBlocked.selector);
        auction.claimLot(id);
        assertFalse(auction.lot(id).claimed);
        assertEq(auction.lot(id).claimant, ALICE);
        vm.prank(BOB);
        auction.claimLot(healthy);
        vm.prank(SELLER);
        auction.withdraw();
        assertEq(gavl.balanceOf(address(auction)), 0);
        assertEq(bad.balanceOf(address(auction)), LOT_AMOUNT);
        bad.configureTransfers(false, false);
        vm.prank(ALICE);
        auction.claimLot(id);
        assertEq(bad.balanceOf(ALICE), LOT_AMOUNT);
        assertTrue(auction.lot(id).claimed);
        _assertSolvent();
    }

    function testFalseReturnClaimPreservesClaimUntilRetry() public {
        HostileToken bad = _hostile();
        vm.startPrank(SELLER);
        uint256 id = auction.createLot(address(bad), LOT_AMOUNT, RESERVE, 1 hours);
        auction.cancel(id);
        vm.stopPrank();
        bad.configureTransfers(false, true);
        vm.prank(SELLER);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        auction.claimLot(id);
        assertFalse(auction.lot(id).claimed);
        bad.configureTransfers(false, false);
        vm.prank(SELLER);
        auction.claimLot(id);
        assertTrue(auction.lot(id).claimed);
    }

    function testEveryMutatorRejectsReentryDuringDeposit() public {
        HostileToken bad = _hostile();
        bytes[6] memory calls = _callbacks(1, address(bad));
        for (uint256 i; i < calls.length; ++i) {
            bad.configureCallback(address(auction), calls[i], false);
            vm.prank(SELLER);
            uint256 id = auction.createLot(address(bad), 1 ether, RESERVE, 1 hours);
            _assertCallbackBlocked(bad);
            assertEq(id, i + 1);
            assertEq(auction.lot(id).lotAmount, 1 ether);
            _assertSolvent();
        }
    }

    function testEveryMutatorRejectsReentryDuringClaim() public {
        HostileToken bad = _hostile();
        for (uint256 i; i < 6; ++i) {
            bad.configureCallback(address(0), "", false);
            vm.startPrank(SELLER);
            uint256 id = auction.createLot(address(bad), 1 ether, RESERVE, 1 hours);
            auction.cancel(id);
            vm.stopPrank();
            bytes[6] memory calls = _callbacks(id, address(bad));
            bad.configureCallback(address(auction), calls[i], false);
            vm.prank(SELLER);
            auction.claimLot(id);
            _assertCallbackBlocked(bad);
            assertTrue(auction.lot(id).claimed);
            assertEq(bad.balanceOf(address(auction)), 0);
            _assertSolvent();
        }
    }

    function testBubblingCallbackFailureRollsBackAndGuardRecovers() public {
        HostileToken bad = _hostile();
        bad.configureCallback(address(auction), abi.encodeCall(auction.withdraw, ()), true);
        vm.prank(SELLER);
        vm.expectRevert(HostileToken.CallbackFailed.selector);
        auction.createLot(address(bad), LOT_AMOUNT, RESERVE, 1 hours);
        assertEq(auction.lotCount(), 0);
        assertEq(bad.balanceOf(address(auction)), 0);
        bad.configureCallback(address(0), "", false);
        vm.prank(SELLER);
        uint256 id = auction.createLot(address(bad), LOT_AMOUNT, RESERVE, 1 hours);
        assertEq(id, 1);
    }

    function testCallbackCurrencyCannotReenterBidOrWithdrawal() public {
        // Production uses LaunchToken. A callback currency exercises the payout guard independently.
        HostileToken currency = new HostileToken();
        LotAuction other = _currencyAuction(currency);
        currency.configureCallback(address(other), abi.encodeCall(other.withdraw, ()), false);
        vm.prank(ALICE);
        other.bid(1, RESERVE);
        _assertCallbackBlocked(currency);
        vm.prank(BOB);
        other.bid(1, 11 ether);
        _assertCallbackBlocked(currency);
        assertEq(other.withdrawable(ALICE), RESERVE);
        currency.configureCallback(address(other), abi.encodeCall(other.withdraw, ()), false);
        uint256 before = currency.balanceOf(ALICE);
        vm.prank(ALICE);
        other.withdraw();
        _assertCallbackBlocked(currency);
        assertEq(currency.balanceOf(ALICE), before + RESERVE);
        assertEq(other.withdrawable(ALICE), 0);
        assertEq(other.totalWithdrawable(), 0);
        assertEq(currency.balanceOf(address(other)), 11 ether);
    }

    function testWithdrawalFailurePreservesCreditAndCanRetry() public {
        HostileToken currency = new HostileToken();
        LotAuction other = _currencyAuction(currency);
        vm.prank(ALICE);
        other.bid(1, RESERVE);
        vm.prank(BOB);
        other.bid(1, 11 ether);
        currency.configureTransfers(false, true);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(currency)));
        other.withdraw();
        assertEq(other.withdrawable(ALICE), RESERVE);
        assertEq(other.totalWithdrawable(), RESERVE);
        assertEq(currency.balanceOf(address(other)), 21 ether);
        currency.configureTransfers(false, false);
        vm.prank(ALICE);
        other.withdraw();
        assertEq(other.withdrawable(ALICE), 0);
        assertEq(currency.balanceOf(address(other)), 11 ether);
    }

    function testMisconfiguredTaxedBidCurrencyCannotCreateUnfundedLiability() public {
        FeeToken currency = new FeeToken(1000);
        LotAuction other = new LotAuction(address(currency));
        currency.mint(ALICE, 100 ether);
        vm.startPrank(SELLER);
        asset.approve(address(other), LOT_AMOUNT);
        other.createLot(address(asset), LOT_AMOUNT, RESERVE, 1 hours);
        vm.stopPrank();
        vm.startPrank(ALICE);
        currency.approve(address(other), 100 ether);
        vm.expectRevert(LotAuction.InexactBidReceipt.selector);
        other.bid(1, RESERVE);
        vm.stopPrank();
        assertEq(other.totalBidEscrow(), 0);
        assertEq(other.lot(1).highestBidder, address(0));
        assertEq(currency.balanceOf(address(other)), 0);
        assertEq(currency.balanceOf(ALICE), 100 ether);
    }

    function _hostile() private returns (HostileToken bad) {
        bad = new HostileToken();
        bad.mint(SELLER, 1000 ether);
        vm.prank(SELLER);
        bad.approve(address(auction), type(uint256).max);
    }

    function _assertCallbackBlocked(HostileToken bad) private view {
        assertTrue(bad.callbackAttempted());
        assertFalse(bad.callbackSucceeded());
        assertEq(bad.callbackResult(), abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
    }

    function _callbacks(uint256 id, address lotToken) private view returns (bytes[6] memory) {
        return [
            abi.encodeCall(auction.createLot, (lotToken, 1, RESERVE, 1 hours)),
            abi.encodeCall(auction.bid, (id, RESERVE)),
            abi.encodeCall(auction.cancel, (id)),
            abi.encodeCall(auction.settle, (id)),
            abi.encodeCall(auction.claimLot, (id)),
            abi.encodeCall(auction.withdraw, ())
        ];
    }

    function _currencyAuction(HostileToken currency) private returns (LotAuction other) {
        other = new LotAuction(address(currency));
        currency.mint(ALICE, 100 ether);
        currency.mint(BOB, 100 ether);
        vm.prank(ALICE);
        currency.approve(address(other), type(uint256).max);
        vm.prank(BOB);
        currency.approve(address(other), type(uint256).max);
        vm.startPrank(SELLER);
        asset.approve(address(other), LOT_AMOUNT);
        other.createLot(address(asset), LOT_AMOUNT, RESERVE, 1 hours);
        vm.stopPrank();
    }
}
