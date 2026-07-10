// JSON panel: read-only highlighted viewer of the current recipe state, plus
// Copy JSON and Download JSON. Download re-validates against
// CanonicalRecipeSchema client-side first, so a broken edit never produces a
// broken file. Save and Preview Card live in the ActionTray (phase 8.5
// item 11), which owns the save state machine.
import { useCallback, useMemo, useState } from 'react';
import { CanonicalRecipeSchema, type CanonicalRecipe } from 'shared';
import type { FlattenedErrors } from '../../api/client.ts';
import { buildRecipeFilename, downloadJson } from '../../lib/download.ts';
import { highlightJson } from '../../lib/json-highlight.ts';
import { FieldErrors } from '../review/FieldErrors.tsx';

const COPY_FAILURE_MESSAGE = 'Copy failed - select the JSON text manually.';

type JsonPanelStatus =
  | { phase: 'idle' }
  | { phase: 'validation-error'; errors: FlattenedErrors };

export function JsonPanel({ recipe }: { recipe: CanonicalRecipe }) {
  const [status, setStatus] = useState<JsonPanelStatus>({ phase: 'idle' });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Tracks which recipe reference `status` was produced for, so a stale
  // validation error from a previous edit resets in-render (React's
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

      <div className="json-panel-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopy}>
          Copy JSON
        </button>
        {copyState === 'copied' ? <span className="json-panel-copied">Copied</span> : null}
        {copyState === 'failed' ? <span className="json-panel-copy-failed">{COPY_FAILURE_MESSAGE}</span> : null}

        <button type="button" className="btn btn-ghost btn-sm" onClick={handleDownload}>
          Download JSON
        </button>
      </div>

      {status.phase === 'validation-error' ? <FieldErrors {...status.errors} /> : null}
    </div>
  );
}
