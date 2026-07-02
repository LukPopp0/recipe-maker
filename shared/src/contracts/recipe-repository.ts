// Wire shape for recipe list summaries per specs/13. The full RecipeRepository
// interface (save/get/list/delete) lives in server/, since only the backend
// implements it; both frontend and backend need this summary type for
// GET /api/recipes.
export type RecipeSummary = {
  id: string
  title: string
  tags: string[]
  main_image: string
  createdAt: string
}
