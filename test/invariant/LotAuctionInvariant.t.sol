// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {LaunchToken} from "../../src/LaunchToken.sol";
import {LotAuction} from "../../src/LotAuction.sol";
import {MockToken} from "../helpers/Tokens.sol";

contract AuctionHandler is Test {
    LaunchToken public immutable gavl;
    MockToken public immutable asset;
    LotAuction public immutable auction;
    address[4] public actors = [address(0x1001), address(0x1002), address(0x1003), address(0x1004)];
    uint256 public donatedGavl;

    constructor(LaunchToken currency, MockToken lotToken, LotAuction app) {
        gavl = currency;
        asset = lotToken;
        auction = app;
        for (uint256 i; i < actors.length; ++i) {
            vm.startPrank(actors[i]);
            currency.approve(address(app), type(uint256).max);
            lotToken.approve(address(app), type(uint256).max);
            vm.stopPrank();
        }
    }

    function create(uint256 actorSeed, bool useGavl, uint256 amount, uint256 reserve, uint256 duration) external {
        if (auction.lotCount() >= 16) return;
        address seller = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 1000 ether);
        uint256 balance = useGavl ? gavl.balanceOf(seller) : asset.balanceOf(seller);
        if (balance < amount) return;
        reserve = bound(reserve, 1 ether, 100 ether);
        duration = bound(duration, 1 hours, 1 days);
        vm.prank(seller);
        auction.createLot(useGavl ? address(gavl) : address(asset), amount, reserve, duration);
    }

    function bid(uint256 idSeed, uint256 actorSeed, uint256 extra) external {
        if (auction.lotCount() == 0) return;
        uint256 id = 1 + idSeed % auction.lotCount();
        LotAuction.Lot memory item = auction.lot(id);
        address bidder = actors[actorSeed % actors.length];
        if (
            item.status != LotAuction.Status.Open || block.timestamp >= item.end || bidder == item.seller
                || bidder == item.highestBidder
        ) return;
        uint256 amount = auction.minNextBid(id) + bound(extra, 0, 100 ether);
        if (gavl.balanceOf(bidder) < amount) return;
        vm.prank(bidder);
        auction.bid(id, amount);
    }

    function cancel(uint256 idSeed) external {
        if (auction.lotCount() == 0) return;
        uint256 id = 1 + idSeed % auction.lotCount();
        LotAuction.Lot memory item = auction.lot(id);
        if (item.status != LotAuction.Status.Open || item.highestBid != 0 || block.timestamp >= item.end) return;
        vm.prank(item.seller);
        auction.cancel(id);
    }

    function settle(uint256 idSeed) external {
        if (auction.lotCount() == 0) return;
        uint256 id = 1 + idSeed % auction.lotCount();
        LotAuction.Lot memory item = auction.lot(id);
        if (item.status != LotAuction.Status.Open || block.timestamp < item.end) return;
        auction.settle(id);
    }

    function claim(uint256 idSeed) external {
        if (auction.lotCount() == 0) return;
        uint256 id = 1 + idSeed % auction.lotCount();
        LotAuction.Lot memory item = auction.lot(id);
        if (item.status == LotAuction.Status.Open || item.claimed) return;
        vm.prank(item.claimant);
        auction.claimLot(id);
    }

    function withdraw(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (auction.withdrawable(actor) == 0) return;
        vm.prank(actor);
        auction.withdraw();
    }

    function elapse(uint256 delta) external {
        vm.warp(block.timestamp + bound(delta, 0, 2 hours));
    }

    function donate(uint256 actorSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        amount = bound(amount, 0, 10 ether);
        if (gavl.balanceOf(actor) < amount) return;
        donatedGavl += amount;
        vm.prank(actor);
        gavl.transfer(address(auction), amount);
    }
}

contract LotAuctionInvariantTest is StdInvariant, Test {
    LaunchToken internal gavl;
    MockToken internal asset;
    LotAuction internal auction;
    AuctionHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        gavl = new LaunchToken();
        asset = new MockToken();
        auction = new LotAuction(address(gavl));
        handler = new AuctionHandler(gavl, asset, auction);
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            gavl.transfer(actor, 1_000_000 ether);
            asset.mint(actor, 1_000_000 ether);
        }
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = AuctionHandler.create.selector;
        selectors[1] = AuctionHandler.bid.selector;
        selectors[2] = AuctionHandler.cancel.selector;
        selectors[3] = AuctionHandler.settle.selector;
        selectors[4] = AuctionHandler.claim.selector;
        selectors[5] = AuctionHandler.withdraw.selector;
        selectors[6] = AuctionHandler.elapse.selector;
        selectors[7] = AuctionHandler.donate.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariantBalancesCoverIndependentlySummedLiabilities() public view {
        uint256 credits;
        uint256 liveBids;
        uint256 gavlLots;
        uint256 assetLots;
        uint256 allGavl = gavl.balanceOf(address(this)) + gavl.balanceOf(address(auction));
        uint256 allAsset = asset.balanceOf(address(auction));
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            credits += auction.withdrawable(actor);
            allGavl += gavl.balanceOf(actor);
            allAsset += asset.balanceOf(actor);
        }
        for (uint256 i = 1; i <= auction.lotCount(); ++i) {
            LotAuction.Lot memory item = auction.lot(i);
            if (item.status == LotAuction.Status.Open) {
                liveBids += item.highestBid;
                assertEq(item.claimant, address(0));
                assertFalse(item.claimed);
            } else {
                address recipient = item.highestBidder == address(0) ? item.seller : item.highestBidder;
                assertEq(item.claimant, recipient);
                if (item.status == LotAuction.Status.Cancelled) assertEq(item.highestBid, 0);
            }
            if (item.highestBidder == address(0)) {
                assertEq(item.highestBid, 0);
            } else {
                assertGe(item.highestBid, item.reserve);
                assertTrue(item.highestBidder != item.seller);
            }
            if (!item.claimed) {
                if (item.lotToken == address(gavl)) gavlLots += item.lotAmount;
                else assetLots += item.lotAmount;
            }
        }
        assertEq(auction.totalWithdrawable(), credits);
        assertEq(auction.totalBidEscrow(), liveBids);
        assertEq(auction.totalTokenLotEscrow(), gavlLots);
        uint256 liabilities = credits + liveBids + gavlLots;
        assertGe(gavl.balanceOf(address(auction)), liabilities);
        assertEq(gavl.balanceOf(address(auction)), liabilities + handler.donatedGavl());
        assertEq(asset.balanceOf(address(auction)), assetLots);
        assertEq(gavl.totalSupply(), 1e27);
        assertEq(allGavl, 1e27);
        assertEq(allAsset, 4_000_000 ether);
        assertEq(address(auction).balance, 0);
    }

    /// @dev Every randomized sequence must be completely unwindable without an administrator.
    function afterInvariant() public {
        uint256 latestEnd = block.timestamp;
        for (uint256 i = 1; i <= auction.lotCount(); ++i) {
            uint256 end = auction.lot(i).end;
            if (end > latestEnd) latestEnd = end;
        }
        vm.warp(latestEnd);
        for (uint256 i = 1; i <= auction.lotCount(); ++i) {
            LotAuction.Lot memory item = auction.lot(i);
            if (item.status == LotAuction.Status.Open) auction.settle(i);
            item = auction.lot(i);
            if (!item.claimed) {
                vm.prank(item.claimant);
                auction.claimLot(i);
            }
        }
        for (uint256 i; i < 4; ++i) {
            address actor = handler.actors(i);
            if (auction.withdrawable(actor) != 0) {
                vm.prank(actor);
                auction.withdraw();
            }
        }
        invariantBalancesCoverIndependentlySummedLiabilities();
        assertEq(auction.totalWithdrawable(), 0);
        assertEq(auction.totalBidEscrow(), 0);
        assertEq(auction.totalTokenLotEscrow(), 0);
        assertEq(gavl.balanceOf(address(auction)), handler.donatedGavl());
        assertEq(asset.balanceOf(address(auction)), 0);
    }
}
