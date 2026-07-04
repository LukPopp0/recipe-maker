// Global error display with a per-error-code recovery hint and Retry/Dismiss
// actions. Used wherever an ApiFailure surfaces (ingestion, validate, save).
import type { ApiFailure } from '../api/client.ts';

const RECOVERY_HINTS: Record<string, string> = {
  INVALID_URL: 'Check the URL or use the Manual tab instead.',
  URL_EXTRACTION_FAILED: 'Check the URL or use the Manual tab instead.',
  URL_FETCH_TIMEOUT: 'The page took too long to load. Try again or use the Manual tab.',
  NETWORK_ERROR: 'Could not reach the server - is the backend running on port 8787?',
};

const GENERIC_RECOVERY_HINT = 'Try again, or check the console for details.';

function recoveryHintFor(code: string): string {
  return RECOVERY_HINTS[code] ?? GENERIC_RECOVERY_HINT;
}

export function ErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: ApiFailure
  onRetry: () => void
  onDismiss: () => void
}) {
  return (
    <div className="error-banner" role="alert">
      <p className="error-banner-message">{error.message}</p>
      <p className="error-banner-meta">
        Code: {error.code}
        {error.requestId ? ` - Request ID: ${error.requestId}` : null}
      </p>
      <p className="error-banner-hint">{recoveryHintFor(error.code)}</p>
      <div className="error-banner-actions">
        <button type="button" onClick={onRetry}>
          Retry
        </button>
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
