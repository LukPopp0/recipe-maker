import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeSummary } from 'shared';
import { LibraryPanel } from './LibraryPanel.tsx';
import { listRecipes, deleteRecipe, getRecipe } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  listRecipes: vi.fn(),
  deleteRecipe: vi.fn(),
  getRecipe: vi.fn(),
}));

const mockedListRecipes = vi.mocked(listRecipes);
const mockedDeleteRecipe = vi.mocked(deleteRecipe);

const SUMMARIES: RecipeSummary[] = [
  { id: 'id-old', title: 'Older', tags: [], main_image: '/images/a.png', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'id-new', title: 'Newer', tags: [], main_image: '/images/b.png', createdAt: '2026-02-01T00:00:00.000Z' },
];

describe('LibraryPanel', () => {
  beforeEach(() => {
    mockedListRecipes.mockReset();
    mockedDeleteRecipe.mockReset();
    vi.restoreAllMocks();
  });

  it('lists saved recipes sorted newest first', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    const cards = await screen.findAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual(['Newer', 'Older']);
  });

  it('shows an ErrorBanner with retry when the list fetch fails', async () => {
    mockedListRecipes
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Could not reach the server.' } })
      .mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Newer')).toBeInTheDocument();
  });

  it('deletes after confirm and removes the card from the list', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    mockedDeleteRecipe.mockResolvedValueOnce({ ok: true, value: {} });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(mockedDeleteRecipe).toHaveBeenCalledWith('id-old');
    await vi.waitFor(() => {
      expect(screen.queryByText('Older')).not.toBeInTheDocument();
    });
  });

  it('does not call the API when confirm is declined', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(mockedDeleteRecipe).not.toHaveBeenCalled();
  });

  it('shows an ErrorBanner when delete fails, keeping the card', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    mockedDeleteRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RECIPE_NOT_FOUND', message: 'No recipe exists with id "id-old".' },
    });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(await screen.findByText(/no recipe exists/i)).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('opens the detail view on View and returns on Back', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const mockedGetRecipe = vi.mocked(getRecipe);
    mockedGetRecipe.mockResolvedValue({
      ok: true,
      value: {
        recipe: {
          title: 'Newer',
          tags: [],
          time: null,
          ingredients: [],
          pantry_items: [],
          main_image: '/images/b.png',
          steps: [{ step_header: 'S', step_description: 'D' }],
          metadata: { source_type: 'url', language: 'en', warnings: [] },
        },
      },
    });
    const user = userEvent.setup();
    render(<LibraryPanel onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'View Newer' }));
    expect(await screen.findByRole('button', { name: /back to library/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Older' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to library/i }));
    expect(await screen.findByRole('button', { name: 'View Older' })).toBeInTheDocument();
  });
});
