import { afterEach, describe, expect, it, vi } from 'vitest';
import { logStage } from './log.js';

describe('logStage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a JSON line with all required fields', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logStage({
      requestId: 'req-123',
      stage: 'fetch',
      durationMs: 123.456,
      outcome: 'ok',
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.requestId).toBe('req-123');
    expect(logged.stage).toBe('fetch');
    expect(logged.durationMs).toBe(123);
    expect(logged.outcome).toBe('ok');
  });

  it('includes optional errorCode when provided', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logStage({
      requestId: 'req-456',
      stage: 'extract',
      durationMs: 50.123,
      outcome: 'error',
      errorCode: 'PARSE_ERROR',
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.errorCode).toBe('PARSE_ERROR');
  });

  it('spreads extra detail fields into the log', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logStage({
      requestId: 'req-789',
      stage: 'host-images',
      durationMs: 200.5,
      outcome: 'ok',
      fetchMode: 'playwright',
      imageCount: 3,
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.fetchMode).toBe('playwright');
    expect(logged.imageCount).toBe(3);
  });

  it('rounds durationMs to nearest integer', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    logStage({
      requestId: 'req-000',
      stage: 'normalize',
      durationMs: 99.7,
      outcome: 'ok',
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(logSpy.mock.calls[0][0] as string) as Record<string, unknown>;
    expect(logged.durationMs).toBe(100);
  });
});
