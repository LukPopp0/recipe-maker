// Capture mode (/capture): shows the page handed over by the bookmarklet or
// extension and posts it to the server only on an explicit "Extract recipe".
import { useCallback, useState } from 'react';
import { ingestCapture, type CaptureIngestResult } from '../../api/client.ts';
import type { HandoffState } from '../../capture/use-capture-handoff.ts';
import type { IngestStatus } from '../../workspace-types.ts';
import { ErrorBanner } from '../ErrorBanner.tsx';
import { StageStatus } from './StageStatus.tsx';

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function CapturePanel({
  handoff,
  onExtractStart,
  onIngested,
}: {
  handoff: HandoffState
  onExtractStart: () => void
  onIngested: (result: CaptureIngestResult) => void
}) {
  const [status, setStatus] = useState<IngestStatus>({ phase: 'idle' });

  const payload = handoff.phase === 'received' ? handoff.payload : null;

  const extract = useCallback(async () => {
    if (!payload) return;
    onExtractStart();
    setStatus({
      phase: 'processing',
      message: 'Extracting and normalizing (this can take up to a minute)...',
    });
    const result = await ingestCapture(payload);
    if (result.ok) {
      setStatus({ phase: 'complete' });
      onIngested(result.value);
    } else {
      setStatus({ phase: 'error', error: result.error });
    }
  }, [payload, onExtractStart, onIngested]);

  const isPending = status.phase === 'submitting' || status.phase === 'processing';

  return (
    <div className="capture-panel">
      {handoff.phase === 'waiting' ? <p>Waiting for the page from your browser...</p> : null}
      {handoff.phase === 'failed' ? (
        <p role="alert">
          Did not receive the page. Go back to the recipe tab and press Send to Recipe Maker again. If you just
          logged in, the second try works.
        </p>
      ) : null}
      {payload ? (
        <>
          <p>Page received from {hostnameOf(payload.url)}</p>
          <p className="capture-panel-url">{payload.url}</p>
          <button type="button" className="btn btn-primary" disabled={isPending} onClick={() => void extract()}>
            Extract recipe
          </button>
          <StageStatus status={status} />
          {status.phase === 'error' ? (
            <ErrorBanner
              error={status.error}
              onRetry={() => void extract()}
              onDismiss={() => setStatus({ phase: 'idle' })}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
