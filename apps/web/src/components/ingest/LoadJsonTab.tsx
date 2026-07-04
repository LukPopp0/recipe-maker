// Load JSON tab: lets the user pick a previously-downloaded recipe JSON
// file, validates it against the canonical schema via /api/recipe/validate,
// and hands the normalized recipe up. This is not a fresh ingestion, so no
// diagnostics are produced - onRecipe is always called with null.
import { useCallback, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CanonicalRecipe } from 'shared';
import { validateRecipe, type ApiFailure, type FlattenedErrors } from '../../api/client.ts';
import { FieldErrors } from '../review/FieldErrors.tsx';
import { ErrorBanner } from '../ErrorBanner.tsx';

type LoadJsonStatus =
  | { phase: 'idle' }
  | { phase: 'submitting' }
  | { phase: 'parse-error'; message: string }
  | { phase: 'invalid'; errors: FlattenedErrors }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'complete' };

export function LoadJsonTab({
  onRecipe,
}: {
  onRecipe: (recipe: CanonicalRecipe, diagnostics: null) => void
}) {
  const [file, setFile] = useState<File | undefined>(undefined);
  const [status, setStatus] = useState<LoadJsonStatus>({ phase: 'idle' });

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0]);
    setStatus({ phase: 'idle' });
  }, []);

  const submit = useCallback(async () => {
    if (!file) return;

    setStatus({ phase: 'submitting' });

    let text: string;
    try {
      text = await file.text();
    } catch {
      setStatus({
        phase: 'parse-error',
        message: 'Could not read that file. Choose a recipe JSON file and try again.',
      });
      return;
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(text);
    } catch {
      setStatus({
        phase: 'parse-error',
        message: 'That file is not valid JSON. Choose a recipe JSON file and try again.',
      });
      return;
    }

    const result = await validateRecipe(candidate);
    if (!result.ok) {
      setStatus({ phase: 'error', error: result.error });
      return;
    }

    if (result.value.valid) {
      setStatus({ phase: 'complete' });
      onRecipe(result.value.recipe, null);
    } else {
      setStatus({ phase: 'invalid', errors: result.value.errors });
    }
  }, [file, onRecipe]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      void submit();
    },
    [submit],
  );

  const handleRetry = useCallback(() => {
    void submit();
  }, [submit]);

  const handleDismiss = useCallback(() => {
    setStatus({ phase: 'idle' });
  }, []);

  const isPending = status.phase === 'submitting';

  return (
    <form className="load-json-tab" onSubmit={handleSubmit}>
      <label htmlFor="load-json-tab-input">Recipe JSON file</label>
      <input
        id="load-json-tab-input"
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        disabled={isPending}
      />
      {status.phase === 'parse-error' ? (
        <p className="load-json-tab-parse-error" role="alert">
          {status.message}
        </p>
      ) : null}
      <button type="submit" disabled={isPending || !file}>
        Load Recipe
      </button>
      {status.phase === 'invalid' ? <FieldErrors {...status.errors} /> : null}
      {status.phase === 'error' ? (
        <ErrorBanner error={status.error} onRetry={handleRetry} onDismiss={handleDismiss} />
      ) : null}
    </form>
  );
}
