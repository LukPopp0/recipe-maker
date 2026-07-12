import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibraryFilterBar } from './LibraryFilterBar.tsx';
import { EMPTY_FILTERS, type LibraryFilters } from '../../lib/library-query.ts';
import { tagColorClass } from '../../lib/tag-palette.ts';

const TAGS = ['Dessert', 'Quick', 'Vegetarian'];

function renderBar(overrides: Partial<Parameters<typeof LibraryFilterBar>[0]> = {}) {
  const onFiltersChange = vi.fn();
  const onSortChange = vi.fn();
  render(
    <LibraryFilterBar
      filters={EMPTY_FILTERS}
      sort="newest"
      availableTags={TAGS}
      matchCount={3}
      totalCount={3}
      onFiltersChange={onFiltersChange}
      onSortChange={onSortChange}
      {...overrides}
    />,
  );
  return { onFiltersChange, onSortChange };
}

describe('LibraryFilterBar', () => {
  it('renders a colored toggle chip per available tag', () => {
    renderBar();
    const chip = screen.getByRole('button', { name: 'Quick' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).toHaveClass(tagColorClass('Quick'));
  });

  it('clicking an unselected tag chip adds it to filters', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar();
    await user.click(screen.getByRole('button', { name: 'Quick' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, tags: ['Quick'] });
  });

  it('clicking a selected tag chip removes it', async () => {
    const user = userEvent.setup();
    const filters: LibraryFilters = { ...EMPTY_FILTERS, tags: ['Quick', 'Dessert'] };
    const { onFiltersChange } = renderBar({ filters });
    const chip = screen.getByRole('button', { name: 'Quick' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, tags: ['Dessert'] });
  });

  it('typing in search updates filters', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar();
    await user.type(screen.getByRole('searchbox', { name: /search/i }), 's');
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, search: 's' });
  });

  it('switching tag mode to AND updates filters', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar({ filters: { ...EMPTY_FILTERS, tags: ['Quick'] } });
    await user.click(screen.getByRole('button', { name: /all tags/i }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, tags: ['Quick'], tagMode: 'and' });
  });

  it('selecting a time bucket updates filters', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar();
    await user.click(screen.getByRole('button', { name: 'Under 30' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, timeBucket: 'lt30' });
  });

  it('selecting a source updates filters', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar();
    await user.click(screen.getByRole('button', { name: 'URL' }));
    expect(onFiltersChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, source: 'url' });
  });

  it('changing sort calls onSortChange', async () => {
    const user = userEvent.setup();
    const { onSortChange } = renderBar();
    await user.selectOptions(screen.getByRole('combobox', { name: /sort/i }), 'name-asc');
    expect(onSortChange).toHaveBeenCalledWith('name-asc');
  });

  it('hides clear button and count when no filters are active', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/of 3 recipes/i)).not.toBeInTheDocument();
  });

  it('shows match count and clear button when filters are active; clear resets', async () => {
    const user = userEvent.setup();
    const { onFiltersChange } = renderBar({
      filters: { ...EMPTY_FILTERS, search: 'soup' },
      matchCount: 1,
    });
    expect(screen.getByText('1 of 3 recipes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(onFiltersChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });

  it('hides the tag section when the library has no tags', () => {
    renderBar({ availableTags: [] });
    expect(screen.queryByRole('group', { name: /tags/i })).not.toBeInTheDocument();
  });
});
