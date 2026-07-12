import { describe, it, expect } from 'vitest';
import type { RecipeSummary } from 'shared';
import { applyLibraryQuery, collectTags, EMPTY_FILTERS } from './library-query.ts';

function summary(overrides: Partial<RecipeSummary>): RecipeSummary {
  return {
    id: 'id',
    title: 'Recipe',
    tags: [],
    main_image: '/x.png',
    createdAt: '2026-01-01T00:00:00.000Z',
    time: 30,
    source_type: 'manual',
    ...overrides,
  };
}

const soup = summary({ id: 'soup', title: 'Tomato Soup', tags: ['Quick', 'Vegetarian'], time: 15, createdAt: '2026-01-03T00:00:00.000Z', source_type: 'url' });
const cake = summary({ id: 'cake', title: 'Carrot Cake', tags: ['Dessert'], time: 90, createdAt: '2026-01-01T00:00:00.000Z' });
const stew = summary({ id: 'stew', title: 'Beef Stew', tags: ['Quick', 'Beefy'], time: null, createdAt: '2026-01-02T00:00:00.000Z' });
const all = [soup, cake, stew];

describe('applyLibraryQuery filters', () => {
  it('returns everything unchanged-order-newest with empty filters', () => {
    expect(applyLibraryQuery(all, EMPTY_FILTERS, 'newest').map((s) => s.id)).toEqual(['soup', 'stew', 'cake']);
  });

  it('matches title search case-insensitively by substring', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, search: 'soup' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['soup']);
  });

  it('tag OR mode matches recipes with any selected tag', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, tags: ['Vegetarian', 'Dessert'] }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['soup', 'cake']);
  });

  it('tag AND mode requires all selected tags', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, tags: ['Quick', 'Beefy'], tagMode: 'and' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['stew']);
  });

  it('time bucket lt30 keeps only recipes under 30 minutes and drops null times', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, timeBucket: 'lt30' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['soup']);
  });

  it('time bucket gte60 keeps recipes at 60 minutes or more', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, timeBucket: 'gte60' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['cake']);
  });

  it('source filter keeps only the selected source', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, source: 'url' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['soup']);
  });

  it('combines filters with AND across categories', () => {
    const result = applyLibraryQuery(all, { ...EMPTY_FILTERS, tags: ['Quick'], source: 'manual' }, 'newest');
    expect(result.map((s) => s.id)).toEqual(['stew']);
  });
});

describe('applyLibraryQuery sorts', () => {
  it('oldest reverses newest', () => {
    expect(applyLibraryQuery(all, EMPTY_FILTERS, 'oldest').map((s) => s.id)).toEqual(['cake', 'stew', 'soup']);
  });

  it('name-asc sorts titles alphabetically', () => {
    expect(applyLibraryQuery(all, EMPTY_FILTERS, 'name-asc').map((s) => s.id)).toEqual(['stew', 'cake', 'soup']);
  });

  it('name-desc sorts titles reverse-alphabetically', () => {
    expect(applyLibraryQuery(all, EMPTY_FILTERS, 'name-desc').map((s) => s.id)).toEqual(['soup', 'cake', 'stew']);
  });

  it('time-asc sorts shortest first with null times last', () => {
    expect(applyLibraryQuery(all, EMPTY_FILTERS, 'time-asc').map((s) => s.id)).toEqual(['soup', 'cake', 'stew']);
  });

  it('does not mutate the input array', () => {
    const input = [...all];
    applyLibraryQuery(input, EMPTY_FILTERS, 'name-asc');
    expect(input.map((s) => s.id)).toEqual(['soup', 'cake', 'stew']);
  });
});

describe('collectTags', () => {
  it('returns sorted unique tags across summaries', () => {
    expect(collectTags(all)).toEqual(['Beefy', 'Dessert', 'Quick', 'Vegetarian']);
  });

  it('returns empty array for no summaries', () => {
    expect(collectTags([])).toEqual([]);
  });
});
