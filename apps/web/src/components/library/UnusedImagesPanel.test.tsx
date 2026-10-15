import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteImages, listUnusedImages } from '../../api/client.ts';
import { UnusedImagesPanel } from './UnusedImagesPanel.tsx';

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

  it('does nothing when the confirm is cancelled', async () => {
    const user = userEvent.setup();
    mockedList.mockResolvedValue({ ok: true, value: { images } });
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<UnusedImagesPanel onClose={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Delete all' }));

    expect(mockedDelete).not.toHaveBeenCalled();
  });
});
