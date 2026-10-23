import { findExtensionApi, type ExtensionApi, type ExtensionTab } from './api';
import { blobToBase64 } from './base64';
import { collectCapture } from '../../shared/src/capture/collect';
import { fetchImageBlob } from '../../shared/src/capture/fetch-image';
import { CAPTURE_IMAGE_MAX_BYTES } from '../../shared/src/capture/protocol';

type ImageData = { base64: string; type: string };
type PendingPayload = { url: string; html: string; mainImageUrl?: string; mainImage?: ImageData };

async function toImageData(blob: Blob | null): Promise<ImageData | null> {
  return blob ? { base64: await blobToBase64(blob), type: blob.type } : null;
}

export function createBackground(api: ExtensionApi, fetchImpl: typeof fetch): void {
  // In memory only: if the browser stops the worker before the app tab says ready,
  // the app tab times out and shows its "press the button again" message.
  const pending = new Map<number, Promise<PendingPayload | null>>();

  const getAppOrigin = async (): Promise<string | undefined> => {
    const { appOrigin } = await api.storage.local.get('appOrigin');
    return typeof appOrigin === 'string' && appOrigin !== '' ? appOrigin : undefined;
  };

  // Never rejects: any failure resolves to null so `ready` answers null.
  const collect = async (tabId: number): Promise<PendingPayload | null> => {
    try {
      const results = await api.scripting.executeScript({ target: { tabId }, func: collectCapture, args: [] });
      const page = results[0]?.result as PendingPayload | undefined | null;
      if (!page || typeof page.url !== 'string' || typeof page.html !== 'string') {
        throw new Error('The page returned no content');
      }
      const payload: PendingPayload = { ...page };
      if (page.mainImageUrl) {
        const image = await toImageData(await fetchImageBlob(page.mainImageUrl, CAPTURE_IMAGE_MAX_BYTES, fetchImpl));
        if (image) payload.mainImage = image;
      }
      return payload;
    } catch (error) {
      console.error('Send to Recipe Maker: could not collect the page', error);
      return null;
    }
  };

  const onClicked = async (tab: ExtensionTab): Promise<void> => {
    try {
      const appOrigin = await getAppOrigin();
      if (!appOrigin) {
        await api.runtime.openOptionsPage();
        return;
      }
      const appTab = await api.tabs.create({
        url: `${appOrigin}/capture`,
        index: tab.index === undefined ? undefined : tab.index + 1,
      });
      if (appTab.id === undefined || tab.id === undefined) return;
      pending.set(appTab.id, collect(tab.id));
    } catch (error) {
      console.error('Send to Recipe Maker: could not open the app', error);
    }
  };

  const onUpdated = async (tabId: number, changeInfo: { status?: string }, tab: ExtensionTab): Promise<void> => {
    try {
      if (changeInfo.status !== 'complete' || !pending.has(tabId)) return;
      const appOrigin = await getAppOrigin();
      if (!appOrigin || !tab.url?.startsWith(`${appOrigin}/capture`)) return;
      await api.scripting.executeScript({ target: { tabId }, files: ['bridge.js'] });
    } catch (error) {
      console.error('Send to Recipe Maker: could not inject the bridge', error);
    }
  };

  const answerReady = async (tabId: number | undefined): Promise<PendingPayload | null> => {
    if (tabId === undefined) return null;
    const payload = pending.get(tabId);
    if (!payload) return null;
    pending.delete(tabId);
    return payload;
  };

  const answerRelay = async (url: string): Promise<ImageData | null> => {
    try {
      return await toImageData(await fetchImageBlob(url, CAPTURE_IMAGE_MAX_BYTES, fetchImpl));
    } catch (error) {
      console.error('Send to Recipe Maker: relay failed', error);
      return null;
    }
  };

  api.action.onClicked.addListener(onClicked);
  api.tabs.onUpdated.addListener(onUpdated);
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const m = message as { type?: unknown; url?: unknown } | null;
    let answer: Promise<unknown>;
    if (m?.type === 'ready') answer = answerReady(sender.tab?.id);
    else if (m?.type === 'relay-request' && typeof m.url === 'string') answer = answerRelay(m.url);
    else return false;
    answer.then(sendResponse, () => sendResponse(null));
    return true;
  });
}

const api = findExtensionApi();
if (api) createBackground(api, (input, init) => fetch(input, init));
