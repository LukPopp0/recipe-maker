# Spec 10: Recipe Card Renderer (Milestone 2)

## Goal
Render a standardized two-page recipe card from canonical JSON.

## Design Template (locked during Phase 7 planning)
The visual design follows the product owner's letter-size template
(hello-fresh-template.pdf, two pages). Decisions locked:

- Pages are fixed 8.5in x 11in boxes. Layout in in/pt units. On screen a
  wrapper applies a computed `transform: scale()` to fit the viewport
  (side by side when wide enough, stacked otherwise); in print the scale
  is removed and pages print 1:1. Screen preview and print output are the
  same layout by construction.
- Header (page 1 only): pineapple logo (shared/assets/pina-logo.png) plus
  a stacked two-line "MY RECIPES" wordmark, top-left.
- Pantry items render at the TOP OF PAGE 2 as a full-width banner (this
  supersedes the earlier "page 1 bottom" placement in this spec).
- Step descriptions auto-bold ingredient mentions at render time
  (case-insensitive whole-word match against the recipe's ingredient
  names, longest name first, simple s/es plural variants). Plain text in
  the schema is unchanged; no markup is stored.
- Ingredient grid is 2 columns on the right of page 1. More than 12
  ingredients: thumbnails and gaps shrink (density buckets) so all
  ingredients always fit on page 1. Never a third column, never a cap.
  (Portrait rule - the landscape variant below allows a third column.)
- Tag pills get a deterministic background from a fixed 3-color palette
  (hash of the tag name), matching the template hues.

### Typography (from template)
| Element | Font | Size |
| --- | --- | --- |
| Recipe title | Montserrat 700 | 23pt, 22pt leading, -0.06em tracking |
| Time | Lato 700 | 11pt |
| Tags | Lato 400 | 10pt |
| Ingredient name | DIN Alternate stack, bold | 7pt |
| Ingredient amount | Helvetica stack, bold | 7pt |
| Pantry heading | Helvetica stack, bold | 11pt, #225022 on #B7C98D |
| Pantry list | Helvetica stack, regular | 9pt, #225022 |
| Step title | Lato 700 | 12pt, #FFFFFF on #2E6E32 |
| Step description | Helvetica stack | 9pt, 14pt leading |

Montserrat and Lato are self-hosted woff2 (SIL OFL) bundled in the web
app. As of the landscape variant (below), the DIN Alternate and Helvetica
roles are served by self-hosted D-DIN (bold) and Inter (400/700) woff2
respectively, with the previous system stacks retained as fallbacks
(`"D-DIN", "DIN Alternate", Bahnschrift, "Arial Narrow", Arial` and
`Inter, Helvetica, "Helvetica Neue", Arial`). Both orientations use the
same stacks.

## Landscape Variant (locked 2026-07-07)

The original template is landscape (11in x 8.5in). Phase 7 shipped a
portrait adaptation; both layouts are kept. Decisions:

- `orientation: 'landscape' | 'portrait'` prop on CardView/CardPage1/
  CardPage2, rendered as a CSS class (`card-page--landscape`). Data logic
  (density buckets, ingredient bolding, image fallbacks, max 6 steps) is
  shared; only layout CSS differs.
- Default orientation is landscape. A toolbar button in CardView toggles
  to portrait and back. The choice is per-mount component state - no
  persistence.
- Landscape page geometry: 11in x 8.5in (1056 x 816 px at 96dpi).
  `useCardScale` takes page dimensions as parameters; the card-scale lib
  exports both dimension sets.
- Landscape page 1: logo + wordmark top-left; title, time, tag pills to
  the right of the logo. Below the header, the main image fills the left
  ~80% width; the ingredient grid is a right rail, 2 columns x up to 6
  rows. More than 12 ingredients: the rail widens to 3 columns and the
  image area narrows. More than 18: density buckets shrink tiles further
  (no hard cap - every ingredient always renders on page 1). The portrait
  layout's "never a third column" rule applies to portrait only.
- Landscape page 2: full-width pantry banner, then the same 3x2 step grid
  and step variants as portrait, laid out for the wider page.
- Print orientation: when the landscape card is mounted, CardView injects
  a `<style>` element containing `@page { size: letter landscape;
  margin: 0 }` and removes it on toggle/unmount. Portrait keeps the
  static portrait `@page` rule. All existing print guards
  (`body:has(.card-view)`, break-after page 1, hidden-panel collapse)
  apply to both orientations.

## Inputs
- CanonicalRecipe object.
- Ingredient image URLs (local asset match output).
- Optional step images.

## Page 1 Requirements
- Header: logo + wordmark top-left.
- Title at top, right of the header logo.
- Total time indicator ("N Minutes") under the title.
- Tags pill row under the time.
- Main image area filling the left/bottom of the page.
- Ingredients grid (2 columns) on the right with:
  - image thumbnail
  - name
  - amount_text (plus unit when present)

## Page 2 Requirements
- Pantry Items banner at the top (hidden when pantry_items is empty).
- Steps block containing 1-6 items in a 3-column x 2-row grid
  (fill order 1,2,3 top row; 4,5,6 bottom row).
- Each step:
  - step number (badge)
  - step_header (green title bar)
  - optional image (above the title bar)
  - step_description (ingredient mentions bolded)

## Rendering Rules
- Never render more than 6 steps.
- If step image missing, render text-only step variant: the green title
  bar (number + header inline) sits at the top of the column and the
  description gets the full column height.
- If ingredient image missing or unknown, render
  INGREDIENT_NOT_FOUND.png placeholder.
- No tags: tag row omitted. No time: time line omitted.

## Responsiveness
- Desktop: side-by-side page preview (scaled).
- Mobile: stacked pages with page labels (scaled).
- Pages never reflow; only the preview scale changes.

## Entry Points
- Library detail view: "View as Card" replaces the detail view (Back
  returns).
- Create workspace: "Preview Card" action on the current review state,
  gated by client-side CanonicalRecipeSchema validation like Download.

## Print/PDF
- Add print stylesheet (milestone 2 baseline):
  - fixed card dimensions.
  - hide app controls.
  - force page breaks between card pages.
- Future upgrade (see plan Phase 9, not part of milestone 2): server-side headless rendering (Puppeteer/Playwright) hitting the card renderer route and printing to PDF, for consistent output regardless of the user's browser.

## Styling Constraints
- Final visual design can evolve, but data placement hierarchy must remain stable.

## Acceptance Criteria
- Any valid canonical recipe renders without layout overflow.
- Print output preserves both pages and all content.
- Missing media handled gracefully.