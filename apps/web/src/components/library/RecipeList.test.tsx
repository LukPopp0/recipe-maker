import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RecipeSummary } from 'shared';
import { RecipeList } from './RecipeList.tsx';
import { tagColorClass } from '../../lib/tag-palette.ts';

const SUMMARIES: RecipeSummary[] = [
  { id: 'id-1', title: 'Soup', tags: ['dinner'], main_image: '/images/soup.png', createdAt: '2026-01-02T00:00:00.000Z' },
  { id: 'id-2', title: 'Cake', tags: [], main_image: '/images/cake.png', createdAt: '2026-01-01T00:00:00.000Z' },
];

describe('RecipeList', () => {
  it('renders title, thumbnail, and tags per recipe', () => {
    render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Soup')).toBeInTheDocument();
    expect(screen.getByText('dinner')).toBeInTheDocument();
    expect(screen.getByText('dinner')).toHaveClass(tagColorClass('dinner'));
    expect(screen.getByRole('img', { name: 'Soup' })).toHaveAttribute('src', '/images/soup.png');
  });

  it('renders an empty state when there are no recipes', () => {
    render(<RecipeList recipes={[]} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText(/no saved recipes yet/i)).toBeInTheDocument();
  });

  it('fires onView and onDelete with the recipe id', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onDelete = vi.fn();
    render(<RecipeList recipes={SUMMARIES} onView={onView} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'View Soup' }));
    expect(onView).toHaveBeenCalledWith('id-1');

    await user.click(screen.getByRole('button', { name: 'Delete Cake' }));
    expect(onDelete).toHaveBeenCalledWith('id-2');
  });

  it('links Download to the server download endpoint', () => {
    render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Download Soup' })).toHaveAttribute('href', '/api/recipe/download/id-1');
  });

  it('hides a thumbnail that fails to load instead of showing a broken image', () => {
    render(<RecipeList recipes={SUMMARIES} onView={vi.fn()} onDelete={vi.fn()} />);
    const img = screen.getByRole('img', { name: 'Soup' });
    fireEvent.error(img);
    expect(img).not.toBeVisible();
  });
});
