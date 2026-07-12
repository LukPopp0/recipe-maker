// Card page 1 (specs/10): header logo/wordmark, title, time, tag pills,
// main image left, 2-column ingredient grid right. Pure render from
// CanonicalRecipe - no fetching, no state beyond image-error fallbacks.
import { useState } from 'react';
import { formatIngredientAmount, type CanonicalRecipe } from 'shared';
import type { CardOrientation } from './CardView.tsx';
import { ingredientImageUrl, INGREDIENT_NOT_FOUND_IMAGE } from '../../lib/ingredient-image.ts';
import { tagColorClass } from '../../lib/tag-palette.ts';
import pinaLogo from '../../assets/pina-logo.png';

// Density buckets keep any ingredient count on page 1 (specs/10: shrink,
// never a third column, never a cap). Thresholds match the 2x6 template grid.
function ingredientDensity(count: number): 'regular' | 'compact' | 'tight' {
  if (count > 18) return 'tight';
  if (count > 12) return 'compact';
  return 'regular';
}

function IngredientThumb({ image }: { image: string | undefined }) {
  return (
    <img
      className="card-ingredient-image"
      data-testid="card-ingredient-image"
      src={ingredientImageUrl(image)}
      alt=""
      onError={(event) => {
        // Guard: if the not-found fallback itself fails, do not loop.
        if (!event.currentTarget.src.endsWith(INGREDIENT_NOT_FOUND_IMAGE)) {
          event.currentTarget.src = INGREDIENT_NOT_FOUND_IMAGE;
        }
      }}
    />
  );
}

export function CardPage1({
  recipe,
  orientation = 'portrait',
}: {
  recipe: CanonicalRecipe;
  orientation?: CardOrientation;
}) {
  const pageClass =
    orientation === 'landscape' ? 'card-page card-page-1 card-page--landscape' : 'card-page card-page-1';
  const [mainImageFailed, setMainImageFailed] = useState(false);

  return (
    <section className={pageClass} aria-label="Recipe card page 1">
      <header className="card-header">
        <img className="card-logo" src={pinaLogo} alt="" />
        <p className="card-wordmark">
          MY
          <br />
          RECIPES
        </p>
        <div className="card-title-block">
          <h1 className="card-title">{recipe.title}</h1>
          {recipe.time !== null ? <p className="card-time">{recipe.time} Minutes</p> : null}
          {recipe.tags.length > 0 ? (
            <ul className="card-tags" aria-label="Tags">
              {recipe.tags.map((tag) => (
                <li key={tag} className={`card-tag ${tagColorClass(tag)}`}>
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </header>

      <div className="card-page-1-body">
        {mainImageFailed ? (
          <div
            className="card-main-image card-main-image-missing"
            data-testid="card-main-image-missing"
            role="img"
            aria-label={recipe.title}
          />
        ) : (
          <img
            className="card-main-image"
            src={recipe.main_image}
            alt={recipe.title}
            onError={() => setMainImageFailed(true)}
          />
        )}
        <ul
          className="card-ingredients"
          data-density={ingredientDensity(recipe.ingredients.length)}
          aria-label="Ingredients"
        >
          {recipe.ingredients.map((ingredient, index) => (
            <li key={index} className="card-ingredient">
              <IngredientThumb image={ingredient.image} />
              <span className="card-ingredient-name">{ingredient.name}</span>
              <span className="card-ingredient-amount">
                {formatIngredientAmount(ingredient.amount_text, ingredient.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
