# Gavel auction room

One static React + TypeScript page for the deployed Gavel / LotAuction project. Vite uses `base: './'`; the delivered `../dist/` directory is the complete hosting payload. The worker could not create the requested commit because this workspace mounts `.git` read-only; all files are ready for collection. No backend, indexer, remote font, WalletConnect account or private configuration is needed. Wallet interaction uses viem with the browser's injected EIP-1193 provider. When multiple wallets are installed, select the desired default provider in the wallet extensions.

## Install, build and preview

Requires Node 22 and npm. From the repository root:

```sh
npm ci --prefix web
npm run build --prefix web
npm run preview --prefix web
```

The production build includes TypeScript checking, exports the pinned ABIs, verifies their canonical Keccak-256 hashes, then writes `dist/imd-deployment.json` and its complete SHA-256 asset inventory. `git show` must be able to read the deployed source commit retained in repository history. Do not use a shallow checkout that omits that commit. No network is used during the build. A clean installation needs npm registry access or a populated external npm cache; no registry/cache is committed. The worker also successfully installed from the lockfile using `npm ci --offline` with its populated cache.

For local iteration, rebuild after source changes and reload the production preview. This keeps development checks against the same generated manifest and ABI files that are delivered, with no second deployment map. The supported preview serves the delivered `dist/` tree.

## Configuration and provenance

- `web/deployment/handoff.json` and `web/deployment/network.json` retain the exact provided public inputs for reproducible builds after `.imd/reads` is removed.
- `web/scripts/manifest.mjs` obtains ABI arrays from `docs/abi/<Contract>.json` **at the handoff's deployed source commit**, confirms their hashes and equality with the existing ABI exports, and writes the runtime manifest. Solidity and root build configuration are untouched.
- `src/config.ts` loads **only** `imd-deployment.json` for chain, addresses, ABI paths, public RPCs, explorer and wallet-add parameters. It then fetches and hashes the referenced ABI JSON. There is no independent runtime deployment map or hard-coded router.
- The full network block is preserved, including its Uniswap addresses. The approved workflow explicitly excludes an in-page swap. GAVL acquisition instructions explain using Sepolia ETH in the factory-seeded Uniswap v4 pool.
- Transactions remain disabled until the RPC reports the expected chain, each attested contract has nonempty code, `LotAuction.token()` matches the handoff token, and GAVL reports 18 decimals. These are identity/presence checks, not deployed-bytecode equivalence or attestation-signature verification.
- Public reads fail over through the configured RPC list. The wallet signs only on the configured chain. A missing chain triggers switch → add with the exact supplied parameters → switch again. No wallet-provider read fallback or WalletConnect connector is configured.

## Actions and live state

The page exposes createLot, bid, cancel, settle, claimLot and withdraw, plus ERC-20 approval and optional zero-allowance reset. Paying actions have a separate exact-amount approval step; existing sufficient allowance is shown as approved. Every submitted action has a review dialog and public-RPC simulation before the wallet signing request. Chain and account are checked again after simulation. Receipt status, explorer links, rejection/revert errors and replacement/cancellation handling are shown. Only one transaction can run at a time. A confirmation timeout retains the transaction link and asks the visitor to check it before retrying.

Balances show GAVL balance, allowance to LotAuction, and withdrawable credit. Polling runs every 15 seconds and following confirmed transactions; manual Refresh is available. Lot snapshots and wallet balances are pinned to one block number. Six sequential IDs are read per page, newest first. Filters apply to the current page; use Older lots to reach the full history. Countdowns extrapolate the latest chain timestamp; contract simulation remains authoritative at expiry. No event service, indexer or backend is used.

Amounts use BigInt and the token's decimals, without floating-point conversion. GAVL has 18 decimals; unknown lot metadata is displayed in raw units. A new deposit requires readable decimals, allowance and balance. Untrusted token metadata is shortened and directional controls are stripped; full addresses remain accessible in lot details. Fee-on-transfer lot tokens are recorded net by the contract. Rebasing and sender-extra-fee tokens are unsupported. Tokens with restrictive/malicious transfer behavior can prevent collection; settlement and GAVL credits are separate.

Seller/current-highest-bidder restrictions, minimum next bids, deadlines, settlement, cancellation and claimant eligibility determine enabled controls. The contract rechecks all conditions; a competing transaction may invalidate a simulated action. No claim of guaranteed inclusion or economic value is made for test tokens.

## Validation

```sh
npm run typecheck --prefix web
npm run build --prefix web
PLAYWRIGHT_BROWSERS_PATH=/tmp/gavel-browsers npm exec --prefix web -- playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/gavel-browsers npm test --prefix web
node web/scripts/verify-export.mjs
node web/scripts/check-deployment.mjs
```

The Playwright suite starts and closes its own static server under `/preview/`, tests the production files with mocked RPC/wallet behavior, runs axe scans, and writes evidence in `docs/validation/`. It never broadcasts. The separate live-chain script uses `curl` for read-only configured-RPC calls and records the block number, chain, code sizes, token binding and lot count. See [validation report](../docs/VALIDATION.md) for actual results and limitations and [design document](../docs/DESIGN.md) for the final implementation.

`web/.gitignore` uses the assignment's explicit dotfile allowance to exclude dependency and generated cache/test directories at every nesting level. Commit source, package-lock, docs and all of dist. Do not commit node_modules or browser binaries. Rebuild and verify the manifest after any export change. Publication, IPFS naming and immutable/named-copy checks belong to the publisher and have not been performed here.
