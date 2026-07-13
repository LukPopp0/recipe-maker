import { describe, expect, it } from 'vitest';
import { extractJsonLdStepImages } from './jsonld-step-images.js';

const BASE_URL = 'https://example.com/recipes/lasagna';

function recipeWith(instructions: unknown): Record<string, unknown> {
  return { '@type': 'Recipe', recipeInstructions: instructions };
}

describe('extractJsonLdStepImages', () => {
  it('returns an empty result for a null node', () => {
    expect(extractJsonLdStepImages(null, BASE_URL)).toEqual({ instructionCount: 0, images: [] });
  });

  it('returns an empty result when recipeInstructions is missing', () => {
    expect(extractJsonLdStepImages({ '@type': 'Recipe' }, BASE_URL)).toEqual({
      instructionCount: 0,
      images: [],
    });
  });

  it('extracts string image URLs from HowToStep nodes in order', () => {
    const node = recipeWith([
      { '@type': 'HowToStep', text: 'Chop.', image: 'https://cdn.example.com/step1.jpg' },
      { '@type': 'HowToStep', text: 'Fry.', image: 'https://cdn.example.com/step2.jpg' },
    ]);

    expect(extractJsonLdStepImages(node, BASE_URL)).toEqual({
      instructionCount: 2,
      images: ['https://cdn.example.com/step1.jpg', 'https://cdn.example.com/step2.jpg'],
    });
  });

  it('handles ImageObject and {url} image shapes', () => {
    const node = recipeWith([
      { '@type': 'HowToStep', image: { '@type': 'ImageObject', url: 'https://cdn.example.com/a.jpg' } },
      { '@type': 'HowToStep', image: { url: 'https://cdn.example.com/b.jpg' } },
    ]);

    expect(extractJsonLdStepImages(node, BASE_URL).images).toEqual([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/b.jpg',
    ]);
  });

  it('takes the first usable entry from an array-valued image', () => {
    const node = recipeWith([
      { '@type': 'HowToStep', image: [{ url: 'https://cdn.example.com/first.jpg' }, 'https://cdn.example.com/second.jpg'] },
    ]);

    expect(extractJsonLdStepImages(node, BASE_URL).images).toEqual(['https://cdn.example.com/first.jpg']);
  });

  it('maps image-less steps and plain-string instructions to null', () => {
    const node = recipeWith([
      'Preheat the oven.',
      { '@type': 'HowToStep', text: 'Bake.' },
      { '@type': 'HowToStep', text: 'Serve.', image: 'https://cdn.example.com/serve.jpg' },
    ]);

    expect(extractJsonLdStepImages(node, BASE_URL)).toEqual({
      instructionCount: 3,
      images: [null, null, 'https://cdn.example.com/serve.jpg'],
    });
  });

  it('flattens HowToSection itemListElement entries in place', () => {
    const node = recipeWith([
      {
        '@type': 'HowToSection',
        name: 'Sauce',
        itemListElement: [
          { '@type': 'HowToStep', image: 'https://cdn.example.com/sauce1.jpg' },
          { '@type': 'HowToStep' },
        ],
      },
      { '@type': 'HowToStep', image: 'https://cdn.example.com/final.jpg' },
    ]);

    expect(extractJsonLdStepImages(node, BASE_URL)).toEqual({
      instructionCount: 3,
      images: ['https://cdn.example.com/sauce1.jpg', null, 'https://cdn.example.com/final.jpg'],
    });
  });

  it('resolves relative image URLs against the effective page URL', () => {
    const node = recipeWith([{ '@type': 'HowToStep', image: '/images/step1.jpg' }]);

    expect(extractJsonLdStepImages(node, BASE_URL).images).toEqual([
      'https://example.com/images/step1.jpg',
    ]);
  });

  it('degrades malformed shapes to null without throwing', () => {
    const node = recipeWith([
      { '@type': 'HowToStep', image: 42 },
      { '@type': 'HowToStep', image: { nested: { deep: true } } },
      null,
      ['weird'],
    ]);

    const result = extractJsonLdStepImages(node, BASE_URL);
    expect(result.instructionCount).toBe(4);
    expect(result.images).toEqual([null, null, null, null]);
  });

  it('handles a single-string recipeInstructions value', () => {
    const node = recipeWith('Mix everything and bake.');

    expect(extractJsonLdStepImages(node, BASE_URL)).toEqual({ instructionCount: 1, images: [null] });
  });
});
