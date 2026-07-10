import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import App from './App.tsx';
import { ingestUrl, listRecipes } from './api/client.ts';

vi.mock('./api/client.ts', () => ({
  ingestUrl: vi.fn(),
  listRecipes: vi.fn(),
  getRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
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

  it('renders nav with Create active and Library enabled', () => {
    render(<App />);

    const nav = screen.getByRole('navigation');
    const createButton = screen.getByRole('button', { name: 'Create' });
    const libraryButton = screen.getByRole('button', { name: /Library/ });

    expect(nav).toBeInTheDocument();
    expect(createButton).toBeInTheDocument();
    expect(createButton).toHaveAttribute('aria-current', 'page');
    expect(libraryButton).toBeEnabled();
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

    // Header status chip and the action tray note both report the dirty state.
    expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThanOrEqual(1);
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

describe('Wizard flow', () => {
  it('collapses the Input stage after successful extraction and reopens via Edit input', async () => {
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

    expect(screen.getByLabelText(/recipe url/i)).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /edit input/i }));
    expect(screen.getByLabelText(/recipe url/i)).toBeVisible();
  });

  it('keeps the JSON drawer collapsed until toggled', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
    render(<App />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));
    await screen.findByLabelText(/title/i);

    expect(screen.getByText(/"Test Recipe"/)).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /show json/i }));
    expect(screen.getByText(/"Test Recipe"/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: /hide json/i }));
    expect(screen.getByText(/"Test Recipe"/)).not.toBeVisible();
  });

  it('shows the action tray only when a recipe is loaded', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
    render(<App />);

    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));
    await screen.findByLabelText(/title/i);

    expect(screen.getByRole('button', { name: /save recipe/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /preview card/i })).toBeVisible();
  });
});

describe('Library view', () => {
  it('enables the Library nav button and shows the library on click', async () => {
    vi.mocked(listRecipes).mockResolvedValueOnce({ ok: true, value: { recipes: [] } });
    const user = userEvent.setup();
    render(<App />);

    const libraryButton = screen.getByRole('button', { name: /library/i });
    expect(libraryButton).toBeEnabled();
    await user.click(libraryButton);
    expect(await screen.findByText(/no saved recipes yet/i)).toBeInTheDocument();
  });

  it('hides the Create panels while in the Library view without unmounting them', async () => {
    vi.mocked(listRecipes).mockResolvedValueOnce({ ok: true, value: { recipes: [] } });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /library/i }));
    // hidden sections stay in the DOM but are not visible
    expect(screen.getByText(/no recipe loaded yet/i)).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByText(/no recipe loaded yet/i)).toBeVisible();
  });
});

describe('Create card preview', () => {
  it('shows the card from Preview Card and returns via Back', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 } },
    });
    render(<App />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.org/r');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));
    await screen.findByLabelText(/title/i);

    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /input/i })).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByRole('heading', { name: /input/i })).toBeVisible();
  });
});
