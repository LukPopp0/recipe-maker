import { describe, expect, it } from 'vitest';
import { PANTRY_ALLOWLIST, TAG_VOCABULARY } from 'shared';
import { buildUrlIngestionPrompt, buildUrlIngestionRetryPrompt } from './url-ingestion.js';

const baseParams = {
  url: 'https://example.com/recipe',
  cleanedText: 'Mix flour and eggs. Bake for 20 minutes.',
  candidateImages: [
    { url: 'https://example.com/img1.jpg', alt: 'whisking the batter' },
    { url: 'https://example.com/img2.jpg' },
  ],
  titleHint: 'Best Pancakes Ever',
};

describe('buildUrlIngestionPrompt', () => {
  const prompt = buildUrlIngestionPrompt(baseParams);

  it('embeds the full pantry allowlist', () => {
    for (const item of PANTRY_ALLOWLIST) {
      expect(prompt).toContain(item);
    }
  });

  it('embeds the full tag vocabulary', () => {
    for (const tag of TAG_VOCABULARY) {
      expect(prompt).toContain(tag);
    }
  });

  it('instructs on the 6-step limit', () => {
    expect(prompt).toMatch(/6 steps|at most 6/);
    expect(prompt).toMatch(/more than 6/);
  });

  it('instructs to merge preparation-only duplicate ingredients', () => {
    expect(prompt).toMatch(/Merge ingredients that name the same item/);
    expect(prompt).toMatch(/Do NOT merge/);
  });

  it('instructs to carry ingredient-list cutting prep into the steps', () => {
    expect(prompt).toMatch(/missing cutting instructions/i);
    expect(prompt).toMatch(/would still have at most 6 steps/i);
    expect(prompt).toMatch(/do not duplicate cutting/i);
  });

  it('instructs to expand ingredient-section references in steps', () => {
    expect(prompt).toMatch(/named\s+sections/i);
    expect(prompt).toMatch(/rewrite that step to name the actual\s+ingredients/i);
  });

  it('tells the model JSON-LD may flatten or omit ingredient sections', () => {
    const withJsonLd = buildUrlIngestionPrompt({
      ...baseParams,
      recipeJsonLd: { '@type': 'Recipe', name: 'Pancakes' },
    });
    expect(withJsonLd).toMatch(/flattens or omits ingredient section headings/i);
    expect(withJsonLd).toMatch(/use the page content for ingredient grouping/i);
  });

  it('instructs on the 600-char step_description limit', () => {
    expect(prompt).toMatch(/600 characters/);
  });

  it('instructs to use the upper bound of a time range', () => {
    expect(prompt).toMatch(/use the upper bound/i);
  });

  it('instructs to emit units in short form', () => {
    expect(prompt).toMatch(/tablespoons -> tbsp/i);
  });

  it('instructs to preserve ingredient order', () => {
    expect(prompt).toMatch(/preserve the original ingredient order/i);
  });

  it('instructs to route pantry items out of ingredients', () => {
    expect(prompt).toMatch(/pantry_items/);
    expect(prompt).toMatch(/exclude it from "ingredients"/i);
  });

  it('instructs against hallucinating missing fields', () => {
    expect(prompt).toMatch(/never hallucinate/i);
    expect(prompt).toMatch(/metadata\.warnings/);
  });

  it('includes the source url, title hint, candidate images, and cleaned text', () => {
    expect(prompt).toContain(baseParams.url);
    expect(prompt).toContain(baseParams.titleHint);
    expect(prompt).toContain(baseParams.candidateImages[0].url);
    expect(prompt).toContain(baseParams.candidateImages[1].url);
    expect(prompt).toContain(baseParams.cleanedText);
  });

  it('renders candidate alt text as a step-mapping hint', () => {
    expect(prompt).toContain('https://example.com/img1.jpg (alt: "whisking the batter")');
  });

  it('describes the optional per-step image field', () => {
    expect(prompt).toMatch(/"image"\?: string/);
    expect(prompt).toMatch(/omit the field when unsure/i);
  });

  it('sets source_type url and language en instructions', () => {
    expect(prompt).toMatch(/"metadata\.source_type" to "url"/);
    expect(prompt).toMatch(/"metadata\.language" to "en"/);
  });

  it('handles a null title hint and empty candidate images', () => {
    const result = buildUrlIngestionPrompt({ ...baseParams, titleHint: null, candidateImages: [] });
    expect(result).toContain('(none)');
  });
});

describe('buildUrlIngestionRetryPrompt', () => {
  const retryParams = {
    url: baseParams.url,
    reducedText: 'Flour, eggs. Bake 20 min.',
    candidateImages: baseParams.candidateImages,
  };
  const prompt = buildUrlIngestionRetryPrompt(retryParams);

  it('embeds the pantry allowlist and tag vocabulary', () => {
    for (const item of PANTRY_ALLOWLIST) {
      expect(prompt).toContain(item);
    }
    for (const tag of TAG_VOCABULARY) {
      expect(prompt).toContain(tag);
    }
  });

  it('instructs on the 6-step and 600-char limits and ingredient order', () => {
    expect(prompt).toMatch(/more than 6/);
    expect(prompt).toMatch(/600 characters/);
    expect(prompt).toMatch(/preserve the original ingredient order/i);
  });

  it('instructs to carry ingredient-list cutting prep into the steps', () => {
    expect(prompt).toMatch(/missing cutting instructions/i);
    expect(prompt).toMatch(/would still have at most 6 steps/i);
  });

  it('instructs to expand ingredient-section references in steps', () => {
    expect(prompt).toMatch(/named\s+sections/i);
    expect(prompt).toMatch(/rewrite that step to name the actual\s+ingredients/i);
  });

  it('explicitly states the first attempt failed schema validation', () => {
    expect(prompt).toMatch(/previous attempt.*FAILED schema validation/i);
  });

  it('is strict about required fields', () => {
    expect(prompt).toMatch(/strict about required fields/i);
  });

  it('includes the reduced text and source url', () => {
    expect(prompt).toContain(retryParams.reducedText);
    expect(prompt).toContain(retryParams.url);
  });
});
