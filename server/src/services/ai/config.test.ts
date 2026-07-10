import { describe, it, expect } from 'vitest';
import { loadGeminiConfig } from './config.js';

describe('loadGeminiConfig', () => {
  it('applies defaults with empty env', () => {
    const config = loadGeminiConfig({});

    expect(config.geminiApiKey).toBeUndefined();
    expect(config.primaryModel).toBe('gemini-3.1-flash-lite');
    expect(config.retryModel).toBe('gemini-2.5-flash');
    expect(config.timeoutMs).toBe(60000);
    expect(config.tokenBudget).toBe(8000);
    expect(config.generationConfig).toEqual({
      temperature: 0,
      topP: 1,
      topK: 1,
    });
  });

  it('respects environment variable overrides', () => {
    const config = loadGeminiConfig({
      GEMINI_API_KEY: 'test-key-123',
      GEMINI_PRIMARY_MODEL: 'custom-primary',
      GEMINI_RETRY_MODEL: 'custom-retry',
      GEMINI_TIMEOUT_MS: '30000',
      GEMINI_TOKEN_BUDGET: '12000',
    });

    expect(config.geminiApiKey).toBe('test-key-123');
    expect(config.primaryModel).toBe('custom-primary');
    expect(config.retryModel).toBe('custom-retry');
    expect(config.timeoutMs).toBe(30000);
    expect(config.tokenBudget).toBe(12000);
  });

  it('throws on invalid numeric env value', () => {
    expect(() => {
      loadGeminiConfig({
        GEMINI_TIMEOUT_MS: 'not-a-number',
      });
    }).toThrow();
  });

  it('ignores unknown GEMINI_MAX_RETRIES env var (zod ignores extra keys)', () => {
    const config = loadGeminiConfig({
      GEMINI_MAX_RETRIES: '2',
    });

    expect(config.primaryModel).toBe('gemini-3.1-flash-lite');
    expect(config.retryModel).toBe('gemini-2.5-flash');
  });
});
