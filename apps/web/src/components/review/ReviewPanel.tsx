// Full recipe editor: title/time, ingredients, steps, read-only pantry
// items, warnings, and (when present) an ingestion diagnostics line. Every
// field change builds a fresh CanonicalRecipe and calls onChange - App.tsx
// owns the single source of truth (recipeState), including dirty/savedId
// bookkeeping (Task 4). No field here mutates the `recipe` prop.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { CanonicalRecipe, Ingredient, Step } from 'shared';
import type { IngestDiagnostics } from '../../api/client.ts';
import { IngredientEditor } from './IngredientEditor.tsx';
import { StepEditor } from './StepEditor.tsx';
import { TagEditor } from './TagEditor.tsx';
import { WarningsPanel } from './WarningsPanel.tsx';

const TITLE_MAXLENGTH = 140;

const noop = () => {};

// One prompt covering every step, meant to be pasted into an image-capable
// chat model (e.g. Gemini in the browser): the user generates the images for
// free there, downloads them, and uploads them per step below. Each step sits
// in its own <step-N> tag and the generation instruction comes last with an
// explicit image count - without that structure the model tends to produce a
// single image instead of one per step.
function buildStepImagePrompt(recipe: CanonicalRecipe): string {
  const stepBlocks = recipe.steps
    .map(
      (step, index) =>
        `<step-${index + 1}>\n  ${index + 1}. ${step.step_description}\n</step-${index + 1}>`,
    )
    .join('\n');
  const count = recipe.steps.length;
  return `Here are the recipe steps for a dish called "${recipe.title}".

<steps>
${stepBlocks}
</steps>

For each step, generate one photorealistic cooking photo for this recipe, all in a consistent style. There should be ${count} separate images.`;
}

export function ReviewPanel({
  recipe,
  diagnostics,
  onChange,
  readOnly = false,
  imageNamespaceId,
}: {
  recipe: CanonicalRecipe
  diagnostics: IngestDiagnostics | null
  onChange?: (recipe: CanonicalRecipe) => void
  readOnly?: boolean
  // Storage namespace for review-stage step-image uploads (StepEditor).
  imageNamespaceId?: string
}) {
  const emit = onChange ?? noop;
  const [promptCopied, setPromptCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
  }, []);

  const handleCopyImagePrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildStepImagePrompt(recipe));
    } catch {
      return;
    }
    setPromptCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setPromptCopied(false), 2000);
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    emit({ ...recipe, title: event.target.value });
  };

  const handleTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    const parsed = raw === '' ? NaN : parseInt(raw, 10);
    // Treat anything that doesn't parse to a finite integer (e.g. a leading
    // '.' like ".5") as null rather than propagating NaN into the schema.
    emit({ ...recipe, time: Number.isFinite(parsed) ? parsed : null });
  };

  const handleIngredientsChange = (ingredients: Ingredient[]) => {
    emit({ ...recipe, ingredients });
  };

  const handleStepsChange = (steps: Step[]) => {
    emit({ ...recipe, steps });
  };

  const handleTagsChange = (tags: string[]) => {
    emit({ ...recipe, tags });
  };

  return (
    <div className="review-panel">
      {readOnly ? (
        <>
          <p className="review-panel-static-field">
            <span className="review-panel-static-label">Title</span> {recipe.title}
          </p>
          <p className="review-panel-static-field">
            <span className="review-panel-static-label">Time (minutes)</span> {recipe.time ?? 'not set'}
          </p>
        </>
      ) : (
        <>
          <label>
            <span>Title</span>
            <input type="text" maxLength={TITLE_MAXLENGTH} value={recipe.title} onChange={handleTitleChange} />
          </label>

          <label>
            <span>Time (minutes)</span>
            <input type="number" value={recipe.time ?? ''} onChange={handleTimeChange} />
          </label>
        </>
      )}

      <section aria-labelledby="review-tags-heading">
        <h3 id="review-tags-heading">Tags</h3>
        <TagEditor tags={recipe.tags} onChange={handleTagsChange} readOnly={readOnly} />
      </section>

      <section aria-labelledby="review-ingredients-heading">
        <h3 id="review-ingredients-heading">Ingredients</h3>
        <IngredientEditor ingredients={recipe.ingredients} onChange={handleIngredientsChange} readOnly={readOnly} />
      </section>

      <section aria-labelledby="review-steps-heading">
        <div className="review-panel-steps-header">
          <h3 id="review-steps-heading">Steps</h3>
          {!readOnly ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleCopyImagePrompt()}>
              {promptCopied ? 'Copied' : 'Copy step image generation prompt'}
            </button>
          ) : null}
        </div>
        <StepEditor
          steps={recipe.steps}
          onChange={handleStepsChange}
          readOnly={readOnly}
          imageNamespaceId={imageNamespaceId}
        />
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
