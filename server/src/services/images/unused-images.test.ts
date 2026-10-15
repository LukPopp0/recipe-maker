import { describe, expect, it } from 'vitest';
import { findUnusedImages } from './unused-images.js';

const BASE = 'http://localhost:8787';
const NOW = new Date('2026-10-14T12:00:00Z');
const OLD = new Date('2026-10-12T12:00:00Z');
const FRESH = new Date('2026-10-14T11:00:00Z');

describe('findUnusedImages', () => {
  it('returns unreferenced objects older than 24 h only', () => {
    const objects = [
      { key: 'recipes/a/main-0.jpg', sizeBytes: 1, modifiedAt: OLD },
      { key: 'recipes/b/main-0.jpg', sizeBytes: 1, modifiedAt: OLD },
      { key: 'recipes/c/main-0.jpg', sizeBytes: 1, modifiedAt: FRESH },
    ];
    const recipes = [
      {
        id: '1',
        owner: 'alice',
        createdAt: '',
        updatedAt: '',
        recipe: { main_image: `${BASE}/images/recipes/a/main-0.jpg`, steps: [] },
      },
    ] as never;

    const unused = findUnusedImages({ objects, recipes, publicBaseUrl: BASE, now: NOW });

    expect(unused.map((o) => o.key)).toEqual(['recipes/b/main-0.jpg']);
  });

  it('keeps images referenced through another origin out of the unused list', () => {
    const objects = [{ key: 'recipes/b/main-0.jpg', sizeBytes: 1, modifiedAt: OLD }];
    const recipes = [
      {
        id: '1',
        owner: 'alice',
        createdAt: '',
        updatedAt: '',
        recipe: { main_image: 'http://old-host.example.com/images/recipes/b/main-0.jpg', steps: [] },
      },
    ] as never;

    expect(findUnusedImages({ objects, recipes, publicBaseUrl: BASE, now: NOW })).toEqual([]);
  });
});
