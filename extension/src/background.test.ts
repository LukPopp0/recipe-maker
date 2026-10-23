import { describe, expect, it, vi } from 'vitest';
import { createBackground } from './background';
import { createFakeApi, flush } from './fake-api';
import { base64ToBlob } from './base64';

const ORIGIN = 'https://recipes.example';
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
    const first = (await fire.message({ type: 'ready' }, { tab: { id: 99 } })) as {
      url: string;
      html: string;
      mainImageUrl: string;
      mainImage: { base64: string; type: string };
    };
    expect(first).toMatchObject({ url: page.url, html: page.html, mainImageUrl: page.mainImageUrl });
    expect(first.mainImage.type).toBe('image/jpeg');
    const blob = base64ToBlob(first.mainImage.base64, first.mainImage.type);
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(await fire.message({ type: 'ready' }, { tab: { id: 99 } })).toBeNull();
  });

  it('answers ready with null for a tab without a pending payload', async () => {
    const { fire } = setup();
    expect(await fire.message({ type: 'ready' }, { tab: { id: 12 } })).toBeNull();
  });

  it('sends the payload without image bytes when the image fetch fails', async () => {
    const { fire } = setup({ fetchImpl: vi.fn(async () => new Response('no', { status: 404 })) as unknown as typeof fetch });
    await fire.actionClicked({ id: 7, index: 2 });
    const reply = (await fire.message({ type: 'ready' }, { tab: { id: 99 } })) as Record<string, unknown>;
    expect(reply).toEqual(page);
    expect(reply).not.toHaveProperty('mainImage');
  });

  it('answers ready with null and logs when collection fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = setup({ collect: async () => Promise.reject(new Error('Cannot access chrome:// pages')) });
    await fire.actionClicked({ id: 7, index: 2 });
    expect(await fire.message({ type: 'ready' }, { tab: { id: 99 } })).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('answers ready with null when the collection result is empty', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { fire } = setup({ collect: async () => [{}] });
    await fire.actionClicked({ id: 7, index: 2 });
    expect(await fire.message({ type: 'ready' }, { tab: { id: 99 } })).toBeNull();
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
      { tab: { id: 99 } },
    )) as { base64: string; type: string };
    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example/step.png');
    expect(reply.type).toBe('image/jpeg');
    expect(reply.base64).toBe('AQID');
  });

  it('answers a relay request with null for an oversized or non-image response', async () => {
    const big = vi.fn(
      async () => new Response('x', { status: 200, headers: { 'content-type': 'image/png', 'content-length': '99999999' } }),
    );
    const a = setup({ fetchImpl: big as unknown as typeof fetch });
    expect(await a.fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, { tab: { id: 1 } })).toBeNull();
    const html = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const b = setup({ fetchImpl: html as unknown as typeof fetch });
    expect(await b.fire.message({ type: 'relay-request', url: 'https://x.example/a.png' }, { tab: { id: 1 } })).toBeNull();
  });

  it('ignores messages it does not know', async () => {
    const { fire } = setup();
    expect(await fire.message({ type: 'other' }, { tab: { id: 1 } })).toBeUndefined();
  });
});
