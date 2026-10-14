import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildIngredientMatchOutputJsonSchema,
  MANUAL_RECIPE_OUTPUT_JSON_SCHEMA,
  ManualRecipeOutputSchema,
  toModelJsonSchema,
  URL_RECIPE_OUTPUT_JSON_SCHEMA,
  UrlRecipeOutputSchema,
} from './output-schemas.js';
import { z } from 'zod';

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../test-support/fixtures/gemini/${name}`, import.meta.url), 'utf8'));
}

// Every key used anywhere in a JSON Schema tree.
function allKeys(node: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((child) => allKeys(child, keys));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      keys.add(key);
      // "properties" maps field names to schemas; field names are not keywords.
      if (key === 'properties') {
        Object.values(value as object).forEach((child) => allKeys(child, keys));
      } else {
        allKeys(value, keys);
      }
    }
  }
  return keys;
}

describe('toModelJsonSchema', () => {
  it('keeps only keywords Gemini supports and turns const into a one-value enum', () => {
    const schema = toModelJsonSchema(
      z.object({
        name: z.string().trim().min(1).max(5),
        lang: z.literal('en'),
        list: z.array(z.string()).max(6).default([]),
      }),
    );

    expect(schema).toEqual({
      type: 'object',
      properties: {
        name: { type: 'string' },
        lang: { type: 'string', enum: ['en'] },
        list: { type: 'array', maxItems: 6, items: { type: 'string' } },
      },
      required: ['name', 'lang', 'list'],
      additionalProperties: false,
    });
  });
});

describe('URL recipe output schema', () => {
  it('caps steps at 6 and tags at 5, and leaves step image optional', () => {
    const props = URL_RECIPE_OUTPUT_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(props.steps.maxItems).toBe(6);
    expect(props.steps.minItems).toBe(1);
    expect(props.tags.maxItems).toBe(5);
    const stepItem = props.steps.items as { required: string[] };
    expect(stepItem.required).toEqual(['step_header', 'step_description']);
  });

  it('pins source_type to "url" and language to "en"', () => {
    const metadata = (URL_RECIPE_OUTPUT_JSON_SCHEMA.properties as Record<string, { properties: Record<string, unknown> }>)
      .metadata;
    expect(metadata.properties.source_type).toEqual({ type: 'string', enum: ['url'] });
    expect(metadata.properties.language).toEqual({ type: 'string', enum: ['en'] });
  });

  it('uses no unsupported keywords', () => {
    const keys = allKeys(URL_RECIPE_OUTPUT_JSON_SCHEMA);
    for (const banned of ['$schema', 'const', 'default', 'minLength', 'maxLength']) {
      expect(keys.has(banned)).toBe(false);
    }
  });

  it('accepts the golden URL candidate fixture', () => {
    expect(UrlRecipeOutputSchema.safeParse(readFixture('url-candidate.json')).success).toBe(true);
  });
});

describe('manual recipe output schema', () => {
  it('omits tags, main_image and step images (the backend owns them)', () => {
    const props = MANUAL_RECIPE_OUTPUT_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>;
    expect(props.tags).toBeUndefined();
    expect(props.main_image).toBeUndefined();
    const stepItem = props.steps.items as { properties: Record<string, unknown> };
    expect(stepItem.properties.image).toBeUndefined();
  });

  it('accepts the golden manual candidate fixture once its deliberately wrong metadata is corrected', () => {
    // The fixture carries source_type "url" on purpose (the pipeline overrides it).
    const fixture = readFixture('manual-candidate.json') as { metadata: Record<string, unknown> };
    const candidate = { ...fixture, metadata: { ...fixture.metadata, source_type: 'manual' } };
    expect(ManualRecipeOutputSchema.safeParse(candidate).success).toBe(true);
  });
});

describe('buildIngredientMatchOutputJsonSchema', () => {
  it('limits image to the catalog filenames and requires i, name and image', () => {
    const schema = buildIngredientMatchOutputJsonSchema(['onion.png', 'INGREDIENT_NOT_FOUND.png']);

    expect(schema).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', minimum: 0 },
          name: { type: 'string' },
          image: { type: 'string', enum: ['onion.png', 'INGREDIENT_NOT_FOUND.png'] },
        },
        required: ['i', 'name', 'image'],
        additionalProperties: false,
      },
    });
  });
});
