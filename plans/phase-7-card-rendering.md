# Phase 7: Milestone 2 Card Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a two-page, letter-size, printable recipe card from canonical JSON, matching the product owner's template, reachable from the Library detail view and the Create workspace.

**Architecture:** Frontend-only. A new `apps/web/src/components/card/` module renders two fixed 8.5in x 11in page boxes (all layout in in/pt units); a scale-to-fit wrapper shrinks them for screen preview and print CSS removes the scale so print output is 1:1 identical to the preview. Card components accept a `CanonicalRecipe` prop and never fetch. Two small pure libs (`step-emphasis`, `card-scale`, `tag-palette`) carry the testable logic.

**Tech Stack:** React + TypeScript (Vite), Vitest + React Testing Library (jsdom), shared types from the `shared` workspace package, self-hosted woff2 fonts (Montserrat 700, Lato 400/700, SIL OFL).

## Global Constraints

- ASCII only in code, comments, and copy. No emojis, no emdashes.
- Comments concise; explain constraints, not mechanics.
- No new npm dependencies. No router.
- Tests run with `pnpm --filter web run test` from the repo root.
- Components never mutate props; card components are pure render (no fetch, no global state).
- Design source of truth: specs/10-recipe-card-renderer.md "Design Template (locked during Phase 7 planning)" section, including the typography table. Copy exact values from there if this plan and the spec ever disagree.
- Colors: pantry `#225022` on `#B7C98D`; step title `#FFFFFF` on `#2E6E32`; tag palette `#4C5270`/white, `#F3C3BD`/`#C0392B`, `#2E6E32`/white.
- Page geometry: 8.5in x 11in, 0.4in padding, 1in = 96px CSS. Steps grid 3 cols x 2 rows, fill order 1,2,3 / 4,5,6.
- Schema guarantees: `steps` length 1-6, `main_image` non-empty, `time` nullable, `tags` max 5. Never render more than 6 steps regardless.
- Server-side PDF is Phase 9. Phase 7 download = `window.print()` + print CSS only.

---

### Task 1: Fonts and static assets groundwork

**Files:**
- Create: `apps/web/src/assets/fonts/montserrat-700.woff2`, `apps/web/src/assets/fonts/lato-400.woff2`, `apps/web/src/assets/fonts/lato-700.woff2`, `apps/web/src/assets/fonts/OFL.txt` (downloaded)
- Create: `apps/web/src/assets/fonts/fonts.css`
- Move: `shared/assets/pina-logo.png` -> `apps/web/src/assets/pina-logo.png`
- Move: `shared/assets/favicon.png` -> `apps/web/public/favicon.png`
- Modify: `apps/web/index.html`

**Interfaces:**
- Consumes: nothing.
- Produces: `fonts.css` (imported by `card.css` in Task 6); `apps/web/src/assets/pina-logo.png` (imported by `CardPage1.tsx` in Task 4 as `import pinaLogo from '../../assets/pina-logo.png'`).

- [ ] **Step 1: Move the image assets**

`shared/assets` stays the canonical home for ingredient images only; the card logo and favicon are web-app assets. Both files are currently untracked (`??` in git status), so plain `mv`:

```bash
mkdir -p apps/web/public apps/web/src/assets/fonts
mv shared/assets/pina-logo.png apps/web/src/assets/pina-logo.png
mv shared/assets/favicon.png apps/web/public/favicon.png
```

- [ ] **Step 2: Point index.html at the new favicon**

In `apps/web/index.html` replace the icon link (the referenced `/favicon.svg` never existed):

```html
<link rel="icon" type="image/png" href="/favicon.png" />
```

Leave the `<title>` as is.

- [ ] **Step 3: Download the woff2 fonts and license**

Run from the repo root (node script fetches the Google Fonts css2 stylesheet with a browser UA so it serves woff2, then downloads the latin-subset files):

```bash
cd apps/web/src/assets/fonts
node - <<'EOF'
const https = require('https');
const fs = require('fs');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const cssUrl = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@700&family=Lato:wght@400;700&display=block';
function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}
(async () => {
  const css = (await get(cssUrl)).toString();
  const wanted = { 'montserrat-700': null, 'lato-400': null, 'lato-700': null };
  for (const block of css.split('@font-face').slice(1)) {
    if (!block.includes('U+0000-00FF')) continue; // latin subset only
    const family = /font-family: '([^']+)'/.exec(block)[1].toLowerCase();
    const weight = /font-weight: (\d+)/.exec(block)[1];
    const url = /url\((https:[^)]+\.woff2)\)/.exec(block)[1];
    wanted[`${family}-${weight}`] = url;
  }
  for (const [name, url] of Object.entries(wanted)) {
    if (!url) throw new Error(`no latin woff2 found for ${name}`);
    fs.writeFileSync(`${name}.woff2`, await get(url));
    console.log(`wrote ${name}.woff2`);
  }
})();
EOF
curl -fsS -o OFL.txt https://raw.githubusercontent.com/google/fonts/main/ofl/lato/OFL.txt
cd -
```

Expected output: three `wrote *.woff2` lines. Verify: `file apps/web/src/assets/fonts/*.woff2` reports "Web Open Font Format (Version 2)" for all three.

- [ ] **Step 4: Create fonts.css**

Create `apps/web/src/assets/fonts/fonts.css`:

```css
/* Self-hosted card fonts. Montserrat and Lato are both SIL OFL (see
   OFL.txt); only the weights the card uses are bundled. font-display:
   block because the card is print output - a flash of fallback font
   would change line breaks between preview and print. */
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('./montserrat-700.woff2') format('woff2');
}
@font-face {
  font-family: 'Lato';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('./lato-400.woff2') format('woff2');
}
@font-face {
  font-family: 'Lato';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('./lato-700.woff2') format('woff2');
}
```

- [ ] **Step 5: Verify the build still passes**

Run: `pnpm --filter web run build`
Expected: clean build (nothing imports the new files yet; this catches index.html mistakes).

Run: `pnpm --filter web run test`
Expected: PASS (no behavior change).

- [ ] **Step 6: Commit**

```bash
git add apps/web/index.html apps/web/public/favicon.png apps/web/src/assets
git commit -m "feat(web): add self-hosted card fonts, move logo and favicon into web app"
```

---

### Task 2: step-emphasis lib (auto-bold ingredient mentions)

**Files:**
- Create: `apps/web/src/lib/step-emphasis.ts`
- Test: `apps/web/src/lib/step-emphasis.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 5):

```ts
export type TextSegment = { text: string; bold: boolean };
export function emphasizeIngredients(description: string, ingredientNames: string[]): TextSegment[]
```

Concatenating all segment texts always reproduces `description` exactly.

- [ ] **Step 1: Write the failing tests**

Create `step-emphasis.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emphasizeIngredients } from './step-emphasis.ts';

describe('emphasizeIngredients', () => {
  it('bolds a case-insensitive whole-word ingredient mention', () => {
    expect(emphasizeIngredients('Cut Potatoes into rounds.', ['potatoes'])).toEqual([
      { text: 'Cut ', bold: false },
      { text: 'Potatoes', bold: true },
      { text: ' into rounds.', bold: false },
    ]);
  });

  it('matches simple s/es plural variants of a singular name', () => {
    const segments = emphasizeIngredients('Add the potatoes and 2 tomatoes.', ['potato', 'tomato']);
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(['potatoes', 'tomatoes']);
  });

  it('does not bold partial-word matches', () => {
    const segments = emphasizeIngredients('Grease the pan generously.', ['pea']);
    expect(segments).toEqual([{ text: 'Grease the pan generously.', bold: false }]);
  });

  it('prefers the longest matching name on overlap', () => {
    const segments = emphasizeIngredients('Drizzle olive oil on top.', ['oil', 'olive oil']);
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(['olive oil']);
  });

  it('escapes regex metacharacters in names instead of crashing', () => {
    const segments = emphasizeIngredients('Use chili (fresh) now.', ['chili (fresh']);
    expect(segments.map((s) => s.text).join('')).toBe('Use chili (fresh) now.');
  });

  it('returns one unbolded segment when there are no names', () => {
    expect(emphasizeIngredients('Just stir.', [])).toEqual([{ text: 'Just stir.', bold: false }]);
  });

  it('returns an empty array for an empty description', () => {
    expect(emphasizeIngredients('', ['potato'])).toEqual([]);
  });

  it('round-trips: concatenated segments equal the input', () => {
    const description = 'Add potatoes, then more potatoes, then salt the potatoes.';
    const segments = emphasizeIngredients(description, ['potatoes', 'salt']);
    expect(segments.map((s) => s.text).join('')).toBe(description);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/lib/step-emphasis.test.ts`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `step-emphasis.ts`:

```ts
// Render-time bolding of ingredient mentions in step descriptions (specs/10).
// The schema stores plain text; this only affects display. Whole-word,
// case-insensitive, longest name first so "olive oil" wins over "oil", with
// a cheap s/es plural suffix. Misses are acceptable - this is decoration.
export type TextSegment = { text: string; bold: boolean };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function emphasizeIngredients(description: string, ingredientNames: string[]): TextSegment[] {
  if (description.length === 0) return [];

  const names = ingredientNames
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return [{ text: description, bold: false }];

  const pattern = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})(?:es|s)?\\b`, 'gi');
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of description.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: description.slice(last, index), bold: false });
    segments.push({ text: match[0], bold: true });
    last = index + match[0].length;
  }
  if (last < description.length) segments.push({ text: description.slice(last), bold: false });
  return segments;
}
```

Note: names ending in a non-word character (like the `chili (fresh` test) make the trailing `\b` unsatisfiable, so they simply never match - that is the accepted behavior, not an error.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/lib/step-emphasis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/step-emphasis.ts apps/web/src/lib/step-emphasis.test.ts
git commit -m "feat(web): add ingredient auto-bold helper for card step text"
```

---

### Task 3: card-scale and tag-palette libs

**Files:**
- Create: `apps/web/src/lib/card-scale.ts`
- Create: `apps/web/src/lib/tag-palette.ts`
- Test: `apps/web/src/lib/card-scale.test.ts`
- Test: `apps/web/src/lib/tag-palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 4 and 6):

```ts
// card-scale.ts
export const CARD_PAGE_WIDTH_PX = 816;   // 8.5in at 96dpi
export const CARD_PAGE_HEIGHT_PX = 1056; // 11in at 96dpi
export const CARD_PAGE_GAP_PX = 24;
export type CardScaleLayout = { scale: number; sideBySide: boolean };
export function computeCardScale(containerWidth: number): CardScaleLayout

// tag-palette.ts
export const TAG_PALETTE_SIZE = 3;
export function tagPaletteIndex(tag: string): number // 0 | 1 | 2, deterministic
```

- [ ] **Step 1: Write the failing tests**

Create `card-scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeCardScale, CARD_PAGE_WIDTH_PX, CARD_PAGE_GAP_PX } from './card-scale.ts';

describe('computeCardScale', () => {
  it('caps at 1 and goes side by side on very wide containers', () => {
    expect(computeCardScale(4000)).toEqual({ scale: 1, sideBySide: true });
  });

  it('shrinks side-by-side pages to fill a desktop-width container', () => {
    const width = 1200;
    const { scale, sideBySide } = computeCardScale(width);
    expect(sideBySide).toBe(true);
    expect(2 * CARD_PAGE_WIDTH_PX * scale + CARD_PAGE_GAP_PX).toBeLessThanOrEqual(width);
    expect(scale).toBeGreaterThan(0.45);
  });

  it('stacks pages when side by side would be unreadably small', () => {
    const { scale, sideBySide } = computeCardScale(600);
    expect(sideBySide).toBe(false);
    expect(CARD_PAGE_WIDTH_PX * scale).toBeLessThanOrEqual(600);
  });

  it('handles zero/negative widths without NaN', () => {
    expect(computeCardScale(0)).toEqual({ scale: 1, sideBySide: false });
    expect(computeCardScale(-5)).toEqual({ scale: 1, sideBySide: false });
  });
});
```

Create `tag-palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tagPaletteIndex, TAG_PALETTE_SIZE } from './tag-palette.ts';

describe('tagPaletteIndex', () => {
  it('is deterministic for the same tag', () => {
    expect(tagPaletteIndex('High Protein')).toBe(tagPaletteIndex('High Protein'));
  });

  it('always returns an index within the palette', () => {
    for (const tag of ['Spicy', 'vegan', 'quick', 'Comfort Food', 'x']) {
      const index = tagPaletteIndex(tag);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(TAG_PALETTE_SIZE);
      expect(Number.isInteger(index)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/lib/card-scale.test.ts src/lib/tag-palette.test.ts`
Expected: FAIL - modules not found.

- [ ] **Step 3: Implement**

Create `card-scale.ts`:

```ts
// Preview scaling for the fixed letter-size card pages (specs/10): the pages
// themselves never reflow, only this scale changes. Side-by-side preview is
// used while each scaled page stays at least ~45% size (readable); below
// that the pages stack vertically.
export const CARD_PAGE_WIDTH_PX = 816; // 8.5in at 96dpi
export const CARD_PAGE_HEIGHT_PX = 1056; // 11in at 96dpi
export const CARD_PAGE_GAP_PX = 24;

const MIN_SIDE_BY_SIDE_SCALE = 0.45;

export type CardScaleLayout = { scale: number; sideBySide: boolean };

export function computeCardScale(containerWidth: number): CardScaleLayout {
  if (containerWidth <= 0) return { scale: 1, sideBySide: false };

  const sideBySideScale = (containerWidth - CARD_PAGE_GAP_PX) / (2 * CARD_PAGE_WIDTH_PX);
  if (sideBySideScale >= MIN_SIDE_BY_SIDE_SCALE) {
    return { scale: Math.min(1, sideBySideScale), sideBySide: true };
  }
  return { scale: Math.min(1, containerWidth / CARD_PAGE_WIDTH_PX), sideBySide: false };
}
```

Create `tag-palette.ts`:

```ts
// Deterministic tag pill color assignment (specs/10): hash of the tag name
// into a fixed 3-color palette, so the same tag gets the same color on
// every recipe. The palette itself lives in card.css (.card-tag-0/1/2).
export const TAG_PALETTE_SIZE = 3;

export function tagPaletteIndex(tag: string): number {
  let sum = 0;
  for (let i = 0; i < tag.length; i += 1) {
    sum = (sum + tag.charCodeAt(i)) % TAG_PALETTE_SIZE;
  }
  return sum;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/lib/card-scale.test.ts src/lib/tag-palette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/card-scale.ts apps/web/src/lib/card-scale.test.ts apps/web/src/lib/tag-palette.ts apps/web/src/lib/tag-palette.test.ts
git commit -m "feat(web): add card scale and tag palette helpers"
```

---

### Task 4: CardPage1 component and page 1 styles

**Files:**
- Create: `apps/web/src/components/card/CardPage1.tsx`
- Create: `apps/web/src/components/card/card.css`
- Test: `apps/web/src/components/card/CardPage1.test.tsx`

**Interfaces:**
- Consumes: `tagPaletteIndex` (Task 3), `ingredientImageUrl`/`INGREDIENT_NOT_FOUND_IMAGE` from `apps/web/src/lib/ingredient-image.ts` (existing), `pina-logo.png` (Task 1).
- Produces (used by Task 6): `CardPage1({ recipe }: { recipe: CanonicalRecipe })` rendering a `<section class="card-page card-page-1">`. `card.css` (page 1 rules; Tasks 5-6 append to the same file).

- [ ] **Step 1: Write the failing tests**

Create `CardPage1.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CanonicalRecipe } from 'shared';
import { CardPage1 } from './CardPage1.tsx';
import { INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';
import { tagPaletteIndex } from '../../lib/tag-palette.ts';

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Korean Beef Bowls',
    tags: ['High Protein', 'Spicy'],
    time: 15,
    ingredients: [
      { name: 'Ground Beef', amount_text: '250 g', image: 'ground-beef.png' },
      { name: 'Mystery Item', amount_text: '1', unit: 'pc', image: 'not-in-catalog.png' },
    ],
    pantry_items: ['salt'],
    main_image: '/images/main.png',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: { source_type: 'url', language: 'en', warnings: [] },
    ...overrides,
  };
}

describe('CardPage1', () => {
  it('renders wordmark, title, time, and tags', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    expect(screen.getByText(/my/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Korean Beef Bowls' })).toBeInTheDocument();
    expect(screen.getByText('15 Minutes')).toBeInTheDocument();
    const tag = screen.getByText('High Protein');
    expect(tag).toHaveClass(`card-tag-${tagPaletteIndex('High Protein')}`);
  });

  it('omits time and tags rows when absent', () => {
    render(<CardPage1 recipe={makeRecipe({ time: null, tags: [] })} />);
    expect(screen.queryByText(/minutes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /tags/i })).not.toBeInTheDocument();
  });

  it('renders the main image with the title as alt text', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    expect(screen.getByRole('img', { name: 'Korean Beef Bowls' })).toHaveAttribute('src', '/images/main.png');
  });

  it('swaps to a placeholder block when the main image fails to load', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Korean Beef Bowls' }));
    expect(screen.queryByRole('img', { name: 'Korean Beef Bowls' })).not.toBeInTheDocument();
    expect(screen.getByTestId('card-main-image-missing')).toBeInTheDocument();
  });

  it('renders ingredient name, amount with unit, and catalog thumbnails with not-found fallback', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    expect(screen.getByText('Ground Beef')).toBeInTheDocument();
    expect(screen.getByText('250 g')).toBeInTheDocument();
    expect(screen.getByText('1 pc')).toBeInTheDocument();
    const thumbs = screen.getAllByTestId('card-ingredient-image');
    expect(thumbs[0]).toHaveAttribute('src', '/ingredient-images/ground-beef.png');
    expect(thumbs[1]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('uses density buckets so long ingredient lists compress instead of overflowing', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `Item ${i}`, amount_text: '1' }));
    render(<CardPage1 recipe={makeRecipe({ ingredients: many })} />);
    expect(screen.getByRole('list', { name: /ingredients/i })).toHaveAttribute('data-density', 'compact');

    const veryMany = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}`, amount_text: '1' }));
    render(<CardPage1 recipe={makeRecipe({ ingredients: veryMany })} />);
    expect(screen.getAllByRole('list', { name: /ingredients/i })[1]).toHaveAttribute('data-density', 'tight');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/card/CardPage1.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement CardPage1**

Create `CardPage1.tsx`:

```tsx
// Card page 1 (specs/10): header logo/wordmark, title, time, tag pills,
// main image left, 2-column ingredient grid right. Pure render from
// CanonicalRecipe - no fetching, no state beyond image-error fallbacks.
import { useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import { ingredientImageUrl, INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';
import { tagPaletteIndex } from '../../lib/tag-palette.ts';
import pinaLogo from '../../assets/pina-logo.png';

// Density buckets keep any ingredient count on page 1 (specs/10: shrink,
// never a third column, never a cap). Thresholds match the 2x6 template grid.
function ingredientDensity(count: number): 'regular' | 'compact' | 'tight' {
  if (count > 18) return 'tight';
  if (count > 12) return 'compact';
  return 'regular';
}

function IngredientThumb({ image }: { image: string | undefined }) {
  return (
    <img
      className="card-ingredient-image"
      data-testid="card-ingredient-image"
      src={ingredientImageUrl(image)}
      alt=""
      onError={(event) => {
        // Guard: if the not-found fallback itself fails, do not loop.
        if (!event.currentTarget.src.endsWith(INGREDIENT_NOT_FOUND_IMAGE)) {
          event.currentTarget.src = INGREDIENT_NOT_FOUND_IMAGE;
        }
      }}
    />
  );
}

export function CardPage1({ recipe }: { recipe: CanonicalRecipe }) {
  const [mainImageFailed, setMainImageFailed] = useState(false);

  return (
    <section className="card-page card-page-1" aria-label="Recipe card page 1">
      <header className="card-header">
        <img className="card-logo" src={pinaLogo} alt="" />
        <p className="card-wordmark">
          MY
          <br />
          RECIPES
        </p>
        <div className="card-title-block">
          <h1 className="card-title">{recipe.title}</h1>
          {recipe.time !== null ? <p className="card-time">{recipe.time} Minutes</p> : null}
          {recipe.tags.length > 0 ? (
            <ul className="card-tags" aria-label="Tags">
              {recipe.tags.map((tag) => (
                <li key={tag} className={`card-tag card-tag-${tagPaletteIndex(tag)}`}>
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div className="card-page-1-body">
        {mainImageFailed ? (
          <div
            className="card-main-image card-main-image-missing"
            data-testid="card-main-image-missing"
            role="img"
            aria-label={recipe.title}
          />
        ) : (
          <img
            className="card-main-image"
            src={recipe.main_image}
            alt={recipe.title}
            onError={() => setMainImageFailed(true)}
          />
        )}
        <ul
          className="card-ingredients"
          data-density={ingredientDensity(recipe.ingredients.length)}
          aria-label="Ingredients"
        >
          {recipe.ingredients.map((ingredient, index) => (
            <li key={index} className="card-ingredient">
              <IngredientThumb image={ingredient.image} />
              <span className="card-ingredient-name">{ingredient.name}</span>
              <span className="card-ingredient-amount">
                {ingredient.amount_text}
                {ingredient.unit ? ` ${ingredient.unit}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create card.css with base page and page 1 rules**

Create `card.css` (Tasks 5 and 6 append page 2, preview wrapper, and print sections to this file):

```css
@import '../../assets/fonts/fonts.css';

/* Card geometry uses real-world units: pages are exactly letter size and
   type is in pt (specs/10 typography table), so the scaled screen preview
   and the printed page share one layout. 1in = 96px in CSS. */

.card-page {
  width: 8.5in;
  height: 11in;
  padding: 0.4in;
  background: #ffffff;
  color: #1a1a1a;
  box-shadow: var(--shadow-md);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Page 1 header */
.card-header {
  display: flex;
  align-items: flex-start;
  gap: 0.12in;
}

.card-logo {
  width: 0.55in;
  height: 0.55in;
  object-fit: contain;
}

.card-wordmark {
  margin: 0;
  font-family: 'Montserrat', Arial, sans-serif;
  font-weight: 700;
  font-size: 14pt;
  line-height: 0.95;
  letter-spacing: -0.02em;
}

.card-title-block {
  flex: 1;
  min-width: 0;
  margin-left: 0.25in;
}

.card-title {
  margin: 0;
  font-family: 'Montserrat', Arial, sans-serif;
  font-weight: 700;
  font-size: 23pt;
  line-height: 22pt;
  letter-spacing: -0.06em;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-time {
  margin: 0.14in 0 0;
  font-family: 'Lato', Arial, sans-serif;
  font-weight: 700;
  font-size: 11pt;
}

.card-tags {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 0.12in;
  margin: 0.1in 0 0;
  padding: 0;
}

.card-tag {
  font-family: 'Lato', Arial, sans-serif;
  font-size: 10pt;
  padding: 0.02in 0.16in;
  border-radius: 999px;
}

.card-tag-0 { background: #4C5270; color: #ffffff; }
.card-tag-1 { background: #F3C3BD; color: #C0392B; }
.card-tag-2 { background: #2E6E32; color: #ffffff; }

/* Page 1 body: main image left, ingredient grid right */
.card-page-1-body {
  display: flex;
  gap: 0.25in;
  flex: 1;
  min-height: 0;
  margin-top: 0.18in;
}

.card-main-image {
  flex: 1;
  min-width: 0;
  height: 100%;
  object-fit: cover;
}

.card-main-image-missing {
  background: #efefef;
}

.card-ingredients {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 1.75in;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.16in 0.12in;
  align-content: start;
}

.card-ingredient {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.03in;
}

.card-ingredient-image {
  width: 0.55in;
  height: 0.55in;
  object-fit: contain;
}

.card-ingredients[data-density='compact'] { gap: 0.09in 0.1in; }
.card-ingredients[data-density='compact'] .card-ingredient-image { width: 0.42in; height: 0.42in; }
.card-ingredients[data-density='tight'] { gap: 0.05in 0.08in; }
.card-ingredients[data-density='tight'] .card-ingredient-image { width: 0.32in; height: 0.32in; }

.card-ingredient-name {
  font-family: 'DIN Alternate', Bahnschrift, 'Arial Narrow', Arial, sans-serif;
  font-weight: 700;
  font-size: 7pt;
}

.card-ingredient-amount {
  font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;
  font-weight: 700;
  font-size: 7pt;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/card/CardPage1.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/card
git commit -m "feat(web): add card page 1 (header, title, tags, main image, ingredient grid)"
```

---

### Task 5: CardPage2 component and page 2 styles

**Files:**
- Create: `apps/web/src/components/card/CardPage2.tsx`
- Modify: `apps/web/src/components/card/card.css` (append)
- Test: `apps/web/src/components/card/CardPage2.test.tsx`

**Interfaces:**
- Consumes: `emphasizeIngredients` (Task 2).
- Produces (used by Task 6): `CardPage2({ recipe }: { recipe: CanonicalRecipe })` rendering `<section class="card-page card-page-2">`.

- [ ] **Step 1: Write the failing tests**

Create `CardPage2.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CanonicalRecipe, Step } from 'shared';
import { CardPage2 } from './CardPage2.tsx';

function makeRecipe(steps: Step[], overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Korean Beef Bowls',
    tags: [],
    time: 15,
    ingredients: [{ name: 'potatoes', amount_text: '2' }],
    pantry_items: ['salt', 'pepper', 'oil'],
    main_image: '/images/main.png',
    steps,
    metadata: { source_type: 'url', language: 'en', warnings: [] },
    ...overrides,
  };
}

const STEP_WITH_IMAGE: Step = {
  step_header: 'Roast',
  step_description: 'Cut potatoes into rounds.',
  image: '/images/step-1.png',
};

const STEP_WITHOUT_IMAGE: Step = {
  step_header: 'Season',
  step_description: 'Season generously.',
};

describe('CardPage2', () => {
  it('renders the pantry banner with heading and joined items', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITHOUT_IMAGE])} />);
    expect(screen.getByText('Pantry Items')).toBeInTheDocument();
    expect(screen.getByText(/salt, pepper, oil/)).toBeInTheDocument();
  });

  it('hides the pantry banner when pantry_items is empty', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITHOUT_IMAGE], { pantry_items: [] })} />);
    expect(screen.queryByText('Pantry Items')).not.toBeInTheDocument();
  });

  it('numbers steps and renders image and text-only variants', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE, STEP_WITHOUT_IMAGE])} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('card-step-image')).toHaveAttribute('src', '/images/step-1.png');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveClass('card-step-no-image');
    expect(items[1]).toHaveClass('card-step-no-image');
  });

  it('bolds ingredient mentions in step descriptions', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE])} />);
    const bolded = screen.getByText('potatoes');
    expect(bolded.tagName).toBe('STRONG');
  });

  it('degrades a step whose image fails to load to the text-only variant', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE])} />);
    fireEvent.error(screen.getByTestId('card-step-image'));
    expect(screen.queryByTestId('card-step-image')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('card-step-no-image');
  });

  it('never renders more than 6 steps', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      step_header: `Step ${i + 1}`,
      step_description: 'Do it.',
    }));
    // Bypass the schema cap on purpose - the renderer must enforce it too.
    render(<CardPage2 recipe={makeRecipe(seven)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/card/CardPage2.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement CardPage2**

Create `CardPage2.tsx`:

```tsx
// Card page 2 (specs/10): pantry banner on top, then a 3x2 step grid
// (fill order 1,2,3 / 4,5,6). Steps without an image - including images
// that fail to load - use the text-only variant: title bar at the top,
// description takes the full column.
import { useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import { emphasizeIngredients } from '../../lib/step-emphasis.ts';

const MAX_STEPS = 6;

function StepDescription({ description, ingredientNames }: { description: string; ingredientNames: string[] }) {
  return (
    <p className="card-step-description">
      {emphasizeIngredients(description, ingredientNames).map((segment, index) =>
        segment.bold ? <strong key={index}>{segment.text}</strong> : <span key={index}>{segment.text}</span>,
      )}
    </p>
  );
}

export function CardPage2({ recipe }: { recipe: CanonicalRecipe }) {
  const [failedStepImages, setFailedStepImages] = useState<ReadonlySet<number>>(new Set());
  const ingredientNames = recipe.ingredients.map((ingredient) => ingredient.name);
  const steps = recipe.steps.slice(0, MAX_STEPS);

  return (
    <section className="card-page card-page-2" aria-label="Recipe card page 2">
      {recipe.pantry_items.length > 0 ? (
        <p className="card-pantry">
          <strong className="card-pantry-heading">Pantry Items</strong>
          <span className="card-pantry-list"> | {recipe.pantry_items.join(', ')}</span>
        </p>
      ) : null}

      <ol className="card-steps" aria-label="Steps">
        {steps.map((step, index) => {
          const hasImage = Boolean(step.image) && !failedStepImages.has(index);
          return (
            <li key={index} className={hasImage ? 'card-step' : 'card-step card-step-no-image'}>
              {hasImage ? (
                <>
                  <span className="card-step-number">{index + 1}</span>
                  <img
                    className="card-step-image"
                    data-testid="card-step-image"
                    src={step.image}
                    alt=""
                    onError={() => setFailedStepImages((prev) => new Set(prev).add(index))}
                  />
                  <h2 className="card-step-title">{step.step_header}</h2>
                </>
              ) : (
                <h2 className="card-step-title card-step-title-inline">
                  <span className="card-step-number">{index + 1}</span>
                  {step.step_header}
                </h2>
              )}
              <StepDescription description={step.step_description} ingredientNames={ingredientNames} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
```

- [ ] **Step 4: Append page 2 styles to card.css**

Append to `card.css`:

```css
/* Page 2: pantry banner + 3x2 step grid */
.card-pantry {
  margin: 0;
  background: #B7C98D;
  color: #225022;
  padding: 0.09in 0.15in;
  font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
}

.card-pantry-heading {
  font-size: 11pt;
  font-weight: 700;
}

.card-steps {
  list-style: none;
  margin: 0.2in 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: 1fr 1fr;
  gap: 0.25in;
  flex: 1;
  min-height: 0;
}

.card-step {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.card-step-number {
  position: absolute;
  top: 0;
  left: 0;
  width: 0.28in;
  height: 0.28in;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #2E6E32;
  color: #ffffff;
  font-family: 'Lato', Arial, sans-serif;
  font-weight: 700;
  font-size: 12pt;
}

.card-step-image {
  width: 100%;
  height: 1.35in;
  object-fit: cover;
}

.card-step-title {
  margin: 0.08in 0 0;
  background: #2E6E32;
  color: #ffffff;
  font-family: 'Lato', Arial, sans-serif;
  font-weight: 700;
  font-size: 12pt;
  padding: 0.05in 0.12in;
  display: flex;
  align-items: center;
  gap: 0.1in;
}

/* Text-only variant: number sits inline in the title bar, bar moves to top */
.card-step-title-inline {
  margin-top: 0;
}

.card-step-title-inline .card-step-number {
  position: static;
  flex: none;
}

.card-step-description {
  margin: 0.08in 0 0;
  font-family: Helvetica, 'Helvetica Neue', Arial, sans-serif;
  font-size: 9pt;
  line-height: 14pt;
  overflow: hidden;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/card/CardPage2.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/card
git commit -m "feat(web): add card page 2 (pantry banner, step grid, auto-bolding)"
```

---

### Task 6: CardView container, preview scaling, and print CSS

**Files:**
- Create: `apps/web/src/components/card/CardView.tsx`
- Create: `apps/web/src/components/card/useCardScale.ts`
- Modify: `apps/web/src/components/card/card.css` (append)
- Test: `apps/web/src/components/card/CardView.test.tsx`

**Interfaces:**
- Consumes: `CardPage1` (Task 4), `CardPage2` (Task 5), `computeCardScale` + constants (Task 3).
- Produces (used by Task 7):

```tsx
CardView({ recipe, onBack }: { recipe: CanonicalRecipe; onBack: () => void })
```

- [ ] **Step 1: Write the failing tests**

Create `CardView.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { CardView } from './CardView.tsx';

const RECIPE: CanonicalRecipe = {
  title: 'Korean Beef Bowls',
  tags: ['Spicy'],
  time: 15,
  ingredients: [{ name: 'Ground Beef', amount_text: '250 g' }],
  pantry_items: ['salt'],
  main_image: '/images/main.png',
  steps: [{ step_header: 'Cook', step_description: 'Cook the ground beef.' }],
  metadata: { source_type: 'url', language: 'en', warnings: [] },
};

describe('CardView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders both card pages with page labels', () => {
    render(<CardView recipe={RECIPE} onBack={vi.fn()} />);
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe card page 2')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });

  it('fires onBack from the Back button', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<CardView recipe={RECIPE} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('calls window.print from the print button', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CardView recipe={RECIPE} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /print/i }));
    expect(printSpy).toHaveBeenCalled();
  });
});
```

Note: jsdom has no `ResizeObserver` and no layout, so `useCardScale` must tolerate both (guard below). The tests intentionally do not assert a scale value.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/card/CardView.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement useCardScale**

Create `useCardScale.ts`:

```ts
// Measures the preview container and derives the page scale/arrangement.
// Guards for jsdom: no ResizeObserver means measure once and stay there.
import { useEffect, useState, type RefObject } from 'react';
import { computeCardScale, type CardScaleLayout } from '../../lib/card-scale.ts';

export function useCardScale(ref: RefObject<HTMLElement | null>): CardScaleLayout {
  const [layout, setLayout] = useState<CardScaleLayout>({ scale: 1, sideBySide: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => setLayout(computeCardScale(element.clientWidth));
    update();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return layout;
}
```

- [ ] **Step 4: Implement CardView**

Create `CardView.tsx`:

```tsx
// Card preview container: toolbar (Back, Print/Save PDF) plus the two
// letter-size pages inside scale frames. The frame div reserves the
// scaled footprint (transform does not affect layout size); print CSS
// strips the toolbar/labels and resets the scale so output is 1:1.
import { useRef, type ReactNode } from 'react';
import type { CanonicalRecipe } from 'shared';
import { CARD_PAGE_HEIGHT_PX, CARD_PAGE_WIDTH_PX } from '../../lib/card-scale.ts';
import { useCardScale } from './useCardScale.ts';
import { CardPage1 } from './CardPage1.tsx';
import { CardPage2 } from './CardPage2.tsx';
import './card.css';

function PageFrame({ scale, label, children }: { scale: number; label: string; children: ReactNode }) {
  return (
    <div className="card-page-slot">
      <div
        className="card-page-frame"
        style={{ width: CARD_PAGE_WIDTH_PX * scale, height: CARD_PAGE_HEIGHT_PX * scale }}
      >
        <div className="card-page-scaler" style={{ transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
      <p className="card-page-label">{label}</p>
    </div>
  );
}

export function CardView({ recipe, onBack }: { recipe: CanonicalRecipe; onBack: () => void }) {
  const pagesRef = useRef<HTMLDivElement>(null);
  const { scale, sideBySide } = useCardScale(pagesRef);

  return (
    <div className="card-view">
      <div className="card-view-toolbar">
        <button type="button" onClick={onBack}>
          Back
        </button>
        <button type="button" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>
      <div ref={pagesRef} className={sideBySide ? 'card-view-pages card-view-pages-row' : 'card-view-pages'}>
        <PageFrame scale={scale} label="Page 1">
          <CardPage1 recipe={recipe} />
        </PageFrame>
        <PageFrame scale={scale} label="Page 2">
          <CardPage2 recipe={recipe} />
        </PageFrame>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Append preview wrapper and print rules to card.css**

Append to `card.css`:

```css
/* Screen preview wrapper */
.card-view {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.card-view-toolbar {
  display: flex;
  gap: var(--space-2);
}

.card-view-pages {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  align-items: flex-start;
}

.card-view-pages-row {
  flex-direction: row;
}

.card-page-frame {
  overflow: hidden;
}

.card-page-scaler {
  transform-origin: top left;
}

.card-page-label {
  margin: var(--space-1) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

/* Print: only the card pages, 1:1 letter size, one sheet per page.
   The visibility trick keeps React state intact while hiding the app;
   !important is required to beat the inline scale/size styles. */
@page {
  size: letter;
  margin: 0;
}

@media print {
  body * {
    visibility: hidden;
  }

  .card-view,
  .card-view * {
    visibility: visible;
  }

  .card-view {
    position: absolute;
    inset: 0 auto auto 0;
  }

  .card-view-toolbar,
  .card-page-label {
    display: none;
  }

  .card-view-pages {
    flex-direction: column;
    gap: 0;
  }

  .card-page-frame {
    width: 8.5in !important;
    height: 11in !important;
    overflow: visible;
  }

  .card-page-scaler {
    transform: none !important;
  }

  .card-page {
    box-shadow: none;
    break-after: page;
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/card/CardView.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/card
git commit -m "feat(web): add CardView with scale-to-fit preview and letter print CSS"
```

---

### Task 7: Entry points - Library "View as Card" and Create "Preview Card"

**Files:**
- Modify: `apps/web/src/components/library/RecipeDetail.tsx`
- Modify: `apps/web/src/components/json/JsonPanel.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/workspace.css` (append)
- Test: `apps/web/src/components/library/RecipeDetail.test.tsx` (append)
- Test: `apps/web/src/components/json/JsonPanel.test.tsx` (append)
- Test: `apps/web/src/App.test.tsx` (append)

**Interfaces:**
- Consumes: `CardView` (Task 6).
- Produces: `JsonPanel` gains optional `onPreviewCard?: () => void` (button renders only when provided; validation-gated like Download). `RecipeDetail` gains an internal card mode. `App` gains `cardPreview` state for the Create workspace.

- [ ] **Step 1: Write the failing tests**

Append to `RecipeDetail.test.tsx` (reuse the file's existing `RECIPE` fixture and `mockedGetRecipe`):

```tsx
describe('View as Card', () => {
  it('replaces the detail view with the card and returns via Back', async () => {
    const user = userEvent.setup();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /view as card/i }));
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open in create/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('button', { name: /open in create/i })).toBeInTheDocument();
  });
});
```

Append to `JsonPanel.test.tsx` (reuse the file's existing valid recipe fixture, named `RECIPE` below):

```tsx
describe('Preview Card action', () => {
  it('renders no preview button when onPreviewCard is not provided', () => {
    render(<JsonPanel recipe={RECIPE} savedId={null} dirty={false} onSaved={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /preview card/i })).not.toBeInTheDocument();
  });

  it('calls onPreviewCard for a valid recipe', async () => {
    const user = userEvent.setup();
    const onPreviewCard = vi.fn();
    render(<JsonPanel recipe={RECIPE} savedId={null} dirty={false} onSaved={vi.fn()} onPreviewCard={onPreviewCard} />);
    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(onPreviewCard).toHaveBeenCalled();
  });

  it('blocks preview and shows validation errors for an invalid recipe', async () => {
    const user = userEvent.setup();
    const onPreviewCard = vi.fn();
    const invalid = { ...RECIPE, title: '' };
    render(<JsonPanel recipe={invalid} savedId={null} dirty={false} onSaved={vi.fn()} onPreviewCard={onPreviewCard} />);
    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(onPreviewCard).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument(); // FieldErrors container
  });
});
```

Append to `App.test.tsx` (reuse the file's `RECIPE` fixture and `mockedIngestUrl`; ingestion via the URL tab is the established way to get a recipe into App state):

```tsx
describe('Create card preview', () => {
  it('shows the card from Preview Card and returns via Back', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
    render(<App />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.org/r');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));
    await screen.findByLabelText(/title/i);

    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /input/i })).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('heading', { name: /input/i })).toBeVisible();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/library/RecipeDetail.test.tsx src/components/json/JsonPanel.test.tsx src/App.test.tsx`
Expected: FAIL - buttons not found.

- [ ] **Step 3: Implement JsonPanel onPreviewCard**

In `JsonPanel.tsx`, add the prop:

```tsx
export function JsonPanel({
  recipe,
  savedId = null,
  dirty = false,
  onSaved,
  readOnly = false,
  onPreviewCard,
}: {
  recipe: CanonicalRecipe
  savedId?: string | null
  dirty?: boolean
  onSaved?: (id: string) => void
  readOnly?: boolean
  onPreviewCard?: () => void
}) {
```

Add the handler next to `handleDownload` (same validation gate):

```tsx
const handlePreviewCard = useCallback(() => {
  if (!onPreviewCard) return;
  const parsed = CanonicalRecipeSchema.safeParse(recipe);
  if (!parsed.success) {
    setStatus({ phase: 'validation-error', errors: parsed.error.flatten() });
    return;
  }
  setStatus({ phase: 'idle' });
  onPreviewCard();
}, [recipe, onPreviewCard]);
```

Add the button in `.json-panel-actions`, after Download JSON:

```tsx
{onPreviewCard ? (
  <button type="button" onClick={handlePreviewCard}>
    Preview Card
  </button>
) : null}
```

- [ ] **Step 4: Implement RecipeDetail View as Card**

In `RecipeDetail.tsx`: add `import { CardView } from '../card/CardView.tsx';` and card-mode state:

```tsx
const [showCard, setShowCard] = useState(false);
```

Early-return the card when active (place right before the existing `return`):

```tsx
if (showCard && status.phase === 'loaded') {
  return <CardView recipe={status.recipe} onBack={() => setShowCard(false)} />;
}
```

Add the toolbar button inside the existing `status.phase === 'loaded'` fragment, after "Open in Create":

```tsx
<button type="button" onClick={() => setShowCard(true)}>
  View as Card
</button>
```

- [ ] **Step 5: Implement App Create preview**

In `App.tsx`: add `import { CardView } from './components/card/CardView.tsx';` and state:

```tsx
const [showCardPreview, setShowCardPreview] = useState(false);
```

The three Create sections currently use `hidden={!inCreate}`; change the flag so preview hides them too (state survives, matching the Library pattern):

```tsx
const inCreate = view === 'create' && !showCardPreview;
```

Pass the preview callback to JsonPanel:

```tsx
<JsonPanel
  recipe={recipeState.recipe}
  savedId={recipeState.savedId}
  dirty={recipeState.dirty}
  onSaved={handleSaved}
  onPreviewCard={() => setShowCardPreview(true)}
/>
```

Render the preview section after the library section block:

```tsx
{view === 'create' && showCardPreview && recipeState ? (
  <section className="workspace-panel workspace-panel-card" aria-labelledby="card-panel-heading">
    <h2 id="card-panel-heading">Card Preview</h2>
    <CardView recipe={recipeState.recipe} onBack={() => setShowCardPreview(false)} />
  </section>
) : null}
```

Also reset the preview when a new recipe is adopted (inside `adoptRecipe`, after `setRecipeState(...)`):

```tsx
setShowCardPreview(false);
```

Add the panel style to `apps/web/src/workspace.css` (full-width like the library panel):

```css
.workspace-panel-card {
  grid-column: 1 / -1;
}
```

- [ ] **Step 6: Run the affected suites**

Run: `pnpm --filter web run test -- src/components/library src/components/json src/App.test.tsx`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/library/RecipeDetail.tsx apps/web/src/components/library/RecipeDetail.test.tsx apps/web/src/components/json/JsonPanel.tsx apps/web/src/components/json/JsonPanel.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/workspace.css
git commit -m "feat(web): wire card view into Library detail and Create preview"
```

---

### Task 8: Polish, manual print verification, and docs

**Files:**
- Modify: `apps/web/src/components/library/RecipeList.tsx`
- Test: `apps/web/src/components/library/RecipeList.test.tsx` (append)
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `plans/recipe-maker-implementation-plan.md`

**Interfaces:** None new.

- [ ] **Step 1: Write the failing test for the thumbnail fallback (Phase 6 follow-up)**

Append to `RecipeList.test.tsx` (reuse the file's `SUMMARIES` fixture):

```tsx
it('hides a thumbnail that fails to load instead of showing a broken image', () => {
  render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
  const img = screen.getByRole('img', { name: 'Soup' });
  fireEvent.error(img);
  expect(img).not.toBeVisible();
});
```

(Add `fireEvent` to the existing `@testing-library/react` import.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web run test -- src/components/library/RecipeList.test.tsx`
Expected: FAIL - image still visible.

- [ ] **Step 3: Implement the fallback**

In `RecipeList.tsx`, add an `onError` to the thumbnail `<img>`:

```tsx
<img
  className="recipe-list-thumbnail"
  src={recipe.main_image}
  alt={recipe.title}
  onError={(event) => {
    event.currentTarget.style.visibility = 'hidden';
  }}
/>
```

Run: `pnpm --filter web run test -- src/components/library/RecipeList.test.tsx`
Expected: PASS.

- [ ] **Step 4: Manual print verification (required, specs/10 acceptance)**

Start both dev servers (`server/.env` is not auto-loaded by pnpm dev - see project notes; do not use example.com for smoke tests):

```bash
pnpm --filter server run dev   # ensure env vars are loaded per server/README notes
pnpm --filter web run dev
```

In the browser:
- Open a saved recipe in Library -> View as Card. Both pages render; fonts are Montserrat/Lato (inspect computed styles); ingredient thumbnails resolve.
- Resize the window: pages go side-by-side when wide, stacked with Page 1/2 labels when narrow; no horizontal page scrolling.
- Create workspace -> load or ingest a recipe -> Preview Card works; Back returns with state intact.
- Print / Save PDF: print preview shows exactly 2 letter-size pages, no toolbar/labels/app chrome, page 2 starts on its own sheet, nothing clipped at the margins.
- Verify a recipe with an image-less step renders the text-only variant, and one with empty pantry_items hides the banner.
- Save the PDF and open it: text is selectable (real fonts, not rasterized).

Fix any layout clipping found before proceeding; tune the in/pt constants in card.css only.

- [ ] **Step 5: Update docs**

`README.md`: add Phase 7 to the completed list; describe the card view (two-page letter-size card, print/save-PDF, Library View as Card + Create Preview Card).

`CLAUDE.md` Status section: fold Phase 7 into the done list; change "Next:" to "Next: Phase 8 quality/testing/hardening."

`plans/recipe-maker-implementation-plan.md` Phase 7: append `[Done.]` to each implementation task, matching the Phase 6 convention.

- [ ] **Step 6: Full verification**

Run: `pnpm --filter web run test && pnpm --filter server run test`
Expected: PASS across both packages.

Run: `pnpm --filter web run build`
Expected: clean build; woff2 and png assets emitted to dist.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/library README.md CLAUDE.md plans/recipe-maker-implementation-plan.md
git commit -m "docs: mark Phase 7 card rendering complete; fix library thumbnail fallback"
```
