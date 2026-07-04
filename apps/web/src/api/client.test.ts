import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanonicalRecipe } from 'shared';
import { ingestManual, ingestUrl, saveRecipe, validateRecipe } from './client.ts';

function jsonResponse(body: unknown, init?: { status?: number }): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fakeRecipe = { title: 'Spicy Noodles' } as unknown as CanonicalRecipe;

describe('api/client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('ingestUrl', () => {
    it('unwraps a success envelope into ClientResult.value', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ok: true,
          requestId: 'req-1',
          recipe: fakeRecipe,
          diagnostics: { extractor: 'readability', model: 'gemini-2.5-flash', durationMs: 1200 },
        }),
      );

      const result = await ingestUrl('https://example.com/recipe');

      expect(result).toEqual({
        ok: true,
        value: {
          recipe: fakeRecipe,
          diagnostics: { extractor: 'readability', model: 'gemini-2.5-flash', durationMs: 1200 },
        },
      });
    });

    it('posts to a relative /api/ingest/url path with a JSON body', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ok: true, requestId: 'req-1', recipe: fakeRecipe, diagnostics: {} }),
      );

      await ingestUrl('https://example.com/recipe');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/ingest/url');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body as string)).toEqual({ url: 'https://example.com/recipe' });
    });

    it('maps an ok:false envelope to an ApiFailure', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ok: false,
          requestId: 'req-2',
          error: { code: 'INVALID_URL', message: 'That URL is not valid.', details: { field: 'url' } },
        }),
      );

      const result = await ingestUrl('not-a-url');

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'INVALID_URL',
          message: 'That URL is not valid.',
          details: { field: 'url' },
          requestId: 'req-2',
        },
      });
    });

    it('maps a rejected fetch to a synthetic NETWORK_ERROR failure', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      const result = await ingestUrl('https://example.com/recipe');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });

    it('maps a non-JSON response to a synthetic INTERNAL_ERROR failure', async () => {
      fetchMock.mockResolvedValue(new Response('<html>not json</html>', { status: 200 }));

      const result = await ingestUrl('https://example.com/recipe');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('ingestManual', () => {
    it('posts FormData with the text fields, mainImage, and repeated stepImages', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ok: true, requestId: 'req-3', recipe: fakeRecipe, diagnostics: {} }),
      );

      const mainImage = new File(['main'], 'main.jpg', { type: 'image/jpeg' });
      const step1 = new File(['s1'], 'step1.jpg', { type: 'image/jpeg' });
      const step2 = new File(['s2'], 'step2.jpg', { type: 'image/jpeg' });

      await ingestManual({
        ingredientsText: '2 eggs',
        stepsText: 'Whisk the eggs.',
        mainImage,
        stepImages: [step1, step2],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/ingest/manual');
      expect(init.method).toBe('POST');

      const formData = init.body as FormData;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get('ingredientsText')).toBe('2 eggs');
      expect(formData.get('stepsText')).toBe('Whisk the eggs.');
      expect(formData.get('mainImage')).toBe(mainImage);
      expect(formData.getAll('stepImages')).toEqual([step1, step2]);
    });
  });

  describe('validateRecipe', () => {
    it('returns valid:true with the parsed recipe on success', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ok: true, requestId: 'req-4', valid: true, recipe: fakeRecipe }),
      );

      const result = await validateRecipe({ title: 'Spicy Noodles' });

      expect(result).toEqual({ ok: true, value: { valid: true, recipe: fakeRecipe } });
    });

    it('returns valid:false with flattened zod errors', async () => {
      const errors = { formErrors: ['Missing title'], fieldErrors: { title: ['Required'] } };
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, requestId: 'req-5', valid: false, errors }));

      const result = await validateRecipe({});

      expect(result).toEqual({ ok: true, value: { valid: false, errors } });
    });

    it('posts to a relative /api/recipe/validate path', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ok: true, requestId: 'req-6', valid: true, recipe: fakeRecipe }),
      );

      await validateRecipe({ title: 'Spicy Noodles' });

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/recipe/validate');
      expect(JSON.parse(init.body as string)).toEqual({ title: 'Spicy Noodles' });
    });
  });

  describe('saveRecipe', () => {
    it('unwraps a success envelope into the saved id', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, requestId: 'req-7', id: 'abc-123' }));

      const result = await saveRecipe(fakeRecipe);

      expect(result).toEqual({ ok: true, value: { id: 'abc-123' } });
    });

    it('posts to a relative /api/recipe/save path', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ok: true, requestId: 'req-8', id: 'abc-123' }));

      await saveRecipe(fakeRecipe);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/recipe/save');
      expect(init.method).toBe('POST');
    });

    it('maps an ok:false envelope on save to an ApiFailure', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ok: false,
          requestId: 'req-9',
          error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid recipe.' },
        }),
      );

      const result = await saveRecipe(fakeRecipe);

      expect(result).toEqual({
        ok: false,
        error: { code: 'SCHEMA_VALIDATION_FAILED', message: 'Invalid recipe.', details: undefined, requestId: 'req-9' },
      });
    });
  });
});
