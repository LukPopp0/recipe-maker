// Manual ingestion tab: ingredients/steps text plus a main image and optional
// step images, validated client-side against the same limits the server
// enforces (lib/upload-limits.ts) before spending a round trip.
import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
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

export function ManualTab({
  onRecipe,
  onExtractStart,
}: {
  onRecipe: (recipe: CanonicalRecipe, diagnostics: IngestDiagnostics | null) => void
  onExtractStart: () => void
}) {
  const [ingredientsText, setIngredientsText] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [mainImage, setMainImage] = useState<File | undefined>(undefined);
  const [stepImages, setStepImages] = useState<File[]>([]);
  const [status, setStatus] = useState<IngestStatus>({ phase: 'idle' });
  const [errors, setErrors] = useState<string[]>([]);

  // Step images are assigned to steps by sorted filename server-side
  // (specs/05), so the selected-file list is shown in that same order to
  // set expectations about which image lands on which step.
  const sortedStepImages = useMemo(
    () => [...stepImages].sort((a, b) => a.name.localeCompare(b.name)),
    [stepImages],
  );

  const handleMainImageChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setMainImage(event.target.files?.[0]);
  }, []);

  const handleStepImagesChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length > 0) {
      setStepImages((prev) => [...prev, ...files]);
    }
    event.target.value = '';
  }, []);

  const removeMainImage = useCallback(() => setMainImage(undefined), []);
  const removeStepImage = useCallback((file: File) => {
    setStepImages((prev) => prev.filter((candidate) => candidate !== file));
  }, []);

  const submit = useCallback(async () => {
    const validationErrors = validateManualUpload({ ingredientsText, stepsText, mainImage, stepImages });
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
      mainImage: mainImage as File,
      stepImages,
    });
    if (result.ok) {
      setStatus({ phase: 'complete' });
      onRecipe(result.value.recipe, result.value.diagnostics);
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [ingredientsText, stepsText, mainImage, stepImages, onRecipe, onExtractStart]);

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
        type="file"
        accept={ACCEPT}
        onChange={handleMainImageChange}
        disabled={isPending}
      />

      <label htmlFor="manual-tab-step-images">Step Images (optional)</label>
      <input
        id="manual-tab-step-images"
        type="file"
        accept={ACCEPT}
        multiple
        onChange={handleStepImagesChange}
        disabled={isPending}
      />

      <ul className="manual-tab-file-list">
        {mainImage ? (
          <li>
            <span>
              {mainImage.name} ({formatBytes(mainImage.size)})
            </span>
            <button
              type="button"
              onClick={removeMainImage}
              aria-label={`Remove ${mainImage.name}`}
              disabled={isPending}
            >
              Remove
            </button>
          </li>
        ) : null}
        {sortedStepImages.map((file, index) => (
          <li key={`${file.name}-${index}`}>
            <span>
              {file.name} ({formatBytes(file.size)})
            </span>
            <button
              type="button"
              onClick={() => removeStepImage(file)}
              aria-label={`Remove ${file.name}`}
              disabled={isPending}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {errors.length > 0 ? (
        <ul className="manual-tab-errors" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      <button type="submit" disabled={isPending}>
        Normalize Recipe
      </button>

      <StageStatus status={status} />
      {status.phase === 'error' ? (
        <ErrorBanner error={status.error} onRetry={handleRetry} onDismiss={handleDismiss} />
      ) : null}
    </form>
  );
}
