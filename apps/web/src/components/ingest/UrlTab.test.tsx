import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlTab } from './UrlTab.tsx';
import type { CanonicalRecipe } from 'shared';
import { ingestUrl } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  ingestUrl: vi.fn(),
}));

const mockedIngestUrl = vi.mocked(ingestUrl);

const RECIPE: CanonicalRecipe = {
  title: 'Test Recipe',
  tags: [],
  time: 30,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Step 1', step_description: 'Do the thing.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/recipe', language: 'en', warnings: [] },
};

// Deferred promise helper - lets tests inspect the pending UI state before
// resolving the mocked client call.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('UrlTab', () => {
  beforeEach(() => {
    mockedIngestUrl.mockReset();
  });

  it('disables the submit button when the URL field is empty or whitespace', async () => {
    const user = userEvent.setup();
    render(<UrlTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const button = screen.getByRole('button', { name: /extract recipe/i });
    const input = screen.getByLabelText(/recipe url/i);

    expect(button).toBeDisabled();

    await user.type(input, '   ');
    expect(button).toBeDisabled();
  });

  it('shows an inline error for an obviously invalid URL without calling the client', async () => {
    const user = userEvent.setup();
    render(<UrlTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const input = screen.getByLabelText(/recipe url/i);
    await user.type(input, 'not-a-url');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid/i);
    expect(mockedIngestUrl).not.toHaveBeenCalled();
  });

  it('shows an inline error for a non-http(s) URL without calling the client', async () => {
    const user = userEvent.setup();
    render(<UrlTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const input = screen.getByLabelText(/recipe url/i);
    await user.type(input, 'ftp://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid/i);
    expect(mockedIngestUrl).not.toHaveBeenCalled();
  });

  it('calls ingestUrl and fires onRecipe on the happy path', async () => {
    const user = userEvent.setup();
    const onRecipe = vi.fn();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });

    render(<UrlTab onRecipe={onRecipe} onExtractStart={vi.fn()} />);

    const input = screen.getByLabelText(/recipe url/i);
    await user.type(input, 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(mockedIngestUrl).toHaveBeenCalledWith('https://example.com/recipe');
    await vi.waitFor(() => {
      expect(onRecipe).toHaveBeenCalledWith(RECIPE, { extractor: 'url', model: 'gemini', durationMs: 100 });
    });
  });

  it('disables the button and shows processing status while the request is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<Awaited<ReturnType<typeof ingestUrl>>>();
    mockedIngestUrl.mockReturnValueOnce(pending.promise);

    render(<UrlTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const input = screen.getByLabelText(/recipe url/i);
    await user.type(input, 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(screen.getByRole('button', { name: /extract recipe/i })).toBeDisabled();
    expect(screen.getByText(/extracting and normalizing/i)).toBeInTheDocument();

    pending.resolve({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/complete/i)).toBeInTheDocument();
    });
  });

  it('renders the ErrorBanner on an ApiFailure, and Retry re-submits the same URL', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: false,
      error: { code: 'URL_EXTRACTION_FAILED', message: 'Could not extract that recipe.' },
    });

    render(<UrlTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const input = screen.getByLabelText(/recipe url/i);
    await user.type(input, 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(await screen.findByText('Could not extract that recipe.')).toBeInTheDocument();

    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 50 } },
    });
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(mockedIngestUrl).toHaveBeenLastCalledWith('https://example.com/recipe');
    expect(mockedIngestUrl).toHaveBeenCalledTimes(2);
  });

  it('fires onExtractStart before the request resolves (item 5)', async () => {
    const user = userEvent.setup();
    const onExtractStart = vi.fn();
    const pending = deferred<Awaited<ReturnType<typeof ingestUrl>>>();
    mockedIngestUrl.mockReturnValueOnce(pending.promise);

    render(<UrlTab onRecipe={vi.fn()} onExtractStart={onExtractStart} />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    // Cleared up front, while the call is still pending.
    expect(onExtractStart).toHaveBeenCalledTimes(1);

    pending.resolve({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
  });

  it('does not fire onExtractStart when validation fails (item 5)', async () => {
    const user = userEvent.setup();
    const onExtractStart = vi.fn();
    render(<UrlTab onRecipe={vi.fn()} onExtractStart={onExtractStart} />);

    await user.type(screen.getByLabelText(/recipe url/i), 'not-a-url');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onExtractStart).not.toHaveBeenCalled();
  });
});
