import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteImages, listUnusedImages } from '../../api/client.ts';
import { DELETE_BATCH_SIZE, UnusedImagesPanel } from './UnusedImagesPanel.tsx';

vi.mock('../../api/client.ts', () => ({
  listUnusedImages: vi.fn(),
  deleteImages: vi.fn(),
}));

const mockedList = vi.mocked(listUnusedImages);
const mockedDelete = vi.mocked(deleteImages);

const images = [
  { key: 'recipes/a/main-0.jpg', url: '/images/recipes/a/main-0.jpg', sizeBytes: 150_000, modifiedAt: '2026-10-01T00:00:00Z' },
  { key: 'recipes/b/step-1.jpg', url: '/images/recipes/b/step-1.jpg', sizeBytes: 45_000, modifiedAt: '2026-10-01T00:00:00Z' },
];

describe('UnusedImagesPanel', () => {
  beforeEach(() => {
    mockedList.mockReset();
    mockedDelete.mockReset();
    vi.restoreAllMocks();
  });

  it('lists unused images with a total and deletes them all after confirm', async () => {
    const user = userEvent.setup();
    mockedList
      .mockResolvedValueOnce({ ok: true, value: { images } })
      .mockResolvedValueOnce({ ok: true, value: { images: [] } });
    mockedDelete.mockResolvedValueOnce({ ok: true, value: { deleted: 2 } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<UnusedImagesPanel onClose={vi.fn()} />);

    expect(await screen.findByText('2 unused images (195 KB)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete all' }));

    expect(mockedDelete).toHaveBeenCalledWith(['recipes/a/main-0.jpg', 'recipes/b/step-1.jpg']);
    expect(await screen.findByText('No unused images.')).toBeInTheDocument();
  });

  it('deletes in batches of 500 and reloads afterwards', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: DELETE_BATCH_SIZE + 1 }, (_, i) => ({
      key: `recipes/a/img-${i}.jpg`,
      url: `/images/recipes/a/img-${i}.jpg`,
      sizeBytes: 1000,
      modifiedAt: '2026-10-01T00:00:00Z',
    }));
    mockedList
      .mockResolvedValueOnce({ ok: true, value: { images: many } })
      .mockResolvedValueOnce({ ok: true, value: { images: [] } });
    mockedDelete
      .mockResolvedValueOnce({ ok: true, value: { deleted: DELETE_BATCH_SIZE } })
      .mockResolvedValueOnce({ ok: true, value: { deleted: 1 } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<UnusedImagesPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Delete all' }));

    expect(await screen.findByText('No unused images.')).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledTimes(2);
    expect(mockedDelete.mock.calls[0][0]).toHaveLength(DELETE_BATCH_SIZE);
    expect(mockedDelete.mock.calls[1][0]).toEqual(['recipes/a/img-500.jpg']);
    expect(mockedList).toHaveBeenCalledTimes(2);
  });

  it('stops at the first failing batch and shows the error', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: DELETE_BATCH_SIZE + 1 }, (_, i) => ({
      key: `recipes/a/img-${i}.jpg`,
      url: `/images/recipes/a/img-${i}.jpg`,
      sizeBytes: 1000,
      modifiedAt: '2026-10-01T00:00:00Z',
    }));
    mockedList.mockResolvedValue({ ok: true, value: { images: many } });
    mockedDelete.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom', status: 500 },
    } as never);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<UnusedImagesPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Delete all' }));

    expect(await screen.findByText(/boom/)).toBeInTheDocument();
    expect(mockedDelete).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue({ ok: true, value: { images } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<UnusedImagesPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Delete all' }));

    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
