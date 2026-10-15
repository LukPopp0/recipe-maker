import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
  { id: 'id-old', title: 'Older', tags: [], main_image: '/images/a.png', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', owner: 'alice', time: 60, source_type: 'url' },
  { id: 'id-new', title: 'Newer', tags: [], main_image: '/images/b.png', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', owner: 'alice', time: 20, source_type: 'manual' },
];

describe('LibraryPanel', () => {
  beforeEach(() => {
    mockedListRecipes.mockReset();
    mockedDeleteRecipe.mockReset();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('lists saved recipes sorted newest first', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    const cards = await screen.findAllByRole('heading', { level: 3 });
    expect(cards.map((h) => h.textContent)).toEqual(['Newer', 'Older']);
  });

  it('shows an ErrorBanner with retry when the list fetch fails', async () => {
    mockedListRecipes
      .mockResolvedValueOnce({ ok: false, error: { code: 'NETWORK_ERROR', message: 'Could not reach the server.' } })
      .mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Newer')).toBeInTheDocument();
  });

  it('deletes after confirm and removes the card from the list', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    mockedDeleteRecipe.mockResolvedValueOnce({ ok: true, value: {} });
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

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
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

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
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Delete Older' }));
    expect(await screen.findByText(/no recipe exists/i)).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('narrows the list from the search box and shows the match count', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await user.type(await screen.findByRole('searchbox', { name: /search/i }), 'newer');
    expect(screen.getByText('Newer')).toBeInTheDocument();
    expect(screen.queryByText('Older')).not.toBeInTheDocument();
    expect(screen.getByText('1 of 2 recipes')).toBeInTheDocument();
  });

  it('shows a no-match message with a working clear-filters reset', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await user.type(await screen.findByRole('searchbox', { name: /search/i }), 'zzz');
    expect(screen.getByText(/no recipes match/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(screen.getByText('Newer')).toBeInTheDocument();
    expect(screen.getByText('Older')).toBeInTheDocument();
  });

  it('reorders the list when the sort changes', async () => {
    mockedListRecipes.mockResolvedValueOnce({ ok: true, value: { recipes: SUMMARIES } });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await screen.findByText('Newer');
    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'name-asc');
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['Newer', 'Older']);

    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'name-desc');
    const reversed = screen.getAllByRole('heading', { level: 3 });
    expect(reversed.map((h) => h.textContent)).toEqual(['Older', 'Newer']);
  });

  it('hides the filter bar in the detail view', async () => {
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
        meta: { id: 'id-new', owner: 'alice', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
      },
    });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'View Newer' }));
    await screen.findByRole('button', { name: /back to library/i });
    expect(screen.queryByRole('searchbox', { name: /search/i })).not.toBeInTheDocument();
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
        meta: { id: 'id-new', owner: 'alice', createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
      },
    });
    const user = userEvent.setup();
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'View Newer' }));
    expect(await screen.findByRole('button', { name: /back to library/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View Older' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /back to library/i }));
    expect(await screen.findByRole('button', { name: 'View Older' })).toBeInTheDocument();
  });

  it('starts on "My recipes" and switches to "All recipes", reloading with that scope', async () => {
    const user = userEvent.setup();
    mockedListRecipes.mockResolvedValue({ ok: true, value: { recipes: SUMMARIES } });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    expect(await screen.findByText('Newer')).toBeInTheDocument();
    expect(mockedListRecipes).toHaveBeenCalledWith('mine');

    await user.click(screen.getByRole('button', { name: 'All recipes' }));

    expect(mockedListRecipes).toHaveBeenLastCalledWith('all');
    expect(screen.getByRole('button', { name: 'All recipes' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('recipe-maker.library-scope')).toBe('all');
  });

  it('hides Delete on recipes of other users for non-admins', async () => {
    mockedListRecipes.mockResolvedValue({
      ok: true,
      value: { recipes: [{ ...SUMMARIES[0], owner: 'bob' }] },
    });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    expect(await screen.findByText('Older')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('ignores a superseded response that resolves after a later scope request', async () => {
    const user = userEvent.setup();
    const mine = { ...SUMMARIES[1], id: 'id-mine', title: 'Mine only' };
    const everyones = { ...SUMMARIES[0], id: 'id-all', title: 'Everyones' };
    let resolveAll!: (value: Awaited<ReturnType<typeof listRecipes>>) => void;
    mockedListRecipes
      .mockResolvedValueOnce({ ok: true, value: { recipes: [mine] } })
      .mockReturnValueOnce(new Promise((resolve) => { resolveAll = resolve; }))
      .mockResolvedValueOnce({ ok: true, value: { recipes: [mine] } });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);
    expect(await screen.findByText('Mine only')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All recipes' }));
    await user.click(screen.getByRole('button', { name: 'My recipes' }));
    expect(await screen.findByText('Mine only')).toBeInTheDocument();

    await act(async () => {
      resolveAll({ ok: true, value: { recipes: [everyones] } });
    });

    expect(screen.getByRole('button', { name: 'My recipes' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Mine only')).toBeInTheDocument();
    expect(screen.queryByText('Everyones')).not.toBeInTheDocument();
  });

  it('explains an empty "My recipes" list and points at All recipes', async () => {
    mockedListRecipes.mockResolvedValue({ ok: true, value: { recipes: [] } });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);

    expect(
      await screen.findByText("You have not saved any recipes yet. Switch to All recipes to see everyone's."),
    ).toBeInTheDocument();
  });

  it('keeps the generic empty message for an empty "All recipes" list', async () => {
    const user = userEvent.setup();
    mockedListRecipes.mockResolvedValue({ ok: true, value: { recipes: [] } });
    render(<LibraryPanel currentUser={{ username: 'alice', isAdmin: false }} onOpenInCreate={vi.fn()} />);
    await screen.findByText(/You have not saved any recipes yet/);

    await user.click(screen.getByRole('button', { name: 'All recipes' }));

    expect(await screen.findByText(/No saved recipes yet/)).toBeInTheDocument();
  });
});
