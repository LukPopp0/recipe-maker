// Cross-seam contract: the real bookmarklet runtime talks to the real handoff
// hook. Every message is captured from one side and fed to the other.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { runBookmarklet } from '../../../../shared/src/capture/bookmarklet.ts';
import { useCaptureHandoff } from './use-capture-handoff.ts';

const APP_ORIGIN = window.location.origin;
const IMAGE_URL = 'https://img.test/main.png';

let recipeFrame: HTMLIFrameElement;
let appFrame: HTMLIFrameElement;
let toApp: ReturnType<typeof vi.fn>;

// Delivers a message to the recipe window the way the browser would when the
// app window posts to its opener.
function appPostsToRecipe(data: unknown) {
  const win = recipeFrame.contentWindow!;
  win.dispatchEvent(
    new (win as unknown as typeof globalThis).MessageEvent('message', {
      data,
      origin: APP_ORIGIN,
      source: appFrame.contentWindow,
    }),
  );
}

// Delivers a message to this (app) window as if the recipe window posted it.
function recipePostsToApp(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: recipeFrame.contentWindow }));
  });
}

beforeEach(() => {
  recipeFrame = document.createElement('iframe');
  appFrame = document.createElement('iframe');
  document.body.append(recipeFrame, appFrame);
  const recipeWin = recipeFrame.contentWindow!;
  recipeWin.document.head.innerHTML = `<meta property="og:image" content="${IMAGE_URL}"><title>Soup</title>`;
  recipeWin.document.body.innerHTML = '<p>Boil water.</p>';
  recipeWin.open = (() => appFrame.contentWindow) as typeof recipeWin.open;
  toApp = vi.fn();
  appFrame.contentWindow!.postMessage = toApp as unknown as typeof window.postMessage;
  // The hook's ready messages go to window.opener = the recipe window.
  recipeWin.postMessage = ((data: unknown) => appPostsToRecipe(data)) as typeof recipeWin.postMessage;
  Object.defineProperty(window, 'opener', { value: recipeWin, configurable: true });
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'image/png' }),
    blob: async () => new Blob(['png-bytes']),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'opener', { value: null, configurable: true });
  recipeFrame.remove();
  appFrame.remove();
  window.history.replaceState(null, '', '/');
});

describe('bookmarklet <-> handoff hook contract', () => {
  it('delivers the payload after ready and resolves a relay request', async () => {
    runBookmarklet(APP_ORIGIN, recipeFrame.contentWindow!);
    const { result } = renderHook(() => useCaptureHandoff(true));

    // ready (posted by the hook to the opener) makes the bookmarklet send the payload.
    await waitFor(() => expect(toApp).toHaveBeenCalled());
    const [payloadMessage, targetOrigin] = toApp.mock.calls[0];
    expect(targetOrigin).toBe(APP_ORIGIN);
    recipePostsToApp(payloadMessage);
    await waitFor(() => expect(result.current.state.phase).toBe('received'));
    if (result.current.state.phase !== 'received') throw new Error('unreachable');
    expect(result.current.state.payload.mainImage?.type).toBe('image/png');

    toApp.mockClear();
    let relayed!: Promise<Blob | null>;
    act(() => {
      relayed = result.current.requestRelay(IMAGE_URL);
    });
    await waitFor(() => expect(toApp).toHaveBeenCalled());
    recipePostsToApp(toApp.mock.calls[0][0]);
    const image = await relayed;
    expect(image?.type).toBe('image/png');
  });
});
