import type { CanonicalRecipe, RecipeMeta, RecipeSummary } from 'shared';

// Pluggable persistence interface per docs/specs/13, mirroring the StorageAdapter pattern
// (spec 06) so a database-backed implementation can replace the local JSON file
// implementation later without touching callers. Server-only: unlike RecipeSummary,
// this interface is not part of the shared wire contract.
export type StoredRecipe = RecipeMeta & { recipe: CanonicalRecipe }

export interface RecipeRepository {
  // Creates a new recipe owned by `owner`; returns its new id.
  save(recipe: CanonicalRecipe, owner: string): Promise<{ id: string }>
  // Replaces the recipe body and bumps updatedAt; owner and createdAt stay.
  // Returns false (and writes nothing) when the id does not exist.
  update(id: string, recipe: CanonicalRecipe): Promise<boolean>
  get(id: string): Promise<StoredRecipe | null>
  // Every stored recipe with its body (image cleanup needs the bodies).
  getAll(): Promise<StoredRecipe[]>
  // Newest first; only `owner`'s recipes when given.
  list(filter?: { owner?: string }): Promise<RecipeSummary[]>
  delete(id: string): Promise<void>
  // Releases held resources (e.g. the SQLite handle) on shutdown; the JSON store holds none.
  close?(): void
}

// Single mapping from a stored recipe to its list summary, shared by every
// implementation so the summary fields cannot drift between stores.
export function toRecipeSummary(stored: StoredRecipe): RecipeSummary {
  return {
    id: stored.id,
    title: stored.recipe.title,
    tags: stored.recipe.tags,
    main_image: stored.recipe.main_image,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
    owner: stored.owner,
    time: stored.recipe.time,
    source_type: stored.recipe.metadata.source_type,
  };
}
