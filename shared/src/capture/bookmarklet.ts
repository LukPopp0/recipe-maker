import { collectCapture } from './collect.js';
import { fetchImageBlob } from './fetch-image.js';
import { CAPTURE_IMAGE_MAX_BYTES, CAPTURE_PROTOCOL, isCaptureMessage } from './protocol.js';
import type { CapturePayload } from './protocol.js';

export function runBookmarklet(appOrigin: string, win: Window = window): void {
  const appWindow = win.open(appOrigin + '/capture', '_blank');
  if (!appWindow) {
    win.alert('Recipe Maker could not open a new tab. Allow pop-ups for this site and try again.');
    return;
  }

  const payload: Promise<CapturePayload> = (async () => {
    let collected: ReturnType<typeof collectCapture>;
    try {
      collected = collectCapture(win.document);
    } catch (err) {
      console.error('Recipe Maker: page collection failed', err);
      return { url: win.location.href, html: win.document.documentElement.outerHTML };
    }
    const result: CapturePayload = { ...collected };
    if (collected.mainImageUrl) {
      const blob = await fetchImageBlob(collected.mainImageUrl, CAPTURE_IMAGE_MAX_BYTES);
      if (blob) result.mainImage = blob;
    }
    return result;
  })();

  win.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== appOrigin || event.source !== appWindow) return;
    const msg = event.data;
    if (!isCaptureMessage(msg)) return;
    if (msg.type === 'ready') {
      void payload.then((p) => {
        appWindow.postMessage({ protocol: CAPTURE_PROTOCOL, type: 'payload', payload: p }, appOrigin);
      });
    } else if (msg.type === 'relay-request') {
      void fetchImageBlob(msg.url, CAPTURE_IMAGE_MAX_BYTES).then((image) => {
        appWindow.postMessage(
          { protocol: CAPTURE_PROTOCOL, type: 'relay-reply', id: msg.id, url: msg.url, image },
          appOrigin,
        );
      });
    }
  });
}
