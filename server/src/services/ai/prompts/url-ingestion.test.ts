import { describe, expect, it } from 'vitest';
import { PANTRY_ALLOWLIST, TAG_VOCABULARY } from 'shared';
import { buildUrlIngestionPrompt, buildUrlIngestionRetryPrompt } from './url-ingestion.js';

const baseParams = {
  url: 'https://example.com/recipe',
  cleanedText: 'Mix flour and eggs. Bake for 20 minutes.',
  candidateImageUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
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

  it('instructs on the 600-char step_description limit', () => {
    expect(prompt).toMatch(/600 characters/);
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
    expect(prompt).toContain(baseParams.candidateImageUrls[0]);
    expect(prompt).toContain(baseParams.candidateImageUrls[1]);
    expect(prompt).toContain(baseParams.cleanedText);
  });

  it('sets source_type url and language en instructions', () => {
    expect(prompt).toMatch(/"metadata\.source_type" to "url"/);
    expect(prompt).toMatch(/"metadata\.language" to "en"/);
  });

  it('handles a null title hint and empty candidate images', () => {
    const result = buildUrlIngestionPrompt({ ...baseParams, titleHint: null, candidateImageUrls: [] });
    expect(result).toContain('(none)');
  });
});

describe('buildUrlIngestionRetryPrompt', () => {
  const retryParams = {
    url: baseParams.url,
    reducedText: 'Flour, eggs. Bake 20 min.',
    candidateImageUrls: baseParams.candidateImageUrls,
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
