// URL ingestion tab: a single input + submit button that calls ingestUrl and
// hands the resulting recipe up to the workspace via onRecipe.
import { useCallback, useState, type FormEvent } from 'react';
import type { CanonicalRecipe } from 'shared';
import { ingestUrl, type IngestDiagnostics } from '../../api/client.ts';
import type { IngestStatus } from '../../workspace-types.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { StageStatus } from './StageStatus.tsx';

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function UrlTab({
  onRecipe,
  onExtractStart,
}: {
  onRecipe: (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null) => void
  onExtractStart: () => void
}) {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<IngestStatus>({ phase: 'idle' });
  const [inlineError, setInlineError] = useState<string | null>(null);

  const submit = useCallback(
    async (value: string) => {
      // Clear the current recipe before the long-running call (item 5). Only
      // reached after handleSubmit's validation passes, or via retry.
      onExtractStart();
      setInlineError(null);
      setStatus({ phase: 'submitting' });
      setStatus({
        phase: 'processing',
        message: 'Extracting and normalizing (this can take up to a minute)...',
      });

      const result = await ingestUrl(value);
      if (result.ok) {
        setStatus({ phase: 'complete' });
        onRecipe(result.value.recipe, result.value.diagnostics);
      } else {
        setStatus({ phase: 'error', error: result.error });
      }
    },
    [onRecipe, onExtractStart],
  );

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = url.trim();
      if (!trimmed) return;
      if (!isValidHttpUrl(trimmed)) {
        setInlineError('Enter a valid http:// or https:// URL.');
        return;
      }
      void submit(trimmed);
    },
    [url, submit],
  );

  const handleRetry = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    void submit(trimmed);
  }, [url, submit]);

  const handleDismiss = useCallback(() => {
    setStatus({ phase: 'idle' });
  }, []);

  const isPending = status.phase === 'submitting' || status.phase === 'processing';

  return (
    <form className="url-tab" onSubmit={handleSubmit}>
      <label htmlFor="url-tab-input">Recipe URL</label>
      <input
        id="url-tab-input"
        type="text"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        disabled={isPending}
        placeholder="https://example.com/recipe"
      />
      {inlineError ? (
        <p className="url-tab-inline-error" role="alert">
          {inlineError}
        </p>
      ) : null}
      <button type="submit" disabled={isPending || url.trim().length === 0}>
        Extract Recipe
      </button>
      <StageStatus status={status} />
      {status.phase === 'error' ? (
        <ErrorBanner error={status.error} onRetry={handleRetry} onDismiss={handleDismiss} />
      ) : null}
    </form>
  );
}
