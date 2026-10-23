import { describe, expect, it, vi } from 'vitest';
import { createBackground } from './background';
import { createFakeApi, flush } from './fake-api';
import { base64ToBlob } from './base64';

const ORIGIN = 'https://recipes.example';
const appSender = (id = 99) => ({ id: 'ext-id', frameId: 0, tab: { id, url: `${ORIGIN}/capture` } });
const page = { url: 'https://site.example/r', html: '<html></html>', mainImageUrl: 'https://site.example/i.jpg' };

function imageResponse(type = 'image/jpeg', bytes = [1, 2, 3]) {
  return new Response(new Uint8Array(bytes), { status: 200, headers: { 'content-type': type } });
}

function setup(opts: { fetchImpl?: typeof fetch; collect?: () => Promise<Array<{ result?: unknown }>> } = {}) {
  const fake = createFakeApi({
    storage: { appOrigin: ORIGIN },
    executeScript: (i) => (i.files ? Promise.resolve([{}]) : (opts.collect ?? (async () => [{ result: page }]))()),
  });
  const fetchImpl = opts.fetchImpl ?? (vi.fn(async () => imageResponse()) as unknown as typeof fetch);
  createBackground(fake.api, fetchImpl);
  return { ...fake, fetchImpl };
}

describe('background', () => {
  it('opens the options page when no address is set', async () => {
    const fake = createFakeApi();
    createBackground(fake.api, vi.fn() as unknown as typeof fetch);
    await fake.fire.actionClicked({ id: 7, index: 2 });
    expect(fake.calls.map((c) => c.name)).toEqual(['runtime.openOptionsPage']);
  });

  it('opens the app tab before collecting the page', async () => {
    const { fire, calls } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    expect(calls.map((c) => c.name).slice(0, 2)).toEqual(['tabs.create', 'scripting.executeScript']);
    expect(calls[0].args[0]).toEqual({ url: 'https://recipes.example/capture', index: 3 });
    expect(calls[1].args[0]).toMatchObject({ target: { tabId: 7 }, args: [] });
  });

  it('injects the bridge when the app tab finishes loading /capture', async () => {
    const { fire, calls } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    await fire.tabUpdated(99, { status: 'complete' }, { id: 99, url: `${ORIGIN}/capture` });
    expect(calls[calls.length - 1]).toEqual({
      name: 'scripting.executeScript',
      args: [{ target: { tabId: 99 }, files: ['bridge.js'] }],
    });
  });

  it('does not inject into an app tab that is still on the login page', async () => {
    const { fire, calls } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    const before = calls.length;
    await fire.tabUpdated(99, { status: 'complete' }, { id: 99, url: 'https://auth.example/login' });
    await fire.tabUpdated(99, { status: 'loading' }, { id: 99, url: `${ORIGIN}/capture` });
    await fire.tabUpdated(5, { status: 'complete' }, { id: 5, url: `${ORIGIN}/capture` });
    expect(calls.length).toBe(before);
  });

  it('answers ready with the pending payload once and then null', async () => {
    const { fire } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    const first = (await fire.message({ type: 'ready' }, appSender(99))) as {
      url: string;
      html: string;
      mainImageUrl: string;
      mainImage: { base64: string; type: string };
    };
    expect(first).toMatchObject({ url: page.url, html: page.html, mainImageUrl: page.mainImageUrl });
    expect(first.mainImage.type).toBe('image/jpeg');
    const blob = base64ToBlob(first.mainImage.base64, first.mainImage.type);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await fire.message({ type: 'ready' }, appSender(99))).toBeNull();
  });

  it('answers ready with null for a tab without a pending payload', async () => {
    const { fire } = setup();
    expect(await fire.message({ type: 'ready' }, appSender(12))).toBeNull();
  });

  it('sends the payload without image bytes when the image fetch fails', async () => {
    const { fire } = setup({ fetchImpl: vi.fn(async () => new Response('no', { status: 404 })) as unknown as typeof fetch });
    await fire.actionClicked({ id: 7, index: 2 });
    const reply = (await fire.message({ type: 'ready' }, appSender(99))) as Record<string, unknown>;
    expect(reply).toEqual(page);
    expect(reply).not.toHaveProperty('mainImage');
  });

  it('answers ready with null and logs when collection fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = setup({ collect: async () => Promise.reject(new Error('Cannot access chrome:// pages')) });
    await fire.actionClicked({ id: 7, index: 2 });
    expect(await fire.message({ type: 'ready' }, appSender(99))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers ready with null when the collection result is empty', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = setup({ collect: async () => [{}] });
    await fire.actionClicked({ id: 7, index: 2 });
    expect(await fire.message({ type: 'ready' }, appSender(99))).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not reject when opening the app tab fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = createFakeApi({ storage: { appOrigin: ORIGIN } });
    fake.api.tabs.create = async () => Promise.reject(new Error('boom'));
    createBackground(fake.api, vi.fn() as unknown as typeof fetch);
    await expect(fake.fire.actionClicked({ id: 7, index: 2 })).resolves.toBeUndefined();
    await flush();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers a relay request by fetching with host permissions', async () => {
    const { fire, fetchImpl } = setup();
    const reply = (await fire.message(
      { type: 'relay-request', url: 'https://cdn.example/step.png' },
      appSender(99),
    )) as { base64: string; type: string };
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example/step.png', { credentials: 'include' });
    expect(reply.type).toBe('image/jpeg');
    expect(reply.base64).toBe('AQID');
  });

  it('answers a relay request with null for an oversized or non-image response', async () => {
    const big = vi.fn(
      async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '99999999' } }),
    );
    const a = setup({ fetchImpl: big as unknown as typeof fetch });
    expect(await a.fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, appSender(1))).toBeNull();
    const html = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const b = setup({ fetchImpl: html as unknown as typeof fetch });
    expect(await b.fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, appSender(1))).toBeNull();
  });

  it('fetches the main image with the site session (credentials include)', async () => {
    const { fire, fetchImpl } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    await fire.message({ type: 'ready' }, appSender(99));
    expect(fetchImpl).toHaveBeenCalledWith(page.mainImageUrl, { credentials: 'include' });
  });

  it('ignores relay requests from a tab on another origin', async () => {
    const { fire, fetchImpl } = setup();
    const other = { id: 'ext-id', frameId: 0, tab: { id: 5, url: 'https://evil.example/capture' } };
    expect(await fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, other)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the pending payload when ready comes from another origin, a subframe or another extension', async () => {
    const { fire } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    const other = { id: 'ext-id', frameId: 0, tab: { id: 99, url: 'https://evil.example/capture' } };
    const sub = { ...appSender(99), frameId: 3 };
    const foreign = { ...appSender(99), id: 'other-ext' };
    for (const sender of [other, sub, foreign]) {
      expect(await fire.message({ type: 'ready' }, sender)).toBeNull();
    }
    expect(await fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, sub)).toBeNull();
    expect(await fire.message({ type: 'ready' }, appSender(99))).toMatchObject({ url: page.url });
  });

  it('drops the pending payload when its tab is closed', async () => {
    const { fire } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    fire.tabRemoved(99);
    expect(await fire.message({ type: 'ready' }, appSender(99))).toBeNull();
  });

  it('only injects the bridge on the exact /capture page of the app origin', async () => {
    const { fire, calls } = setup();
    await fire.actionClicked({ id: 7, index: 2 });
    const before = calls.length;
    await fire.tabUpdated(99, { status: 'complete' }, { id: 99, url: 'https://recipes.example.evil.test/capture' });
    await fire.tabUpdated(99, { status: 'complete' }, { id: 99, url: `${ORIGIN}/capturex` });
    expect(calls.length).toBe(before);
    await fire.tabUpdated(99, { status: 'complete' }, { id: 99, url: `${ORIGIN}/capture?x=1` });
    expect(calls.length).toBe(before + 1);
  });

  it('opens the options page instead of capturing when host access is missing', async () => {
    const fake = createFakeApi({ storage: { appOrigin: ORIGIN }, hostAccess: false });
    createBackground(fake.api, vi.fn() as unknown as typeof fetch);
    await fake.fire.actionClicked({ id: 7, index: 2 });
    expect(fake.calls.map((c) => c.name)).toEqual(['runtime.openOptionsPage']);
  });

  it('ignores messages it does not know', async () => {
    const { fire } = setup();
    expect(await fire.message({ type: 'other' }, appSender(1))).toBeUndefined();
  });
});
