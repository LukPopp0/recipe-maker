// Library section: owns the saved-recipe summaries, the selected detail id,
// and the delete confirm/API flow (RecipeList and RecipeDetail delegate
// delete up here so list state has one owner). Fetches on mount - the
// component remounts on each Library visit, so the list is always fresh.
import { useCallback, useEffect, useState } from 'react';
import type { CanonicalRecipe, RecipeSummary } from 'shared';
import { deleteRecipe, listRecipes, type ApiFailure } from '../../api/client.ts';
import { applyLibraryQuery, collectTags, EMPTY_FILTERS, type LibraryFilters, type LibrarySort } from '../../lib/library-query.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { LibraryFilterBar } from './LibraryFilterBar.tsx';
import { RecipeList } from './RecipeList.tsx';
import { RecipeDetail } from './RecipeDetail.tsx';

type ListStatus =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'ready' };

export function LibraryPanel({
  onOpenInCreate,
}: {
  onOpenInCreate: (recipe: CanonicalRecipe) => void
}) {
  const [summaries, setSummaries] = useState<RecipeSummary[]>([]);
  const [status, setStatus] = useState<ListStatus>({ phase: 'loading' });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Filter/sort state resets on each Library visit (component remounts) -
  // deliberate: a stale filter hiding recipes days later would look like data loss.
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<LibrarySort>('newest');
  // Delete failures render alongside the list/detail rather than replacing
  // them - the recipe still exists, so its card must stay visible.
  const [deleteFailure, setDeleteFailure] = useState<{ id: string; error: ApiFailure } | null>(null);

  const load = useCallback(async () => {
    setStatus({ phase: 'loading' });
    const result = await listRecipes();
    if (result.ok) {
      setSummaries(result.value.recipes);
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
          {status.phase === 'ready' ? (() => {
            const visible = applyLibraryQuery(summaries, filters, sort);
            return (
              <>
                {summaries.length > 0 ? (
                  <LibraryFilterBar
                    filters={filters}
                    sort={sort}
                    availableTags={collectTags(summaries)}
                    matchCount={visible.length}
                    totalCount={summaries.length}
                    onFiltersChange={setFilters}
                    onSortChange={setSort}
                  />
                ) : null}
                {summaries.length > 0 && visible.length === 0 ? (
                  <p className="recipe-list-empty">No recipes match the current filters.</p>
                ) : (
                  <RecipeList recipes={visible} onView={setSelectedId} onDelete={handleDelete} />
                )}
              </>
            );
          })() : null}
        </>
      )}
    </div>
  );
}
