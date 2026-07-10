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
          <img
            className="recipe-list-thumbnail"
            src={recipe.main_image}
            alt={recipe.title}
            onError={(event) => {
              event.currentTarget.style.visibility = 'hidden';
            }}
          />
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
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onView(recipe.id)} aria-label={`View ${recipe.title}`}>
              View
            </button>
            <a className="btn btn-ghost btn-sm" href={`/api/recipe/download/${encodeURIComponent(recipe.id)}`} aria-label={`Download ${recipe.title}`} download>
              Download
            </a>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => onDelete(recipe.id)} aria-label={`Delete ${recipe.title}`}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
