// Full recipe editor: title/time, ingredients, steps, read-only pantry
// items, warnings, and (when present) an ingestion diagnostics line. Every
// field change builds a fresh CanonicalRecipe and calls onChange - App.tsx
// owns the single source of truth (recipeState), including dirty/savedId
// bookkeeping (Task 4). No field here mutates the `recipe` prop.
import type { ChangeEvent } from 'react';
import type { CanonicalRecipe, Ingredient, Step } from 'shared';
import type { IngestDiagnostics } from '../../api/client.ts';
import { IngredientEditor } from './IngredientEditor.tsx';
import { StepEditor } from './StepEditor.tsx';
import { TagEditor } from './TagEditor.tsx';
import { WarningsPanel } from './WarningsPanel.tsx';

const TITLE_MAXLENGTH = 140;

export function ReviewPanel({
  recipe,
  diagnostics,
  onChange,
}: {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics | null
  onChange: (recipe: CanonicalRecipe) => void
}) {
  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange({ ...recipe, title: event.target.value });
  };

  const handleTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const parsed = raw === '' ? NaN : parseInt(raw, 10);
    // Treat anything that doesn't parse to a finite integer (e.g. a leading
    // '.' like ".5") as null rather than propagating NaN into the schema.
    onChange({ ...recipe, time: Number.isFinite(parsed) ? parsed : null });
  };

  const handleIngredientsChange = (ingredients: Ingredient[]) => {
    onChange({ ...recipe, ingredients });
  };

  const handleStepsChange = (steps: Step[]) => {
    onChange({ ...recipe, steps });
  };

  const handleTagsChange = (tags: string[]) => {
    onChange({ ...recipe, tags });
  };

  return (
    <div className="review-panel">
      <label>
        <span>Title</span>
        <input type="text" maxLength={TITLE_MAXLENGTH} value={recipe.title} onChange={handleTitleChange} />
      </label>

      <label>
        <span>Time (minutes)</span>
        <input type="number" value={recipe.time ?? ''} onChange={handleTimeChange} />
      </label>

      <section aria-labelledby="review-tags-heading">
        <h3 id="review-tags-heading">Tags</h3>
        <TagEditor tags={recipe.tags} onChange={handleTagsChange} />
      </section>

      <section aria-labelledby="review-ingredients-heading">
        <h3 id="review-ingredients-heading">Ingredients</h3>
        <IngredientEditor ingredients={recipe.ingredients} onChange={handleIngredientsChange} />
      </section>

      <section aria-labelledby="review-steps-heading">
        <h3 id="review-steps-heading">Steps</h3>
        <StepEditor steps={recipe.steps} onChange={handleStepsChange} />
      </section>

      <section aria-labelledby="review-pantry-heading" data-testid="pantry-section">
        <h3 id="review-pantry-heading">Pantry items</h3>
        <p className="review-panel-pantry-note">
          Pantry items are derived from the fixed pantry allowlist and cannot be edited here.
        </p>
        <ul className="review-panel-pantry-list">
          {recipe.pantry_items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <WarningsPanel warnings={recipe.metadata.warnings} />

      {diagnostics ? (
        <p className="review-panel-diagnostics" data-testid="review-diagnostics">
          Extracted via {diagnostics.extractor} using {diagnostics.model} in {diagnostics.durationMs}ms.
        </p>
      ) : null}
    </div>
  );
}
