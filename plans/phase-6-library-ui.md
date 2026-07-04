# Phase 6: Library UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Library section of the frontend: list saved recipes, view one read-only, download, delete, and copy a saved recipe into the Create workspace.

**Architecture:** All backend routes already exist (`server/src/routes/recipe.ts`). This phase is frontend-only: three new components under `apps/web/src/components/library/`, a `readOnly` mode threaded through the existing review/JSON components, three new API client functions, and App.tsx nav wiring. No router - view switching stays local state.

**Tech Stack:** React + TypeScript (Vite), Vitest + React Testing Library (jsdom), shared types from the `shared` workspace package.

## Global Constraints

- ASCII only in code, comments, and copy. No emojis, no emdashes.
- Comments concise; match existing comment style (explain constraints, not mechanics).
- No new dependencies. No router.
- Tests run with `pnpm --filter web run test` from the repo root.
- Immutability convention: components never mutate props; every change builds fresh objects/arrays.
- All fetch calls live in `apps/web/src/api/client.ts`; components never call `fetch` directly. Exception: the Download action is a plain `<a href>` to `GET /api/recipe/download/:id` (browser navigation, not fetch).
- The Vite dev proxy already forwards `/api` and `/images` to localhost:8787; no proxy changes needed.
- Decisions locked during planning (master plan Phase 6 scope note, specs/13): read-only view + "Open in Create" copy (new id on save, no in-place update), detail replaces list with a Back button, `readOnly` prop reuse (no duplicate detail component), `window.confirm` for delete, createdAt-descending sort.

---

### Task 1: API client functions (list/get/delete)

**Files:**
- Modify: `apps/web/src/api/client.ts`
- Test: `apps/web/src/api/client.test.ts` (append tests; follow the file's existing fetch-mock helpers if they differ from below)

**Interfaces:**
- Consumes: existing `request<T>` helper and `ClientResult<T>` in client.ts; `RecipeSummary`, `CanonicalRecipe` from `shared`.
- Produces (used by Tasks 4-6):
  - `listRecipes(): Promise<ClientResult<{ recipes: RecipeSummary[] }>>`
  - `getRecipe(id: string): Promise<ClientResult<{ recipe: CanonicalRecipe }>>`
  - `deleteRecipe(id: string): Promise<ClientResult<Record<string, never>>>`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/api/client.test.ts` (adapt the fetch mocking to the helpers already in that file if they exist; the assertions must stay):

```ts
import { listRecipes, getRecipe, deleteRecipe } from './client.ts';

describe('library endpoints', () => {
  it('listRecipes unwraps the recipes array from the envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: true,
        requestId: 'r1',
        recipes: [{ id: 'a', title: 'T', tags: [], main_image: '/images/x.png', createdAt: '2026-01-01T00:00:00.000Z' }],
      }),
    }));

    const result = await listRecipes();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.recipes).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/recipes', undefined);
  });

  it('getRecipe hits /api/recipe/:id and unwraps the recipe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true, requestId: 'r2', recipe: { title: 'T' } }),
    }));

    const result = await getRecipe('some-id');
    expect(result.ok).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/recipe/some-id', undefined);
  });

  it('deleteRecipe issues DELETE and surfaces RECIPE_NOT_FOUND failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({
        ok: false,
        requestId: 'r3',
        error: { code: 'RECIPE_NOT_FOUND', message: 'No recipe exists with id "x".' },
      }),
    }));

    const result = await deleteRecipe('x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RECIPE_NOT_FOUND');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/recipe/x', { method: 'DELETE' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/api/client.test.ts`
Expected: FAIL - `listRecipes` is not exported.

- [ ] **Step 3: Implement the three functions**

In `apps/web/src/api/client.ts`, extend the shared import and append after `saveRecipe`:

```ts
// at top: import type { ..., RecipeSummary } from 'shared';

export async function listRecipes(): Promise<ClientResult<{ recipes: RecipeSummary[] }>> {
  return request('/api/recipes');
}

export async function getRecipe(id: string): Promise<ClientResult<{ recipe: CanonicalRecipe }>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`);
}

export async function deleteRecipe(id: string): Promise<ClientResult<Record<string, never>>> {
  return request(`/api/recipe/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/api/client.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/client.ts apps/web/src/api/client.test.ts
git commit -m "feat(web): add library API client functions (list/get/delete)"
```

---

### Task 2: readOnly mode for ReviewPanel and its editors

**Files:**
- Modify: `apps/web/src/components/review/ReviewPanel.tsx`
- Modify: `apps/web/src/components/review/TagEditor.tsx`
- Modify: `apps/web/src/components/review/IngredientEditor.tsx`
- Modify: `apps/web/src/components/review/StepEditor.tsx`
- Test: `apps/web/src/components/review/ReviewPanel.test.tsx` (append)

**Interfaces:**
- Produces (used by Task 5): `ReviewPanel` accepts optional `readOnly?: boolean` (default false) and `onChange` becomes optional. When readOnly: no inputs or buttons render anywhere in the tree; values render as static text. Pantry list, warnings, and diagnostics behavior unchanged.
- Editors each gain `readOnly?: boolean` and their `onChange` stays required (ReviewPanel passes a no-op when it has no onChange).

- [ ] **Step 1: Write the failing tests**

Append to `ReviewPanel.test.tsx` (reuse the file's existing recipe fixture; shown inline here so this task is self-contained):

```tsx
describe('readOnly mode', () => {
  const recipe: CanonicalRecipe = {
    title: 'Static Soup',
    tags: ['dinner'],
    time: 25,
    ingredients: [{ name: 'Carrot', amount_text: '2', unit: 'pcs', image: 'carrot.png' }],
    pantry_items: ['salt'],
    main_image: '/images/main.png',
    steps: [{ step_header: 'Chop', step_description: 'Chop the carrot.' }],
    metadata: { source_type: 'url', language: 'en', warnings: ['a warning'] },
  };

  it('renders no textboxes, spinbuttons, or buttons', () => {
    render(<ReviewPanel recipe={recipe} diagnostics={null} readOnly />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders all field values as static text', () => {
    render(<ReviewPanel recipe={recipe} diagnostics={null} readOnly />);
    expect(screen.getByText('Static Soup')).toBeInTheDocument();
    expect(screen.getByText(/25/)).toBeInTheDocument();
    expect(screen.getByText('dinner')).toBeInTheDocument();
    expect(screen.getByText('Carrot')).toBeInTheDocument();
    expect(screen.getByText('Chop')).toBeInTheDocument();
    expect(screen.getByText('Chop the carrot.')).toBeInTheDocument();
    expect(screen.getByText('salt')).toBeInTheDocument();
    expect(screen.getByText('a warning')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/review/ReviewPanel.test.tsx`
Expected: FAIL - `readOnly` prop not accepted / textboxes still rendered.

- [ ] **Step 3: Implement readOnly in the editors**

`TagEditor.tsx` - add prop and early static return before any hooks-dependent UI (hooks still run; only the rendering branches):

```tsx
export function TagEditor({
  tags,
  onChange,
  readOnly = false,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  readOnly?: boolean
}) {
  // ... existing state/handlers unchanged ...

  if (readOnly) {
    return (
      <div className="tag-editor">
        {tags.length > 0 ? (
          <ul className="tag-editor-applied" aria-label="Applied tags">
            {tags.map((tag) => (
              <li key={tag} className="tag-editor-chip">
                <span>{tag}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tag-editor-hint">No tags.</p>
        )}
      </div>
    );
  }

  // ... existing editable JSX unchanged ...
```

`IngredientEditor.tsx` - same pattern (keep `IngredientThumbnail` reuse):

```tsx
export function IngredientEditor({
  ingredients,
  onChange,
  readOnly = false,
}: {
  ingredients: Ingredient[]
  onChange: (ingredients: Ingredient[]) => void
  readOnly?: boolean
}) {
  // ... existing handlers unchanged ...

  if (readOnly) {
    return (
      <div className="ingredient-editor">
        {ingredients.map((ingredient, index) => (
          <div className="ingredient-editor-row" key={index}>
            <IngredientThumbnail key={ingredient.image ?? 'no-image'} image={ingredient.image} />
            <span className="ingredient-editor-static-name">{ingredient.name}</span>
            <span className="ingredient-editor-static-amount">
              {ingredient.amount_text}
              {ingredient.unit ? ` ${ingredient.unit}` : ''}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // ... existing editable JSX unchanged ...
```

`StepEditor.tsx` - same pattern:

```tsx
export function StepEditor({
  steps,
  onChange,
  readOnly = false,
}: {
  steps: Step[]
  onChange: (steps: Step[]) => void
  readOnly?: boolean
}) {
  // ... existing handlers unchanged ...

  if (readOnly) {
    return (
      <div className="step-editor">
        {steps.map((step, index) => (
          <div className="step-editor-block" key={index}>
            <h4 className="step-editor-static-header">{step.step_header}</h4>
            <p className="step-editor-static-description">{step.step_description}</p>
            {step.image ? (
              <span className="step-editor-image-indicator" data-testid="step-image-indicator">
                Image attached: {step.image}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    );
  }

  // ... existing editable JSX unchanged ...
```

- [ ] **Step 4: Implement readOnly in ReviewPanel**

`ReviewPanel.tsx` - `onChange` becomes optional; a shared no-op keeps the editor prop contract required:

```tsx
const noop = () => {};

export function ReviewPanel({
  recipe,
  diagnostics,
  onChange,
  readOnly = false,
}: {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics | null
  onChange?: (recipe: CanonicalRecipe) => void
  readOnly?: boolean
}) {
  const emit = onChange ?? noop;
  // existing handlers call emit(...) instead of onChange(...)
```

Title and time render static when readOnly (replace the two labels):

```tsx
{readOnly ? (
  <>
    <p className="review-panel-static-field">
      <span className="review-panel-static-label">Title</span> {recipe.title}
    </p>
    <p className="review-panel-static-field">
      <span className="review-panel-static-label">Time (minutes)</span> {recipe.time ?? 'not set'}
    </p>
  </>
) : (
  <>
    {/* existing Title label/input */}
    {/* existing Time label/input */}
  </>
)}
```

Pass `readOnly={readOnly}` to `TagEditor`, `IngredientEditor`, `StepEditor`. Pantry section, `WarningsPanel`, and diagnostics line stay as-is.

- [ ] **Step 5: Run the full review test suite**

Run: `pnpm --filter web run test -- src/components/review`
Expected: PASS - new readOnly tests plus all pre-existing editor tests (editable behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/review
git commit -m "feat(web): add readOnly mode to ReviewPanel and editors"
```

---

### Task 3: readOnly mode for JsonPanel

**Files:**
- Modify: `apps/web/src/components/json/JsonPanel.tsx`
- Test: `apps/web/src/components/json/JsonPanel.test.tsx` (append)

**Interfaces:**
- Produces (used by Task 5): `JsonPanel` accepts `readOnly?: boolean` (default false); `savedId`, `dirty`, `onSaved` become optional with safe defaults. When readOnly: Save Recipe button and unsaved-changes note never render; Copy JSON and Download JSON still work.

- [ ] **Step 1: Write the failing tests**

Append to `JsonPanel.test.tsx` (reuse the file's existing recipe fixture):

```tsx
describe('readOnly mode', () => {
  it('hides Save and the unsaved note, keeps Copy and Download', () => {
    render(<JsonPanel recipe={RECIPE} readOnly />);
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy json/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download json/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/json/JsonPanel.test.tsx`
Expected: FAIL - required props missing / Save button rendered.

- [ ] **Step 3: Implement**

Prop changes in `JsonPanel.tsx`:

```tsx
export function JsonPanel({
  recipe,
  savedId = null,
  dirty = false,
  onSaved,
  readOnly = false,
}: {
  recipe: CanonicalRecipe
  savedId?: string | null
  dirty?: boolean
  onSaved?: (id: string) => void
  readOnly?: boolean
}) {
```

In `handleSave`, replace `onSaved(result.value.id)` with `onSaved?.(result.value.id)`.
Guard the note: `const showUnsavedNote = !readOnly && dirty && savedId === null;`
Wrap the Save button: `{readOnly ? null : (<button ...>Save Recipe</button>)}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/json/JsonPanel.test.tsx`
Expected: PASS, including pre-existing save-flow tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/json
git commit -m "feat(web): add readOnly mode to JsonPanel"
```

---

### Task 4: RecipeList component

**Files:**
- Create: `apps/web/src/components/library/RecipeList.tsx`
- Test: `apps/web/src/components/library/RecipeList.test.tsx`

**Interfaces:**
- Consumes: `RecipeSummary` from `shared`.
- Produces (used by Task 6):

```tsx
RecipeList({ recipes, onView, onDelete }: {
  recipes: RecipeSummary[]
  onView: (id: string) => void
  onDelete: (id: string) => void
})
```

Download is a plain anchor to `/api/recipe/download/:id`; no callback.

- [ ] **Step 1: Write the failing tests**

Create `RecipeList.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeSummary } from 'shared';
import { RecipeList } from './RecipeList.tsx';

const SUMMARIES: RecipeSummary[] = [
  { id: 'id-1', title: 'Soup', tags: ['dinner'], main_image: '/images/soup.png', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'id-2', title: 'Cake', tags: [], main_image: '/images/cake.png', createdAt: '2026-01-01T00:00:00.000Z' },
];

describe('RecipeList', () => {
  it('renders title, thumbnail, and tags per recipe', () => {
    render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Soup')).toBeInTheDocument();
    expect(screen.getByText('dinner')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Soup' })).toHaveAttribute('src', '/images/soup.png');
  });

  it('renders an empty state when there are no recipes', () => {
    render(<RecipeList recipes={[]} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no saved recipes yet/i)).toBeInTheDocument();
  });

  it('fires onView and onDelete with the recipe id', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onDelete = vi.fn();
    render(<RecipeList recipes={SUMMARIES} onView={onView} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'View Soup' }));
    expect(onView).toHaveBeenCalledWith('id-1');

    await user.click(screen.getByRole('button', { name: 'Delete Cake' }));
    expect(onDelete).toHaveBeenCalledWith('id-2');
  });

  it('links Download to the server download endpoint', () => {
    render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Download Soup' })).toHaveAttribute('href', '/api/recipe/download/id-1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/library/RecipeList.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `RecipeList.tsx`:

```tsx
// Library list: one card per saved recipe (title, main image thumbnail,
// tags, saved date). View/Delete are callbacks owned by LibraryPanel;
// Download is a plain anchor because the server sets the filename via
// Content-Disposition on GET /api/recipe/download/:id.
import type { RecipeSummary } from 'shared';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

export function RecipeList({
  recipes,
  onView,
  onDelete,
}: {
  recipes: RecipeSummary[]
  onView: (id: string) => void
  onDelete: (id: string) => void
}) {
  if (recipes.length === 0) {
    return <p className="recipe-list-empty">No saved recipes yet. Save one from the Create workspace to see it here.</p>;
  }

  return (
    <ul className="recipe-list" aria-label="Saved recipes">
      {recipes.map((recipe) => (
        <li key={recipe.id} className="recipe-list-card">
          <img className="recipe-list-thumbnail" src={recipe.main_image} alt={recipe.title} />
          <h3 className="recipe-list-title">{recipe.title}</h3>
          {recipe.tags.length > 0 ? (
            <ul className="recipe-list-tags" aria-label={`Tags for ${recipe.title}`}>
              {recipe.tags.map((tag) => (
                <li key={tag} className="recipe-list-tag">{tag}</li>
              ))}
            </ul>
          ) : null}
          <p className="recipe-list-date">Saved {formatDate(recipe.createdAt)}</p>
          <div className="recipe-list-actions">
            <button type="button" onClick={() => onView(recipe.id)} aria-label={`View ${recipe.title}`}>
              View
            </button>
            <a href={`/api/recipe/download/${encodeURIComponent(recipe.id)}`} aria-label={`Download ${recipe.title}`} download>
              Download
            </a>
            <button type="button" onClick={() => onDelete(recipe.id)} aria-label={`Delete ${recipe.title}`}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/library/RecipeList.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/library
git commit -m "feat(web): add RecipeList library card grid"
```

---

### Task 5: RecipeDetail component

**Files:**
- Create: `apps/web/src/components/library/RecipeDetail.tsx`
- Test: `apps/web/src/components/library/RecipeDetail.test.tsx`

**Interfaces:**
- Consumes: `getRecipe` (Task 1), `ReviewPanel` readOnly (Task 2), `JsonPanel` readOnly (Task 3), `ErrorBanner`.
- Produces (used by Task 6):

```tsx
RecipeDetail({ id, onBack, onOpenInCreate, onDelete }: {
  id: string
  onBack: () => void
  onOpenInCreate: (recipe: CanonicalRecipe) => void
  onDelete: (id: string) => void
})
```

Fetches its own recipe by id. Delete/Open in Create are delegated up; LibraryPanel owns confirm + API + list state.

- [ ] **Step 1: Write the failing tests**

Create `RecipeDetail.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { RecipeDetail } from './RecipeDetail.tsx';
import { getRecipe } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  getRecipe: vi.fn(),
}));

const mockedGetRecipe = vi.mocked(getRecipe);

const RECIPE: CanonicalRecipe = {
  title: 'Saved Soup',
  tags: [],
  time: 20,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/soup.png',
  steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
  metadata: { source_type: 'url', language: 'en', warnings: [] },
};

describe('RecipeDetail', () => {
  beforeEach(() => {
    mockedGetRecipe.mockReset();
  });

  it('fetches by id and renders the recipe read-only with no Save button', async () => {
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    expect(await screen.findByText('Saved Soup')).toBeInTheDocument();
    expect(mockedGetRecipe).toHaveBeenCalledWith('id-1');
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('fires onOpenInCreate with the loaded recipe', async () => {
    const user = userEvent.setup();
    const onOpenInCreate = vi.fn();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={onOpenInCreate} onDelete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /open in create/i }));
    expect(onOpenInCreate).toHaveBeenCalledWith(RECIPE);
  });

  it('fires onDelete with the id and onBack from the Back button', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onBack = vi.fn();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={onBack} onOpenInCreate={vi.fn()} onDelete={onDelete} />);

    await user.click(await screen.findByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('id-1');

    await user.click(screen.getByRole('button', { name: /back to library/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows an ErrorBanner when the fetch fails (e.g. stale id)', async () => {
    mockedGetRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RECIPE_NOT_FOUND', message: 'No recipe exists with id "id-9".' },
    });
    render(<RecipeDetail id="id-9" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    expect(await screen.findByText(/no recipe exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/library/RecipeDetail.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `RecipeDetail.tsx`:

```tsx
// Read-only detail view for one saved recipe. Fetches its own copy by id;
// LibraryPanel owns the list, selection, and the delete confirm/API flow.
// Open in Create hands the loaded recipe up so App can copy it into the
// Create workspace (a copy - saving there creates a new id, per specs/13).
import { useCallback, useEffect, useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import { getRecipe, type ApiFailure } from '../../api/client.ts';
import { ReviewPanel } from '../review/ReviewPanel.tsx';
import { JsonPanel } from '../json/JsonPanel.tsx';
import { ErrorBanner } from '../ErrorBanner.tsx';

type DetailStatus =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'loaded'; recipe: CanonicalRecipe };

export function RecipeDetail({
  id,
  onBack,
  onOpenInCreate,
  onDelete,
}: {
  id: string
  onBack: () => void
  onOpenInCreate: (recipe: CanonicalRecipe) => void
  onDelete: (id: string) => void
}) {
  const [status, setStatus] = useState<DetailStatus>({ phase: 'loading' });

  const load = useCallback(async () => {
    setStatus({ phase: 'loading' });
    const result = await getRecipe(id);
    if (result.ok) {
      setStatus({ phase: 'loaded', recipe: result.value.recipe });
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="recipe-detail">
      <div className="recipe-detail-toolbar">
        <button type="button" onClick={onBack}>
          Back to Library
        </button>
        {status.phase === 'loaded' ? (
          <>
            <button type="button" onClick={() => onOpenInCreate(status.recipe)}>
              Open in Create
            </button>
            <a href={`/api/recipe/download/${encodeURIComponent(id)}`} download>
              Download
            </a>
            <button type="button" onClick={() => onDelete(id)}>
              Delete
            </button>
          </>
        ) : null}
      </div>

      {status.phase === 'loading' ? <p className="recipe-detail-loading">Loading recipe...</p> : null}

      {status.phase === 'error' ? (
        <ErrorBanner error={status.error} onRetry={() => void load()} onDismiss={onBack} />
      ) : null}

      {status.phase === 'loaded' ? (
        <>
          <ReviewPanel recipe={status.recipe} diagnostics={null} readOnly />
          <JsonPanel recipe={status.recipe} readOnly />
        </>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/library/RecipeDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/library
git commit -m "feat(web): add read-only RecipeDetail view"
```

---

### Task 6: LibraryPanel (list state, selection, delete flow)

**Files:**
- Create: `apps/web/src/components/library/LibraryPanel.tsx`
- Test: `apps/web/src/components/library/LibraryPanel.test.tsx`

**Interfaces:**
- Consumes: `listRecipes`, `deleteRecipe` (Task 1), `RecipeList` (Task 4), `RecipeDetail` (Task 5), `ErrorBanner`.
- Produces (used by Task 7):

```tsx
LibraryPanel({ onOpenInCreate }: { onOpenInCreate: (recipe: CanonicalRecipe) => void })
```

Owns: summaries, load status, selectedId, delete failure state. Fetches `GET /api/recipes` on mount (component remounts on each Library visit, giving a fresh fetch). Sorts createdAt descending. Delete: `window.confirm` -> `deleteRecipe` -> remove from list, clear selection if it was selected.

- [ ] **Step 1: Write the failing tests**

Create `LibraryPanel.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeSummary } from 'shared';
import { LibraryPanel } from './LibraryPanel.tsx';
import { listRecipes, deleteRecipe, getRecipe } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  listRecipes: vi.fn(),
  deleteRecipe: vi.fn(),
  getRecipe: vi.fn(),
}));

const mockedListRecipes = vi.mocked(listRecipes);
const mockedDeleteRecipe = vi.mocked(deleteRecipe);

const SUMMARIES: RecipeSummary[] = [
  { id: 'id-old', title: 'Older', tags: [], main_image: '/images/a.png', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'id-new', title: 'Newer', tags: [], main_image: '/images/b.png', createdAt: '2026-02-01T00:00:00.000Z' },
];

describe('LibraryPanel', () => {
  beforeEach(() => {
    mockedListRecipes.mockReset();
    mockedDeleteRecipe.mockReset();
    vi.restoreAllMocks();
  });

  it('lists saved recipes sorted newest first', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    const cards = await screen.findAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual(['Newer', 'Older']);
  });

  it('shows an ErrorBanner with retry when the list fetch fails', async () => {
    mockedListRecipes
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Could not reach the server.' } })
      .mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Newer')).toBeInTheDocument();
  });

  it('deletes after confirm and removes the card from the list', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    mockedDeleteRecipe.mockResolvedValueOnce({ ok: true, value: {} });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(mockedDeleteRecipe).toHaveBeenCalledWith('id-old');
    await vi.waitFor(() => {
      expect(screen.queryByText('Older')).not.toBeInTheDocument();
    });
  });

  it('does not call the API when confirm is declined', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(mockedDeleteRecipe).not.toHaveBeenCalled();
  });

  it('shows an ErrorBanner when delete fails, keeping the card', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    mockedDeleteRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RECIPE_NOT_FOUND', message: 'No recipe exists with id "id-old".' },
    });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(await screen.findByText(/no recipe exists/i)).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('opens the detail view on View and returns on Back', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const mockedGetRecipe = vi.mocked(getRecipe);
    mockedGetRecipe.mockResolvedValue({
      ok: true,
      value: {
        recipe: {
          title: 'Newer',
          tags: [],
          time: null,
          ingredients: [],
          pantry_items: [],
          main_image: '/images/b.png',
          steps: [{ step_header: 'S', step_description: 'D' }],
          metadata: { source_type: 'url', language: 'en', warnings: [] },
        },
      },
    });
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'View Newer' }));
    expect(await screen.findByRole('button', { name: /back to library/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Older' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to library/i }));
    expect(await screen.findByRole('button', { name: 'View Older' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/components/library/LibraryPanel.test.tsx`
Expected: FAIL - module not found.

- [ ] **Step 3: Implement**

Create `LibraryPanel.tsx`:

```tsx
// Library section: owns the saved-recipe summaries, the selected detail id,
// and the delete confirm/API flow (RecipeList and RecipeDetail delegate
// delete up here so list state has one owner). Fetches on mount - the
// component remounts on each Library visit, so the list is always fresh.
import { useCallback, useEffect, useState } from 'react';
import type { CanonicalRecipe, RecipeSummary } from 'shared';
import { deleteRecipe, listRecipes, type ApiFailure } from '../../api/client.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { RecipeList } from './RecipeList.tsx';
import { RecipeDetail } from './RecipeDetail.tsx';

type ListStatus =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'ready' };

function sortNewestFirst(recipes: RecipeSummary[]): RecipeSummary[] {
  return [...recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function LibraryPanel({
  onOpenInCreate,
}: {
  onOpenInCreate: (recipe: CanonicalRecipe) => void
}) {
  const [summaries, setSummaries] = useState<RecipeSummary[]>([]);
  const [status, setStatus] = useState<ListStatus>({ phase: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Delete failures render alongside the list/detail rather than replacing
  // them - the recipe still exists, so its card must stay visible.
  const [deleteFailure, setDeleteFailure] = useState<{ id: string; error: ApiFailure } | null>(null);

  const load = useCallback(async () => {
    setStatus({ phase: 'loading' });
    const result = await listRecipes();
    if (result.ok) {
      setSummaries(sortNewestFirst(result.value.recipes));
      setStatus({ phase: 'ready' });
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const performDelete = useCallback(async (id: string) => {
    setDeleteFailure(null);
    const result = await deleteRecipe(id);
    if (result.ok) {
      setSummaries((prev) => prev.filter((summary) => summary.id !== id));
      setSelectedId((prev) => (prev === id ? null : prev));
    } else {
      setDeleteFailure({ id, error: result.error });
    }
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      const proceed = window.confirm('Delete this recipe? This cannot be undone.');
      if (!proceed) return;
      void performDelete(id);
    },
    [performDelete],
  );

  return (
    <div className="library-panel">
      {deleteFailure ? (
        <ErrorBanner
          error={deleteFailure.error}
          onRetry={() => void performDelete(deleteFailure.id)}
          onDismiss={() => setDeleteFailure(null)}
        />
      ) : null}

      {selectedId ? (
        <RecipeDetail
          id={selectedId}
          onBack={() => setSelectedId(null)}
          onOpenInCreate={onOpenInCreate}
          onDelete={handleDelete}
        />
      ) : (
        <>
          {status.phase === 'loading' ? <p className="library-panel-loading">Loading library...</p> : null}
          {status.phase === 'error' ? (
            <ErrorBanner error={status.error} onRetry={() => void load()} onDismiss={() => void load()} />
          ) : null}
          {status.phase === 'ready' ? (
            <RecipeList recipes={summaries} onView={setSelectedId} onDelete={handleDelete} />
          ) : null}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web run test -- src/components/library/LibraryPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/library
git commit -m "feat(web): add LibraryPanel with list/detail/delete flow"
```

---

### Task 7: App wiring, Open in Create, and library styles

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/workspace.css`
- Test: `apps/web/src/App.test.tsx` (append)

**Interfaces:**
- Consumes: `LibraryPanel` (Task 6), existing `adoptRecipe`/`shouldConfirmReplace` logic.
- Produces: Library nav button enabled; `adoptRecipe` returns `boolean` (adopted or cancelled); Open in Create switches to the Create view only when adoption succeeded. The three Create sections stay mounted but `hidden` while in the Library view so in-progress tab/form state survives browsing.

- [ ] **Step 1: Write the failing tests**

Append to `App.test.tsx` (mock `../api/client.ts` exports consistently with the file's existing mocks; add `listRecipes`, `getRecipe`, `deleteRecipe` to the mock factory if App's import graph now pulls them in):

```tsx
describe('Library view', () => {
  it('enables the Library nav button and shows the library on click', async () => {
    vi.mocked(listRecipes).mockResolvedValueOnce({ ok: true, value: { recipes: [] } });
    const user = userEvent.setup();
    render(<App />);

    const libraryButton = screen.getByRole('button', { name: /library/i });
    expect(libraryButton).toBeEnabled();
    await user.click(libraryButton);
    expect(await screen.findByText(/no saved recipes yet/i)).toBeInTheDocument();
  });

  it('hides the Create panels while in the Library view without unmounting them', async () => {
    vi.mocked(listRecipes).mockResolvedValueOnce({ ok: true, value: { recipes: [] } });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /library/i }));
    // hidden sections stay in the DOM but are not visible
    expect(screen.getByText(/no recipe loaded yet/i)).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/no recipe loaded yet/i)).toBeVisible();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web run test -- src/App.test.tsx`
Expected: FAIL - Library button disabled.

- [ ] **Step 3: Implement App changes**

In `App.tsx`:

1. `adoptRecipe` returns whether it adopted (Open in Create must not switch views on a cancelled confirm):

```tsx
const adoptRecipe = useCallback(
  (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null): boolean => {
    if (shouldConfirmReplace(recipeState)) {
      const proceed = window.confirm(
        'Loading a new recipe will discard your unsaved changes. Continue?',
      );
      if (!proceed) return false;
    }
    setRecipeState({ recipe, diagnostics, savedId: null, dirty: false });
    return true;
  },
  [recipeState],
);
```

(`IngestTabs`' `onRecipe` callers ignore the return value - no change needed there.)

2. Add the Open in Create handler:

```tsx
// Open in Create copies a saved recipe into the workspace (specs/13):
// saving it again creates a new id, the library original is untouched.
const handleOpenInCreate = useCallback(
  (recipe: CanonicalRecipe) => {
    if (adoptRecipe(recipe, null)) {
      setView('create');
    }
  },
  [adoptRecipe],
);
```

3. Enable the Library nav button (replace the disabled placeholder):

```tsx
<button
  type="button"
  className="workspace-nav-item"
  aria-current={view === 'library' ? 'page' : undefined}
  onClick={() => setView('library')}
>
  Library
</button>
```

Update the stale comment above `WorkspaceView` (Library no longer "ships in Phase 6" - it exists).

4. Keep Create sections mounted but hidden in Library view; render LibraryPanel only while visible (fresh fetch per visit). Wrap the three existing `<section>` elements:

```tsx
const inCreate = view === 'create';
// ...
<section className="workspace-panel workspace-panel-input" aria-labelledby="input-panel-heading" hidden={!inCreate}>
  ...
</section>
<section className="workspace-panel workspace-panel-review" aria-labelledby="review-panel-heading" hidden={!inCreate}>
  ...
</section>
<section className="workspace-panel workspace-panel-json" aria-labelledby="json-panel-heading" hidden={!inCreate}>
  ...
</section>

{view === 'library' ? (
  <section className="workspace-panel workspace-panel-library" aria-labelledby="library-panel-heading">
    <h2 id="library-panel-heading">Library</h2>
    <LibraryPanel onOpenInCreate={handleOpenInCreate} />
  </section>
) : null}
```

Import: `import { LibraryPanel } from './components/library/LibraryPanel.tsx';`

- [ ] **Step 4: Add library styles**

Append to `workspace.css`, matching the existing token variables used elsewhere in the file (inspect the top of the file for the exact custom property names and reuse them):

```css
/* Library */
.workspace-panel-library {
  grid-column: 1 / -1;
}

.recipe-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
  gap: var(--space-4, 1rem);
}

.recipe-list-card {
  border: 1px solid var(--color-border, #ddd);
  border-radius: var(--radius-2, 0.5rem);
  padding: var(--space-3, 0.75rem);
  display: flex;
  flex-direction: column;
  gap: var(--space-2, 0.5rem);
}

.recipe-list-thumbnail {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: var(--radius-2, 0.5rem);
}

.recipe-list-title {
  margin: 0;
}

.recipe-list-tags {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1, 0.25rem);
}

.recipe-list-tag {
  border: 1px solid var(--color-border, #ddd);
  border-radius: 999px;
  padding: 0 var(--space-2, 0.5rem);
  font-size: 0.85em;
}

.recipe-list-date {
  margin: 0;
  font-size: 0.85em;
  color: var(--color-text-muted, #666);
}

.recipe-list-actions,
.recipe-detail-toolbar {
  display: flex;
  gap: var(--space-2, 0.5rem);
  align-items: center;
  flex-wrap: wrap;
}

.recipe-detail {
  display: flex;
  flex-direction: column;
  gap: var(--space-4, 1rem);
}

.review-panel-static-field {
  margin: 0;
}

.review-panel-static-label {
  font-weight: 600;
  margin-right: 0.5em;
}
```

If `workspace.css` does not define some of the custom properties above, the fallbacks after the comma apply; prefer swapping in the file's real token names where they exist.

- [ ] **Step 5: Run the full web test suite**

Run: `pnpm --filter web run test`
Expected: PASS - all suites, including pre-existing App tests (the nav test asserting a disabled Library button will need its assertion flipped if one exists; update it to assert the button is enabled).

- [ ] **Step 6: Manual smoke check**

Start backend and frontend (`pnpm --filter server run dev` needs `server/.env` loaded - see project notes; `pnpm --filter web run dev`). Verify in the browser:
- Save a recipe from Create, switch to Library: card appears with thumbnail/tags.
- View: read-only detail, no Save button; JSON copy works.
- Open in Create: recipe lands in Create view; editing then saving produces a new id.
- Download: file downloads with slugified name.
- Delete: confirm dialog, card disappears; recipe file gone from `server/data/recipes/`.
- Restart the server; library still lists saved recipes.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/workspace.css
git commit -m "feat(web): wire Library view into workspace nav with Open in Create"
```

---

### Task 8: Documentation updates and final verification

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `plans/recipe-maker-implementation-plan.md`

**Interfaces:** None - documentation only.

- [ ] **Step 1: Update README**

In the status section (around lines 9-11 and 31-39): add Phase 6 to the completed list; replace the "Library UI (Phase 6) is ..." sentence with a short description of the Library (list/view read-only/download/delete plus Open in Create copy). Keep wording consistent with the surrounding text.

- [ ] **Step 2: Update CLAUDE.md**

In the `## Status` section: fold Phase 6 into the done list and change "Next: Phase 6 Library UI (backend routes already exist)." to "Next: Phase 7 Milestone 2 card rendering."

- [ ] **Step 3: Update the master plan**

In `plans/recipe-maker-implementation-plan.md` Phase 6: append `[Done.]` to implementation task 3, mirroring how tasks 1-2 are marked.

- [ ] **Step 4: Full verification**

Run: `pnpm --filter web run test && pnpm --filter server run test`
Expected: PASS across both packages.

Run: `pnpm --filter web run build`
Expected: clean TypeScript build, no errors.

- [ ] **Step 5: Commit**

```bash
git add README.md CLAUDE.md plans/recipe-maker-implementation-plan.md
git commit -m "docs: mark Phase 6 Library UI complete"
```
