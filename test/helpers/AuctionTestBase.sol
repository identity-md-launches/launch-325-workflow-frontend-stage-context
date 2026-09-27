// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {LotAuction} from "../../src/LotAuction.sol";
import {MockToken} from "./Tokens.sol";

abstract contract AuctionTestBase is Test {
    LaunchToken internal gavl;
    LotAuction internal auction;
    MockToken internal asset;
    address internal constant SELLER = address(0xA11CE);
    address internal constant ALICE = address(0xB0B);
    address internal constant BOB = address(0xCAFE);
    address internal constant CAROL = address(0xD00D);
    uint256 internal constant LOT_AMOUNT = 100 ether;
    uint256 internal constant RESERVE = 10 ether;

    function setUp() public virtual {
        vm.warp(1_000_000);
        gavl = new LaunchToken();
        auction = new LotAuction(address(gavl));
        asset = new MockToken();
        address[4] memory users = [SELLER, ALICE, BOB, CAROL];
        for (uint256 i; i < users.length; ++i) {
            gavl.transfer(users[i], 1_000_000 ether);
            asset.mint(users[i], 1_000_000 ether);
            vm.startPrank(users[i]);
            gavl.approve(address(auction), type(uint256).max);
            asset.approve(address(auction), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _create() internal returns (uint256 id) {
        vm.prank(SELLER);
        return auction.createLot(address(asset), LOT_AMOUNT, RESERVE, 1 hours);
    }

    function _bid(uint256 id, address bidder, uint256 amount) internal {
        vm.prank(bidder);
        auction.bid(id, amount);
    }

    function _assertSolvent() internal view {
        uint256 credits = auction.withdrawable(SELLER) + auction.withdrawable(ALICE) + auction.withdrawable(BOB)
            + auction.withdrawable(CAROL);
        uint256 bids;
        uint256 lots;
        for (uint256 i = 1; i <= auction.lotCount(); ++i) {
            LotAuction.Lot memory item = auction.lot(i);
            if (item.status == LotAuction.Status.Open) bids += item.highestBid;
            if (item.lotToken == address(gavl) && !item.claimed) lots += item.lotAmount;
        }
        assertEq(auction.totalWithdrawable(), credits);
        assertEq(auction.totalBidEscrow(), bids);
        assertEq(auction.totalTokenLotEscrow(), lots);
        assertGe(gavl.balanceOf(address(auction)), credits + bids + lots);
    }
}
