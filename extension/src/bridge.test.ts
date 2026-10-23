// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPTURE_PROTOCOL, EXTENSION_CHANNEL, isCaptureMessage } from '../../shared/src/capture/protocol';
import { flush } from './fake-api';

type Handler = (message: unknown) => Promise<unknown>;
const g = globalThis as Record<string, unknown>;
let installed: Array<EventListenerOrEventListenerObject> = [];

function post(data: unknown, source: MessageEventSource | null = window) {
  window.dispatchEvent(new MessageEvent('message', { data, source, origin: window.location.origin }));
}

async function loadBridge(handler: Handler) {
  const sendMessage = vi.fn(handler);
  g.chrome = { runtime: { sendMessage } };
  vi.resetModules();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'message') installed.push(listener);
    add(type, listener);
  }) as typeof window.addEventListener);
  await import('./bridge');
  return sendMessage;
}

describe('bridge', () => {
  let posted: Array<{ data: unknown; origin: unknown }>;
  beforeEach(() => {
    posted = [];
    vi.spyOn(window, 'postMessage').mockImplementation(((data: unknown, origin: unknown) => {
      posted.push({ data, origin });
    }) as typeof window.postMessage);
  });
  afterEach(() => {
    for (const l of installed) window.removeEventListener('message', l);
    installed = [];
    delete g.chrome;
    delete (window as unknown as Record<string, unknown>).__recipeMakerBridge;
    vi.restoreAllMocks();
  });

  it('forwards ready from its own window with the channel marker', async () => {
    const send = await loadBridge(async () => null);
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' });
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'ready' });
    expect(posted).toEqual([]);
  });

  it('ignores messages without the channel marker or from another window', async () => {
    const send = await loadBridge(async () => null);
    post({ protocol: CAPTURE_PROTOCOL, type: 'ready' });
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' }, null);
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' }, {} as MessageEventSource);
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'payload', payload: { url: 'u', html: 'h' } });
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'relay-reply', id: 'a', url: 'u', image: null });
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('posts the payload back with the image as a Blob', async () => {
    await loadBridge(async () => ({
      url: 'https://site.example/r',
      html: '<html></html>',
      mainImageUrl: 'https://site.example/i.jpg',
      mainImage: { base64: 'AQID', type: 'image/jpeg' },
    }));
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' });
    await flush();
    expect(posted).toHaveLength(1);
    expect(posted[0].origin).toBe(window.location.origin);
    expect(posted[0].data).toEqual(
      expect.objectContaining({
        protocol: CAPTURE_PROTOCOL,
        type: 'payload',
        channel: EXTENSION_CHANNEL,
        payload: expect.objectContaining({ mainImage: expect.any(Blob) }),
      }),
    );
    expect(isCaptureMessage(posted[0].data)).toBe(true);
    const blob = (posted[0].data as { payload: { mainImage: Blob } }).payload.mainImage;
    expect(blob.type).toBe('image/jpeg');
  });

  it('posts a payload without image when the background sends none, and nothing for null', async () => {
    let reply: unknown = { url: 'u', html: 'h' };
    await loadBridge(async () => reply);
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' });
    await flush();
    expect(isCaptureMessage(posted[0].data)).toBe(true);
    expect((posted[0].data as { payload: object }).payload).toEqual({ url: 'u', html: 'h' });
    reply = null;
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' });
    await flush();
    expect(posted).toHaveLength(1);
  });

  it('answers a relay request echoing id and url, with the image as a Blob', async () => {
    const send = await loadBridge(async () => ({ base64: 'AQID', type: 'image/png' }));
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'relay-request', id: 'r1', url: 'https://x.example/a.png' });
    await flush();
    expect(send).toHaveBeenCalledWith({ type: 'relay-request', url: 'https://x.example/a.png' });
    expect(posted[0].data).toEqual(
      expect.objectContaining({
        type: 'relay-reply',
        channel: EXTENSION_CHANNEL,
        id: 'r1',
        url: 'https://x.example/a.png',
        image: expect.any(Blob),
      }),
    );
    expect(isCaptureMessage(posted[0].data)).toBe(true);
  });

  it('answers a relay request with image null when the background fails', async () => {
    await loadBridge(async () => Promise.reject(new Error('worker gone')));
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'relay-request', id: 'r2', url: 'https://x.example/b.png' });
    await flush();
    expect(posted[0].data).toEqual(
      expect.objectContaining({ type: 'relay-reply', id: 'r2', url: 'https://x.example/b.png', image: null }),
    );
  });

  it('does not install twice', async () => {
    const send = await loadBridge(async () => null);
    vi.resetModules();
    await import('./bridge');
    post({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, type: 'ready' });
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
