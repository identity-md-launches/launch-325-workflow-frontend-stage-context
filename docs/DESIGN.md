# Gavel — implemented design

## Overview

A single auction room for Sepolia ERC-20 sellers and bidders. Warm paper surfaces, dark green actions, editorial serif headings and plain sans-serif controls keep auction terms and transaction steps readable. A large introduction establishes the room; a shared balance strip precedes the working area. Lots and their controls are the primary content, with creation beside them on larger screens.

This file is under `docs/` because the assignment's overriding write scope prohibits repository-root files. It serves the requested DESIGN.md purpose without changing protected root paths. Design choices are implementation decisions, not a claim of prior user approval.

## Colors

Source of truth: `web/src/style.css:1`. The final palette uses sRGB hex values; there is one light theme.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f2eb` | Page background |
| `--surface` | `#fffdf8` | Lot cards, creation panel, fields, dialog |
| `--text` | `#252b25` | Main text |
| `--muted` | `#5c655b` | Supporting text and labels |
| `--line` | `#d6d8cc` | Structural separators |
| `--input-border` | `#858e7f` | Visible field and button boundaries |
| `--accent` / `--accent-hover` | `#344e37` / `#253e29` | Filled primary action |
| `--accent-text` | `#ffffff` | Primary action label |
| `--soft` | `#e7ebdf` | Balance strip, tags, disabled controls |
| `--warning` | `#f5e8c7` | Wrong-network notice |
| `--error` | `#9d3029` | Recoverable errors |
| `--focus` | `#315d92` | Three-pixel keyboard outline |

Measured rendered pairs are in `validation/contrast.json`: body/page 12.95:1, text/card 14.24:1, supporting text/card 5.96:1, disabled primary label/soft background 5.00:1. The last value describes a disabled button, not the enabled primary color pair. Automated axe scans also exercised the enabled dialog controls. Colors accompany words such as Open, Cancelled and Settled; color alone never indicates eligibility.

## Typography

`style.css` uses local system families only: Arial/Helvetica/sans-serif for body and controls; Georgia/Times New Roman/serif for display and section headings; monospace for the wallet shorthand. No font download is required. Screenshot rendering uses available platform fallbacks, not bundled typefaces.

Body is 1rem with 1.55 line-height. H1 is `clamp(3.7rem, 7.2vw, 6.4rem)`, 400 weight, 0.99 line-height and -0.065em tracking. H2 is normally 2rem/1.1 with -0.035em tracking; creation and rules have smaller section variants. Lot amounts are 1.65rem serif. Labels are .8125rem/600; inputs are 1rem at every width. Uppercase eyebrow captions are .6875rem/700 with .13em tracking. Small supporting copy ranges from .6875 to .8125rem. Headings balance wraps and body descriptions use pretty wrapping.

Changing amounts and countdowns use tabular figures. Amounts and addresses wrap rather than overflowing. Shorthand addresses link to their full explorer destinations; lot details and the network disclosure expose full selectable addresses. Token metadata uses `bdi` and strips directional controls.

## Layout

`style.css:318` defines the working grid. Outer content is at most 1264px including 48px desktop inline gutters. The two-column work area uses `minmax(0,1.65fr) minmax(280px,1fr)` with a 48px gap. Lot cards use 24px padding; creation uses 28px. Internal group gaps are commonly 8–12px; section gaps are 24–64px. Forms, buttons and pagination remain in normal document flow.

At 65rem, gutters become 28px, the work gap becomes 24px, the brand subtitle disappears, the balance strip uses two columns plus a full-row withdrawal area, and rules use two columns. At 47rem, gutters become 20px and both hero and workspace become one column. At 24rem, gutters become 16px, form rows and bid actions stack, and the decorative network pill is hidden; network identity remains in contract details and footer. `min-width: 0`, wrapping addresses and no fixed text heights support narrow layouts.

The final export was exercised at 1440, 820, 390 and 320 CSS pixels, plus 200% root-text enlargement at 320px. Desktop/mobile screenshots were visually inspected. Native browser 200% zoom and RTL localization were not tested.

## Elevation & Depth

A deliberately flat system: structural one-pixel borders distinguish cards and fields. The balance strip uses a tonal background. There are no card shadows, gradients, image backgrounds or floating navigation. The only overlay is a native modal dialog with a `#252b2577` backdrop.

## Shapes

Cards and notices use 8px radii, fields 5px, buttons 6px and the dialog 12px. Status pills are rounded. The desktop circular `g.` mark is text and CSS, not an external image. No decorative assets are required.

## Components

- `App` (`web/src/App.tsx`) owns the runtime status, wallet connection, balance strip, creation form, paginated lots, rules and deployment disclosure. Loading, missing wallet, wrong network, stale/error state and confirmation status are explicit.
- `LotCard` in the same file renders a token lot, status, exact GAVL threshold, live countdown, separate approval/payment steps and eligibility-dependent cancel/settle/claim actions. Details use the browser's native disclosure.
- Buttons use neutral outline, `.primary`, `.quiet` and `.text-button` variants. Unavailable transactions use real `disabled` controls and adjacent instructions. Touch controls are at least 44px high; native text links retain ordinary inline behavior.
- Inputs use persistent wrapping labels. Errors are linked through `aria-describedby`; invalid amount/reserve fields are marked and focused. Amount fields use decimal input mode but preserve strings until BigInt parsing.
- The transaction review is a native `dialog` opened with `showModal()`. It previews amount, contract and network. Tab/Shift+Tab wrap through available dialog buttons; Escape cancels and focus returns to the trigger. One filled confirmation button is emphasized in the dialog.
- Stable status/alert regions communicate async progress and errors. Countdown ticks are not announced every second.

Focus uses a visible three-pixel outline with a four-pixel offset. Hover is enabled only for hover-capable pointers. In reduced-motion mode there are no transitions; otherwise button background/press feedback lasts 120ms and pressed buttons scale to .96. Forced-color mode uses system outline/border colors.

## Do's and Don'ts

Use the existing page gutters, section headings, surface tokens and native form elements. Keep each approval visibly separate from its payment and state the exact amount before signature. Preserve uppercase GAVL in amounts, full-address access, token-decimal formatting and units. Keep the runtime manifest as the sole deployment configuration.

Do not add remote fonts, decorative assets, price estimates or a second network map. Do not represent unverified balances as zero. For an additional section, reuse the section heading and surface patterns, place it in the main document flow, and check it at 320px before adding a breakpoint. Dark mode, additional pages and localization are not part of this implementation.

## Attribution

Design review applies the pinned Better Interface guidance adapted from Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method is adapted from Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. The supplied guide remains the provenance source; this document records implemented values rather than redistributing either guide.
