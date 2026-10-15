# Spec 13: Recipe Persistence and Library

## Goal
Allow a user to explicitly save a normalized recipe server-side, and later browse, view, download, or delete saved recipes. Ships as part of Milestone 1.

## Storage: RecipeRepository

Pluggable interface, mirroring the existing StorageAdapter pattern (spec 06), so the store can be swapped without touching callers. `RECIPE_STORE` selects the implementation at startup (spec 11 Storage Settings).

```ts
interface RecipeRepository {
  save(recipe: CanonicalRecipe, owner: string): Promise<{ id: string }>
  update(id: string, recipe: CanonicalRecipe): Promise<boolean>  // false, no write, for an unknown id
  get(id: string): Promise<StoredRecipe | null>
  getAll(): Promise<StoredRecipe[]>
  list(filter?: { owner?: string }): Promise<RecipeSummary[]>  // newest first
  delete(id: string): Promise<void>
}

type StoredRecipe = {
  id: string
  owner: string
  createdAt: string
  updatedAt: string
  recipe: CanonicalRecipe
}

type RecipeSummary = {
  id: string
  title: string
  tags: string[]
  main_image: string
  owner: string
  createdAt: string
  updatedAt: string
}
```

- `update` keeps `owner` and `createdAt` and bumps `updatedAt`. It never creates a recipe.
- Both implementations pass one shared contract test suite.

### LocalJsonFileRecipeRepository (default, `RECIPE_STORE=json`)
- Writes one file per recipe: `server/data/recipes/{id}.json`.
- `id` is a generated identifier (e.g. ULID/UUID), independent of the download filename slug used in spec 09's JSON export.
- `list()` reads summaries by scanning the directory; acceptable at personal-use scale. Revisit if this becomes a bottleneck.
- Legacy envelopes written before owners existed (no `owner`/`updatedAt`) are read as owner `local` with `updatedAt` = `createdAt`.
- `server/data/recipes` is excluded from version control (see spec 01 security requirements).

### SqliteRecipeRepository (`RECIPE_STORE=sqlite`)
- Uses `better-sqlite3`; database file at `RECIPE_DB_PATH` (default `./data/db/recipes.db`).
- Table `recipes(id TEXT PRIMARY KEY, owner TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)` where `data` is the recipe as JSON text, with an index on `(owner, created_at)`.
- WAL journal mode; schema version tracked with `PRAGMA user_version = 1`.

## Save Flow
- Saving is an explicit user action, not automatic (spec 09: "Save Recipe" button in the review panel).
- Applies equally to freshly-ingested recipes and recipes loaded via the Load JSON tab - both go through the same review panel and the same Save action.
- Calls `POST /api/recipe/save` (spec 03); backend validates against the canonical schema before writing. The caller becomes the owner.
- On success, UI confirms with the returned id (e.g. "Saved" state, optional link to the library entry).
- Ownership (multi-user): every recipe has an owner. Everyone can view and edit every recipe; only the owner or an admin can delete.
- A recipe opened from the Library (or saved once in this session) tracks its source id. The Create workspace then offers "Save changes" (`PUT /api/recipe/:id`, in place, owner kept) and "Save as new" (`POST`, new id). Retry after a failed save repeats the mode that failed. If the original was deleted meanwhile, "Save changes" shows a `RECIPE_NOT_FOUND` error and the edits stay on screen.

## Library UI
New top-level section alongside the ingestion workspace (spec 09 layout).

Milestone 1 scope:
- List view: grid/list of saved recipes showing title, main image thumbnail, and tags. Backed by `GET /api/recipes`.
- My/All switch: "My recipes" (default, `scope=mine`) or "All recipes" (`scope=all`), remembered in `localStorage` key `recipe-maker.library-scope`. In All, each item shows "by <owner>".
- View action: opens the recipe in the existing read-only review/JSON panel (no new rendering code), with "Saved by <owner>" in the detail. Backed by `GET /api/recipe/:id`.
- Open in Create action (Phase 6 decision): copies the viewed recipe into the Create workspace for editing. The workspace then offers "Save changes" (update in place) or "Save as new" (see Save Flow).
- Download action: triggers `GET /api/recipe/download/:id`.
- Delete action: shown only to the owner or an admin; confirms, then calls `DELETE /api/recipe/:id` and removes the item from the list.

Milestone 2 upgrade (not built until spec 10's card renderer exists):
- Add a "View as Card" link from the library view action into the card renderer, reusing the same component the ingestion workspace uses for its review-to-card transition.

Out of scope for now:
- Search/filter/pagination. Fine to list everything at personal-use scale.

## Acceptance Criteria
- A saved recipe survives a server restart (flat file or SQLite database on disk).
- Updating a recipe keeps its owner; updating an unknown id returns 404 and creates nothing.
- Deleting as a non-owner, non-admin returns 403 and the recipe still exists.
- Library list, view, download, and delete all work against the same RecipeRepository the save flow writes to.
- Deleting a recipe removes it from the store and it no longer appears in `GET /api/recipes`.
- Load JSON does not implicitly save; explicit Save is always required.
