import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ingredient } from 'shared';
import { INGREDIENT_IMAGE_MANIFEST } from 'shared';
import { IngredientEditor } from './IngredientEditor.tsx';
import { INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';

// Stateful harness mirroring how ReviewPanel/App actually thread onChange
// back into props - IngredientEditor is a controlled component and needs a
// real state loop for realistic typing interactions.
function Harness({
  initial,
  onChange,
}: {
  initial: Ingredient[]
  onChange: (ingredients: Ingredient[]) => void
}) {
  const [ingredients, setIngredients] = useState(initial);
  return (
    <IngredientEditor
      ingredients={ingredients}
      onChange={(next) => {
        setIngredients(next);
        onChange(next);
      }}
    />
  );
}

const KNOWN_IMAGE = INGREDIENT_IMAGE_MANIFEST[0];

const INGREDIENTS: Ingredient[] = [
  { name: 'Flour', amount_text: '2 cups', unit: 'cups', image: KNOWN_IMAGE },
  { name: 'Sugar', amount_text: '1 cup' },
];

describe('IngredientEditor', () => {
  it('renders a thumbnail per row resolved via ingredientImageUrl, falling back for unknown filenames', () => {
    render(<IngredientEditor ingredients={INGREDIENTS} onChange={vi.fn()} />);

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', `/ingredient-images/${KNOWN_IMAGE}`);
    // Sugar has no image field, so it renders the not-found fallback directly.
    expect(images[1]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('falls back to the not-found image on img onError (e.g. a stale manifest filename)', () => {
    render(<IngredientEditor ingredients={INGREDIENTS} onChange={vi.fn()} />);

    const images = screen.getAllByRole('img');
    // Simulate the browser failing to load the resolved src.
    fireEvent.error(images[0]);
    expect(images[0]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('editing name/amount_text/unit calls onChange with a patched, non-mutated array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={INGREDIENTS} onChange={onChange} />);

    const nameInputs = screen.getAllByLabelText(/ingredient name/i);
    await user.clear(nameInputs[0]);
    await user.type(nameInputs[0], 'X');

    expect(onChange).toHaveBeenLastCalledWith([
      { name: 'X', amount_text: '2 cups', unit: 'cups', image: KNOWN_IMAGE },
      { name: 'Sugar', amount_text: '1 cup' },
    ]);
    // Original array/objects untouched.
    expect(INGREDIENTS[0]).toEqual({ name: 'Flour', amount_text: '2 cups', unit: 'cups', image: KNOWN_IMAGE });
  });

  it('adds a new ingredient row with empty name/amount_text and no image', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IngredientEditor ingredients={INGREDIENTS} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /add ingredient/i }));

    expect(onChange).toHaveBeenLastCalledWith([
      ...INGREDIENTS,
      { name: '', amount_text: '', image: undefined },
    ]);
  });

  it('a newly added row renders the not-found thumbnail', () => {
    const onChange = vi.fn();
    const { rerender } = render(<IngredientEditor ingredients={INGREDIENTS} onChange={onChange} />);
    rerender(
      <IngredientEditor
        ingredients={[...INGREDIENTS, { name: '', amount_text: '', image: undefined }]}
        onChange={onChange}
      />,
    );

    const images = screen.getAllByRole('img');
    expect(images[2]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('removes an ingredient row, and may go down to zero rows', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<IngredientEditor ingredients={[INGREDIENTS[0]]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /remove ingredient/i }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('does not repeat the unit in the read-only amount when amount_text already contains it', () => {
    render(
      <IngredientEditor
        ingredients={[{ name: 'Flour', amount_text: '2 cups', unit: 'cups' }]}
        onChange={vi.fn()}
        readOnly
      />,
    );
    expect(screen.getByText('2 cups')).toBeInTheDocument();
    expect(screen.queryByText('2 cups cups')).not.toBeInTheDocument();
  });

  it('renders no ingredient rows when the list is empty', () => {
    render(<IngredientEditor ingredients={[]} onChange={vi.fn()} />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('does not carry a stale failed-thumbnail state onto a different ingredient after a preceding row is removed', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const [imageA, imageB, imageC] = INGREDIENT_IMAGE_MANIFEST;
    const three: Ingredient[] = [
      { name: 'A', amount_text: '1', image: imageA },
      { name: 'B', amount_text: '1', image: imageB },
      { name: 'C', amount_text: '1', image: imageC },
    ];

    render(<Harness initial={three} onChange={onChange} />);

    // Row 1 (B) fails to load its image.
    fireEvent.error(screen.getAllByRole('img')[1]);
    expect(screen.getAllByRole('img')[1]).toHaveAttribute('src', INGREDIENT_NOT_FOUND_IMAGE);

    // Removing row 0 (A) shifts B to index 0 and C to index 1.
    await user.click(screen.getAllByRole('button', { name: /remove ingredient/i })[0]);

    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
    // C never errored, so its thumbnail must show its own resolved src, not
    // a stale failed state inherited from whichever row previously sat here.
    expect(images[1]).toHaveAttribute('src', `/ingredient-images/${imageC}`);
  });
});
