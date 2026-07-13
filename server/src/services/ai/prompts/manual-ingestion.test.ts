import { describe, expect, it } from 'vitest';
import { PANTRY_ALLOWLIST, TAG_VOCABULARY } from 'shared';
import { buildManualIngestionPrompt } from './manual-ingestion.js';

const baseParams = {
  ingredientsText: '2 cups flour\n3 eggs',
  stepsText: '1. Mix flour and eggs.\n2. Bake for 20 minutes.',
  stepImageCount: 2,
};

describe('buildManualIngestionPrompt', () => {
  const prompt = buildManualIngestionPrompt(baseParams);

  it('embeds the full pantry allowlist', () => {
    for (const item of PANTRY_ALLOWLIST) {
      expect(prompt).toContain(item);
    }
  });

  it('does not embed the tag vocabulary (tags are fully user-set for manual ingestion)', () => {
    for (const tag of TAG_VOCABULARY) {
      expect(prompt).not.toContain(tag);
    }
  });

  it('instructs on the 600-char step_description limit', () => {
    expect(prompt).toMatch(/600 characters/);
  });

  it('instructs not to reorder, invent, or drop steps, with the cutting-prep carve-out', () => {
    expect(prompt).toMatch(/do not reorder, invent, or\s+drop steps/i);
    expect(prompt).toMatch(/one\s+allowed\s+exception/i);
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

  it('instructs to use the upper bound of a time range', () => {
    expect(prompt).toMatch(/use the upper bound/i);
  });

  it('instructs to emit units in short form', () => {
    expect(prompt).toMatch(/tablespoons -> tbsp/i);
  });

  it('instructs to merge preparation-only duplicate ingredients', () => {
    expect(prompt).toMatch(/Merge ingredients that name the same item/);
    expect(prompt).toMatch(/Do NOT merge/);
  });

  it('sets metadata.source_type to manual instruction', () => {
    expect(prompt).toMatch(/"metadata\.source_type" to "manual"/);
  });

  it('does not ask the model to reference or describe step images', () => {
    expect(prompt).toContain('2 step image(s)');
    expect(prompt).toMatch(/do not attempt to describe or reference them/i);
  });

  it('does not include main_image in the required output shape', () => {
    expect(prompt).not.toContain('main_image');
  });

  it('does not mention tags at all', () => {
    expect(prompt).not.toMatch(/"tags": string\[\]/);
    expect(prompt.toLowerCase()).not.toContain('tag');
  });

  it('includes the raw ingredients and steps text', () => {
    expect(prompt).toContain(baseParams.ingredientsText);
    expect(prompt).toContain(baseParams.stepsText);
  });

  it('does not mention a source URL', () => {
    expect(prompt).not.toMatch(/source url/i);
    expect(prompt).not.toContain('source_url');
  });

  it('instructs to route pantry items out of ingredients', () => {
    expect(prompt).toMatch(/pantry_items/);
    expect(prompt).toMatch(/exclude it from "ingredients"/i);
  });

  it('instructs against hallucinating missing fields', () => {
    expect(prompt).toMatch(/never hallucinate/i);
    expect(prompt).toMatch(/metadata\.warnings/);
  });

  it('handles zero step images', () => {
    const result = buildManualIngestionPrompt({ ...baseParams, stepImageCount: 0 });
    expect(result).toContain('0 step image(s)');
  });
});
