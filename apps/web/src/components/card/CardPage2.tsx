// Card page 2 (specs/10): pantry banner on top, then a 3x2 step grid
// (fill order 1,2,3 / 4,5,6). Steps without an image - including images
// that fail to load - use the text-only variant: title bar at the top,
// description takes the full column.
import { useState } from 'react';
import type { CanonicalRecipe } from 'shared';
import { emphasizeIngredients } from '../../lib/step-emphasis.ts';

const MAX_STEPS = 6;

function StepDescription({ description, ingredientNames }: { description: string; ingredientNames: string[] }) {
  return (
    <p className="card-step-description">
      {emphasizeIngredients(description, ingredientNames).map((segment, index) =>
        segment.bold ? <strong key={index}>{segment.text}</strong> : <span key={index}>{segment.text}</span>,
      )}
    </p>
  );
}

export function CardPage2({ recipe }: { recipe: CanonicalRecipe }) {
  const [failedStepImages, setFailedStepImages] = useState<ReadonlySet<number>>(new Set());
  const ingredientNames = recipe.ingredients.map((ingredient) => ingredient.name);
  const steps = recipe.steps.slice(0, MAX_STEPS);

  return (
    <section className="card-page card-page-2" aria-label="Recipe card page 2">
      {recipe.pantry_items.length > 0 ? (
        <p className="card-pantry">
          <strong className="card-pantry-heading">Pantry Items</strong>
          <span className="card-pantry-list"> | {recipe.pantry_items.join(', ')}</span>
        </p>
      ) : null}

      <ol className="card-steps" aria-label="Steps">
        {steps.map((step, index) => {
          const hasImage = Boolean(step.image) && !failedStepImages.has(index);
          return (
            <li key={index} className={hasImage ? 'card-step' : 'card-step card-step-no-image'}>
              {hasImage ? (
                <>
                  <span className="card-step-number">{index + 1}</span>
                  <img
                    className="card-step-image"
                    data-testid="card-step-image"
                    src={step.image}
                    alt=""
                    onError={() => setFailedStepImages((prev) => new Set(prev).add(index))}
                  />
                  <h2 className="card-step-title">{step.step_header}</h2>
                </>
              ) : (
                <h2 className="card-step-title card-step-title-inline">
                  <span className="card-step-number">{index + 1}</span>
                  {step.step_header}
                </h2>
              )}
              <StepDescription description={step.step_description} ingredientNames={ingredientNames} />
            </li>
          );
        })}
      </ol>
    </section>
  );
}
