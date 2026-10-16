import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The Docker image takes Chromium from the Playwright base image, so its tag
// must equal the installed "playwright" package; otherwise the browser
// fallback fails at runtime with "Executable doesn't exist".
describe('Dockerfile Playwright base image', () => {
  it('matches the installed playwright version', () => {
    const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf-8');
    const baseVersion = dockerfile.match(/^ARG PLAYWRIGHT_VERSION=(\S+)$/m)?.[1];
    const installed = (createRequire(import.meta.url)('playwright/package.json') as { version: string }).version;

    expect(baseVersion).toBe(installed);
  });
});
