import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CapturePanel } from './CapturePanel.tsx';
import { ingestCapture } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({ ingestCapture: vi.fn() }));
const mockedIngest = vi.mocked(ingestCapture);

const payload = { url: 'https://www.example.com/recipes/soup', html: '<html></html>' };

beforeEach(() => mockedIngest.mockReset());

describe('CapturePanel', () => {
  it('shows the host and URL of the received page and sends nothing before Extract', () => {
    render(<CapturePanel handoff={{ phase: 'received', payload }} onExtractStart={vi.fn()} onIngested={vi.fn()} />);

    expect(screen.getByText('Page received from www.example.com')).toBeInTheDocument();
    expect(screen.getByText(payload.url)).toBeInTheDocument();
    expect(mockedIngest).not.toHaveBeenCalled();
  });

  it('shows the waiting text', () => {
    render(<CapturePanel handoff={{ phase: 'waiting' }} onExtractStart={vi.fn()} onIngested={vi.fn()} />);
    expect(screen.getByText('Waiting for the page from your browser...')).toBeInTheDocument();
  });

  it('posts the payload on Extract recipe and reports the result', async () => {
    const value = {
      recipe: {} as never,
      diagnostics: { extractor: 'capture', model: 'm', durationMs: 1 },
      imageNamespaceId: 'ns',
      unhosted: [],
    };
    mockedIngest.mockResolvedValue({ ok: true, value });
    const onExtractStart = vi.fn();
    const onIngested = vi.fn();
    render(<CapturePanel handoff={{ phase: 'received', payload }} onExtractStart={onExtractStart} onIngested={onIngested} />);

    await userEvent.click(screen.getByRole('button', { name: 'Extract recipe' }));

    expect(onExtractStart).toHaveBeenCalled();
    expect(mockedIngest).toHaveBeenCalledWith(payload);
    expect(onIngested).toHaveBeenCalledWith(value);
  });

  it('shows the error banner when extraction fails', async () => {
    mockedIngest.mockResolvedValue({ ok: false, error: { code: 'URL_EXTRACTION_FAILED', message: 'No recipe found' } });
    render(<CapturePanel handoff={{ phase: 'received', payload }} onExtractStart={vi.fn()} onIngested={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Extract recipe' }));

    expect(await screen.findByText(/No recipe found/)).toBeInTheDocument();
  });

  it('shows the retry instructions when the handoff failed', () => {
    render(<CapturePanel handoff={{ phase: 'failed' }} onExtractStart={vi.fn()} onIngested={vi.fn()} />);
    expect(
      screen.getByText(
        'Did not receive the page. Go back to the recipe tab and press Send to Recipe Maker again. If you just logged in, the second try works.',
      ),
    ).toBeInTheDocument();
  });
});
