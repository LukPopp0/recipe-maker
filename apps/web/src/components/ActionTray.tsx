// Floating action tray (phase 8.5 item 11): bottom-center sticky pill with
// the workspace's two primary actions - Save Recipe and Preview Card. Owns
// the save state machine that used to live in JsonPanel; both actions
// re-validate against CanonicalRecipeSchema client-side first, so a broken
// edit never produces a wasted round trip (save stays authoritative
// server-side). Save never fires automatically - only a direct click.
import { useCallback, useState } from 'react';
import { CanonicalRecipeSchema, type CanonicalRecipe } from 'shared';
import { saveRecipe, type ApiFailure, type FlattenedErrors } from '../api/client.ts';
import type { WorkspaceRecipeState } from '../workspace-types.ts';
import { FieldErrors } from './review/FieldErrors.tsx';
import { ErrorBanner } from './ErrorBanner.tsx';

// The server wraps zod's flatten() output under an `issues` key (see
// server/src/routes/recipe.ts SCHEMA_VALIDATION_FAILED), so it must be
// unwrapped before use. Guards against a malformed shape so a bad response
// falls back to the generic save-error path instead of throwing in
// FieldErrors.
function isFlattenedErrors(value: unknown): value is FlattenedErrors {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.formErrors) && typeof candidate.fieldErrors === 'object' && candidate.fieldErrors !== null;
}

type ActionTrayStatus =
  | { phase: 'idle' }
  | { phase: 'validation-error'; errors: FlattenedErrors }
  | { phase: 'saving' }
  | { phase: 'saved'; id: string }
  | { phase: 'save-error'; error: ApiFailure };

export function ActionTray({
  recipeState,
  visible,
  onSaved,
  onPreviewCard,
}: {
  recipeState: WorkspaceRecipeState
  visible: boolean
  onSaved: (id: string) => void
  onPreviewCard: () => void
}) {
  const [status, setStatus] = useState<ActionTrayStatus>({ phase: 'idle' });
  // Tracks which recipe reference `status` was produced for, so a stale save
  // confirmation/error from a previous edit resets in-render (React's
  // "adjusting state when a prop changes" pattern) rather than in an effect.
  const [statusRecipe, setStatusRecipe] = useState<CanonicalRecipe | null>(
    recipeState?.recipe ?? null,
  );

  const recipe = recipeState?.recipe ?? null;
  if (statusRecipe !== recipe) {
    setStatusRecipe(recipe);
    setStatus({ phase: 'idle' });
  }

  const handlePreviewCard = useCallback(() => {
    if (!recipe) return;
    const parsed = CanonicalRecipeSchema.safeParse(recipe);
    if (!parsed.success) {
      setStatus({ phase: 'validation-error', errors: parsed.error.flatten() });
      return;
    }
    setStatus({ phase: 'idle' });
    onPreviewCard();
  }, [recipe, onPreviewCard]);

  const handleSave = useCallback(() => {
    if (!recipe) return;
    const parsed = CanonicalRecipeSchema.safeParse(recipe);
    if (!parsed.success) {
      setStatus({ phase: 'validation-error', errors: parsed.error.flatten() });
      return;
    }

    setStatus({ phase: 'saving' });
    void saveRecipe(recipe).then((result) => {
      if (result.ok) {
        setStatus({ phase: 'saved', id: result.value.id });
        onSaved(result.value.id);
        return;
      }

      if (result.error.code === 'SCHEMA_VALIDATION_FAILED') {
        const details = result.error.details as { issues?: unknown } | undefined;
        const issues = details?.issues;
        if (isFlattenedErrors(issues)) {
          setStatus({ phase: 'validation-error', errors: issues });
          return;
        }
      }

      setStatus({ phase: 'save-error', error: result.error });
    });
  }, [recipe, onSaved]);

  const handleDismissSaveError = useCallback(() => {
    setStatus({ phase: 'idle' });
  }, []);

  if (!visible || !recipeState || !recipe) {
    return null;
  }

  const isSaving = status.phase === 'saving';
  const showUnsavedNote = recipeState.dirty && recipeState.savedId === null;

  return (
    <aside className="action-tray-region" aria-label="Recipe actions">
      {status.phase === 'validation-error' ? (
        <div className="action-tray-feedback">
          <FieldErrors {...status.errors} />
        </div>
      ) : null}
      {status.phase === 'save-error' ? (
        <div className="action-tray-feedback">
          <ErrorBanner error={status.error} onRetry={handleSave} onDismiss={handleDismissSaveError} />
        </div>
      ) : null}

      <div className="action-tray">
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Recipe'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={handlePreviewCard}>
          Preview Card
        </button>
        {status.phase === 'saved' ? (
          <span className="action-tray-note action-tray-note-saved">Saved (id: {status.id})</span>
        ) : showUnsavedNote ? (
          <span className="action-tray-note">Unsaved changes</span>
        ) : null}
      </div>
    </aside>
  );
}
