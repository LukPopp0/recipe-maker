// Presentational lifecycle text shared by every ingestion tab (URL, Manual,
// Load JSON). Maps IngestStatus phases to the honest, non-simulated wording
// from plan decision 7 - props in, text out, no side effects.
import type { IngestStatus } from '../../workspace-types.ts';

function stageText(status: IngestStatus): string | null {
  switch (status.phase) {
    case 'submitting':
      return 'Submitting...';
    case 'processing':
      return 'Extracting and normalizing (this can take up to a minute)...';
    case 'complete':
      return 'Complete.';
    default:
      return null;
  }
}

export function StageStatus({ status }: { status: IngestStatus }) {
  const text = stageText(status);
  if (!text) return null;

  return (
    <p className="stage-status" role="status">
      {text}
    </p>
  );
}
