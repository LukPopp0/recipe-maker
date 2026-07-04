// JSON panel: read-only highlighted viewer of the current recipe state, plus
// three explicit actions - Copy JSON, Download JSON, and Save Recipe. Both
// Download and Save re-validate against CanonicalRecipeSchema client-side
// before doing anything, so a broken edit never produces a broken file or a
// wasted round trip to the server (save itself remains authoritative). Save
// never fires automatically - only a direct button click calls saveRecipe.
import { useCallback, useMemo, useState } from 'react';
import { CanonicalRecipeSchema, type CanonicalRecipe } from 'shared';
import { saveRecipe, type ApiFailure, type FlattenedErrors } from '../../api/client.ts';
import { buildRecipeFilename, downloadJson } from '../../lib/download.ts';
import { highlightJson } from '../../lib/json-highlight.ts';
import { FieldErrors } from '../review/FieldErrors.tsx';
import { ErrorBanner } from '../ErrorBanner.tsx';

// The server wraps zod's flatten() output under an `issues` key (see
// server/src/routes/recipe.ts SCHEMA_VALIDATION_FAILED), so it must be
// unwrapped before use. This also guards against a malformed/missing shape
// so a bad response falls back to the generic save-error path instead of
// throwing inside FieldErrors.
function isFlattenedErrors(value: unknown): value is FlattenedErrors {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate.formErrors) && typeof candidate.fieldErrors === 'object' && candidate.fieldErrors !== null;
}

const COPY_FAILURE_MESSAGE = 'Copy failed - select the JSON text manually.';

type JsonPanelStatus =
  | { phase: 'idle' }
  | { phase: 'validation-error'; errors: FlattenedErrors }
  | { phase: 'saving' }
  | { phase: 'saved'; id: string }
  | { phase: 'save-error'; error: ApiFailure };

export function JsonPanel({
  recipe,
  savedId = null,
  dirty = false,
  onSaved,
  readOnly = false,
}: {
  recipe: CanonicalRecipe
  savedId?: string | null
  dirty?: boolean
  onSaved?: (id: string) => void
  readOnly?: boolean
}) {
  const [status, setStatus] = useState<JsonPanelStatus>({ phase: 'idle' });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Tracks which recipe reference `status` was produced for, so a stale save
  // confirmation/error from a previous edit can be reset in-render (React's
  // documented "adjusting state when a prop changes" pattern) rather than in
  // an effect.
  const [statusRecipe, setStatusRecipe] = useState<CanonicalRecipe>(recipe);

  if (statusRecipe !== recipe) {
    setStatusRecipe(recipe);
    setStatus({ phase: 'idle' });
  }

  const json = useMemo(() => JSON.stringify(recipe, null, 2), [recipe]);
  const tokens = useMemo(() => highlightJson(json), [json]);

  const handleCopy = useCallback(() => {
    setCopyState('idle');
    if (!navigator.clipboard) {
      setCopyState('failed');
      return;
    }
    navigator.clipboard
      .writeText(json)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'));
  }, [json]);

  const handleDownload = useCallback(() => {
    const parsed = CanonicalRecipeSchema.safeParse(recipe);
    if (!parsed.success) {
      setStatus({ phase: 'validation-error', errors: parsed.error.flatten() });
      return;
    }
    setStatus({ phase: 'idle' });
    downloadJson(buildRecipeFilename(recipe.title), recipe);
  }, [recipe]);

  const handleSave = useCallback(() => {
    const parsed = CanonicalRecipeSchema.safeParse(recipe);
    if (!parsed.success) {
      setStatus({ phase: 'validation-error', errors: parsed.error.flatten() });
      return;
    }

    setStatus({ phase: 'saving' });
    void saveRecipe(recipe).then((result) => {
      if (result.ok) {
        setStatus({ phase: 'saved', id: result.value.id });
        onSaved?.(result.value.id);
        return;
      }

      if (result.error.code === 'SCHEMA_VALIDATION_FAILED') {
        const details = result.error.details as { issues?: unknown } | undefined;
        const issues = details?.issues;
        if (isFlattenedErrors(issues)) {
          setStatus({ phase: 'validation-error', errors: issues });
          return;
        }
        setStatus({ phase: 'save-error', error: result.error });
        return;
      }

      setStatus({ phase: 'save-error', error: result.error });
    });
  }, [recipe, onSaved]);

  const handleDismissSaveError = useCallback(() => {
    setStatus({ phase: 'idle' });
  }, []);

  const isSaving = status.phase === 'saving';
  const showUnsavedNote = !readOnly && dirty && savedId === null;

  return (
    <div className="json-panel">
      <pre className="json-panel-viewer">
        {tokens.map((token, index) => (
          // Tokens are positional, not identity-stable - index keys are correct here.
          <span key={index} className={`json-token json-token-${token.kind}`}>
            {token.text}
          </span>
        ))}
      </pre>

      {showUnsavedNote ? (
        <p className="json-panel-unsaved-note">You have unsaved changes - save or download to keep them.</p>
      ) : null}

      <div className="json-panel-actions">
        <button type="button" onClick={handleCopy}>
          Copy JSON
        </button>
        {copyState === 'copied' ? <span className="json-panel-copied">Copied</span> : null}
        {copyState === 'failed' ? <span className="json-panel-copy-failed">{COPY_FAILURE_MESSAGE}</span> : null}

        <button type="button" onClick={handleDownload}>
          Download JSON
        </button>

        {readOnly ? null : (
          <button type="button" onClick={handleSave} disabled={isSaving}>
            Save Recipe
          </button>
        )}
      </div>

      {status.phase === 'saved' ? (
        <p className="json-panel-saved-note">Saved (id: {status.id})</p>
      ) : null}

      {status.phase === 'validation-error' ? <FieldErrors {...status.errors} /> : null}

      {status.phase === 'save-error' ? (
        <ErrorBanner error={status.error} onRetry={handleSave} onDismiss={handleDismissSaveError} />
      ) : null}
    </div>
  );
}
