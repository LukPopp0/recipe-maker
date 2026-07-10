# UI Overhaul Design - "Fresh Market" (Phase 8.5 item 11)

Approved 2026-07-10 after brainstorming. Scope: whole app UI (Create + Library +
shared components); `card.css` untouched. Plain CSS + custom properties, no Tailwind.

## Decisions

- Floating buttons = sticky action tray AND proper button hierarchy
- Fixed header = single compact sticky bar merging title + Create/Library nav + status
- Layout = wizard-ish Create flow (Input collapses after extract, Review hero, JSON drawer)
- Colors = "Warmer market" pastel palette, loosely card-inspired
- Dark mode stays (system-driven via prefers-color-scheme)

## Palette (light / dark)

| Token | Light | Dark |
|---|---|---|
| --color-bg | #FBF8F2 warm white | #1D1B16 warm charcoal |
| --color-surface | #FFFFFF | #26231C |
| --color-tint (sage mist) | #EDF2E4 | #2A3026 |
| --color-tint-warm (peach mist) | #FBEEDF | #33291F |
| --color-accent (primary, market green) | #35845A | #6FBF8E (dark text on fills) |
| --color-accent-warm (soft coral) | #EF9A6D | #E89B70 |
| --color-danger | #C0392B | dark-safe red |
| --color-warning | #B8860B | keep |
| --color-text | #2A2A24 | #EFEDE3 |
| --color-text-muted | #6E6A5E | #A8A296 |
| --color-border | #E7E2D6 | #3A362C |

`--color-accent` stays the primary token name (purple removed by redefinition). New
tokens: `--color-tint`, `--color-tint-warm`, `--color-accent-warm`. Radii: md 12px,
lg 20px, pill full. Soft warm shadows. Success folds into the primary green family.

## Type

- Display/headings: Montserrat 700; body/UI: Lato 400/700 (both already self-hosted
  in `apps/web/src/assets/fonts/`; load fonts.css app-wide from index.css)
- JSON viewer keeps mono stack
- `--font-sans` becomes Lato-first; new `--font-display` (Montserrat)

## Layout and behavior

- Sticky top bar, one row: title (Montserrat), segmented Create/Library control,
  status chip (coral tint dirty, green tint saved, neutral idle)
- Create = centered column (~880px), numbered wizard stages (1 Input, 2 Review, 3 JSON):
  - Input collapses to slim summary row after successful extraction; click reopens;
    stays open during extraction
  - Review is the full-width hero
  - JSON is a collapsible drawer, default collapsed; keeps viewer + Copy + Download
- Signature: floating pill action tray, bottom-center sticky, only when a recipe is
  loaded in Create: Save Recipe (primary), Preview Card (secondary), save-state note;
  validation/save errors render anchored above the tray
- Library: white surface cards, rounded, tint hover; toolbar uses shared buttons
- Buttons: `.btn` pill base + `.btn-primary` / `.btn-secondary` / `.btn-ghost` /
  `.btn-danger`
- ErrorBanner / WarningsPanel: soft tinted backgrounds; empty states centered muted
- A11y: keep HIDDEN_PANEL_STYLE opacity trick; headings stay in DOM when collapsed;
  focus-visible in primary green; collapse animation respects reduced motion
