// Manual ingestion tab: ingredients/steps text plus a main image and optional
// step images, validated client-side against the same limits the server
// enforces (lib/upload-limits.ts) before spending a round trip.
import { useCallback, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { CanonicalRecipe } from 'shared';
import { ingestManual, type IngestDiagnostics } from '../../api/client.ts';
import { ACCEPTED_IMAGE_TYPES, validateManualUpload } from '../../lib/upload-limits.ts';
import type { IngestStatus } from '../../workspace-types.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { StageStatus } from './StageStatus.tsx';

const ACCEPT = ACCEPTED_IMAGE_TYPES.join(',');

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

// Pseudo-filename for a step image URL: the last URL path segment (fallback to
// hostname). Mirrors the server's deriveUrlFilename so the displayed ordering
// matches the server-side sorted-filename step assignment.
function urlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] || url.hostname;
  } catch {
    return raw;
  }
}

export function ManualTab({
  onRecipe,
  onExtractStart,
}: {
  onRecipe: (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null, imageNamespaceId?: string) => void
  onExtractStart: () => void
}) {
  const [ingredientsText, setIngredientsText] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [mainImage, setMainImage] = useState<File | undefined>(undefined);
  const [mainImageUrl, setMainImageUrl] = useState('');
  const [stepImages, setStepImages] = useState<File[]>([]);
  const [stepImageUrls, setStepImageUrls] = useState<string[]>([]);
  const [stepUrlDraft, setStepUrlDraft] = useState('');
  const [status, setStatus] = useState<IngestStatus>({ phase: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);
  const mainImageInputRef = useRef<HTMLInputElement>(null);

  // Step-image display order mirrors the server assignment (specs/05): file
  // uploads are sorted by filename (the user controls those names), then URL
  // images follow in add order because their server-side stored name is not
  // user-controllable, so a filename sort would be meaningless for them.
  const orderedStepEntries = useMemo(() => {
    const fileEntries = stepImages
      .map((file) => ({ kind: 'file' as const, name: file.name, file }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const urlEntries = stepImageUrls.map((url) => ({ kind: 'url' as const, name: urlLabel(url), url }));
    return [...fileEntries, ...urlEntries];
  }, [stepImages, stepImageUrls]);

  // Main image is either a file or a URL, never both: setting one clears the
  // other so the mutually-exclusive server contract can't be violated.
  const handleMainImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setMainImage(file);
    if (file) setMainImageUrl('');
  }, []);

  const handleMainUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setMainImageUrl(value);
    if (value.trim() !== '') setMainImage(undefined);
  }, []);

  const handleStepImagesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      setStepImages((prev) => [...prev, ...files]);
    }
    event.target.value = '';
  }, []);

  const addStepUrl = useCallback(() => {
    const trimmed = stepUrlDraft.trim();
    if (trimmed === '') return;
    setStepImageUrls((prev) => [...prev, trimmed]);
    setStepUrlDraft('');
  }, [stepUrlDraft]);

  // Also reset the native file input's value so re-selecting the same file
  // fires a fresh change event (otherwise the input keeps the removed file and
  // picking it again is a no-op).
  const removeMainImage = useCallback(() => {
    setMainImage(undefined);
    if (mainImageInputRef.current) mainImageInputRef.current.value = '';
  }, []);
  const removeMainUrl = useCallback(() => setMainImageUrl(''), []);
  const removeStepImage = useCallback((file: File) => {
    setStepImages((prev) => prev.filter((candidate) => candidate !== file));
  }, []);
  const removeStepUrl = useCallback((url: string) => {
    setStepImageUrls((prev) => prev.filter((candidate) => candidate !== url));
  }, []);

  const submit = useCallback(async () => {
    const validationErrors = validateManualUpload({
      ingredientsText,
      stepsText,
      mainImage,
      mainImageUrl,
      stepImages,
      stepImageUrls,
    });
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }
    // Clear the current recipe before the long-running call (item 5), only
    // once validation has passed so a rejected submit keeps it on screen.
    onExtractStart();
    setErrors([]);
    setStatus({ phase: 'submitting' });
    setStatus({
      phase: 'processing',
      message: 'Extracting and normalizing (this can take up to a minute)...',
    });

    const result = await ingestManual({
      ingredientsText,
      stepsText,
      mainImage,
      mainImageUrl,
      stepImages,
      stepImageUrls,
    });
    if (result.ok) {
      setStatus({ phase: 'complete' });
      onRecipe(result.value.recipe, result.value.diagnostics, result.value.imageNamespaceId);
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [ingredientsText, stepsText, mainImage, mainImageUrl, stepImages, stepImageUrls, onRecipe, onExtractStart]);

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

  const isPending = status.phase === 'submitting' || status.phase === 'processing';

  return (
    <form className="manual-tab" onSubmit={handleSubmit}>
      <label htmlFor="manual-tab-ingredients">Ingredients</label>
      <textarea
        id="manual-tab-ingredients"
        value={ingredientsText}
        onChange={(event) => setIngredientsText(event.target.value)}
        disabled={isPending}
      />

      <label htmlFor="manual-tab-steps">Steps</label>
      <textarea
        id="manual-tab-steps"
        value={stepsText}
        onChange={(event) => setStepsText(event.target.value)}
        disabled={isPending}
      />

      <label htmlFor="manual-tab-main-image">Main Image</label>
      <input
        id="manual-tab-main-image"
        ref={mainImageInputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleMainImageChange}
        disabled={isPending || mainImageUrl.trim() !== ''}
      />
      {mainImage ? (
        <div className="manual-tab-selected">
          <span>
            {mainImage.name} ({formatBytes(mainImage.size)})
          </span>
          <button
            type="button"
            className="manual-tab-remove"
            onClick={removeMainImage}
            aria-label={`Remove ${mainImage.name}`}
            disabled={isPending}
          >
            x
          </button>
        </div>
      ) : null}

      <label htmlFor="manual-tab-main-image-url">Main Image URL</label>
      <input
        id="manual-tab-main-image-url"
        type="url"
        placeholder="https://..."
        value={mainImageUrl}
        onChange={handleMainUrlChange}
        disabled={isPending || mainImage !== undefined}
      />
      {mainImageUrl.trim() !== '' ? (
        <div className="manual-tab-selected">
          <span>{mainImageUrl}</span>
          <button
            type="button"
            className="manual-tab-remove"
            onClick={removeMainUrl}
            aria-label={`Remove ${mainImageUrl}`}
            disabled={isPending}
          >
            x
          </button>
        </div>
      ) : null}

      <label htmlFor="manual-tab-step-images">Step Images (optional)</label>
      <input
        id="manual-tab-step-images"
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handleStepImagesChange}
        disabled={isPending}
      />

      <label htmlFor="manual-tab-step-image-url">Step Image URL (optional)</label>
      <div className="manual-tab-step-url-row">
        <input
          id="manual-tab-step-image-url"
          type="url"
          placeholder="https://..."
          value={stepUrlDraft}
          onChange={(event) => setStepUrlDraft(event.target.value)}
          disabled={isPending}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={addStepUrl} disabled={isPending || stepUrlDraft.trim() === ''}>
          Add
        </button>
      </div>

      <p className="manual-tab-hint">
        Step images map to steps in order: uploaded files by filename, then URL images in the order
        you add them.
      </p>

      <ul className="manual-tab-file-list">
        {orderedStepEntries.map((entry) =>
          entry.kind === 'file' ? (
            <li key={`file-${entry.name}-${entry.file.size}`}>
              <span>
                {entry.name} ({formatBytes(entry.file.size)})
              </span>
              <button
                type="button"
                className="manual-tab-remove"
                onClick={() => removeStepImage(entry.file)}
                aria-label={`Remove ${entry.name}`}
                disabled={isPending}
              >
                x
              </button>
            </li>
          ) : (
            <li key={`url-${entry.url}`}>
              <span>{entry.url} (URL)</span>
              <button
                type="button"
                className="manual-tab-remove"
                onClick={() => removeStepUrl(entry.url)}
                aria-label={`Remove ${entry.url}`}
                disabled={isPending}
              >
                x
              </button>
            </li>
          ),
        )}
      </ul>

      {errors.length > 0 ? (
        <ul className="manual-tab-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={isPending}>
        Normalize Recipe
      </button>

      <StageStatus status={status} />
      {status.phase === 'error' ? (
        <ErrorBanner error={status.error} onRetry={handleRetry} onDismiss={handleDismiss} />
      ) : null}
    </form>
  );
}
