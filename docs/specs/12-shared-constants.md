# Spec 12: Shared Constants

## Goal
Define the fixed pantry allowlist and tag vocabulary referenced throughout specs 02, 04, 05, and 08.

## Location
`/shared/src/constants` - single source of truth for both frontend and backend.

## Pantry Allowlist
Ingredients on this list are routed to `pantry_items` and removed from `ingredients` (spec 02, spec 04, spec 05).

```
salt
pepper
sugar
butter
oil (olive and vegetable)
milk
flour
water
```

Matching notes:
- Matching is case-insensitive against normalized ingredient names.
- "oil (olive and vegetable)" covers both olive oil and vegetable oil as pantry items; other oils (e.g. sesame oil) are not on this list and remain in ingredients.
- Type variants of the same staple count as that staple ("kosher salt" is salt, "unsalted butter" is butter, "all-purpose flour" is flour). Accepted names live in `PANTRY_VARIANTS` (explicit lists, not word stripping) and are resolved by `pantryCanonicalName`; different products stay in ingredients ("brown sugar", "powdered sugar", "red pepper flakes", "buttermilk", "garlic salt").
- Pantry items dedupe by staple (first display form wins), and the model's own `pantry_items` are filtered through the same check: anything that is not a staple moves back to ingredients with an empty amount and a warning.
- This list is product-owner-controlled and expected to grow; treat it as a plain array in shared constants, not a hardcoded switch statement, so it is easy to extend.

## Tag Vocabulary
Controlled vocabulary Gemini selects from when assigning up to 5 tags per recipe (spec 02, rule 2). Custom tags are allowed if none of these fit.

```
High Protein
Family Friendly
Spicy
Calorie Smart
Exotic
Vegetarian
Quick
Comfort Meal
Balanced
Refreshing
Fishy
Beefy
Chickeny
Dessert
```

## Acceptance Criteria
- Pantry classifier (spec 04 post-processing step, spec 05, Phase 2 of the plan) imports this list rather than duplicating it.
- Tag normalizer prefers this vocabulary before falling back to custom tags.
- Both lists are unit-tested against the pantry classifier and tag normalizer (spec 11).
