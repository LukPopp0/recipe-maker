// Library section: owns the saved-recipe summaries, the selected detail id,
// and the delete confirm/API flow (RecipeList and RecipeDetail delegate
// delete up here so list state has one owner). Fetches on mount - the
// component remounts on each Library visit, so the list is always fresh.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanonicalRecipe, CurrentUser, LibraryScope, RecipeSummary } from 'shared';
import { deleteRecipe, listRecipes, type ApiFailure } from '../../api/client.ts';
import { loadLibraryScope, storeLibraryScope } from '../../lib/library-scope.ts';
import { canDeleteRecipe } from '../../lib/permissions.ts';
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
  currentUser,
  onOpenInCreate,
}: {
  currentUser: CurrentUser | null
  onOpenInCreate: (recipe: CanonicalRecipe, sourceId: string) => void
}) {
  const [scope, setScope] = useState<LibraryScope>(loadLibraryScope);
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

  // Scope switches can overlap; only the latest request may write state,
  // otherwise a slow "all" response could overwrite the "mine" list.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setStatus({ phase: 'loading' });
    const result = await listRecipes(scope);
    if (request !== latestRequest.current) return;
    if (result.ok) {
      setSummaries(result.value.recipes);
      setStatus({ phase: 'ready' });
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeScope = (next: LibraryScope) => {
    storeLibraryScope(next);
    setScope(next);
  };

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
          currentUser={currentUser}
          onBack={() => setSelectedId(null)}
          onOpenInCreate={onOpenInCreate}
          onDelete={handleDelete}
        />
      ) : (
        <>
          <div className="library-scope" role="group" aria-label="Which recipes">
            <button type="button" className="btn btn-sm" aria-pressed={scope === 'mine'} onClick={() => changeScope('mine')}>
              My recipes
            </button>
            <button type="button" className="btn btn-sm" aria-pressed={scope === 'all'} onClick={() => changeScope('all')}>
              All recipes
            </button>
          </div>
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
                  <RecipeList
                    recipes={visible}
                    showOwner={scope === 'all'}
                    emptyMessage={
                      scope === 'mine'
                        ? "You have not saved any recipes yet. Switch to All recipes to see everyone's."
                        : 'No saved recipes yet. Save one from the Create workspace to see it here.'
                    }
                    canDelete={(summary) => canDeleteRecipe(currentUser, summary.owner)}
                    onView={setSelectedId}
                    onDelete={handleDelete}
                  />
                )}
              </>
            );
          })() : null}
        </>
      )}
    </div>
  );
}
