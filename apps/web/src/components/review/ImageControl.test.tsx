import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImageControl } from './ImageControl.tsx';
import { linkImage, uploadImage } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  uploadImage: vi.fn(),
  linkImage: vi.fn(),
}));

const mockedUpload = vi.mocked(uploadImage);
const mockedLink = vi.mocked(linkImage);
const onChange = vi.fn();

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
}

beforeEach(() => {
  mockedUpload.mockReset();
  mockedLink.mockReset();
  onChange.mockReset();
  setClipboard(undefined);
});

afterEach(() => {
  setClipboard(undefined);
});

function renderMain(imageUrl: string | null = null, slot: 'main' | number = 'main') {
  return render(
    <ImageControl label="Main image" slot={slot} imageUrl={imageUrl} namespaceId="ns" onChange={onChange} />,
  );
}

describe('ImageControl', () => {
  it('uploads an image pasted into the control and reports the hosted URL', async () => {
    mockedUpload.mockResolvedValue({ ok: true, value: { url: '/images/recipes/ns/main-0-abcd1234.jpg' } });
    renderMain();
    const file = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    fireEvent.paste(screen.getByRole('group', { name: 'Main image' }), {
      clipboardData: { files: [file], items: [] },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/images/recipes/ns/main-0-abcd1234.jpg'));
    expect(mockedUpload).toHaveBeenCalledWith('ns', 'main', file, 'image.png');
  });

  it('ignores a paste without an image', () => {
    renderMain();
    fireEvent.paste(screen.getByRole('group', { name: 'Main image' }), {
      clipboardData: { files: [], items: [], getData: () => 'hello' },
    });
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reads the clipboard with the Paste button', async () => {
    mockedUpload.mockResolvedValue({ ok: true, value: { url: '/images/x.jpg' } });
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' });
    setClipboard({ read: async () => [{ types: ['text/plain', 'image/png'], getType: async () => blob }] });
    renderMain();
    await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/images/x.jpg'));
    const [, , sent, name] = mockedUpload.mock.calls[0];
    expect((sent as File).type).toBe('image/png');
    expect(name).toBe('pasted.png');
  });

  it('shows a hint when reading the clipboard is refused', async () => {
    setClipboard({
      read: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    renderMain();
    await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not read the clipboard. Long-press the box and choose Paste instead.',
    );
    expect(mockedUpload).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows an error when the clipboard holds no image', async () => {
    setClipboard({ read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }] });
    renderMain();
    await userEvent.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The clipboard does not contain an image.');
  });

  it('hides the Paste button without the async Clipboard API', () => {
    renderMain();
    expect(screen.queryByRole('button', { name: 'Paste' })).toBeNull();
  });

  it('links an image URL through the server', async () => {
    mockedLink.mockResolvedValue({ ok: true, value: { url: '/images/linked.jpg' } });
    renderMain(null, 2);
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.type(screen.getByLabelText('Image URL'), 'https://example.com/a.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Use link' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/images/linked.jpg'));
    expect(mockedLink).toHaveBeenCalledWith('ns', 2, 'https://example.com/a.jpg');
  });

  it('shows the server message when a linked site blocks downloads', async () => {
    const message = 'This site blocks downloads, copy the image and paste it instead.';
    mockedLink.mockResolvedValue({
      ok: false,
      error: { code: 'IMAGE_DOWNLOAD_FAILED', message, requestId: 'r' },
    });
    renderMain();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    await userEvent.type(screen.getByLabelText('Image URL'), 'https://example.com/a.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Use link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uploads a chosen file', async () => {
    mockedUpload.mockResolvedValue({ ok: true, value: { url: '/images/up.jpg' } });
    renderMain();
    const file = new File([new Uint8Array([1])], 'cake.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Upload'), file);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('/images/up.jpg'));
    expect(mockedUpload).toHaveBeenCalledWith('ns', 'main', file, 'cake.jpg');
  });

  it('rejects an unsupported type client-side', () => {
    renderMain();
    const file = new File([new Uint8Array([1])], 'cake.heic', { type: 'image/heic' });
    fireEvent.change(screen.getByLabelText('Upload'), { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent('not a supported image type');
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it('removes the image', async () => {
    renderMain('/images/a.jpg');
    expect(screen.getByRole('img', { name: 'Main image' })).toHaveAttribute('src', '/images/a.jpg');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('has no Remove button when empty', () => {
    renderMain();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});
