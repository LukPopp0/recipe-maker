# Phase 0: Repository Cleanup and Baseline Setup - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strip the Vite starter template, lay down base styles/tokens, generate the ingredient asset manifest, and document the project so later phases build on a clean, documented baseline.

**Architecture:** Frontend-only changes (no backend exists yet). A standalone Node script builds a JSON manifest of ingredient image filenames from `shared/assets/ingredients`, tested in isolation with Vitest. CSS and docs changes are direct file replacements.

**Tech Stack:** React 19 + TypeScript + Vite 8, pnpm, Vitest (new in this phase), Node ESM scripts.

## Global Constraints

- Package manager: pnpm (use `pnpm add`, `pnpm run`).
- Node ESM only (`"type": "module"` in package.json) - scripts use `.mjs` with `node:` builtin imports.
- No backend/server code in this phase - `server/` does not exist until Phase 1.
- Single-user, local-first (per plan section 3) - no auth/env-validation logic here, just template files.
- Prefer targeted, minimal edits over broad rewrites; don't delete files without a clear reason.

---

## Task 1: Remove Vite Starter UI

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/App.css`
- Delete: `src/assets/react.svg`
- Delete: `src/assets/vite.svg`
- Delete: `public/icons.svg`

**Interfaces:**
- Produces: `App` component (default export) rendering a minimal shell, consumed by `src/main.tsx` (already imports it, no change needed there).

**Note:** `src/assets/hero.png` is left in place but unreferenced - provenance unclear, safe to revisit later rather than delete now.

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
function App() {
  return (
    <main id="workspace-shell">
      <h1>Recipe Maker</h1>
      <p>Ingestion workspace coming in Phase 5.</p>
    </main>
  )
}

export default App
```

- [ ] **Step 2: Delete `src/App.css` and its import**

Delete the file. Confirm no other file imports `./App.css` (only `src/App.tsx` did, and it's already rewritten above without that import).

- [ ] **Step 3: Delete unused template assets**

```bash
rm src/assets/react.svg src/assets/vite.svg public/icons.svg
```

- [ ] **Step 4: Verify the app boots**

Run: `pnpm dev`
Expected: Dev server starts without errors; browser shows "Recipe Maker" heading and the placeholder paragraph, no React/Vite logos or docs/social links.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.css src/assets/react.svg src/assets/vite.svg public/icons.svg
git commit -m "chore: remove Vite starter UI, add minimal app shell"
```

## Task 2: Replace `src/index.css` with Project Base Styles

**Files:**
- Modify: `src/index.css`

**Interfaces:**
- Produces: CSS custom properties (`--space-*`, `--font-*`, `--radius-*`, `--shadow-*`, `--z-*`, `--color-*`) on `:root`, consumed by all future component styles.

- [ ] **Step 1: Write the new `src/index.css`**

```css
/* Reset */
*, *::before, *::after {
  box-sizing: border-box;
}
body {
  margin: 0;
}
img, svg {
  display: block;
  max-width: 100%;
}
button, input, textarea, select {
  font: inherit;
  color: inherit;
}

/* Design tokens */
:root {
  --color-bg: #ffffff;
  --color-surface: #f7f7f8;
  --color-text: #1a1a1f;
  --color-text-muted: #6b6375;
  --color-border: #e5e4e7;
  --color-accent: #aa3bff;
  --color-accent-contrast: #ffffff;
  --color-danger: #d1373f;
  --color-warning: #b8860b;
  --color-success: #2f8f4e;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  --font-sans: system-ui, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, Consolas, monospace;
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 16px;
  --font-size-lg: 18px;
  --font-size-xl: 22px;
  --font-size-2xl: 28px;
  --font-size-3xl: 40px;
  --line-height-base: 1.45;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-full: 999px;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.06);
  --shadow-md: 0 4px 6px -2px rgba(0, 0, 0, 0.08), 0 10px 15px -3px rgba(0, 0, 0, 0.06);

  --z-base: 0;
  --z-dropdown: 100;
  --z-modal: 200;
  --z-toast: 300;

  font-family: var(--font-sans);
  font-size: var(--font-size-base);
  line-height: var(--line-height-base);
  color: var(--color-text);
  background: var(--color-bg);
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-bg: #16171d;
    --color-surface: #1f2028;
    --color-text: #f3f4f6;
    --color-text-muted: #9ca3af;
    --color-border: #2e303a;
    --color-accent: #c084fc;
  }
}

/* Baseline layout */
#root {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

/* Accessibility defaults */
:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* Print baseline - full card print rules land in Milestone 2 (specs/10) */
@media print {
  body {
    background: #fff;
  }
}
```

- [ ] **Step 2: Verify styles apply and app still boots**

Run: `pnpm dev`
Expected: No console/build errors; page background/text use the new tokens (open devtools, confirm `--color-accent` etc. are set on `:root`).

- [ ] **Step 3: Lint and commit**

```bash
pnpm lint
git add src/index.css
git commit -m "chore: add design tokens, reset, and baseline styles"
```

## Task 3: Ingredient Asset Manifest Generation

**Pre-check:** `src/assets/ingredients` does not exist; the migration to `shared/assets/ingredients` (215 files) described in the master plan is already done. This task only adds the manifest generator, not the migration.

**Files:**
- Create: `scripts/lib/build-ingredient-manifest.mjs`
- Create: `scripts/lib/build-ingredient-manifest.test.mjs`
- Create: `scripts/generate-ingredient-manifest.mjs`
- Modify: `package.json` (add `vitest` devDependency, `test`/`generate:manifest`/`predev`/`prebuild` scripts)
- Modify: `.gitignore` (add `shared/src/generated`)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: `buildIngredientManifest(dirPath: string): Promise<string[]>` - sorted list of image filenames, consumed by `scripts/generate-ingredient-manifest.mjs` now, and by frontend/backend catalog code in later phases via the generated `shared/src/generated/ingredient-manifest.json`.

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest
```

- [ ] **Step 2: Add `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

Note: `environment: 'node'` suits this task. Phase 5/8 component tests will need `environment: 'jsdom'` (add `jsdom` as a dependency and override per-file or add a second config then - not needed yet).

- [ ] **Step 3: Write the failing test**

```js
// scripts/lib/build-ingredient-manifest.test.mjs
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildIngredientManifest } from './build-ingredient-manifest.mjs'

describe('buildIngredientManifest', () => {
  let dir

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ingredient-manifest-'))
    await writeFile(join(dir, 'garlic.png'), '')
    await writeFile(join(dir, 'Onion-Red.JPG'), '')
    await writeFile(join(dir, 'notes.txt'), '')
    await writeFile(join(dir, '.DS_Store'), '')
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns only image files, sorted, excluding dotfiles and non-images', async () => {
    const result = await buildIngredientManifest(dir)
    expect(result).toEqual(['garlic.png', 'Onion-Red.JPG'])
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm vitest run scripts/lib/build-ingredient-manifest.test.mjs`
Expected: FAIL - cannot find module `./build-ingredient-manifest.mjs`.

- [ ] **Step 5: Write minimal implementation**

```js
// scripts/lib/build-ingredient-manifest.mjs
import { readdir } from 'node:fs/promises'
import { extname } from 'node:path'

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export async function buildIngredientManifest(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => ALLOWED_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run scripts/lib/build-ingredient-manifest.test.mjs`
Expected: PASS

- [ ] **Step 7: Write the CLI wrapper**

```js
// scripts/generate-ingredient-manifest.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIngredientManifest } from './lib/build-ingredient-manifest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCE_DIR = resolve(__dirname, '../shared/assets/ingredients')
const OUTPUT_FILE = resolve(__dirname, '../shared/src/generated/ingredient-manifest.json')

const manifest = await buildIngredientManifest(SOURCE_DIR)
await mkdir(dirname(OUTPUT_FILE), { recursive: true })
await writeFile(OUTPUT_FILE, JSON.stringify(manifest, null, 2) + '\n')
console.log(`Wrote ${manifest.length} ingredient assets to ${OUTPUT_FILE}`)
```

- [ ] **Step 8: Wire up package.json scripts**

Add to `package.json` `"scripts"`:

```json
"generate:manifest": "node scripts/generate-ingredient-manifest.mjs",
"predev": "node scripts/generate-ingredient-manifest.mjs",
"prebuild": "node scripts/generate-ingredient-manifest.mjs",
"test": "vitest run"
```

- [ ] **Step 9: Add generated output to `.gitignore`**

Add this line to `.gitignore`:

```
shared/src/generated
```

- [ ] **Step 10: Run the generator against the real asset directory**

Run: `pnpm generate:manifest`
Expected: Console logs "Wrote 215 ingredient assets to .../ingredient-manifest.json"; `shared/src/generated/ingredient-manifest.json` exists, is a sorted JSON array, and does not contain `.DS_Store`.

- [ ] **Step 11: Run full test suite and lint, then commit**

```bash
pnpm test
pnpm lint
git add scripts vitest.config.ts package.json pnpm-lock.yaml .gitignore
git commit -m "feat: generate ingredient asset manifest from shared/assets/ingredients"
```

## Task 4: Replace README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the new README**

```markdown
# Recipe Maker

Ingests recipes (URL or manual text+images) via Gemini, normalizes them into a
canonical JSON schema, lets you save/browse them, and renders a printable
two-page recipe card.

## Status

Milestone 1 (ingestion + normalization + persistence) in progress. Milestone 2
(card rendering) not started. See `plans/recipe-maker-implementation-plan.md`
for the full phase breakdown and `specs/` for per-feature specs.

## Architecture

- `src/` - frontend (React + TypeScript + Vite).
- `server/` - backend API (Hono), added in Phase 1. Not present yet.
- `shared/` - types, schema validators, constants, and `assets/ingredients`
  (ingredient image library used by both frontend and backend).
- `plans/`, `specs/` - planning docs; read before changing scope.

## Setup

```bash
pnpm install
pnpm dev
```

`pnpm dev` and `pnpm build` automatically regenerate the ingredient asset
manifest (`shared/src/generated/ingredient-manifest.json`) via a `pre`
script - no manual step needed.

## Scripts

- `pnpm dev` - start the Vite dev server.
- `pnpm build` - type-check and build for production.
- `pnpm lint` - run ESLint.
- `pnpm test` - run Vitest.
- `pnpm generate:manifest` - regenerate the ingredient asset manifest manually.

## Known Constraints

- English-only input for Milestone 1.
- Recipes are capped at 6 cooking steps (compaction runs automatically above that).
- Pantry allowlist and tag vocabulary are fixed lists, see `specs/12-shared-constants.md`.
- Recipe persistence is flat JSON files on disk (`server/data/recipes/`), not a database.
- Single-user, no authentication (local-first).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: replace Vite template README with project documentation"
```
