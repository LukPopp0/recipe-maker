// Wire shape for recipe list summaries per docs/specs/13. The full RecipeRepository
// interface (save/get/list/delete) lives in server/, since only the backend
// implements it; both frontend and backend need this summary type for
// GET /api/recipes.
// Ownership and timestamps every stored recipe carries (deployment spec section 3).
export type RecipeMeta = {
  id: string
  owner: string
  createdAt: string
  updatedAt: string
}

export type RecipeSummary = {
  id: string
  title: string
  tags: string[]
  main_image: string
  createdAt: string
  // owner/updatedAt per the deployment spec section 3
  updatedAt: string
  owner: string
  // Library filter/sort fields, lifted from the stored recipe at list() time
  time: number | null
  source_type: 'url' | 'manual'
}

export type LibraryScope = 'mine' | 'all'
