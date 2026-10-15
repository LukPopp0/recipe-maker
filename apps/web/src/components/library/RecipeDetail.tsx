// Read-only detail view for one saved recipe. Fetches its own copy by id;
// LibraryPanel owns the list, selection, and the delete confirm/API flow.
// Open in Create hands the loaded recipe and its id up so App can load it into
// the Create workspace for editing (Save changes updates it in place, Save as
// new makes a copy).
import { useCallback, useEffect, useState } from 'react';
import type { CanonicalRecipe, CurrentUser, RecipeMeta } from 'shared';
import { getRecipe, type ApiFailure } from '../../api/client.ts';
import { canDeleteRecipe } from '../../lib/permissions.ts';
import { ReviewPanel } from '../review/ReviewPanel.tsx';
import { JsonPanel } from '../json/JsonPanel.tsx';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { CardView } from '../card/CardView.tsx';

type DetailStatus =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'loaded'; recipe: CanonicalRecipe; meta: RecipeMeta };

export function RecipeDetail({
  id,
  currentUser,
  onBack,
  onOpenInCreate,
  onDelete,
}: {
  id: string
  currentUser: CurrentUser | null
  onBack: () => void
  onOpenInCreate: (recipe: CanonicalRecipe, sourceId: string) => void
  onDelete: (id: string) => void
}) {
  const [status, setStatus] = useState<DetailStatus>({ phase: 'loading' });
  const [showCard, setShowCard] = useState(false);

  const load = useCallback(async () => {
    setStatus({ phase: 'loading' });
    const result = await getRecipe(id);
    if (result.ok) {
      setStatus({ phase: 'loaded', recipe: result.value.recipe, meta: result.value.meta });
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (showCard && status.phase === 'loaded') {
    return <CardView recipe={status.recipe} onBack={() => setShowCard(false)} />;
  }

  return (
    <div className="recipe-detail">
      <div className="recipe-detail-toolbar">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back to Library
        </button>
        {status.phase === 'loaded' ? (
          <>
            <button type="button" className="btn btn-secondary" onClick={() => onOpenInCreate(status.recipe, id)}>
              Open in Create
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setShowCard(true)}>
              View as Card
            </button>
            <a className="btn btn-ghost" href={`/api/recipe/download/${encodeURIComponent(id)}`} download>
              Download
            </a>
            {canDeleteRecipe(currentUser, status.meta.owner) ? (
              <button type="button" className="btn btn-danger" onClick={() => onDelete(id)}>
                Delete
              </button>
            ) : null}
            <small className="recipe-detail-owner">Saved by {status.meta.owner}</small>
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
          <JsonPanel recipe={status.recipe} />
        </>
      ) : null}
    </div>
  );
}
