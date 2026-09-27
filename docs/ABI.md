# Contract interfaces

The authoritative exported JSON ABI arrays are
[`abi/LaunchToken.json`](abi/LaunchToken.json) and
[`abi/LotAuction.json`](abi/LotAuction.json). Errors and event field indexing are
included. All token amounts are integers in their respective token's minor units;
GAVL always has 18 decimals. Times and durations are seconds.

## LaunchToken

The constructor has no arguments and mints `1e27` minor units to `msg.sender`.
Standard ERC-20 calls are `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`,
`allowance`, `approve`, `transfer` and `transferFrom`. Approval is required before
the auction pulls funds; permit is not implemented. Standard `Transfer` and
`Approval` events apply.

## LotAuction

The nonpayable constructor takes one `address gavl` and exposes it through
`token()`. All state-changing functions are nonpayable; there is no receive or
fallback function.

| Function | Behavior / return |
| --- | --- |
| `createLot(address lotToken, uint256 lotAmount, uint256 reserve, uint256 duration)` | Pull the approved lot tokens and return a new `uint256 id` |
| `bid(uint256 id, uint256 amount)` | Pull the full GAVL bid, credit any previous bidder, possibly extend the deadline |
| `cancel(uint256 id)` | Seller closes an unbid, unexpired auction; seller must subsequently claim |
| `settle(uint256 id)` | Close an expired auction and assign GAVL credit / lot claimant |
| `claimLot(uint256 id)` | Transfer the caller's assigned lot to the caller, once |
| `withdraw()` | Transfer the caller's entire GAVL credit to the caller |
| `lot(uint256 id)` | Return the tuple described below; unknown IDs revert |
| `lotCount()` | Highest created ID, initially zero |
| `minNextBid(uint256 id)` | Reserve or rounded 105% threshold; unknown IDs revert |
| `withdrawable(address account)` | GAVL credit belonging to the account |
| `token()` | Immutable GAVL ERC-20 address |
| `totalWithdrawable()` | Sum of all GAVL withdrawal credits |
| `totalBidEscrow()` | Sum of highest bids on open lots, including expired unsettled lots |
| `totalTokenLotEscrow()` | Sum of unclaimed GAVL lot amounts, including cancelled and settled lots |

`MIN_DURATION`, `MAX_DURATION`, `EXTENSION` and `MIN_RESERVE` expose the constants
3600, 604800, 600 and `1e18`. `minNextBid` is an arithmetic view; it does not assert
that a caller is eligible or that the auction is still open. Closed lots retain
historical bid details. In particular, do not count their `highestBid` again as
live escrow.

`lot(id)` returns a named tuple, in this exact order:

| Field | ABI type | Meaning |
| --- | --- | --- |
| `seller` | `address` | Original creator |
| `lotToken` | `address` | Escrowed ERC-20 |
| `lotAmount` | `uint256` | Actual amount received at creation |
| `reserve` | `uint256` | Minimum first bid in GAVL minor units |
| `end` | `uint256` | Current inclusive settlement / exclusive bid deadline |
| `highestBidder` | `address` | Zero until the first bid |
| `highestBid` | `uint256` | Zero until the first bid |
| `claimant` | `address` | Zero while open; recipient after cancellation/settlement |
| `status` | `uint8` | `0 = Open`, `1 = Cancelled`, `2 = Settled` |
| `claimed` | `bool` | Whether the lot transfer completed |

An open lot with `end <= latestBlock.timestamp` is awaiting settlement, not
accepting bids. A nonzero `claimant` with `claimed == false` has a claim even if
its previous transfer attempt reverted.

## Events

| Event signature | Indexed fields | Meaning |
| --- | --- | --- |
| `LotCreated(uint256 id,address seller,address lotToken,uint256 lotAmount,uint256 reserve,uint256 end)` | id, seller, lotToken | Net deposit and initial terms |
| `Bid(uint256 id,address bidder,uint256 amount,uint256 end)` | id, bidder | Accepted bid and updated end |
| `LotCancelled(uint256 id,address seller)` | id, seller | Seller may reclaim |
| `Settled(uint256 id,address claimant,address seller,uint256 amount)` | id, claimant, seller | Claim recipient and seller credit; amount is zero without bids |
| `LotClaimed(uint256 id,address claimant,address lotToken,uint256 amount)` | id, claimant, lotToken | Nominal escrow amount sent; an outgoing token fee can reduce recipient receipt |
| `Withdrawn(address account,uint256 amount)` | account | Collected GAVL credit |

These events describe successful transactions only. Read views after confirmation
to refresh state; event logs can be removed by reorganizations.

## Frontend handoff

The later static page should validate Sepolia, read GAVL from `LotAuction.token()`,
and use wallet calls to show GAVL `balanceOf`, `allowance(wallet, auction)` and
`withdrawable(wallet)`. Show an explicit approval step before creating a lot
(approve the lot token) or bidding (approve GAVL), followed by the paying action.
Approval and action are separate transactions; wait for confirmation, refresh
allowance and the current bid threshold/deadline, and handle stale-state reverts.

Browse IDs `1..lotCount()` with bounded/paginated RPC reads and subscribe to/query
the events above, using RPC block ranges where needed. Filter open, unexpired
lots for bidding and show a live countdown from the latest known chain timestamp.
Provide settle, cancel when eligible, claim and Withdraw actions from the current
views. No backend or indexer is required. Use integer arithmetic for bids and
format token amounts only for display. Lot token metadata is untrusted.

Explain that GAVL is obtained by swapping Sepolia ETH in the factory-seeded launch
pool; the page must not implement an in-page swap. Keep deployment addresses out
of this source-stage guide until services provide the admitted live deployment.
