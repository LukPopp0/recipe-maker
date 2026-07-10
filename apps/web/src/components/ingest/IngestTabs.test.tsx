import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IngestTabs } from './IngestTabs.tsx';

describe('IngestTabs', () => {
  it('renders three tabs in a tablist named "Ingestion method"', () => {
    render(<IngestTabs onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const tablist = screen.getByRole('tablist', { name: 'Ingestion method' });
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tablist).toBeInTheDocument();
    expect(tabs.map((tab) => tab.textContent)).toEqual(['URL', 'Manual', 'Load JSON']);
  });

  it('selects the URL tab by default', () => {
    render(<IngestTabs onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    expect(screen.getByRole('tab', { name: 'URL' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Load JSON' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByLabelText(/recipe url/i)).toBeInTheDocument();
  });

  it('switches to the Manual panel when the Manual tab is clicked', async () => {
    const user = userEvent.setup();
    render(<IngestTabs onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Manual' }));

    expect(screen.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Ingredients')).toBeInTheDocument();
    expect(screen.queryByLabelText(/recipe url/i)).not.toBeInTheDocument();
  });

  it('switches to the Load JSON panel when the Load JSON tab is clicked', async () => {
    const user = userEvent.setup();
    render(<IngestTabs onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: 'Load JSON' }));

    expect(screen.getByRole('tab', { name: 'Load JSON' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Recipe JSON file')).toBeInTheDocument();
    expect(screen.queryByLabelText(/recipe url/i)).not.toBeInTheDocument();
  });
});
