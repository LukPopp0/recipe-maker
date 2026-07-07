import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { RecipeDetail } from './RecipeDetail.tsx';
import { getRecipe } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  getRecipe: vi.fn(),
}));

const mockedGetRecipe = vi.mocked(getRecipe);

const RECIPE: CanonicalRecipe = {
  title: 'Saved Soup',
  tags: [],
  time: 20,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/soup.png',
  steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
  metadata: { source_type: 'url', language: 'en', warnings: [] },
};

describe('RecipeDetail', () => {
  beforeEach(() => {
    mockedGetRecipe.mockReset();
  });

  it('fetches by id and renders the recipe read-only with no Save button', async () => {
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    expect(await screen.findByText('Saved Soup')).toBeInTheDocument();
    expect(mockedGetRecipe).toHaveBeenCalledWith('id-1');
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });

  it('fires onOpenInCreate with the loaded recipe', async () => {
    const user = userEvent.setup();
    const onOpenInCreate = vi.fn();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={onOpenInCreate} onDelete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /open in create/i }));
    expect(onOpenInCreate).toHaveBeenCalledWith(RECIPE);
  });

  it('fires onDelete with the id and onBack from the Back button', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const onBack = vi.fn();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={onBack} onOpenInCreate={vi.fn()} onDelete={onDelete} />);

    await user.click(await screen.findByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledWith('id-1');

    await user.click(screen.getByRole('button', { name: /back to library/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('shows an ErrorBanner when the fetch fails (e.g. stale id)', async () => {
    mockedGetRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'RECIPE_NOT_FOUND', message: 'No recipe exists with id "id-9".' },
    });
    render(<RecipeDetail id="id-9" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    expect(await screen.findByText(/no recipe exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to library/i })).toBeInTheDocument();
  });
});

describe('View as Card', () => {
  it('replaces the detail view with the card and returns via Back', async () => {
    const user = userEvent.setup();
    mockedGetRecipe.mockResolvedValueOnce({ ok: true, value: { recipe: RECIPE } });
    render(<RecipeDetail id="id-1" onBack={vi.fn()} onOpenInCreate={vi.fn()} onDelete={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /view as card/i }));
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open in create/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('button', { name: /open in create/i })).toBeInTheDocument();
  });
});
