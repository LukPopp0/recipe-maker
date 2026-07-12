// Library filter/sort toolbar. Fully controlled: LibraryPanel owns filters and
// sort, this component only reports changes. Tag chips come from the tags
// actually present in the library (collectTags), not the full vocabulary, so
// there are no dead chips.
import { EMPTY_FILTERS, type LibraryFilters, type LibrarySort, type TimeBucket } from '../../lib/library-query.ts';
import { tagColorClass } from '../../lib/tag-palette.ts';

const TIME_BUCKETS: { value: TimeBucket; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'lt20', label: 'Under 20' },
  { value: 'lt30', label: 'Under 30' },
  { value: 'lt45', label: 'Under 45' },
  { value: 'gte60', label: '60+' },
];

const SOURCES: { value: LibraryFilters['source']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'url', label: 'URL' },
  { value: 'manual', label: 'Manual' },
];

const SORTS: { value: LibrarySort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'name-asc', label: 'Name A-Z' },
  { value: 'name-desc', label: 'Name Z-A' },
  { value: 'time-asc', label: 'Cook time' },
];

function hasActiveFilters(filters: LibraryFilters): boolean {
  return (
    filters.search.trim() !== ''
    || filters.tags.length > 0
    || filters.timeBucket !== 'any'
    || filters.source !== 'all'
  );
}

export function LibraryFilterBar({
  filters,
  sort,
  availableTags,
  matchCount,
  totalCount,
  onFiltersChange,
  onSortChange,
}: {
  filters: LibraryFilters
  sort: LibrarySort
  availableTags: string[]
  matchCount: number
  totalCount: number
  onFiltersChange: (filters: LibraryFilters) => void
  onSortChange: (sort: LibrarySort) => void
}) {
  const active = hasActiveFilters(filters);

  const toggleTag = (tag: string) => {
    const tags = filters.tags.includes(tag)
      ? filters.tags.filter((t) => t !== tag)
      : [...filters.tags, tag];
    onFiltersChange({ ...filters, tags });
  };

  return (
    <div className="library-filter-bar">
      <div className="library-filter-row">
        <input
          type="search"
          className="library-filter-search"
          aria-label="Search recipes"
          placeholder="Search by title"
          value={filters.search}
          onChange={(event) => onFiltersChange({ ...filters, search: event.target.value })}
        />
        <label className="library-filter-sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => onSortChange(event.target.value as LibrarySort)}>
            {SORTS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      {availableTags.length > 0 ? (
        <div className="library-filter-group" role="group" aria-label="Filter by tags">
          <span className="library-filter-label">Tags</span>
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`library-filter-chip library-filter-tag ${tagColorClass(tag)}`}
              aria-pressed={filters.tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
          <div className="library-filter-segment" role="group" aria-label="Tag match mode">
            <button
              type="button"
              aria-pressed={filters.tagMode === 'or'}
              onClick={() => onFiltersChange({ ...filters, tagMode: 'or' })}
            >
              Any tag
            </button>
            <button
              type="button"
              aria-pressed={filters.tagMode === 'and'}
              onClick={() => onFiltersChange({ ...filters, tagMode: 'and' })}
            >
              All tags
            </button>
          </div>
        </div>
      ) : null}

      <div className="library-filter-row">
        <div className="library-filter-group" role="group" aria-label="Filter by cook time">
          <span className="library-filter-label">Time</span>
          {TIME_BUCKETS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className="library-filter-chip"
              aria-pressed={filters.timeBucket === value}
              onClick={() => onFiltersChange({ ...filters, timeBucket: value })}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="library-filter-segment" role="group" aria-label="Filter by source">
          {SOURCES.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={filters.source === value}
              onClick={() => onFiltersChange({ ...filters, source: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {active ? (
        <div className="library-filter-row library-filter-status">
          <span className="library-filter-count">{`${matchCount} of ${totalCount} recipes`}</span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </div>
  );
}
