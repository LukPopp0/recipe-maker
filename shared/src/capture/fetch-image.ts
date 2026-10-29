export async function fetchImageBlob(
  url: string,
  maxBytes: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Blob | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) return null;
    // Only the image/* family is checked here; the server enforces jpeg/png/webp.
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return null;
    const blob = await res.blob();
    if (blob.size > maxBytes) return null;
    // Always the bare media type: a Blob type may carry parameters (image/jpeg;charset=x).
    return blob.type === type ? blob : new Blob([blob], { type });
  } catch {
    return null;
  }
}
