import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupPage } from './SetupPage.tsx';
import { buildBookmarklet } from '../../lib/bookmarklet.ts';

const ORIGIN = 'https://recipes.example';

describe('SetupPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the section headings', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    for (const name of [
      'Why this exists',
      'Bookmarklet (desktop)',
      'Bookmarklet (Chrome on Android)',
      'Firefox extension (desktop and Android)',
      'Chrome extension (desktop)',
    ]) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
  });

  it('nests sections as h3 and sub-steps as h4 below the panel h2', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 3 }).length).toBeGreaterThanOrEqual(5);
    expect(screen.getByRole('heading', { level: 4, name: 'Desktop' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: 'Android' })).toBeInTheDocument();
  });

  it('renders the bookmarklet link with the app origin baked in', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    const link = screen.getByRole('link', { name: 'Send to Recipe Maker' });
    expect(link.getAttribute('href')).toBe(buildBookmarklet(ORIGIN));
  });

  it('copies the bookmarklet code', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<SetupPage appOrigin={ORIGIN} />);
    await user.click(screen.getByRole('button', { name: 'Copy bookmarklet code' }));
    expect(writeText).toHaveBeenCalledWith(buildBookmarklet(ORIGIN));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('links the extension release files', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    const xpi = screen.getByRole('link', { name: /download.*\.xpi/i });
    const zip = screen.getByRole('link', { name: /download.*\.zip/i });
    expect(xpi.getAttribute('href')).toBe('https://github.com/LukPopp0/recipe-maker/releases/latest/download/recipe-maker.xpi');
    expect(zip.getAttribute('href')).toBe('https://github.com/LukPopp0/recipe-maker/releases/latest/download/recipe-maker-chrome.zip');
  });

  it('explains the Chrome Android steps', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    expect(screen.getByText(/type the name in the address bar/i)).toBeInTheDocument();
    expect(screen.getByText(/still starts with javascript:/i)).toBeInTheDocument();
  });

  it('tells Firefox Android users to use the extension and shows the app address', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    expect(screen.getByText(/does not work in Firefox on Android/i)).toBeInTheDocument();
    expect(screen.getByText(ORIGIN)).toBeInTheDocument();
  });

  it('mentions the permission prompt and the developer-mode warning', () => {
    render(<SetupPage appOrigin={ORIGIN} />);
    expect(screen.getAllByText(/grant access to all sites/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/That is expected/i)).toBeInTheDocument();
    expect(screen.getByText(/Firefox-only manifest entries/i)).toBeInTheDocument();
  });

  it('shows a manual copy fallback when the clipboard fails', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<SetupPage appOrigin={ORIGIN} />);
    await user.click(screen.getByRole('button', { name: 'Copy bookmarklet code' }));
    expect(await screen.findByText('Could not copy. Select the code below and copy it.')).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Bookmarklet code' }) as HTMLTextAreaElement;
    expect(box).toHaveAttribute('readonly');
    expect(box.value).toBe(buildBookmarklet(ORIGIN));
    expect(box).toHaveFocus();
  });

  it('resets Copied after 2 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
      render(<SetupPage appOrigin={ORIGIN} />);
      await user.click(screen.getByRole('button', { name: 'Copy bookmarklet code' }));
      expect(await screen.findByText('Copied')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText('Copied')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
