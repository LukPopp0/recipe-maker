// After a capture ingest, asks the capture source to fetch the images the
// server could not host and uploads them into their slots.
import type { ImageSlot, UnhostedImage } from 'shared';
import type { uploadImage } from '../api/client.ts';

export async function relayUnhostedImages(params: {
  unhosted: UnhostedImage[]
  namespaceId: string
  requestRelay: (url: string) => Promise<Blob | null>
  upload: typeof uploadImage
  onImage: (slot: ImageSlot, url: string) => void
}): Promise<void> {
  const { unhosted, namespaceId, requestRelay, upload, onImage } = params;
  for (const entry of unhosted) {
    const blob = await requestRelay(entry.url);
    // The server only accepts image/* uploads; anything else is skipped.
    if (!blob || !blob.type.startsWith('image/')) continue;
    const result = await upload(namespaceId, entry.slot, blob);
    if (result.ok) onImage(entry.slot, result.value.url);
  }
}
