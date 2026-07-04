import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import App from './App.tsx';
import { ingestUrl } from './api/client.ts';

vi.mock('./api/client.ts', () => ({
  ingestUrl: vi.fn(),
}));

const mockedIngestUrl = vi.mocked(ingestUrl);

const RECIPE: CanonicalRecipe = {
  title: 'Test Recipe',
  tags: [],
  time: 30,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Step 1', step_description: 'Do the thing.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/recipe', language: 'en', warnings: [] },
};

describe('App', () => {
  it('renders the app title and the workspace shell region', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Recipe Maker' })).toBeInTheDocument();
    expect(document.getElementById('workspace-shell')).toBeInTheDocument();
  });

  it('renders nav with Create active and Library disabled with a Phase 6 hint', () => {
    render(<App />);

    const nav = screen.getByRole('navigation');
    const createButton = screen.getByRole('button', { name: 'Create' });
    const libraryButton = screen.getByRole('button', { name: /Library/ });

    expect(nav).toBeInTheDocument();
    expect(createButton).toBeInTheDocument();
    expect(createButton).toHaveAttribute('aria-current', 'page');
    expect(libraryButton).toBeDisabled();
    expect(screen.getByText(/coming in Phase 6/i)).toBeInTheDocument();
  });

  it('renders the input, review, and JSON layout regions', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: /input/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /review/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /json/i })).toBeInTheDocument();
  });

  it('shows an empty-state message in the review region when no recipe is loaded', () => {
    render(<App />);

    expect(screen.getByText(/no recipe loaded/i)).toBeInTheDocument();
  });

  it('marks the workspace dirty and clears the saved status when a review-panel edit is made after ingestion', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });

    render(<App />);

    const urlInput = screen.getByLabelText(/recipe url/i);
    await user.type(urlInput, 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    const titleInput = await screen.findByLabelText(/title/i);
    expect(screen.getByText('Recipe loaded')).toBeInTheDocument();

    await user.type(titleInput, '!');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('wires the loaded recipe into the JSON panel', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });

    render(<App />);

    const urlInput = screen.getByLabelText(/recipe url/i);
    await user.type(urlInput, 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    await screen.findByLabelText(/title/i);

    expect(screen.getByText(/"Test Recipe"/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save recipe/i })).toBeInTheDocument();
  });
});
