# Gavel contracts

Gavel is an English auction application on **Sepolia (chain ID 11155111)**.
`LaunchToken` is Gavel (GAVL); `LotAuction` escrows ERC-20 lots and accepts bids in GAVL.
This contribution delivers the contracts, tests, vendored dependencies and ABI exports.

## Build and verify

With Foundry and Solidity 0.8.26 installed:

```sh
forge build
forge test
forge fmt --check
```

`foundry.toml` pins Solidity **0.8.26**, Cancun, optimization at 200 runs,
`bytecode_hash = "none"`, and no CBOR metadata. FFI and filesystem cheatcode
permissions are disabled. All Solidity dependencies are ordinary files in `lib/`;
their versions, archive checksums and licenses are described in
[docs/DEPENDENCIES.md](docs/DEPENDENCIES.md). No network or environment variables
are needed for the tests. The compiler itself is supplied by the build environment.

Regenerate the delivered ABIs after changing contract interfaces:

```sh
forge inspect LaunchToken abi --json > docs/abi/LaunchToken.json
forge inspect LotAuction abi --json > docs/abi/LotAuction.json
```

## Deployment parameters and responsibilities

| Order | Source / identifier | Constructor arguments | Initial state |
| --- | --- | --- | --- |
| Launch token | `src/LaunchToken.sol:LaunchToken` | None | Exactly `1000000000000000000000000000` minor units minted to its constructor caller |
| Application | `src/LotAuction.sol:LotAuction` | One address, `gavl = $token` | Immutable currency, zero lots, zero GAVL required |

The manifest contribution should identify kind `evm_project`, launch token
`LaunchToken`, and exactly one application named `LotAuction` with
`constructorArgs: ["$token"]`. Both constructors are nonpayable and completely
configure their contracts. There is no initializer. `LaunchToken` has 18 decimals,
name `Gavel`, symbol `GAVL`, and no external mint, burn, fee, owner, pause, blocklist
or upgrade functions. `LotAuction` has no owner or administrative powers. Neither
contract derives an application privilege from the factory's `msg.sender`.

The separately generated `launch.json` must describe this source and receive an
independent review alongside it. Deployment services own policy selection, signed
artifact linkage, source publication, attestation, admission and factory deployment.
They also distribute the factory-held supply to the launch pool and protocol rewards.
No app funding, privileged wallet, post-deployment setup, oracle, keeper, backend,
or randomness provider is required. No deployment transaction is part of this package.

After deployment, the frontend service builds the approved one-page static site,
labelled `lab-lot-auction`, with `dist/index.html`. It must use the live factory
deployment addresses on Sepolia. GitHub publication and IPFS hosting are approved
in the workflow. No live addresses or deployed-site claims are made here.

## Auction behavior

1. A seller approves `LotAuction` on the lot's ERC-20 and calls
   `createLot(lotToken, lotAmount, reserve, duration)`. Amount must be nonzero;
   reserve is at least `1e18` GAVL minor units; duration is inclusively 1 hour to
   7 days. The contract uses `SafeERC20.safeTransferFrom` and records the actual
   balance increase. Zero receipt reverts. IDs begin at 1 and are never reused.
2. A bidder approves GAVL and calls `bid(id, amount)` strictly before `end`.
   The first bid is at least reserve. Later bids are at least
   `ceil(highestBid * 105 / 100)`, in minor units. The seller and current highest
   bidder cannot bid. Each bid transfers its **full** amount; existing withdrawal
   credits are not used for payment. The previous highest bid becomes a withdrawal
   credit without sending tokens to its owner.
3. A valid bid with **fewer than 600 seconds** remaining resets the end to
   `block.timestamp + 600`. At exactly 600 seconds the end is unchanged. Extensions
   have no absolute cap. Alternating funded bidders can keep an auction alive;
   each new bid must meet the rounded 5% increase. Users must monitor the current
   `end`, not the creation-time deadline. Timestamps have normal validator timing
   tolerance; they are used only for auction deadlines.
4. Before end and before any bid, only the seller may `cancel(id)`. Cancellation
   closes the auction and makes the lot claimable by the seller. No tokens move.
5. Anyone may `settle(id)` at or after end, once. With a bid, the seller receives
   a GAVL credit and the winner receives the right to claim the lot. With no bid,
   the seller receives the right to reclaim the lot. Settlement has no external
   calls. Cancelled and settled lots reject further bids, cancellation and settlement.
6. Only the assigned recipient can call `claimLot(id)`, once, to transfer the
   escrowed lot to their own address. `withdraw()` transfers all of the caller's
   GAVL credits to that caller. Empty withdrawals revert. Nobody can trigger a
   third party's payout. State updates precede payout calls; every state-changing
   entrypoint is `nonReentrant`. A failed transfer reverts its state changes and
   leaves the claim or credit available for retry.

No function accepts ETH; wallets pay transaction gas in Sepolia ETH. GAVL comes
from swapping Sepolia ETH in the launch pool, outside the application page.
There are no auction fees or hidden beneficiaries.

## Custody and asset assumptions

GAVL is the exact-transfer `LaunchToken` above. The constructor only checks that
its address contains code; deployment and independent review must verify that
`$token` resolves to this accepted token. Bid deposits additionally enforce exact
receipt. A different or malicious currency is not a supported deployment.

Lots can use GAVL itself. GAVL held covers three disjoint obligations:

```text
GAVL balance >= sum(withdrawable for every recipient)
              + sum(highestBid for every open lot)
              + sum(lotAmount for every unclaimed GAVL lot)
```

The public aggregate views `totalWithdrawable`, `totalBidEscrow` and
`totalTokenLotEscrow` track these categories, respectively. Closing a winning
auction moves bid escrow to seller credit. Closing any lot preserves lot escrow
until claim. Withdrawal never consumes lot escrow. Direct donations can make
the inequality strict; there is no admin sweep or recovery path for donations,
mistaken transfers, or forcibly sent ETH.

**Rebasing tokens are unsupported.** Lot tokens must report honest balances and
debit the requested amount from the sender. Fee-on-transfer tokens that deduct
fees from that amount are supported: creation records the net receipt, and an
outgoing fee can reduce what the recipient gets on claim. Tokens charging an
additional sender fee, changing balances externally, or lying about transfers
are unsupported. A standard ERC-20 returning no data is supported; a `false`
return or revert fails the operation atomically.

Permissionless listing does not certify an asset. A malicious, paused, blacklisting,
or upgradeable lot token can prevent its own delivery or misrepresent its balance.
Settlement can still succeed, and the winner still owes the seller's winning bid
even if claiming that asset fails. There is no arbitration, seller clawback or
automatic GAVL refund for an undeliverable malicious lot. Users must assess the
specific lot token before bidding. A broken lot token cannot call back into the
auction's mutating functions or block settlement and withdrawals for other assets.

No one settles or collects automatically: participants or any willing caller
must send the settlement transaction; each recipient then claims/withdraws.
There is no expiry on credits or claims, and no administrator can recover funds
for a lost key. The frontend should expose these actions after bidding ends.

## Verification and review handoff

The 43-test suite includes success and failure cases, 256-case transfer and
rounding fuzz tests, factory-context constructor and forbidden-opcode checks,
and a stateful invariant campaign (128 runs, depth 64). The invariant reconstructs
obligations from lots and user credits independently of the aggregate counters,
tracks token conservation and donations, and completely unwinds every generated
sequence after deadlines pass. Actions cover both GAVL and another ERC-20 as lots.

Adversarial tests cover callbacks into all six mutators during deposit and claim,
callback currency payouts, false/reverting/no-return tokens, retryable failures,
100% and 10% transfer fees, mixed GAVL escrow, repeated extensions, rounded bid
boundaries, and duplicate settlement/claim/withdraw attempts. These are builder
tests, **not an independent security audit**. The required independent contributor
review remains a separate stage before release. Its review should include these
attack surfaces and the accepted manifest's concrete constructor argument.

The supplied protected tests were read as acceptance inputs. The local deployment
tests reproduce their supply, constructor-context, code-size and opcode properties
without environment variables; the protected service harness itself runs later
with service-provided artifacts. Local results do not establish service admission.

The JSON ABIs and the frontend integration guide are in [docs/ABI.md](docs/ABI.md).
