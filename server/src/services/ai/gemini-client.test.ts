import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../lib/errors.js';
import { GeminiClient, type GeminiSdkClient } from './gemini-client.js';
import { loadGeminiConfig } from './config.js';

const config = loadGeminiConfig({ GEMINI_API_KEY: 'test-key' });

function makeSdkClient(generateContent: GeminiSdkClient['models']['generateContent']): GeminiSdkClient {
  return { models: { generateContent } };
}

describe('GeminiClient.generateCanonicalRecipe', () => {
  it('returns parsed JSON on a successful call', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"title":"Pasta"}' });
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    const result = await client.generateCanonicalRecipe({
      model: 'gemini-2.5-pro',
      prompt: 'extract this',
      timeoutMs: 1000,
    });

    expect(result).toEqual({ title: 'Pasta' });
    expect(generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-pro',
        contents: 'extract this',
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          temperature: 0,
          topP: 1,
          topK: 1,
        }),
      }),
    );
  });

  it('throws AI_NORMALIZATION_FAILED when the response text is not valid JSON', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: 'not json' });
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    await expect(
      client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 1000 }),
    ).rejects.toThrow(AppError);

    try {
      await client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 1000 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('AI_NORMALIZATION_FAILED');
    }
  });

  it('throws AI_NORMALIZATION_FAILED on timeout', async () => {
    const generateContent = vi.fn().mockImplementation(() => new Promise(() => {}));
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    await expect(
      client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 20 }),
    ).rejects.toThrow(AppError);

    try {
      await client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 20 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('AI_NORMALIZATION_FAILED');
    }
  });

  it('throws AI_NORMALIZATION_FAILED when the SDK throws (e.g. non-2xx)', async () => {
    const generateContent = vi.fn().mockRejectedValue(new Error('API returned 500'));
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    try {
      await client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 1000 });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('AI_NORMALIZATION_FAILED');
    }
  });

  it('extracts the inner error.message when the SDK throws a JSON quota-error blob', async () => {
    const rawBlob = JSON.stringify({
      error: { code: 429, message: 'Quota exceeded, retry in 7s.', status: 'RESOURCE_EXHAUSTED' },
    });
    const generateContent = vi.fn().mockRejectedValue(new Error(rawBlob));
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    try {
      await client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 1000 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).details).toMatchObject({ cause: 'Quota exceeded, retry in 7s.' });
    }
  });

  it('throws AI_NORMALIZATION_FAILED when the response has no text', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: undefined });
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    try {
      await client.generateCanonicalRecipe({ model: 'gemini-2.5-pro', prompt: 'x', timeoutMs: 1000 });
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('AI_NORMALIZATION_FAILED');
    }
  });
});
