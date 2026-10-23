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

const TYPES = ['ready', 'payload', 'relay-request', 'relay-reply'];

export function isCaptureMessage(data: unknown): data is CaptureMessage {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;
  return d.protocol === CAPTURE_PROTOCOL && typeof d.type === 'string' && TYPES.includes(d.type);
}
