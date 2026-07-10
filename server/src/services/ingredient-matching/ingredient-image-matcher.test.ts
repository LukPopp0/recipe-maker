import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { loadGeminiConfig } from '../ai/config.js';
import type { GenerateCanonicalRecipeParams } from '../ai/gemini-client.js';
import type { RawIngredient } from '../post-processing/index.js';
import { INGREDIENT_NOT_FOUND_IMAGE, type IngredientCatalog } from './catalog.js';
import { createIngredientImageMatcher } from './ingredient-image-matcher.js';

function makeGeminiConfig() {
  return loadGeminiConfig({});
}

function fakeGeminiClient(handler: (params: GenerateCanonicalRecipeParams) => Promise<unknown>) {
  return { generateCanonicalRecipe: vi.fn(handler) };
}

function makeCatalog(filenames: readonly string[]): IngredientCatalog {
  const set = new Set(filenames);
  return {
    filenames,
    has: (filename: string) => set.has(filename),
  };
}

const CATALOG = makeCatalog(['onion.png', 'tomato.png', 'beef.png', INGREDIENT_NOT_FOUND_IMAGE]);

const INPUT: RawIngredient[] = [
  { name: 'onions', amount_text: '2', amount_value: 2 },
  { name: 'tomato sauce', amount_text: '400g', amount_value: 400, unit: 'g' },
  { name: 'ground beef', amount_text: '1 lb', amount_value: 1, unit: 'lb' },
];

describe('createIngredientImageMatcher', () => {
  it('resolves empty result without calling Gemini for empty input', async () => {
    const generateCanonicalRecipe = vi.fn();
    const matcher = createIngredientImageMatcher({
      geminiClient: { generateCanonicalRecipe },
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages([]);

    expect(result).toEqual({ ingredients: [], warnings: [] });
    expect(generateCanonicalRecipe).not.toHaveBeenCalled();
  });

  it('matches all ingredients on the happy path, preserving amount_value by index', async () => {
    const geminiClient = fakeGeminiClient(async () => [
      { name: 'Onions', amount_text: '2', unit: undefined, image: 'onion.png' },
      { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
      { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
    ]);
    const matcher = createIngredientImageMatcher({
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(result.warnings).toEqual([]);
    expect(result.ingredients).toEqual([
      { name: 'Onions', amount_text: '2', amount_value: 2, unit: undefined, image: 'onion.png' },
      { name: 'Tomato Sauce', amount_text: '400g', amount_value: 400, unit: 'g', image: 'tomato.png' },
      { name: 'Ground Beef', amount_text: '1 lb', amount_value: 1, unit: 'lbs', image: 'beef.png' },
    ]);
    expect(geminiClient.generateCanonicalRecipe).toHaveBeenCalledTimes(1);
  });

  it('coerces a non-catalog filename to INGREDIENT_NOT_FOUND.png and warns naming the ingredient', async () => {
    const geminiClient = fakeGeminiClient(async () => [
      { name: 'Onions', amount_text: '2', image: 'not-in-catalog.png' },
      { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
      { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
    ]);
    const matcher = createIngredientImageMatcher({
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Onions');
    expect(result.ingredients[0].image).toBe(INGREDIENT_NOT_FOUND_IMAGE);
    expect(result.ingredients[1]).toEqual({
      name: 'Tomato Sauce',
      amount_text: '400g',
      amount_value: 400,
      unit: 'g',
      image: 'tomato.png',
    });
    expect(result.ingredients[2]).toEqual({
      name: 'Ground Beef',
      amount_text: '1 lb',
      amount_value: 1,
      unit: 'lbs',
      image: 'beef.png',
    });
  });

  it('keeps an honest INGREDIENT_NOT_FOUND.png response and adds the no-match warning', async () => {
    const geminiClient = fakeGeminiClient(async () => [
      { name: 'Onions', amount_text: '2', image: INGREDIENT_NOT_FOUND_IMAGE },
      { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
      { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
    ]);
    const matcher = createIngredientImageMatcher({
      geminiClient,
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(result.warnings).toEqual(['No image match found for ingredient \'Onions\'.']);
    expect(result.ingredients[0].image).toBe(INGREDIENT_NOT_FOUND_IMAGE);
  });

  it('retries with the retry model when the entry count does not match the input length', async () => {
    const config = makeGeminiConfig();
    const generateCanonicalRecipe = vi
      .fn()
      .mockResolvedValueOnce([
        { name: 'Onions', amount_text: '2', image: 'onion.png' },
        { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
      ])
      .mockResolvedValueOnce([
        { name: 'Onions', amount_text: '2', image: 'onion.png' },
        { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
        { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
      ]);
    const matcher = createIngredientImageMatcher({
      geminiClient: { generateCanonicalRecipe },
      geminiConfig: config,
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(generateCanonicalRecipe.mock.calls[0][0].model).toBe(config.primaryModel);
    expect(generateCanonicalRecipe.mock.calls[1][0].model).toBe(config.retryModel);
    expect(result.warnings).toEqual([]);
    expect(result.ingredients).toHaveLength(3);
  });

  it('degrades to INGREDIENT_NOT_FOUND.png for all ingredients when both attempts fail, without rejecting', async () => {
    const generateCanonicalRecipe = vi
      .fn()
      .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'boom'))
      .mockRejectedValueOnce(new AppError('AI_NORMALIZATION_FAILED', 'boom again'));
    const matcher = createIngredientImageMatcher({
      geminiClient: { generateCanonicalRecipe },
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.ingredients).toEqual([
      { name: 'onions', amount_text: '2', amount_value: 2, image: INGREDIENT_NOT_FOUND_IMAGE },
      { name: 'tomato sauce', amount_text: '400g', amount_value: 400, unit: 'g', image: INGREDIENT_NOT_FOUND_IMAGE },
      { name: 'ground beef', amount_text: '1 lb', amount_value: 1, unit: 'lb', image: INGREDIENT_NOT_FOUND_IMAGE },
    ]);
  });

  it('treats an invalid response shape (bad JSON structure) as a failed attempt and degrades after retry also fails', async () => {
    const generateCanonicalRecipe = vi.fn().mockResolvedValue({ foo: 'bar' });
    const matcher = createIngredientImageMatcher({
      geminiClient: { generateCanonicalRecipe },
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.ingredients.every((ing) => ing.image === INGREDIENT_NOT_FOUND_IMAGE)).toBe(true);
  });

  it('treats an empty name in a response entry as a failed attempt (Zod validation failure)', async () => {
    const generateCanonicalRecipe = vi.fn().mockResolvedValue([
      { name: '', amount_text: '2', image: 'onion.png' },
      { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
      { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
    ]);
    const matcher = createIngredientImageMatcher({
      geminiClient: { generateCanonicalRecipe },
      geminiConfig: makeGeminiConfig(),
      catalog: CATALOG,
    });

    const result = await matcher.matchIngredientImages(INPUT);

    expect(generateCanonicalRecipe).toHaveBeenCalledTimes(2);
    expect(result.warnings).toHaveLength(1);
    expect(result.ingredients.every((ing) => ing.image === INGREDIENT_NOT_FOUND_IMAGE)).toBe(true);
  });

  describe('attempt diagnostics (phase 8.5 item 9)', () => {
    // Parse the JSON diagnostic lines the matcher logs to console.log,
    // ignoring any non-JSON output.
    function collectImageMatchLogs(spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] {
      return (spy.mock.calls as unknown[][])
        .map((call) => call[0])
        .filter((arg): arg is string => typeof arg === 'string')
        .map((line): Record<string, unknown> | null => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((obj): obj is Record<string, unknown> => obj !== null && obj.stage === 'image-match');
    }

    it('logs an ok line naming the model on the happy path', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config = makeGeminiConfig();
      const geminiClient = fakeGeminiClient(async () => [
        { name: 'Onions', amount_text: '2', image: 'onion.png' },
        { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
        { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
      ]);
      const matcher = createIngredientImageMatcher({ geminiClient, geminiConfig: config, catalog: CATALOG });

      await matcher.matchIngredientImages(INPUT);

      const logs = collectImageMatchLogs(spy);
      expect(logs).toEqual([{ stage: 'image-match', model: config.primaryModel, outcome: 'ok', count: 3 }]);
      spy.mockRestore();
    });

    it('logs reason "length-mismatch" with expected/actual on a short response, then ok on retry', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const config = makeGeminiConfig();
      const generateCanonicalRecipe = vi
        .fn()
        .mockResolvedValueOnce([
          { name: 'Onions', amount_text: '2', image: 'onion.png' },
          { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
        ])
        .mockResolvedValueOnce([
          { name: 'Onions', amount_text: '2', image: 'onion.png' },
          { name: 'Tomato Sauce', amount_text: '400g', unit: 'g', image: 'tomato.png' },
          { name: 'Ground Beef', amount_text: '1 lb', unit: 'lbs', image: 'beef.png' },
        ]);
      const matcher = createIngredientImageMatcher({
        geminiClient: { generateCanonicalRecipe },
        geminiConfig: config,
        catalog: CATALOG,
      });

      await matcher.matchIngredientImages(INPUT);

      const logs = collectImageMatchLogs(spy);
      expect(logs[0]).toEqual({
        stage: 'image-match',
        model: config.primaryModel,
        outcome: 'error',
        reason: 'length-mismatch',
        expectedLength: 3,
        actualLength: 2,
      });
      expect(logs[1]).toMatchObject({ model: config.retryModel, outcome: 'ok', count: 3 });
      spy.mockRestore();
    });

    it('logs reason "schema" with a raw snippet on a malformed response', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const generateCanonicalRecipe = vi.fn().mockResolvedValue({ foo: 'bar' });
      const matcher = createIngredientImageMatcher({
        geminiClient: { generateCanonicalRecipe },
        geminiConfig: makeGeminiConfig(),
        catalog: CATALOG,
      });

      await matcher.matchIngredientImages(INPUT);

      const logs = collectImageMatchLogs(spy);
      expect(logs.every((l) => l.reason === 'schema')).toBe(true);
      expect(logs[0]).toMatchObject({ outcome: 'error', reason: 'schema', rawSnippet: '{"foo":"bar"}' });
      spy.mockRestore();
    });

    it('logs reason "transport" with the AppError code when the client throws', async () => {
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const generateCanonicalRecipe = vi
        .fn()
        .mockRejectedValue(new AppError('AI_NORMALIZATION_FAILED', 'boom'));
      const matcher = createIngredientImageMatcher({
        geminiClient: { generateCanonicalRecipe },
        geminiConfig: makeGeminiConfig(),
        catalog: CATALOG,
      });

      await matcher.matchIngredientImages(INPUT);

      const logs = collectImageMatchLogs(spy);
      expect(logs.every((l) => l.reason === 'transport')).toBe(true);
      expect(logs[0]).toMatchObject({ outcome: 'error', reason: 'transport', errorCode: 'AI_NORMALIZATION_FAILED' });
      spy.mockRestore();
    });
  });
});
