import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { JsonPanel } from './JsonPanel.tsx';
import { buildRecipeFilename, downloadJson } from '../../lib/download.ts';

vi.mock('../../lib/download.ts', async () => {
  const actual = await vi.importActual<typeof import('../../lib/download.ts')>('../../lib/download.ts');
  return { ...actual, downloadJson: vi.fn() };
});

const mockedDownloadJson = vi.mocked(downloadJson);

const RECIPE: CanonicalRecipe = {
  title: 'Spicy Noodles',
  tags: ['easy'],
  time: 30,
  ingredients: [{ name: 'Noodles', amount_text: '200g' }],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Boil', step_description: 'Boil the noodles.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/recipe', language: 'en', warnings: [] },
};

const INVALID_RECIPE: CanonicalRecipe = { ...RECIPE, title: '' };

describe('JsonPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the pretty-printed JSON of the current recipe', () => {
    render(<JsonPanel recipe={RECIPE} />);
    expect(screen.getByText(/"Spicy Noodles"/)).toBeInTheDocument();
  });

  it('reflects live edits when the recipe prop changes', () => {
    const { rerender } = render(<JsonPanel recipe={RECIPE} />);
    expect(screen.getByText(/"Spicy Noodles"/)).toBeInTheDocument();

    const changed = { ...RECIPE, title: 'Mild Noodles' };
    rerender(<JsonPanel recipe={changed} />);

    expect(screen.queryByText(/"Spicy Noodles"/)).not.toBeInTheDocument();
    expect(screen.getByText(/"Mild Noodles"/)).toBeInTheDocument();
  });

  it('copies the exact JSON string to the clipboard and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<JsonPanel recipe={RECIPE} />);
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(RECIPE, null, 2));
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('shows a fallback message instead of throwing when navigator.clipboard is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    render(<JsonPanel recipe={RECIPE} />);
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(await screen.findByText(/copy failed.*select the json text manually/i)).toBeInTheDocument();
    expect(screen.queryByText(/^copied$/i)).not.toBeInTheDocument();
  });

  it('shows a fallback message when navigator.clipboard.writeText rejects', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(<JsonPanel recipe={RECIPE} />);
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(await screen.findByText(/copy failed.*select the json text manually/i)).toBeInTheDocument();
    expect(screen.queryByText(/^copied$/i)).not.toBeInTheDocument();
  });

  it('blocks download on an invalid recipe and shows the failing field, without calling downloadJson', async () => {
    const user = userEvent.setup();
    render(<JsonPanel recipe={INVALID_RECIPE} />);

    await user.click(screen.getByRole('button', { name: /download json/i }));

    expect(await screen.findByText(/too small/i)).toBeInTheDocument();
    expect(mockedDownloadJson).not.toHaveBeenCalled();
  });

  it('downloads the deterministic filename with the current recipe state when valid', async () => {
    const user = userEvent.setup();
    render(<JsonPanel recipe={RECIPE} />);

    await user.click(screen.getByRole('button', { name: /download json/i }));

    expect(mockedDownloadJson).toHaveBeenCalledTimes(1);
    expect(mockedDownloadJson).toHaveBeenCalledWith(buildRecipeFilename(RECIPE.title), RECIPE);
  });

  it('has no Save or Preview Card actions (they live in the ActionTray)', () => {
    render(<JsonPanel recipe={RECIPE} />);
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /preview card/i })).not.toBeInTheDocument();
  });
});
