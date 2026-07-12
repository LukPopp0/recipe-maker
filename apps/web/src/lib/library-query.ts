// Client-side Library filtering and sorting. Pure functions over the summary
// list the server returns in full (single user, no pagination), so the UI can
// re-run the query on every state change without a round trip.
import type { RecipeSummary } from 'shared';

export type TimeBucket = 'any' | 'lt20' | 'lt30' | 'lt45' | 'gte60';

export type LibraryFilters = {
  search: string
  tags: string[]
  tagMode: 'or' | 'and'
  timeBucket: TimeBucket
  source: 'all' | 'url' | 'manual'
};

export type LibrarySort = 'newest' | 'oldest' | 'name-asc' | 'name-desc' | 'time-asc';

export const EMPTY_FILTERS: LibraryFilters = {
  search: '',
  tags: [],
  tagMode: 'or',
  timeBucket: 'any',
  source: 'all',
};

function matchesTime(time: number | null, bucket: TimeBucket): boolean {
  if (bucket === 'any') return true;
  if (time === null) return false;
  switch (bucket) {
    case 'lt20': return time < 20;
    case 'lt30': return time < 30;
    case 'lt45': return time < 45;
    case 'gte60': return time >= 60;
  }
}

function matches(summary: RecipeSummary, filters: LibraryFilters): boolean {
  const search = filters.search.trim().toLowerCase();
  if (search && !summary.title.toLowerCase().includes(search)) return false;

  if (filters.tags.length > 0) {
    const has = (tag: string) => summary.tags.includes(tag);
    const tagsOk = filters.tagMode === 'and' ? filters.tags.every(has) : filters.tags.some(has);
    if (!tagsOk) return false;
  }

  if (!matchesTime(summary.time, filters.timeBucket)) return false;

  if (filters.source !== 'all' && summary.source_type !== filters.source) return false;

  return true;
}

const COMPARATORS: Record<LibrarySort, (a: RecipeSummary, b: RecipeSummary) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
  'name-asc': (a, b) => a.title.localeCompare(b.title),
  'name-desc': (a, b) => b.title.localeCompare(a.title),
  // Shortest cook time first; recipes without a time sink to the end.
  // MAX_SAFE_INTEGER (not Infinity) so two null times compare 0, not NaN.
  'time-asc': (a, b) => (a.time ?? Number.MAX_SAFE_INTEGER) - (b.time ?? Number.MAX_SAFE_INTEGER),
};

export function applyLibraryQuery(
  summaries: RecipeSummary[],
  filters: LibraryFilters,
  sort: LibrarySort,
): RecipeSummary[] {
  return summaries.filter((summary) => matches(summary, filters)).sort(COMPARATORS[sort]);
}

export function collectTags(summaries: RecipeSummary[]): string[] {
  const tags = new Set<string>();
  for (const summary of summaries) {
    for (const tag of summary.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}
