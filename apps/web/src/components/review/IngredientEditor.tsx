// One editable row per ingredient: thumbnail (resolved via ingredientImageUrl,
// falling back to the not-found image on a load error), name/amount_text/unit
// inputs, and a remove button. All updates are immutable - every callback
// builds a fresh array/object and never mutates the `ingredients` prop.
import { useState, type SyntheticEvent } from 'react';
import type { Ingredient } from 'shared';
import { ingredientImageUrl, INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';

function IngredientThumbnail({ image }: { image: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? INGREDIENT_NOT_FOUND_IMAGE : ingredientImageUrl(image);

  return (
    <img
      src={src}
      alt="Ingredient thumbnail"
      className="ingredient-editor-thumbnail"
      onError={(event: SyntheticEvent<HTMLImageElement>) => {
        if (event.currentTarget.src.endsWith(INGREDIENT_NOT_FOUND_IMAGE)) return;
        setFailed(true);
      }}
    />
  );
}

export function IngredientEditor({
  ingredients,
  onChange,
  readOnly = false,
}: {
  ingredients: Ingredient[]
  onChange: (ingredients: Ingredient[]) => void
  readOnly?: boolean
}) {
  const updateField = (index: number, field: 'name' | 'amount_text' | 'unit', value: string) => {
    const next = ingredients.map((ingredient, i) => {
      if (i !== index) return ingredient;
      if (field === 'unit') {
        return value === '' ? { ...ingredient, unit: undefined } : { ...ingredient, unit: value };
      }
      return { ...ingredient, [field]: value };
    });
    onChange(next);
  };

  const removeRow = (index: number) => {
    onChange(ingredients.filter((_, i) => i !== index));
  };

  const addRow = () => {
    onChange([...ingredients, { name: '', amount_text: '', image: undefined }]);
  };

  if (readOnly) {
    return (
      <div className="ingredient-editor">
        {ingredients.map((ingredient, index) => (
          <div className="ingredient-editor-row" key={index}>
            <IngredientThumbnail key={ingredient.image ?? 'no-image'} image={ingredient.image} />
            <span className="ingredient-editor-static-name">{ingredient.name}</span>
            <span className="ingredient-editor-static-amount">
              {ingredient.amount_text}
              {ingredient.unit ? ` ${ingredient.unit}` : ''}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ingredient-editor">
      {ingredients.map((ingredient, index) => (
        <div className="ingredient-editor-row" key={index}>
          {/* Keyed by image (not row index) so removing a preceding row
              remounts this component for a different ingredient instead of
              reusing a stale `failed` state across unrelated images. */}
          <IngredientThumbnail key={ingredient.image ?? 'no-image'} image={ingredient.image} />
          <label>
            <span>Ingredient name</span>
            <input
              type="text"
              value={ingredient.name}
              onChange={(event) => updateField(index, 'name', event.target.value)}
            />
          </label>
          <label>
            <span>Amount</span>
            <input
              type="text"
              value={ingredient.amount_text}
              onChange={(event) => updateField(index, 'amount_text', event.target.value)}
            />
          </label>
          <label>
            <span>Unit</span>
            <input
              type="text"
              value={ingredient.unit ?? ''}
              onChange={(event) => updateField(index, 'unit', event.target.value)}
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeRow(index)} aria-label={`Remove ingredient ${index + 1}`}>
            Remove ingredient
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addRow}>
        Add ingredient
      </button>
    </div>
  );
}
