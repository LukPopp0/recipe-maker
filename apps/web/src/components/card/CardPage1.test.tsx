import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CanonicalRecipe } from 'shared';
import { CardPage1 } from './CardPage1.tsx';
import { INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';
import { tagColorClass } from '../../lib/tag-palette.ts';

function makeRecipe(overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Korean Beef Bowls',
    tags: ['High Protein', 'Spicy'],
    time: 15,
    ingredients: [
      { name: 'Ground Beef', amount_text: '250 g', image: 'meat-beef-ground.png' },
      { name: 'Garlic', amount_text: '1', unit: 'pc', image: 'not-in-catalog.png' },
    ],
    pantry_items: ['salt'],
    main_image: '/images/main.png',
    steps: [{ step_header: 'Cook', step_description: 'Cook it.' }],
    metadata: { source_type: 'url', language: 'en', warnings: [] },
    ...overrides,
  };
}

describe('CardPage1', () => {
  it('renders wordmark, title, time, and tags', () => {
    const { container } = render(<CardPage1 recipe={makeRecipe()} />);
    const wordmark = container.querySelector('.card-wordmark');
    expect(wordmark).toHaveTextContent(/MY.*RECIPES/s);
    expect(screen.getByRole('heading', { name: 'Korean Beef Bowls' })).toBeInTheDocument();
    expect(screen.getByText('15 Minutes')).toBeInTheDocument();
    const tag = screen.getByText('High Protein');
    expect(tag).toHaveClass(tagColorClass('High Protein'));
    expect(tag).toHaveClass('tag-color-high-protein');
  });

  it('omits time and tags rows when absent', () => {
    render(<CardPage1 recipe={makeRecipe({ time: null, tags: [] })} />);
    expect(screen.queryByText(/minutes/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /tags/i })).not.toBeInTheDocument();
  });

  it('renders the main image with the title as alt text', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    expect(screen.getByRole('img', { name: 'Korean Beef Bowls' })).toHaveAttribute('src', '/images/main.png');
  });

  it('swaps to a placeholder block when the main image fails to load', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Korean Beef Bowls' }));
    // Original img element is removed
    expect(screen.queryByAltText('Korean Beef Bowls')).not.toBeInTheDocument();
    // Placeholder div now has role="img" with the recipe title
    expect(screen.getByRole('img', { name: 'Korean Beef Bowls' })).toBe(
      screen.getByTestId('card-main-image-missing')
    );
  });

  it('renders ingredient name, amount with unit, and catalog thumbnails with not-found fallback', () => {
    render(<CardPage1 recipe={makeRecipe()} />);
    expect(screen.getByText('Ground Beef')).toBeInTheDocument();
    expect(screen.getByText('250 g')).toBeInTheDocument();
    expect(screen.getByText('1 pc')).toBeInTheDocument();
    const thumbs = screen.getAllByTestId('card-ingredient-image');
    expect(thumbs[0]).toHaveAttribute('src', '/ingredient-images/meat-beef-ground.png');
    expect(thumbs[1]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('uses density buckets so long ingredient lists compress instead of overflowing', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `Item ${i}`, amount_text: '1' }));
    render(<CardPage1 recipe={makeRecipe({ ingredients: many })} />);
    expect(screen.getByRole('list', { name: /ingredients/i })).toHaveAttribute('data-density', 'compact');

    const veryMany = Array.from({ length: 20 }, (_, i) => ({ name: `Item ${i}`, amount_text: '1' }));
    render(<CardPage1 recipe={makeRecipe({ ingredients: veryMany })} />);
    expect(screen.getAllByRole('list', { name: /ingredients/i })[1]).toHaveAttribute('data-density', 'tight');
  });

  it('adds the landscape page class when orientation is landscape', () => {
    render(<CardPage1 recipe={makeRecipe()} orientation="landscape" />);
    expect(screen.getByRole('region', { name: 'Recipe card page 1' })).toHaveClass('card-page--landscape');
  });

  it('keeps emitting density buckets used by the landscape 3-column rail', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      name: `Ing ${i}`,
      amount_text: '1 unit',
      image: 'ingredient.png',
    }));
    render(<CardPage1 recipe={makeRecipe({ ingredients: many })} orientation="landscape" />);
    expect(screen.getByRole('list', { name: 'Ingredients' })).toHaveAttribute('data-density', 'compact');
  });
});
