import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBanner } from './ErrorBanner.tsx';
import type { ApiFailure } from '../api/client.ts';

describe('ErrorBanner', () => {
  it('renders the message, code, and requestId when present', () => {
    const error: ApiFailure = {
      code: 'INVALID_URL',
      message: 'That does not look like a valid URL.',
      requestId: 'req-123',
    };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={() => {}} />);

    expect(screen.getByText('That does not look like a valid URL.')).toBeInTheDocument();
    expect(screen.getByText(/INVALID_URL/)).toBeInTheDocument();
    expect(screen.getByText(/req-123/)).toBeInTheDocument();
  });

  it('omits requestId when not present', () => {
    const error: ApiFailure = {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong.',
    };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={() => {}} />);

    expect(screen.queryByText(/req-/)).not.toBeInTheDocument();
  });

  it('fires onRetry when Retry is clicked', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const error: ApiFailure = { code: 'NETWORK_ERROR', message: 'Could not reach the server.' };

    render(<ErrorBanner error={error} onRetry={onRetry} onDismiss={() => {}} />);
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('fires onDismiss when Dismiss is clicked', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const error: ApiFailure = { code: 'NETWORK_ERROR', message: 'Could not reach the server.' };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={onDismiss} />);
    await user.click(screen.getByRole('button', { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows a URL-specific recovery hint for INVALID_URL and URL_EXTRACTION_FAILED', () => {
    const { rerender } = render(
      <ErrorBanner
        error={{ code: 'INVALID_URL', message: 'bad url' }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/check the URL or use the Manual tab/i)).toBeInTheDocument();

    rerender(
      <ErrorBanner
        error={{ code: 'URL_EXTRACTION_FAILED', message: 'could not extract' }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/check the URL or use the Manual tab/i)).toBeInTheDocument();
  });

  it('shows a connectivity recovery hint for NETWORK_ERROR', () => {
    render(
      <ErrorBanner
        error={{ code: 'NETWORK_ERROR', message: 'Could not reach the server.' }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/backend running on port 8787/i)).toBeInTheDocument();
  });

  it('shows a generic recovery hint for unknown codes', () => {
    render(
      <ErrorBanner
        error={{ code: 'SOME_UNKNOWN_CODE', message: 'huh' }}
        onRetry={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText(/try again/i)).toBeInTheDocument();
  });

  it('renders details.cause as a Reason line when present', () => {
    const error: ApiFailure = {
      code: 'AI_NORMALIZATION_FAILED',
      message: 'Gemini request failed.',
      details: { model: 'gemini-2.5-flash', cause: 'fetch failed: ECONNRESET' },
    };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={() => {}} />);

    expect(screen.getByText(/Reason: fetch failed: ECONNRESET/)).toBeInTheDocument();
  });

  it('renders a collapsible details block for non-cause detail shapes', () => {
    const error: ApiFailure = {
      code: 'AI_NORMALIZATION_FAILED',
      message: 'Gemini returned unparseable JSON.',
      details: { model: 'gemini-2.5-flash', rawText: 'not json' },
    };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={() => {}} />);

    expect(screen.getByText('Show details')).toBeInTheDocument();
    expect(screen.getByText(/"rawText": "not json"/)).toBeInTheDocument();
  });

  it('renders neither Reason nor details block when details is absent', () => {
    const error: ApiFailure = { code: 'INTERNAL_ERROR', message: 'Something went wrong.' };

    render(<ErrorBanner error={error} onRetry={() => {}} onDismiss={() => {}} />);

    expect(screen.queryByText(/Reason:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Show details')).not.toBeInTheDocument();
  });
});
