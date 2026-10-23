// Content script injected into the Recipe Maker /capture tab. It connects the page
// (window messages with a channel marker) to the background (runtime messaging).
import { getExtensionApi } from './api';
import { base64ToBlob } from './base64';
import { CAPTURE_PROTOCOL, EXTENSION_CHANNEL } from '../../shared/src/capture/protocol';

type ImageData = { base64: string; type: string };
type BridgePayload = { url: string; html: string; mainImageUrl?: string; mainImage?: ImageData };

const FLAG = '__recipeMakerBridge';

function toBlob(image: unknown): Blob | null {
  const i = image as Partial<ImageData> | null | undefined;
  return i && typeof i.base64 === 'string' && typeof i.type === 'string' ? base64ToBlob(i.base64, i.type) : null;
}

function reply(message: Record<string, unknown>): void {
  window.postMessage({ protocol: CAPTURE_PROTOCOL, channel: EXTENSION_CHANNEL, ...message }, window.location.origin);
}

function install(): void {
  const api = getExtensionApi();

  const onReady = async (): Promise<void> => {
    let response: unknown;
    try {
      response = await api.runtime.sendMessage({ type: 'ready' });
    } catch {
      return; // background unavailable: the app tab's timeout handles it
    }
    const p = response as BridgePayload | null | undefined;
    if (!p || typeof p.url !== 'string' || typeof p.html !== 'string') return;
    const payload: Record<string, unknown> = { url: p.url, html: p.html };
    if (typeof p.mainImageUrl === 'string') payload.mainImageUrl = p.mainImageUrl;
    const image = toBlob(p.mainImage);
    if (image) payload.mainImage = image;
    reply({ type: 'payload', payload });
  };

  const onRelay = async (id: string, url: string): Promise<void> => {
    let image: Blob | null;
    try {
      image = toBlob(await api.runtime.sendMessage({ type: 'relay-request', url }));
    } catch {
      image = null;
    }
    reply({ type: 'relay-reply', id, url, image });
  };

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data as Record<string, unknown> | null;
    if (typeof d !== 'object' || d === null) return;
    if (d.protocol !== CAPTURE_PROTOCOL || d.channel !== EXTENSION_CHANNEL) return;
    if (d.type === 'ready') void onReady();
    else if (d.type === 'relay-request' && typeof d.id === 'string' && typeof d.url === 'string') {
      void onRelay(d.id, d.url);
    }
  });
}

const w = window as unknown as Record<string, unknown>;
if (!w[FLAG]) {
  w[FLAG] = true;
  install();
}
