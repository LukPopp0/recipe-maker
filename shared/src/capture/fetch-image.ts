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
    const blob = await res.blob();
    if (blob.size > maxBytes) return null;
    return blob.type.startsWith('image/') ? blob : new Blob([blob], { type });
  } catch {
    return null;
  }
}
