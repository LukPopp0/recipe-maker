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
