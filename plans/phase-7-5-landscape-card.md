# Phase 7.5: Landscape Card Variant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the originally intended landscape (11in x 8.5in) card layout as the default orientation, with a toolbar toggle back to the existing portrait layout.

**Architecture:** An `orientation` prop threads from CardView (which owns the toggle state, default `'landscape'`) into CardPage1/CardPage2 as a CSS class. All data logic (density buckets, ingredient bolding, image fallbacks, max 6 steps) is shared; only CSS differs. Page scaling is parameterized by page width. Print orientation is handled by a dynamically injected `@page { size: letter landscape }` style element.

**Tech Stack:** React 19 + TypeScript + Vite (`apps/web`), Vitest + React Testing Library (jsdom), plain CSS with real-world units (1in = 96px), self-hosted woff2 fonts.

## Global Constraints

Copied from `specs/10-recipe-card-renderer.md` (Landscape Variant section, locked 2026-07-07):

- Default orientation is landscape; toolbar button toggles; per-mount state only, no persistence.
- Landscape page geometry: 11in x 8.5in (1056 x 816 px at 96dpi).
- Landscape ingredient rail: 2 columns up to 12 ingredients; more than 12 widens to 3 columns; more than 18 shrinks tiles further. No hard cap - every ingredient always renders on page 1. Portrait keeps its existing "never a third column" rule.
- Landscape print: CardView injects `<style>@page { size: letter landscape; margin: 0 }</style>` while landscape is mounted, removes it on toggle/unmount. Portrait keeps the static portrait `@page` rule.
- Fonts: DIN Alternate role = self-hosted D-DIN bold; Helvetica role = self-hosted Inter 400/700; previous system stacks kept as fallbacks. Both orientations use the same stacks. Ingredient NAME uses the D-DIN stack, ingredient AMOUNT uses the Inter/Helvetica stack (per the spec typography table).
- Existing print guards stay and apply to both orientations: `body:has(.card-view)` visibility guard, `break-after: page` scoped to page 1 only, print-only `display: none` collapse of workspace chrome and `[inert]` panels.
- Repo conventions: ASCII only in comments, minimal targeted edits, Vitest + RTL.

Existing code contracts this plan builds on (already on main):

- `apps/web/src/lib/card-scale.ts` exports `CARD_PAGE_WIDTH_PX = 816`, `CARD_PAGE_HEIGHT_PX = 1056`, `CARD_PAGE_GAP_PX = 24`, `computeCardScale(containerWidth): CardScaleLayout`.
- `apps/web/src/components/card/useCardScale.ts` exports `useCardScale(ref)` returning `{ scale, sideBySide }`.
- `apps/web/src/components/card/CardView.tsx` renders toolbar (Back, Print / Save PDF) and two `PageFrame`s.
- `CardPage1` emits `data-density` on `.card-ingredients`: `regular` (<=12), `compact` (>12), `tight` (>18).
- Test commands: `pnpm --filter web run test -- run <file>` (vitest), full suite `pnpm --filter web run test -- run`.

---

### Task 1: Parameterize card scaling by orientation

**Files:**
- Modify: `apps/web/src/lib/card-scale.ts`
- Modify: `apps/web/src/lib/card-scale.test.ts`
- Modify: `apps/web/src/components/card/useCardScale.ts`

**Interfaces:**
- Consumes: existing `computeCardScale`, `CardScaleLayout`.
- Produces (later tasks rely on these exact names):
  - `type CardPageDimensions = { width: number; height: number }`
  - `CARD_PORTRAIT: CardPageDimensions` (816 x 1056)
  - `CARD_LANDSCAPE: CardPageDimensions` (1056 x 816)
  - `computeCardScale(containerWidth: number, pageWidth?: number): CardScaleLayout` (pageWidth defaults to portrait width, so existing callers/tests keep working)
  - `useCardScale(ref, pageWidth?: number): CardScaleLayout`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/card-scale.test.ts` (keep existing tests untouched):

```typescript
import { CARD_LANDSCAPE, CARD_PORTRAIT } from './card-scale.ts';

describe('orientation dimensions', () => {
  it('exports portrait and landscape letter dimensions', () => {
    expect(CARD_PORTRAIT).toEqual({ width: 816, height: 1056 });
    expect(CARD_LANDSCAPE).toEqual({ width: 1056, height: 816 });
  });

  it('computes side-by-side scale from the given page width', () => {
    // 2 landscape pages + gap: (2136 - 24) / (2 * 1056) = 1.0
    expect(computeCardScale(2136, CARD_LANDSCAPE.width)).toEqual({ scale: 1, sideBySide: true });
    // Same container with portrait width scales differently (default arg)
    expect(computeCardScale(2136).sideBySide).toBe(true);
  });

  it('stacks landscape pages when side-by-side would be unreadable', () => {
    const layout = computeCardScale(900, CARD_LANDSCAPE.width);
    expect(layout.sideBySide).toBe(false);
    expect(layout.scale).toBeCloseTo(900 / 1056);
  });
});
```

Adjust the import line at the top of the test file to include the new names (single import statement, no duplicate imports).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- run src/lib/card-scale.test.ts`
Expected: FAIL - `CARD_PORTRAIT` / `CARD_LANDSCAPE` not exported.

- [ ] **Step 3: Implement**

Replace `apps/web/src/lib/card-scale.ts` with:

```typescript
// Preview scaling for the fixed letter-size card pages (specs/10): the pages
// themselves never reflow, only this scale changes. Side-by-side preview is
// used while each scaled page stays at least ~45% size (readable); below
// that the pages stack vertically.
export type CardPageDimensions = { width: number; height: number };

export const CARD_PORTRAIT: CardPageDimensions = { width: 816, height: 1056 }; // 8.5in x 11in at 96dpi
export const CARD_LANDSCAPE: CardPageDimensions = { width: 1056, height: 816 }; // 11in x 8.5in at 96dpi

// Kept for existing callers/tests; portrait is the original geometry.
export const CARD_PAGE_WIDTH_PX = CARD_PORTRAIT.width;
export const CARD_PAGE_HEIGHT_PX = CARD_PORTRAIT.height;
export const CARD_PAGE_GAP_PX = 24;

const MIN_SIDE_BY_SIDE_SCALE = 0.45;

export type CardScaleLayout = { scale: number; sideBySide: boolean };

export function computeCardScale(
  containerWidth: number,
  pageWidth: number = CARD_PORTRAIT.width,
): CardScaleLayout {
  if (containerWidth <= 0) return { scale: 1, sideBySide: false };

  const sideBySideScale = (containerWidth - CARD_PAGE_GAP_PX) / (2 * pageWidth);
  if (sideBySideScale >= MIN_SIDE_BY_SIDE_SCALE) {
    return { scale: Math.min(1, sideBySideScale), sideBySide: true };
  }
  return { scale: Math.min(1, containerWidth / pageWidth), sideBySide: false };
}
```

Update `apps/web/src/components/card/useCardScale.ts` to accept and forward the page width (re-measure when it changes):

```typescript
// Measures the preview container and derives the page scale/arrangement.
// Guards for jsdom: no ResizeObserver means measure once and stay there.
import { useEffect, useState, type RefObject } from 'react';
import { CARD_PORTRAIT, computeCardScale, type CardScaleLayout } from '../../lib/card-scale.ts';

export function useCardScale(
  ref: RefObject<HTMLElement | null>,
  pageWidth: number = CARD_PORTRAIT.width,
): CardScaleLayout {
  const [layout, setLayout] = useState<CardScaleLayout>({ scale: 1, sideBySide: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => setLayout(computeCardScale(element.clientWidth, pageWidth));
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, pageWidth]);

  return layout;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- run src/lib/card-scale.test.ts src/components/card`
Expected: PASS (new tests plus all existing card tests - the default arg keeps old behavior identical).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/card-scale.ts apps/web/src/lib/card-scale.test.ts apps/web/src/components/card/useCardScale.ts
git commit -m "feat: parameterize card preview scaling by page orientation"
```

---

### Task 2: Self-hosted Inter and D-DIN fonts

**Files:**
- Create: `apps/web/src/assets/fonts/inter-400.woff2`
- Create: `apps/web/src/assets/fonts/inter-700.woff2`
- Create: `apps/web/src/assets/fonts/d-din-700.woff2`
- Create: `apps/web/src/assets/fonts/OFL-inter.txt`
- Create: `apps/web/src/assets/fonts/OFL-d-din.txt`
- Modify: `apps/web/src/assets/fonts/fonts.css`
- Modify: `apps/web/src/components/card/card.css` (font stacks only)

**Interfaces:**
- Consumes: existing `fonts.css` / `card.css` font declarations.
- Produces: font families `'Inter'` (400/700) and `'D-DIN'` (700) available to card CSS. Later tasks reference the stacks by these exact names.

No TDD for binary assets; verification is build + font-face wiring.

- [ ] **Step 1: Download fonts (pinned URLs, all verified reachable at plan time)**

```bash
cd apps/web/src/assets/fonts
curl -sL -o inter-400.woff2 "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2"
curl -sL -o inter-700.woff2 "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYAZ9hiA.woff2"
curl -sL -o d-din-700.woff2 "https://raw.githubusercontent.com/amcchord/datto-d-din/e199c8441e758d6e492cd01ef52c3c67ba4bae26/D-DIN-Bold.woff2"
curl -sL -o OFL-inter.txt "https://raw.githubusercontent.com/rsms/inter/master/LICENSE.txt"
curl -sL -o OFL-d-din.txt "https://raw.githubusercontent.com/amcchord/datto-d-din/e199c8441e758d6e492cd01ef52c3c67ba4bae26/OFL-1.1.txt"
```

Sanity check each file: `file *.woff2` must report "Web Open Font Format (Version 2)" for all three; both license files must start with SIL Open Font License text. If any download is wrong, STOP and report BLOCKED - do not substitute other sources.

- [ ] **Step 2: Register the font faces**

Append to `apps/web/src/assets/fonts/fonts.css`:

```css
/* Inter (SIL OFL, OFL-inter.txt) serves the template's Helvetica roles;
   D-DIN (SIL OFL, OFL-d-din.txt) serves the DIN Alternate role. */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('./inter-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('./inter-700.woff2') format('woff2');
}
@font-face {
  font-family: 'D-DIN';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('./d-din-700.woff2') format('woff2');
}
```

- [ ] **Step 3: Switch card.css stacks to the self-hosted fonts**

In `apps/web/src/components/card/card.css`, make exactly these replacements (old stacks stay as fallbacks):

```css
.card-ingredient-name {
  font-family: 'D-DIN', 'DIN Alternate', Bahnschrift, 'Arial Narrow', Arial, sans-serif;
  font-weight: 700;
  font-size: 7pt;
}

.card-ingredient-amount {
  font-family: 'Inter', Helvetica, 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  font-size: 7pt;
}
```

And replace `font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;` with `font-family: 'Inter', Helvetica, 'Helvetica Neue', Arial, sans-serif;` in the two remaining rules that use it (`.card-pantry` and `.card-step-description`).

- [ ] **Step 4: Verify build and tests**

Run: `pnpm --filter web run build && pnpm --filter web run test -- run`
Expected: build succeeds (woff2 assets emitted), all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/assets/fonts apps/web/src/components/card/card.css
git commit -m "feat: self-host Inter and D-DIN fonts for card typography"
```

---

### Task 3: Orientation state, toolbar toggle, and print @page injection

**Files:**
- Modify: `apps/web/src/components/card/CardView.tsx`
- Modify: `apps/web/src/components/card/CardView.test.tsx`
- Modify: `apps/web/src/components/card/CardPage1.tsx` (accept orientation prop)
- Modify: `apps/web/src/components/card/CardPage2.tsx` (accept orientation prop)

**Interfaces:**
- Consumes: `CARD_PORTRAIT`, `CARD_LANDSCAPE`, `CardPageDimensions`, `useCardScale(ref, pageWidth)` from Task 1.
- Produces:
  - `type CardOrientation = 'landscape' | 'portrait'` exported from `CardView.tsx`
  - `CardPage1`/`CardPage2` props become `{ recipe: CanonicalRecipe; orientation?: CardOrientation }` (default `'portrait'` so existing page tests pass unchanged); when `'landscape'`, the page `<section>` gains the class `card-page--landscape`.
  - Root `.card-view` gains `card-view--landscape` class when landscape (Task 4 CSS hooks onto both classes).
  - Toggle button accessible name: `Portrait layout` when landscape is shown, `Landscape layout` when portrait is shown (the button names the layout it switches TO).

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/components/card/CardView.test.tsx` (reuse the file's existing recipe fixture and render helper; adjust names to match):

```typescript
describe('orientation toggle', () => {
  it('defaults to landscape and toggles to portrait and back', async () => {
    const user = userEvent.setup();
    render(<CardView recipe={recipe} onBack={() => {}} />);

    expect(screen.getByRole('region', { name: 'Recipe card page 1' })).toHaveClass('card-page--landscape');

    await user.click(screen.getByRole('button', { name: 'Portrait layout' }));
    expect(screen.getByRole('region', { name: 'Recipe card page 1' })).not.toHaveClass('card-page--landscape');

    await user.click(screen.getByRole('button', { name: 'Landscape layout' }));
    expect(screen.getByRole('region', { name: 'Recipe card page 2' })).toHaveClass('card-page--landscape');
  });

  it('injects the landscape @page style only while landscape is shown', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CardView recipe={recipe} onBack={() => {}} />);

    const findPageStyle = () =>
      Array.from(document.head.querySelectorAll('style')).find((el) =>
        el.textContent?.includes('size: letter landscape'),
      );

    expect(findPageStyle()).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Portrait layout' }));
    expect(findPageStyle()).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Landscape layout' }));
    expect(findPageStyle()).toBeDefined();

    unmount();
    expect(findPageStyle()).toBeUndefined();
  });
});
```

If the test file does not already import `userEvent`, add `import userEvent from '@testing-library/user-event';`.

Note: existing CardView tests that assume portrait defaults (if any assert page frame sizes) must be updated to landscape expectations - inspect the file and adjust; default is now landscape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- run src/components/card/CardView.test.tsx`
Expected: FAIL - no `card-page--landscape` class, no toggle button.

- [ ] **Step 3: Implement**

Replace `apps/web/src/components/card/CardView.tsx` with:

```typescript
// Card preview container: toolbar (Back, orientation toggle, Print/Save
// PDF) plus the two letter-size pages inside scale frames. The frame div
// reserves the scaled footprint (transform does not affect layout size);
// print CSS strips the toolbar/labels and resets the scale so output is
// 1:1. Landscape is the template's original orientation and the default.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CanonicalRecipe } from 'shared';
import { CARD_LANDSCAPE, CARD_PORTRAIT, type CardPageDimensions } from '../../lib/card-scale.ts';
import { useCardScale } from './useCardScale.ts';
import { CardPage1 } from './CardPage1.tsx';
import { CardPage2 } from './CardPage2.tsx';
import './card.css';

export type CardOrientation = 'landscape' | 'portrait';

function PageFrame({
  scale,
  dimensions,
  label,
  children,
}: {
  scale: number;
  dimensions: CardPageDimensions;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="card-page-slot">
      <div
        className="card-page-frame"
        style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
      >
        <div className="card-page-scaler" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
      <p className="card-page-label">{label}</p>
    </div>
  );
}

// @page rules cannot be scoped by selector, so landscape print orientation
// is toggled by injecting a style element while the landscape card is shown.
function useLandscapePageStyle(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const style = document.createElement('style');
    style.textContent = '@page { size: letter landscape; margin: 0; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [active]);
}

export function CardView({ recipe, onBack }: { recipe: CanonicalRecipe; onBack: () => void }) {
  const [orientation, setOrientation] = useState<CardOrientation>('landscape');
  const landscape = orientation === 'landscape';
  const dimensions = landscape ? CARD_LANDSCAPE : CARD_PORTRAIT;
  const pagesRef = useRef<HTMLDivElement>(null);
  const { scale, sideBySide } = useCardScale(pagesRef, dimensions.width);

  useLandscapePageStyle(landscape);

  return (
    <div className={landscape ? 'card-view card-view--landscape' : 'card-view'}>
      <div className="card-view-toolbar">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          onClick={() => setOrientation(landscape ? 'portrait' : 'landscape')}
        >
          {landscape ? 'Portrait layout' : 'Landscape layout'}
        </button>
        <button type="button" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>
      <div ref={pagesRef} className={sideBySide ? 'card-view-pages card-view-pages-row' : 'card-view-pages'}>
        <PageFrame scale={scale} dimensions={dimensions} label="Page 1">
          <CardPage1 recipe={recipe} orientation={orientation} />
        </PageFrame>
        <PageFrame scale={scale} dimensions={dimensions} label="Page 2">
          <CardPage2 recipe={recipe} orientation={orientation} />
        </PageFrame>
      </div>
    </div>
  );
}
```

In `apps/web/src/components/card/CardPage1.tsx`, change the component signature and root section (body unchanged):

```typescript
import type { CardOrientation } from './CardView.tsx';

export function CardPage1({
  recipe,
  orientation = 'portrait',
}: {
  recipe: CanonicalRecipe;
  orientation?: CardOrientation;
}) {
  const pageClass =
    orientation === 'landscape' ? 'card-page card-page-1 card-page--landscape' : 'card-page card-page-1';
  // ... existing mainImageFailed state unchanged ...
  return (
    <section className={pageClass} aria-label="Recipe card page 1">
```

Apply the same pattern to `CardPage2.tsx` (`card-page card-page-2 card-page--landscape`).

Import note: `CardView.tsx` imports the pages and the pages import `CardOrientation` from `CardView.tsx`. This is a type-only import cycle - TypeScript allows it and Vite erases it, but keep the import as `import type` so no runtime cycle exists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- run src/components/card`
Expected: PASS, including untouched CardPage1/CardPage2 tests (orientation defaults to portrait there).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/card
git commit -m "feat: orientation toggle with landscape default and print page-size injection"
```

---

### Task 4: Landscape layout CSS

**Files:**
- Modify: `apps/web/src/components/card/card.css`
- Modify: `apps/web/src/components/card/CardPage1.test.tsx` (landscape class + 3-column rail assertions)

**Interfaces:**
- Consumes: `card-page--landscape` and `card-view--landscape` classes from Task 3; existing `data-density` attribute (`compact` >12, `tight` >18) from CardPage1.
- Produces: complete landscape visual layout. No new JS API.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/components/card/CardPage1.test.tsx` (reuse the file's fixture helpers):

```typescript
it('adds the landscape page class when orientation is landscape', () => {
  render(<CardPage1 recipe={recipe} orientation="landscape" />);
  expect(screen.getByRole('region', { name: 'Recipe card page 1' })).toHaveClass('card-page--landscape');
});

it('keeps emitting density buckets used by the landscape 3-column rail', () => {
  const many = { ...recipe, ingredients: Array.from({ length: 14 }, (_, i) => makeIngredient(`Ing ${i}`)) };
  render(<CardPage1 recipe={many} orientation="landscape" />);
  expect(screen.getByRole('list', { name: 'Ingredients' })).toHaveAttribute('data-density', 'compact');
});
```

If the test file has no `makeIngredient` helper, build the 14-ingredient array inline matching the fixture's ingredient shape.

Note: jsdom does not compute grid layout, so the 3-column rule itself is CSS-only and verified manually (controller does Playwright verification after merge); the test locks the `data-density` contract the CSS keys on.

- [ ] **Step 2: Run test to verify the first one fails**

Run: `pnpm --filter web run test -- run src/components/card/CardPage1.test.tsx`
Expected: the landscape-class test FAILS only if Task 3 was not applied; if Task 3 is in place both may pass - that is fine, they lock the contract for the CSS below. Proceed either way.

- [ ] **Step 3: Add landscape CSS**

Append to `apps/web/src/components/card/card.css`, directly before the `/* Screen preview wrapper */` comment:

```css
/* Landscape variant (specs/10 Landscape Variant): same DOM, different
   geometry. Page is 11in x 8.5in; page 1 keeps image-left/rail-right but
   the rail may widen to 3 columns (never in portrait); page 2 keeps the
   3x2 step grid on the wider, shorter page. */
.card-page--landscape {
  width: 11in;
  height: 8.5in;
}

/* Page 1: slightly wider rail; regular density stays 2 columns x 6 rows */
.card-page--landscape .card-ingredients {
  width: 1.9in;
}

/* More than 12 ingredients: widen to 3 columns, image area narrows */
.card-page--landscape .card-ingredients[data-density='compact'] {
  width: 2.7in;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.12in 0.1in;
}
.card-page--landscape .card-ingredients[data-density='compact'] .card-ingredient-image {
  width: 0.5in;
  height: 0.5in;
}

/* More than 18: keep 3 columns, shrink tiles so everything still fits */
.card-page--landscape .card-ingredients[data-density='tight'] {
  width: 2.7in;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.06in 0.08in;
}
.card-page--landscape .card-ingredients[data-density='tight'] .card-ingredient-image {
  width: 0.38in;
  height: 0.38in;
}

/* Page 2: wider, shorter step columns - trim the image band so two rows
   of steps fit the 7.7in content height */
.card-page--landscape .card-step-image {
  height: 1.2in;
}
```

In the print block of `card.css`, make the frame reset orientation-aware. Replace:

```css
  .card-page-frame {
    width: 8.5in !important;
    height: 11in !important;
    overflow: visible;
  }
```

with:

```css
  .card-page-frame {
    width: 8.5in !important;
    height: 11in !important;
    overflow: visible;
  }

  .card-view--landscape .card-page-frame {
    width: 11in !important;
    height: 8.5in !important;
  }
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter web run test -- run src/components/card && pnpm --filter web run build`
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/card
git commit -m "feat: landscape card layout CSS with 3-column ingredient rail"
```

---

### Task 5: Docs update

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `plans/recipe-maker-implementation-plan.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Update README.md**

In the card rendering description, state: the card renders in landscape (11in x 8.5in, the original template orientation) by default, with a toolbar toggle to the portrait (8.5in x 11in) layout; printing follows the on-screen orientation automatically. Keep the existing description of pages/content accurate - only orientation wording changes plus the toggle mention. Mention the self-hosted fonts now include Inter and D-DIN (both SIL OFL).

- [ ] **Step 2: Update CLAUDE.md status**

In the `## Status` section, extend the Phase 7 sentence with: "Phase 7.5 added the landscape (default) card orientation with a portrait toggle and self-hosted Inter/D-DIN fonts (specs/10 Landscape Variant)." Keep "Next: Phase 8 quality/testing/hardening."

- [ ] **Step 3: Update the main implementation plan**

In `plans/recipe-maker-implementation-plan.md`, add a short "Phase 7.5 (Done): landscape card variant" note next to the Phase 7 entry, referencing `specs/10-recipe-card-renderer.md` Landscape Variant section and `plans/phase-7-5-landscape-card.md`.

- [ ] **Step 4: Verify docs are consistent**

Re-read the three changed sections; confirm no doc still claims portrait-only cards or system-font DIN/Helvetica stacks. Run `pnpm --filter web run test -- run` once more to confirm nothing else drifted.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md plans/recipe-maker-implementation-plan.md
git commit -m "docs: Phase 7.5 landscape card variant"
```

---

## Post-merge manual verification (controller, not a task)

Via Playwright headless Chromium against `pnpm dev`:

1. Library "View as Card" and Create "Preview Card" both open in landscape by default; toggle switches to portrait and back; Back preserves state.
2. Print both orientations to PDF: landscape PDF is 2 landscape letter sheets, portrait PDF is 2 portrait letter sheets. IMPORTANT: call `page.emulateMedia({ media: null })` before `page.pdf()` (screen emulation poisons pdf rendering) and count pages via the `/Count` entry of the Pages object.
3. Fonts embedded: PDF contains Inter and D-DIN subsets (FontFile2 present).
4. A >12-ingredient recipe shows a 3-column rail in landscape and 2 columns in portrait.
5. Cmd+P on a normal (non-card) view still prints app content (guards intact).
