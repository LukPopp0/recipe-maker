import type { CanonicalRecipe, RecipeSummary } from 'shared';

// Pluggable persistence interface per specs/13, mirroring the StorageAdapter pattern
// (spec 06) so a database-backed implementation can replace the local JSON file
// implementation later without touching callers. Server-only: unlike RecipeSummary,
// this interface is not part of the shared wire contract.
export interface RecipeRepository {
  save(recipe: CanonicalRecipe): Promise<{ id: string }>
  get(id: string): Promise<CanonicalRecipe | null>
  list(): Promise<RecipeSummary[]>
  delete(id: string): Promise<void>
}
