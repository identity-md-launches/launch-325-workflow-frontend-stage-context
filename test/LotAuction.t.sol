// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AuctionTestBase} from "./helpers/AuctionTestBase.sol";
import {LotAuction} from "../src/LotAuction.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract LotAuctionTest is AuctionTestBase {
    function testConstructorAndCreation() public {
        assertEq(address(auction.token()), address(gavl));
        assertEq(gavl.balanceOf(address(auction)), 0);
        vm.expectEmit(true, true, true, true, address(auction));
        emit LotAuction.LotCreated(1, SELLER, address(asset), LOT_AMOUNT, RESERVE, block.timestamp + 1 hours);
        uint256 id = _create();
        assertEq(id, 1);
        assertEq(auction.lotCount(), 1);
        LotAuction.Lot memory item = auction.lot(id);
        assertEq(item.seller, SELLER);
        assertEq(item.lotToken, address(asset));
        assertEq(item.lotAmount, LOT_AMOUNT);
        assertEq(item.reserve, RESERVE);
        assertEq(item.end, block.timestamp + 1 hours);
        assertEq(uint256(item.status), uint256(LotAuction.Status.Open));
        assertEq(item.claimant, address(0));
        assertFalse(item.claimed);
        assertEq(asset.balanceOf(address(auction)), LOT_AMOUNT);
        assertEq(auction.minNextBid(id), RESERVE);
    }

    function testInvalidConstructorToken() public {
        vm.expectRevert(LotAuction.InvalidToken.selector);
        new LotAuction(address(0));
        vm.expectRevert(LotAuction.InvalidToken.selector);
        new LotAuction(ALICE);
    }

    function testInvalidCreationParameters() public {
        vm.startPrank(SELLER);
        vm.expectRevert(LotAuction.InvalidToken.selector);
        auction.createLot(address(0), LOT_AMOUNT, RESERVE, 1 hours);
        vm.expectRevert(LotAuction.InvalidToken.selector);
        auction.createLot(ALICE, LOT_AMOUNT, RESERVE, 1 hours);
        vm.expectRevert(LotAuction.InvalidAmount.selector);
        auction.createLot(address(asset), 0, RESERVE, 1 hours);
        vm.expectRevert(LotAuction.InvalidReserve.selector);
        auction.createLot(address(asset), LOT_AMOUNT, 1 ether - 1, 1 hours);
        vm.expectRevert(LotAuction.InvalidDuration.selector);
        auction.createLot(address(asset), LOT_AMOUNT, RESERVE, 1 hours - 1);
        vm.expectRevert(LotAuction.InvalidDuration.selector);
        auction.createLot(address(asset), LOT_AMOUNT, RESERVE, 7 days + 1);
        vm.stopPrank();
        assertEq(auction.lotCount(), 0);
        assertEq(asset.balanceOf(address(auction)), 0);
    }

    function testInclusiveCreationBounds() public {
        vm.startPrank(SELLER);
        uint256 first = auction.createLot(address(asset), 1, 1 ether, 1 hours);
        uint256 second = auction.createLot(address(asset), 1, 1 ether, 7 days);
        vm.stopPrank();
        assertEq(auction.lot(first).end, block.timestamp + 1 hours);
        assertEq(auction.lot(second).end, block.timestamp + 7 days);
        assertEq(auction.lotCount(), 2);
    }

    function testCreationRequiresApproval() public {
        vm.prank(SELLER);
        asset.approve(address(auction), 0);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(auction), 0, LOT_AMOUNT)
        );
        _create();
        assertEq(auction.lotCount(), 0);
    }

    function testReserveAndCeilBoundaries() public {
        uint256 id = _create();
        vm.expectRevert(abi.encodeWithSelector(LotAuction.BidTooLow.selector, RESERVE));
        _bid(id, ALICE, RESERVE - 1);
        _bid(id, ALICE, RESERVE);
        assertEq(auction.minNextBid(id), 10.5 ether);
        vm.expectRevert(abi.encodeWithSelector(LotAuction.BidTooLow.selector, 10.5 ether));
        _bid(id, BOB, 10.5 ether - 1);
        _bid(id, BOB, 10.5 ether);
        assertEq(auction.withdrawable(ALICE), RESERVE);

        uint256 odd = _create();
        _bid(odd, ALICE, RESERVE + 1);
        uint256 rounded = 10.5 ether + 2;
        assertEq(auction.minNextBid(odd), rounded);
        vm.expectRevert(abi.encodeWithSelector(LotAuction.BidTooLow.selector, rounded));
        _bid(odd, BOB, rounded - 1);
        _bid(odd, BOB, rounded);
        _assertSolvent();
    }

    function testFuzzCeilStep(uint256 highest) public {
        highest = bound(highest, RESERVE, 100_000 ether);
        uint256 id = _create();
        _bid(id, ALICE, highest);
        uint256 expected = (highest * 105 + 99) / 100;
        assertEq(auction.minNextBid(id), expected);
        vm.expectRevert(abi.encodeWithSelector(LotAuction.BidTooLow.selector, expected));
        _bid(id, BOB, expected - 1);
        _bid(id, BOB, expected);
        _assertSolvent();
    }

    function testSellerAndHighestBidderCannotBid() public {
        uint256 id = _create();
        vm.expectRevert(LotAuction.SellerCannotBid.selector);
        _bid(id, SELLER, RESERVE);
        _bid(id, ALICE, RESERVE);
        vm.expectRevert(LotAuction.AlreadyHighestBidder.selector);
        _bid(id, ALICE, 100 ether);
        assertEq(auction.lot(id).highestBid, RESERVE);
    }

    function testBidEventAndFailedFundingRollsBack() public {
        uint256 id = _create();
        uint256 end = auction.lot(id).end;
        vm.expectEmit(true, true, false, true, address(auction));
        emit LotAuction.Bid(id, ALICE, RESERVE, end);
        _bid(id, ALICE, RESERVE);
        vm.prank(BOB);
        gavl.approve(address(auction), 0);
        vm.warp(end - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(auction), 0, 11 ether)
        );
        _bid(id, BOB, 11 ether);
        LotAuction.Lot memory item = auction.lot(id);
        assertEq(item.highestBidder, ALICE);
        assertEq(item.highestBid, RESERVE);
        assertEq(item.end, end);
        assertEq(auction.withdrawable(ALICE), 0);
        _assertSolvent();
    }

    function testBidWithAllowanceButInsufficientBalanceReverts() public {
        uint256 id = _create();
        uint256 balance = gavl.balanceOf(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, ALICE, balance, balance + 1)
        );
        _bid(id, ALICE, balance + 1);
        assertEq(auction.lot(id).highestBidder, address(0));
        _assertSolvent();
    }

    function testExtensionAtExactlyTenMinutesThenInsideWindow() public {
        uint256 id = _create();
        uint256 end = auction.lot(id).end;
        vm.warp(end - 10 minutes);
        _bid(id, ALICE, RESERVE);
        assertEq(auction.lot(id).end, end);
        vm.warp(end - 10 minutes + 1);
        _bid(id, BOB, 11 ether);
        assertEq(auction.lot(id).end, end + 1);
        vm.warp(end);
        _bid(id, CAROL, 12 ether);
        assertEq(auction.lot(id).end, end + 10 minutes);
        vm.expectRevert(LotAuction.AuctionNotEnded.selector);
        auction.settle(id);
        _assertSolvent();
    }

    function testRepeatedExtensionsRequireFundedIncreasingBids() public {
        uint256 id = _create();
        for (uint256 i; i < 20; ++i) {
            uint256 oldEnd = auction.lot(id).end;
            vm.warp(oldEnd - 1);
            uint256 amount = auction.minNextBid(id);
            _bid(id, i % 2 == 0 ? ALICE : BOB, amount);
            assertEq(auction.lot(id).end, oldEnd + 599);
            assertEq(auction.lot(id).highestBid, amount);
            _assertSolvent();
        }
        vm.warp(auction.lot(id).end);
        auction.settle(id);
        _assertSolvent();
    }

    function testBidAndCancelRejectAtAndAfterEnd() public {
        uint256 id = _create();
        vm.warp(auction.lot(id).end);
        vm.expectRevert(LotAuction.AuctionEnded.selector);
        _bid(id, ALICE, RESERVE);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.AuctionEnded.selector);
        auction.cancel(id);
        vm.warp(block.timestamp + 1);
        vm.expectRevert(LotAuction.AuctionEnded.selector);
        _bid(id, ALICE, RESERVE);
    }

    function testCancelCreatesSellerClaimAndClosesAllTransitions() public {
        uint256 id = _create();
        vm.prank(SELLER);
        vm.expectEmit(true, true, false, true, address(auction));
        emit LotAuction.LotCancelled(id, SELLER);
        auction.cancel(id);
        assertEq(auction.lot(id).claimant, SELLER);
        assertEq(uint256(auction.lot(id).status), uint256(LotAuction.Status.Cancelled));
        assertEq(asset.balanceOf(address(auction)), LOT_AMOUNT);
        _assertClosed(id);
        vm.prank(SELLER);
        auction.claimLot(id);
        assertEq(asset.balanceOf(SELLER), 1_000_000 ether);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.AlreadyClaimed.selector);
        auction.claimLot(id);
    }

    function testCancelRequiresSellerAndNoBid() public {
        uint256 id = _create();
        vm.prank(ALICE);
        vm.expectRevert(LotAuction.NotSeller.selector);
        auction.cancel(id);
        _bid(id, ALICE, RESERVE);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.HasBid.selector);
        auction.cancel(id);
        assertEq(uint256(auction.lot(id).status), uint256(LotAuction.Status.Open));
    }

    function testSettleWithBidCreditsSellerAndWinnerClaimsOnce() public {
        uint256 id = _create();
        _bid(id, ALICE, RESERVE);
        vm.expectRevert(LotAuction.AuctionNotEnded.selector);
        auction.settle(id);
        uint256 sellerBalance = gavl.balanceOf(SELLER);
        uint256 winnerBalance = asset.balanceOf(ALICE);
        vm.warp(auction.lot(id).end);
        vm.prank(CAROL);
        vm.expectEmit(true, true, true, true, address(auction));
        emit LotAuction.Settled(id, ALICE, SELLER, RESERVE);
        auction.settle(id);
        assertEq(auction.withdrawable(SELLER), RESERVE);
        assertEq(gavl.balanceOf(SELLER), sellerBalance);
        assertEq(asset.balanceOf(ALICE), winnerBalance);
        assertEq(auction.lot(id).claimant, ALICE);
        _assertClosed(id);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.NotClaimant.selector);
        auction.claimLot(id);
        vm.prank(ALICE);
        vm.expectEmit(true, true, true, true, address(auction));
        emit LotAuction.LotClaimed(id, ALICE, address(asset), LOT_AMOUNT);
        auction.claimLot(id);
        assertEq(asset.balanceOf(ALICE), winnerBalance + LOT_AMOUNT);
        vm.prank(ALICE);
        vm.expectRevert(LotAuction.AlreadyClaimed.selector);
        auction.claimLot(id);
        vm.prank(SELLER);
        auction.withdraw();
        assertEq(gavl.balanceOf(SELLER), sellerBalance + RESERVE);
        _assertSolvent();
    }

    function testNoBidSettlementAtEndReclaimsToSeller() public {
        uint256 id = _create();
        vm.warp(auction.lot(id).end);
        auction.settle(id);
        assertEq(auction.lot(id).claimant, SELLER);
        assertEq(auction.withdrawable(SELLER), 0);
        vm.prank(SELLER);
        auction.claimLot(id);
        assertEq(asset.balanceOf(SELLER), 1_000_000 ether);
        _assertClosed(id);
    }

    function testCannotClaimBeforeCloseOrForAnotherRecipient() public {
        uint256 id = _create();
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.NotClaimant.selector);
        auction.claimLot(id);
        _bid(id, ALICE, RESERVE);
        vm.prank(ALICE);
        vm.expectRevert(LotAuction.NotClaimant.selector);
        auction.claimLot(id);
        vm.warp(auction.lot(id).end);
        auction.settle(id);
        vm.prank(BOB);
        vm.expectRevert(LotAuction.NotClaimant.selector);
        auction.claimLot(id);
    }

    function testOutbidCreditsAccumulateAndWithdrawOnlyOnce() public {
        uint256 id = _create();
        uint256 initial = gavl.balanceOf(ALICE);
        _bid(id, ALICE, 10 ether);
        _bid(id, BOB, 11 ether);
        _bid(id, ALICE, 12 ether);
        _bid(id, CAROL, 13 ether);
        assertEq(auction.withdrawable(ALICE), 22 ether);
        assertEq(auction.withdrawable(BOB), 11 ether);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.NothingToWithdraw.selector);
        auction.withdraw();
        vm.prank(ALICE);
        vm.expectEmit(true, false, false, true, address(auction));
        emit LotAuction.Withdrawn(ALICE, 22 ether);
        auction.withdraw();
        assertEq(gavl.balanceOf(ALICE), initial);
        assertEq(auction.withdrawable(ALICE), 0);
        assertEq(auction.withdrawable(BOB), 11 ether);
        vm.prank(ALICE);
        vm.expectRevert(LotAuction.NothingToWithdraw.selector);
        auction.withdraw();
        _assertSolvent();
    }

    function testGavlLotAndBidEscrowRemainSeparateAcrossLots() public {
        vm.startPrank(SELLER);
        uint256 first = auction.createLot(address(gavl), 100 ether, RESERVE, 1 hours);
        uint256 cancelled = auction.createLot(address(gavl), 200 ether, RESERVE, 1 hours);
        uint256 unsold = auction.createLot(address(gavl), 300 ether, RESERVE, 1 hours);
        auction.cancel(cancelled);
        vm.stopPrank();
        _bid(first, ALICE, 10 ether);
        _bid(first, BOB, 11 ether);
        assertEq(gavl.balanceOf(address(auction)), 621 ether);
        _assertSolvent();
        vm.prank(ALICE);
        auction.withdraw();
        vm.prank(SELLER);
        auction.claimLot(cancelled);
        assertEq(gavl.balanceOf(address(auction)), 411 ether);
        _assertSolvent();
        vm.warp(auction.lot(first).end);
        auction.settle(first);
        auction.settle(unsold);
        _assertSolvent();
        vm.prank(SELLER);
        auction.withdraw();
        assertEq(gavl.balanceOf(address(auction)), 400 ether);
        vm.prank(BOB);
        auction.claimLot(first);
        vm.prank(SELLER);
        auction.claimLot(unsold);
        assertEq(gavl.balanceOf(address(auction)), 0);
        _assertSolvent();
    }

    function testDonationDoesNotBecomeSomeoneElsesCredit() public {
        gavl.transfer(address(auction), 1 ether);
        uint256 id = _create();
        _bid(id, ALICE, RESERVE);
        _bid(id, BOB, 11 ether);
        _assertSolvent();
        assertEq(auction.totalWithdrawable() + auction.totalBidEscrow(), 21 ether);
        assertEq(gavl.balanceOf(address(auction)), 22 ether);
    }

    function testUnknownIdsRevertOnEveryLotEndpoint() public {
        for (uint256 id; id < 2; ++id) {
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.lot(id);
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.minNextBid(id);
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.bid(id, RESERVE);
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.cancel(id);
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.settle(id);
            vm.expectRevert(LotAuction.UnknownLot.selector);
            auction.claimLot(id);
        }
    }

    function testRejectsEtherAndUnknownCalls() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(auction).call{value: 1}("");
        assertFalse(sent);
        (bool fallbackOk,) = address(auction).call(hex"12345678");
        assertFalse(fallbackOk);
        (bool payableCall,) = address(auction).call{value: 1}(
            abi.encodeCall(auction.createLot, (address(asset), LOT_AMOUNT, RESERVE, 1 hours))
        );
        assertFalse(payableCall);
        assertEq(address(auction).balance, 0);
    }

    function _assertClosed(uint256 id) private {
        vm.expectRevert(LotAuction.LotClosed.selector);
        _bid(id, BOB, 100 ether);
        vm.prank(SELLER);
        vm.expectRevert(LotAuction.LotClosed.selector);
        auction.cancel(id);
        vm.expectRevert(LotAuction.LotClosed.selector);
        auction.settle(id);
    }
}
