import { useEffect, useId, useRef, useState } from 'react';
import type { ClipboardEvent, ChangeEvent, FormEvent } from 'react';
import type { ImageSlot } from 'shared';
import { linkImage, uploadImage } from '../../api/client.ts';
import type { ClientResult } from '../../api/client.ts';
import { ACCEPTED_IMAGE_TYPES, validateImageFile } from '../../lib/upload-limits.ts';

type ImageControlProps = {
  label: string
  slot: ImageSlot
  imageUrl: string | null
  namespaceId: string
  onChange: (url: string | null) => void
  removeLabel?: string
}

const CLIPBOARD_HINT = 'Could not read the clipboard. Long-press the paste box and choose Paste.';

export function ImageControl({ label, slot, imageUrl, namespaceId, onChange, removeLabel }: ImageControlProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState('');
  const busyRef = useRef(false);
  const pasteBoxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlId = useId();

  // The box is only a paste target: refuse every edit. Native listener because
  // React's onBeforeInput is synthesized from other events.
  useEffect(() => {
    const box = pasteBoxRef.current;
    if (!box) return;
    const block = (event: Event) => event.preventDefault();
    box.addEventListener('beforeinput', block);
    return () => box.removeEventListener('beforeinput', block);
  }, []);

  const canReadClipboard = typeof navigator !== 'undefined' && typeof navigator.clipboard?.read === 'function';

  async function finish(result: ClientResult<{ url: string }>): Promise<boolean> {
    if (!result.ok) {
      setError(result.error.message);
      return false;
    }
    onChange(result.value.url);
    return true;
  }

  async function sendFile(file: File, filename?: string) {
    if (busyRef.current) return;
    const problems: string[] = [];
    validateImageFile(file, problems);
    if (problems.length > 0) {
      setError(problems.join(' '));
      return;
    }
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await finish(await uploadImage(namespaceId, slot, file, filename));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    if (busyRef.current) {
      event.preventDefault();
      return;
    }
    const files = Array.from(event.clipboardData?.files ?? []);
    const image = files.find((file) => file.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    void sendFile(image, image.name || 'image');
  }

  async function handlePasteButton() {
    if (busyRef.current) return;
    setError(null);
    let file: File | null = null;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) {
          const blob = await item.getType(type);
          // Keep the image type explicitly: the server needs an exact mime type.
          file = new File([blob], `pasted.${type.slice('image/'.length)}`, { type });
          break;
        }
      }
    } catch {
      setError(CLIPBOARD_HINT);
      return;
    }
    if (!file) {
      setError('The clipboard does not contain an image.');
      return;
    }
    await sendFile(file, file.name);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void sendFile(file, file.name);
  }

  async function handleLink(event: FormEvent) {
    event.preventDefault();
    const url = linkValue.trim();
    if (!url || busyRef.current) return;
    setError(null);
    busyRef.current = true;
    setBusy(true);
    try {
      if (await finish(await linkImage(namespaceId, slot, url))) {
        setLinkValue('');
        setLinkOpen(false);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="image-control" role="group" aria-label={label} tabIndex={0} onPaste={handlePaste}>
      {imageUrl ? (
        <img className="image-control-thumb" src={imageUrl} alt={label} />
      ) : (
        <div className="image-control-empty">No image. Paste, link or upload one.</div>
      )}
      <div
        className="image-control-paste"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={`${label} paste area`}
        data-placeholder="Paste image here"
        onPaste={(event) => event.preventDefault()}
        ref={pasteBoxRef}
        onDrop={(event) => event.preventDefault()}
      />
      <div className="image-control-actions">
        {canReadClipboard && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void handlePasteButton()}>
            Paste
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setLinkOpen((open) => !open)}>
          Link
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="image-control-file"
          aria-label="Upload"
          accept={ACCEPTED_IMAGE_TYPES.join(',')}
          disabled={busy}
          onChange={handleFileChange}
        />
        {imageUrl && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            aria-label={removeLabel}
            onClick={() => onChange(null)}
          >
            Remove
          </button>
        )}
      </div>
      {linkOpen && (
        <form className="image-control-link" onSubmit={(event) => void handleLink(event)}>
          <label htmlFor={urlId} className="image-control-link-label">Image URL</label>
          <input
            id={urlId}
            type="url"
            value={linkValue}
            disabled={busy}
            onChange={(event) => setLinkValue(event.target.value)}
          />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || linkValue.trim() === ''}>
            Use link
          </button>
        </form>
      )}
      {busy && <p className="image-control-status">Working...</p>}
      {error && (
        <p className="image-control-error" role="alert">{error}</p>
      )}
    </div>
  );
}
