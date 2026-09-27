// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Permissionless ERC-20 lot auctions paid in the immutable GAVL launch token.
/// @dev Arbitrary lot tokens are untrusted. Rebasing and sender-extra-fee tokens are unsupported.
contract LotAuction is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 7 days;
    uint256 public constant EXTENSION = 10 minutes;
    uint256 public constant MIN_RESERVE = 1 ether; // One GAVL, which has 18 decimals.

    enum Status {
        Open,
        Cancelled,
        Settled
    }

    struct Lot {
        address seller;
        address lotToken;
        uint256 lotAmount; // Actual incoming balance delta, in lot-token minor units.
        uint256 reserve; // GAVL minor units.
        uint256 end;
        address highestBidder;
        uint256 highestBid;
        address claimant; // Set only on cancellation or settlement.
        Status status;
        bool claimed;
    }

    IERC20 public immutable token;
    uint256 public lotCount;
    mapping(uint256 => Lot) private _lots;
    mapping(address => uint256) public withdrawable;

    // Disjoint GAVL liabilities; unsolicited transfers may leave excess balance.
    uint256 public totalWithdrawable;
    uint256 public totalBidEscrow;
    uint256 public totalTokenLotEscrow;

    error InvalidToken();
    error InvalidDuration();
    error InvalidReserve();
    error InvalidAmount();
    error NoTokensReceived();
    error UnknownLot();
    error LotClosed();
    error AuctionEnded();
    error AuctionNotEnded();
    error SellerCannotBid();
    error AlreadyHighestBidder();
    error BidTooLow(uint256 minimum);
    error InexactBidReceipt();
    error NotSeller();
    error HasBid();
    error NotClaimant();
    error AlreadyClaimed();
    error NothingToWithdraw();

    event LotCreated(
        uint256 indexed id,
        address indexed seller,
        address indexed lotToken,
        uint256 lotAmount,
        uint256 reserve,
        uint256 end
    );
    event Bid(uint256 indexed id, address indexed bidder, uint256 amount, uint256 end);
    event LotCancelled(uint256 indexed id, address indexed seller);
    event Settled(uint256 indexed id, address indexed claimant, address indexed seller, uint256 amount);
    event LotClaimed(uint256 indexed id, address indexed claimant, address indexed lotToken, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    /// @param gavl The launch token address, supplied as $token by the project factory.
    constructor(address gavl) {
        if (gavl == address(0) || gavl.code.length == 0) revert InvalidToken();
        token = IERC20(gavl);
    }

    /// @return id Sequential ID starting at 1. Sellers approve this contract before calling.
    function createLot(address lotToken, uint256 lotAmount, uint256 reserve, uint256 duration)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (lotToken == address(0) || lotToken.code.length == 0) revert InvalidToken();
        if (lotAmount == 0) revert InvalidAmount();
        if (reserve < MIN_RESERVE) revert InvalidReserve();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert InvalidDuration();

        IERC20 asset = IERC20(lotToken);
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), lotAmount);
        uint256 received = asset.balanceOf(address(this)) - beforeBalance;
        if (received == 0) revert NoTokensReceived();

        id = ++lotCount;
        uint256 end = block.timestamp + duration;
        _lots[id] = Lot({
            seller: msg.sender,
            lotToken: lotToken,
            lotAmount: received,
            reserve: reserve,
            end: end,
            highestBidder: address(0),
            highestBid: 0,
            claimant: address(0),
            status: Status.Open,
            claimed: false
        });
        if (lotToken == address(token)) totalTokenLotEscrow += received;
        emit LotCreated(id, msg.sender, lotToken, received, reserve, end);
    }

    /// @notice Bids are fully funded; an outbid user receives a separate withdrawal credit.
    function bid(uint256 id, uint256 amount) external nonReentrant {
        Lot storage item = _getLot(id);
        _requireOpen(item);
        if (block.timestamp >= item.end) revert AuctionEnded();
        if (msg.sender == item.seller) revert SellerCannotBid();
        if (msg.sender == item.highestBidder) revert AlreadyHighestBidder();
        uint256 minimum = _minNextBid(item);
        if (amount < minimum) revert BidTooLow(minimum);

        uint256 previous = item.highestBid;
        if (previous != 0) _credit(item.highestBidder, previous);
        totalBidEscrow = totalBidEscrow - previous + amount;
        item.highestBidder = msg.sender;
        item.highestBid = amount;
        if (item.end - block.timestamp < EXTENSION) item.end = block.timestamp + EXTENSION;

        // GAVL is a fixed-supply, exact-transfer token; reject a misconfigured taxed currency.
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert InexactBidReceipt();
        emit Bid(id, msg.sender, amount, item.end);
    }

    /// @notice Cancellation creates a claim for the seller; it never calls the lot token.
    function cancel(uint256 id) external nonReentrant {
        Lot storage item = _getLot(id);
        _requireOpen(item);
        if (msg.sender != item.seller) revert NotSeller();
        if (block.timestamp >= item.end) revert AuctionEnded();
        if (item.highestBidder != address(0)) revert HasBid();
        item.status = Status.Cancelled;
        item.claimant = item.seller;
        emit LotCancelled(id, item.seller);
    }

    /// @notice Anyone can settle at or after end. Settlement makes no external calls.
    function settle(uint256 id) external nonReentrant {
        Lot storage item = _getLot(id);
        _requireOpen(item);
        if (block.timestamp < item.end) revert AuctionNotEnded();
        item.status = Status.Settled;
        if (item.highestBidder == address(0)) {
            item.claimant = item.seller;
        } else {
            item.claimant = item.highestBidder;
            totalBidEscrow -= item.highestBid;
            _credit(item.seller, item.highestBid);
        }
        emit Settled(id, item.claimant, item.seller, item.highestBid);
    }

    /// @notice Only the recipient can claim, to their own address. Failed transfers are retryable.
    function claimLot(uint256 id) external nonReentrant {
        Lot storage item = _getLot(id);
        if (item.claimant != msg.sender) revert NotClaimant();
        if (item.claimed) revert AlreadyClaimed();
        item.claimed = true;
        if (item.lotToken == address(token)) totalTokenLotEscrow -= item.lotAmount;
        IERC20(item.lotToken).safeTransfer(msg.sender, item.lotAmount);
        emit LotClaimed(id, msg.sender, item.lotToken, item.lotAmount);
    }

    /// @notice Collect all caller-owned GAVL credits. No third party can trigger a payout.
    function withdraw() external nonReentrant {
        uint256 amount = withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function lot(uint256 id) external view returns (Lot memory) {
        return _getLot(id);
    }

    /// @notice Arithmetic threshold only, including for closed lots; inspect status/end before bidding.
    function minNextBid(uint256 id) external view returns (uint256) {
        return _minNextBid(_getLot(id));
    }

    function _minNextBid(Lot storage item) private view returns (uint256) {
        uint256 highest = item.highestBid;
        if (highest == 0) return item.reserve;
        // ceil(highest * 105 / 100) = highest + ceil(highest / 20), without multiplying highest.
        return highest + highest / 20 + (highest % 20 == 0 ? 0 : 1);
    }

    function _getLot(uint256 id) private view returns (Lot storage item) {
        item = _lots[id];
        if (item.seller == address(0)) revert UnknownLot();
    }

    function _requireOpen(Lot storage item) private view {
        if (item.status != Status.Open) revert LotClosed();
    }

    function _credit(address recipient, uint256 amount) private {
        withdrawable[recipient] += amount;
        totalWithdrawable += amount;
    }
}
