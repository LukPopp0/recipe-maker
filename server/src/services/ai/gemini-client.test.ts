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

  it('passes a response schema through as structured output when given', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"title":"Pasta"}' });
    const client = new GeminiClient(config, makeSdkClient(generateContent));
    const responseJsonSchema = { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] };

    await client.generateCanonicalRecipe({ model: 'm', prompt: 'p', timeoutMs: 1000, responseJsonSchema });

    expect(generateContent.mock.calls[0][0].config.responseJsonSchema).toBe(responseJsonSchema);
  });

  it('sends no response schema when none is given', async () => {
    const generateContent = vi.fn().mockResolvedValue({ text: '{"title":"Pasta"}' });
    const client = new GeminiClient(config, makeSdkClient(generateContent));

    await client.generateCanonicalRecipe({ model: 'm', prompt: 'p', timeoutMs: 1000 });

    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty('responseJsonSchema');
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
      expect((err as AppError).code).toBe('AI_QUOTA_EXCEEDED');
      expect((err as AppError).details).toMatchObject({ cause: 'Quota exceeded, retry in 7s.' });
    }
  });

  it('throws AI_QUOTA_EXCEEDED with the reset message for a RESOURCE_EXHAUSTED JSON blob', async () => {
    const rawBlob = JSON.stringify({
      error: { code: 429, message: 'Quota exceeded, retry in 7s.', status: 'RESOURCE_EXHAUSTED' },
    });
    const client = new GeminiClient(config, makeSdkClient(vi.fn().mockRejectedValue(new Error(rawBlob))));

    await expect(client.generateCanonicalRecipe({ model: 'm', prompt: 'x', timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
      message: 'Gemini daily quota reached. It resets at midnight Pacific time.',
      details: { model: 'm', cause: 'Quota exceeded, retry in 7s.' },
    });
  });

  it('detects an SDK error carrying status 429', async () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    const client = new GeminiClient(config, makeSdkClient(vi.fn().mockRejectedValue(err)));

    await expect(client.generateCanonicalRecipe({ model: 'm', prompt: 'x', timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'AI_QUOTA_EXCEEDED',
    });
  });

  it('does not treat an unrelated error mentioning 429 as quota', async () => {
    const client = new GeminiClient(config, makeSdkClient(vi.fn().mockRejectedValue(new Error('bad recipe 429'))));

    await expect(client.generateCanonicalRecipe({ model: 'm', prompt: 'x', timeoutMs: 1000 })).rejects.toMatchObject({
      code: 'AI_NORMALIZATION_FAILED',
    });
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
