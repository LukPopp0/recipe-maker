# Spec 13: Recipe Persistence and Library

## Goal
Allow a user to explicitly save a normalized recipe server-side, and later browse, view, download, or delete saved recipes. Ships as part of Milestone 1.

## Storage: RecipeRepository

Pluggable interface, mirroring the existing StorageAdapter pattern (spec 06), so a database-backed implementation can replace it later without touching callers.

```ts
interface RecipeRepository {
  save(recipe: CanonicalRecipe): Promise<{ id: string }>
  get(id: string): Promise<CanonicalRecipe | null>
  list(): Promise<RecipeSummary[]>
  delete(id: string): Promise<void>
}

type RecipeSummary = {
  id: string
  title: string
  tags: string[]
  main_image: string
  createdAt: string
}
```

### LocalJsonFileRecipeRepository (milestone 1 default)
- Writes one file per recipe: `server/data/recipes/{id}.json`.
- `id` is a generated identifier (e.g. ULID/UUID), independent of the download filename slug used in spec 09's JSON export.
- `list()` reads summaries by scanning the directory; acceptable at personal-use scale. Revisit if this becomes a bottleneck.
- `server/data/recipes` is excluded from version control (see spec 01 security requirements).

## Save Flow
- Saving is an explicit user action, not automatic (spec 09: "Save Recipe" button in the review panel).
- Applies equally to freshly-ingested recipes and recipes loaded via the Load JSON tab - both go through the same review panel and the same Save action.
- Calls `POST /api/recipe/save` (spec 03); backend validates against the canonical schema before writing.
- On success, UI confirms with the returned id (e.g. "Saved" state, optional link to the library entry).

## Library UI
New top-level section alongside the ingestion workspace (spec 09 layout).

Milestone 1 scope:
- List view: grid/list of saved recipes showing title, main image thumbnail, and tags. Backed by `GET /api/recipes`.
- View action: opens the recipe in the existing read-only review/JSON panel (no new rendering code). Backed by `GET /api/recipe/:id`.
- Open in Create action (Phase 6 decision): copies the viewed recipe into the Create workspace for editing. Saving there creates a new recipe id; the original saved recipe is untouched. This is a copy, not an in-place update - the update path stays out of scope.
- Download action: triggers `GET /api/recipe/download/:id`.
- Delete action: confirms, then calls `DELETE /api/recipe/:id` and removes the item from the list.

Milestone 2 upgrade (not built until spec 10's card renderer exists):
- Add a "View as Card" link from the library view action into the card renderer, reusing the same component the ingestion workspace uses for its review-to-card transition.

Out of scope for now:
- Re-editing a saved recipe in place (would require an update path on RecipeRepository). Revisit if needed later.
- Search/filter/pagination. Fine to list everything at personal-use scale.

## Acceptance Criteria
- A saved recipe survives a server restart (flat file on disk).
- Library list, view, download, and delete all work against the same RecipeRepository the save flow writes to.
- Deleting a recipe removes its JSON file and it no longer appears in `GET /api/recipes`.
- Load JSON does not implicitly save; explicit Save is always required.
