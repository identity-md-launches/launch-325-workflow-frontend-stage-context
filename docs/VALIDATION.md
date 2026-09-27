# Frontend validation

Worker validation completed on 2026-09-27. This is the contributor's evidence, not independent network certification. The delivered page uses the attested deployment, with source, lockfile and frontend configuration under `web/` and the complete static payload under `dist/`.

## Scope and choices

The approved workflow takes precedence over generic swap examples: Gavel is an auction page with GAVL acquisition instructions and **no in-page swap**. All six application actions and separate ERC-20 approvals are implemented. Browsing uses bounded contract views, not a backend/indexer. A single injected Ethereum wallet provider is supported without a WalletConnect project ID. No contract changes, deployment, transaction broadcast or publication occurred.

The overriding path budget permits only `web/**`, `dist/**`, `docs/**` and `web/.gitignore`. Accordingly the required design document is delivered at `docs/DESIGN.md`; a repository-root DESIGN.md would violate that budget. The only new dotfile is the explicitly permitted `web/.gitignore`.

## Commands and results

| Check | Actual result |
| --- | --- |
| `npm ci --prefix web --offline --cache /tmp/gavel-npm-cache --no-audit --no-fund` | Passed; 44 packages installed from the lockfile using a populated external cache |
| `npm run build --prefix web` | Passed; includes `tsc --noEmit`, Vite production build and pinned-ABI/manifest generation |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/gavel-browsers npm test --prefix web` | 13 tests passed, 38.5 seconds, Chromium 141 / Playwright 1.56.1 |
| `node web/scripts/check-deployment.mjs` | Passed read-only live Sepolia checks at block 11791607 |
| `node web/scripts/verify-export.mjs` | Passed handoff, network, ABI, inventory, SHA-256, path and size checks |

The supplied browser MCP tool failed immediately with `Transport closed`; it could not create its managed preview. A locally installed Playwright Chromium browser provided the rendered checks instead. The test runner owns a foreground static server and shuts it down after the suite. Tests load the actual final `dist/` at `/preview/`, proving subpath-relative assets/configuration work without server rewrites. Browser binaries and npm caches are outside the submission.

`validation/interactions.json` is the machine-readable Playwright result. It records:

1. Static subpath loading, empty/disconnected state, missing-wallet guidance, desktop/mobile reflow, axe and reduced motion.
2. Wrong-network gating and exact switch → add → switch parameters.
3. GAVL approval followed by a full bid; exact allowance/spender, GAVL precision and minimum, no ETH value, simulation, receipt refresh, seller and highest-bidder eligibility.
4. A six-decimal lot deposit with exact minor units; minimum reserve rejection; cancellation review/Escape/focus restoration and one-time claim controls.
5. Settlement with a winning bid and without a bid; winner/seller claims; withdrawal of GAVL credits.
6. Wallet rejection and simulation-revert errors without broadcasting.
7. Account-change dismissal of stale reviews and changed permissions.
8. Missing code, wrong RPC chain, unavailable reads and transaction gating.
9. ABI tampering rejection before controls render.
10. Six-lot bounded pagination, older lots and current-page activity filters.
11. Missing arbitrary-token metadata: raw unit display, blocked creation.
12. Populated responsive layouts, automated accessibility, dialog focus cycling and measured contrast.
13. Explicit wallet connect/disconnect, connection rejection recovery, excessive precision, insufficient funds, error association and focus.

All wallet transactions in these tests are **mocked**, with decoded calldata and resulting state checked. They do not attest real wallet-extension interoperability or chain execution. Test USDC metadata/addresses and balances are fixtures, not live token endorsements.

## Better Interface: all six domains

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native labels/buttons/disclosures; stable status and alert regions; invalid input associations; keyboard dialog entry, wrap, Escape and focus restoration. Axe reported zero violations for empty/error and populated pages at 1440, 820, 390, 320px and transaction review. No screen-reader or physical-device session. |
| Layout | Checked | Production screenshots and DOM overflow assertions at all four widths; working area stacks on mobile, full addresses are disclosed, 200% root-text enlargement at 320px passed. This is not browser-native zoom. RTL/localized content is not implemented/tested. |
| Writing | Checked | Labels match approve/create/bid/cancel/settle/claim/withdraw actions. Transaction previews describe funds and irreversibility; errors provide retry steps; separate approval and collection are explained. Unverified values display a dash. |
| Typography | Checked | Heading hierarchy, real text/amount wrapping, 16px inputs, tabular countdowns and long-address handling reviewed. System font fallbacks are intentional; no network font loading. No cross-platform font comparison. |
| Colors | Checked | Actual computed foreground/background pairs recorded in `contrast.json`; visible states and status text checked. Tested pairs range from 5.00:1 to 14.24:1. Axe also covers enabled dialog controls. This does not claim every hover/focus pair or forced-color environment was manually measured. |
| UI | Checked | Empty/loading/connected/disabled/rejected/simulated/confirmed states exercised. Native review overlay inspected; reduced-motion transition duration verified as zero. No image assets or staged animations; 10%-speed animation-panel playback not performed. |

Desktop and mobile screenshots were opened and visually inspected, as was the focused transaction-review screenshot. Content aligns within the intended surfaces with no observed clipping at those widths. Screenshots show controlled fixture states, except the missing-wallet error which is an actual local browser condition.

## Findings, corrections and rechecks

| Severity | Final source location | Evidence, correction and recheck |
| --- | --- | --- |
| Medium | `web/src/App.tsx:668` | Initial axe scan reported an unnecessary complementary landmark nested in main. Replaced the decorative rules aside with a neutral div. Final scans pass. |
| Medium | `web/src/App.tsx:1087` | Browser Tab after the final native dialog button did not immediately cycle to the first button. Added explicit Tab/Shift+Tab wrapping among available buttons; final browser focus assertions pass. Native modal inertness, Escape and trigger restoration remain. |
| Medium | `web/src/App.tsx:538`, `web/src/App.tsx:1254` | Source review found validation errors lacked field association/focus. Added invalid-field state, error descriptions and focus to the offending control. Excess-precision and reserve interactions passed; bid invalid/focus assertions pass. |
| Medium | `web/src/App.tsx:426` | Review found a successful replacement receipt could be described as the original action's success. Replacement/cancellation now produces a status-check error; repricing may confirm normally. Implemented and typechecked; this branch was not exercised by a real or mocked replacement. |
| Low | `web/src/style.css:909` | Screenshot review showed the withdrawal arrow wrapping below its label because the balance-label selector applied to its span. Added a specific inline override. Regenerated desktop/mobile screenshots confirm the final control. |

A separate initial test assertion compared an ABI-decoded checksummed address to a lowercase handoff string. Normalizing case corrected that test-only mismatch; transaction destination and amount were already correct.

## Live deployment evidence

`validation/live-chain.json` records chain ID 11155111 at block 11791607 using the first configured public RPC. LaunchToken had 1709 bytes of runtime code and LotAuction 5326 bytes. The auction's token getter matched the handoff GAVL address. The live lot count was zero. Reproduce these read-only checks with `web/scripts/check-deployment.mjs`; exact methods and pinned evidence block are recorded by the recipe and JSON. This verifies chain/presence/binding, not bytecode equivalence, cryptographic signature verification or economic correctness.

No live approval, bid, create, cancel, settle, claim, withdraw or swap was signed. A real wallet extension, replacement/cancellation receipts, confirmation timeout, sustained RPC outage, reorgs and adversarial lot-token transfers remain untested live behavior. Core state/error paths have the mocked coverage above. The app verifies ABIs against its manifest; the publisher remains responsible for the attested handoff and immutable delivery binding.

## Export and delivery

`validation/export.json` records **6 assets, 517648 total export bytes including the manifest**. Both canonical ABI Keccak hashes match the handoff. Every exported file other than `imd-deployment.json` is declared with its final lowercase SHA-256; there are no extra undeclared assets. The network and wallet-add blocks match the supplied input. Per-file, asset-count and response-body budget limits pass with ample room. Required ABI JSON remains included.

Only permitted paths are delivered; dependency directories, caches, archives and browser binaries are excluded. Read-only Git path/submodule checks and an uncompressed delivery-size audit passed; see `validation/delivery.json`. A final Git submission bundle could not be measured because the required commit is blocked by the workspace’s read-only `.git` directory. There are no published URLs or CIDs because publication belongs to the later control-plane stage. Those service checks have not run and are not claimed as browser validation.

Frontend implementation and worker validation are complete. The requested Git commit is **blocked by the environment**: `git add -- web dist docs` failed with `Unable to create .../.git/index.lock: Read-only file system`. No commit was created. Source, lockfile, static export and evidence remain as files in the permitted working-tree paths for collection. The root-document path conflict is resolved within `docs/`; the verification limitations above remain explicit.
