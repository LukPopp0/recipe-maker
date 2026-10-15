// Admin-only cleanup of stored images no saved recipe uses (deployment spec
// section 8), e.g. from ingests that were never saved. The server only
// lists images older than 24 h and re-checks every key before deleting.
import { useCallback, useEffect, useState } from 'react';
import type { UnusedImage } from 'shared';
import { deleteImages, listUnusedImages, type ApiFailure } from '../../api/client.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';

type PanelStatus =
  | { phase: 'loading' }
  | { phase: 'error'; error: ApiFailure }
  | { phase: 'ready'; images: UnusedImage[] }
  | { phase: 'deleting'; images: UnusedImage[] };

// The server rejects more than 500 keys per request (deployment spec section 8).
export const DELETE_BATCH_SIZE = 500;

function formatKb(bytes: number): string {
  return `${Math.round(bytes / 1000)} KB`;
}

export function UnusedImagesPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<PanelStatus>({ phase: 'loading' });

  const load = useCallback(async () => {
    setStatus({ phase: 'loading' });
    const result = await listUnusedImages();
    setStatus(result.ok ? { phase: 'ready', images: result.value.images } : { phase: 'error', error: result.error });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDeleteAll = useCallback(async (images: UnusedImage[]) => {
    if (!window.confirm(`Delete ${images.length} unused images? This cannot be undone.`)) return;
    setStatus({ phase: 'deleting', images });
    const keys = images.map((image) => image.key);
    for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
      const result = await deleteImages(keys.slice(start, start + DELETE_BATCH_SIZE));
      if (!result.ok) {
        setStatus({ phase: 'error', error: result.error });
        return;
      }
    }
    await load();
  }, [load]);

  return (
    <section className="unused-images" aria-label="Unused images">
      <div className="unused-images-toolbar">
        <h3>Unused images</h3>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {status.phase === 'loading' ? <p>Loading...</p> : null}
      {status.phase === 'error' ? <ErrorBanner error={status.error} onRetry={() => void load()} onDismiss={onClose} /> : null}
      {status.phase === 'ready' || status.phase === 'deleting' ? (
        status.images.length === 0 ? (
          <p>No unused images.</p>
        ) : (
          <>
            <p>
              {status.images.length} unused images ({formatKb(status.images.reduce((sum, image) => sum + image.sizeBytes, 0))})
            </p>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={status.phase === 'deleting'}
              onClick={() => void handleDeleteAll(status.images)}
            >
              Delete all
            </button>
            <ul className="unused-images-grid">
              {status.images.map((image) => (
                <li key={image.key}>
                  <img src={image.url} alt={image.key} loading="lazy" />
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}
    </section>
  );
}
