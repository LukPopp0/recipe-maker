import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText(/developer-mode warning is expected/i)).toBeInTheDocument();
  });
});
