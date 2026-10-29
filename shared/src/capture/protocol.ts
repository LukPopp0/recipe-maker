export const CAPTURE_PROTOCOL = 'recipe-maker-capture/1';
export const EXTENSION_CHANNEL = 'recipe-maker-extension';
export const CAPTURE_IMAGE_MAX_BYTES = 8_000_000; // mirrors IMAGE_MAX_BYTES

export type CapturePayload = { url: string; html: string; mainImageUrl?: string; mainImage?: Blob };

type Base = { protocol: typeof CAPTURE_PROTOCOL; channel?: typeof EXTENSION_CHANNEL };
export type CaptureMessage =
  | (Base & { type: 'ready' })
  | (Base & { type: 'payload'; payload: CapturePayload })
  | (Base & { type: 'relay-request'; id: string; url: string })
  | (Base & { type: 'relay-reply'; id: string; url: string; image: Blob | null });

const isBlob = (x: unknown): boolean => typeof Blob !== 'undefined' && x instanceof Blob;
const isStr = (x: unknown): boolean => typeof x === 'string';

export function isCaptureMessage(data: unknown): data is CaptureMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  if (d.protocol !== CAPTURE_PROTOCOL) return false;
  if (d.channel !== undefined && d.channel !== EXTENSION_CHANNEL) return false;
  switch (d.type) {
    case 'ready':
      return true;
    case 'payload': {
      const p = d.payload as Record<string, unknown> | null | undefined;
      if (typeof p !== 'object' || p === null) return false;
      return (
        isStr(p.url) &&
        isStr(p.html) &&
        (p.mainImageUrl === undefined || isStr(p.mainImageUrl)) &&
        (p.mainImage === undefined || isBlob(p.mainImage))
      );
    }
    case 'relay-request':
      return isStr(d.id) && isStr(d.url);
    case 'relay-reply':
      return isStr(d.id) && isStr(d.url) && (d.image === null || isBlob(d.image));
    default:
      return false;
  }
}
