import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import App from './App.tsx';
import { getMe, getRecipe, ingestCapture, ingestUrl, linkImage, listRecipes, saveRecipe, uploadImage } from './api/client.ts';
import { useCaptureHandoff } from './capture/use-capture-handoff.ts';

vi.mock('./api/client.ts', () => ({
  ingestUrl: vi.fn(),
  ingestCapture: vi.fn(),
  uploadImage: vi.fn(),
  linkImage: vi.fn(),
  listRecipes: vi.fn(),
  getRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  getMe: vi.fn(),
  updateRecipe: vi.fn(),
  saveRecipe: vi.fn(),
  listUnusedImages: vi.fn(),
  deleteImages: vi.fn(),
}));

vi.mock('./capture/use-capture-handoff.ts', () => ({
  useCaptureHandoff: vi.fn(() => ({ state: { phase: 'off' }, requestRelay: vi.fn() })),
}));

const mockedIngestUrl = vi.mocked(ingestUrl);

beforeEach(() => {
  vi.mocked(getMe).mockResolvedValue({ ok: true, value: { user: { username: 'alice', isAdmin: false }, placeholderImageUrl: '/images/placeholder-recipe.png' } });
});

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
  it('shows the logged-in username in the header', async () => {
    render(<App />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
  });

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
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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

  it('passes placeholderImageUrl from /api/me to the review panel', async () => {
    const user = userEvent.setup();
    vi.mocked(getMe).mockResolvedValue({
      ok: true,
      value: { user: { username: 'alice', isAdmin: false }, placeholderImageUrl: 'https://cdn.x/p.png' },
    });
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: {
        recipe: { ...RECIPE, main_image: 'https://cdn.x/p.png' },
        diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 },
        imageNamespaceId: 'ns-test',
      },
    });

    render(<App />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.com/recipe');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));

    expect(await screen.findByRole('region', { name: 'Add main image' })).toBeVisible();
  });

  it('wires the loaded recipe into the JSON panel', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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

describe('Theme toggle', () => {
  afterEach(() => {
    localStorage.removeItem('theme');
    delete document.documentElement.dataset.theme;
  });

  it('toggles to dark, stamps data-theme on <html>, and persists the choice', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Dark mode' }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
  });

  it('toggles back to light from an explicit dark theme', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Dark mode' }));
    await user.click(screen.getByRole('button', { name: 'Light mode' }));

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('honors a stored dark theme on load', () => {
    localStorage.setItem('theme', 'dark');
    render(<App />);

    expect(screen.getByRole('button', { name: 'Light mode' })).toBeInTheDocument();
  });
});

describe('Wizard flow', () => {
  it('collapses the Input stage after successful extraction and reopens via Edit input', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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
    expect(await screen.findByText(/you have not saved any recipes yet/i)).toBeInTheDocument();
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
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
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

  it('collapses the hidden Create panels to zero height while the card is shown', async () => {
    const user = userEvent.setup();
    mockedIngestUrl.mockReset();
    mockedIngestUrl.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'url', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
    });
    render(<App />);

    await user.type(screen.getByLabelText(/recipe url/i), 'https://example.org/r');
    await user.click(screen.getByRole('button', { name: /extract recipe/i }));
    await screen.findByLabelText(/title/i);

    await user.click(screen.getByRole('button', { name: /preview card/i }));

    // Hidden panels must not extend the page's scrollable height - the card
    // view should be the only thing occupying vertical space.
    const reviewPanel = screen.getByRole('heading', { name: /^review$/i }).closest('section');
    expect(reviewPanel).toHaveStyle({ height: '0px', overflow: 'hidden' });
  });
});

describe('Open in Create', () => {
  it('shows Save changes and Save as new for a recipe opened from the Library', async () => {
    const user = userEvent.setup();
    vi.mocked(listRecipes).mockResolvedValueOnce({
      ok: true,
      value: {
        recipes: [
          {
            id: 'id-1',
            title: 'Test Recipe',
            tags: [],
            main_image: '/images/placeholder.png',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            owner: 'alice',
            time: 30,
            source_type: 'url',
          },
        ],
      },
    });
    vi.mocked(getRecipe).mockResolvedValueOnce({
      ok: true,
      value: {
        recipe: RECIPE,
        meta: { id: 'id-1', owner: 'alice', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      },
    });
    render(<App />);

    await user.click(screen.getByRole('button', { name: /library/i }));
    await user.click(await screen.findByRole('button', { name: 'View Test Recipe' }));
    await user.click(await screen.findByRole('button', { name: /open in create/i }));

    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as new' })).toBeInTheDocument();
  });

  describe('capture mode', () => {
    const PLACEHOLDER = '/images/placeholder-recipe.png';
    const captureValue = {
      recipe: { ...RECIPE, main_image: PLACEHOLDER },
      diagnostics: { extractor: 'capture', model: 'gemini', durationMs: 1 },
      imageNamespaceId: 'ns-cap',
      unhosted: [{ slot: 'main' as const, url: 'https://img/a.jpg', warning: 'Main image was not re-hosted: blocked' }],
    };

    function setup(requestRelay: () => Promise<Blob | null>) {
      window.history.replaceState(null, '', '/capture');
      vi.mocked(useCaptureHandoff).mockReturnValue({
        state: { phase: 'received', payload: { url: 'https://example.com/r', html: '<html></html>' } },
        requestRelay,
      });
      vi.mocked(ingestCapture).mockResolvedValue({ ok: true, value: captureValue });
    }

    afterEach(() => {
      window.history.replaceState(null, '', '/');
      vi.mocked(useCaptureHandoff).mockReturnValue({ state: { phase: 'off' }, requestRelay: vi.fn() });
    });

    it('enters capture mode on /capture and relays unhosted images after extraction', async () => {
      const blob = new Blob(['x'], { type: 'image/jpeg' });
      setup(() => Promise.resolve(blob));
      vi.mocked(uploadImage).mockResolvedValue({ ok: true, value: { url: '/images/ns-cap/main.jpg' } });
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Extract recipe' }));

      await waitFor(() => expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument());
      expect(uploadImage).toHaveBeenCalledWith('ns-cap', 'main', blob);
      expect(screen.getByAltText(/main/i)).toHaveAttribute('src', '/images/ns-cap/main.jpg');
      expect(screen.queryByText('Unsaved changes', { selector: '.workspace-status' })).not.toBeInTheDocument();
    });

    it('relay never overwrites a slot the user already filled', async () => {
      let release!: (b: Blob) => void;
      setup(() => new Promise<Blob>((r) => { release = r; }));
      vi.mocked(uploadImage).mockResolvedValue({ ok: true, value: { url: '/images/relayed.jpg' } });
      vi.mocked(linkImage).mockResolvedValue({ ok: true, value: { url: '/images/user.jpg' } });
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Extract recipe' }));
      const region = await screen.findByRole('region', { name: 'Add main image' });
      await userEvent.click(within(region).getByRole('button', { name: 'Link' }));
      await userEvent.type(within(region).getByLabelText('Image URL'), 'https://example.com/u.jpg');
      await userEvent.click(within(region).getByRole('button', { name: 'Use link' }));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument());

      release(new Blob(['x'], { type: 'image/jpeg' }));
      await waitFor(() => expect(uploadImage).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 0));

      expect(screen.getByAltText(/main/i)).toHaveAttribute('src', '/images/user.jpg');
    });

    it('marks the recipe dirty when a relayed image lands after Save', async () => {
      let release!: (b: Blob) => void;
      setup(() => new Promise<Blob>((r) => { release = r; }));
      const valid = {
        ...captureValue.recipe,
        ingredients: [{ name: 'Noodles', amount_text: '200g' }],
      };
      vi.mocked(ingestCapture).mockResolvedValue({ ok: true, value: { ...captureValue, recipe: valid } });
      vi.mocked(saveRecipe).mockResolvedValue({ ok: true, value: { id: 'saved-1' } });
      vi.mocked(uploadImage).mockResolvedValue({ ok: true, value: { url: '/images/relayed.jpg' } });
      render(<App />);

      await userEvent.click(screen.getByRole('button', { name: 'Extract recipe' }));
      await userEvent.click(await screen.findByRole('button', { name: /save recipe/i }));
      await waitFor(() => expect(saveRecipe).toHaveBeenCalled());
      expect((await screen.findAllByText('Saved')).length).toBeGreaterThan(0);

      release(new Blob(['x'], { type: 'image/jpeg' }));

      await waitFor(() => expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0));
      expect(screen.getByAltText(/main/i)).toHaveAttribute('src', '/images/relayed.jpg');
    });
  });

  it('opens Setup from the header and returns on Back', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('link', { name: 'Setup' }));
    expect(window.location.pathname).toBe('/setup');
    expect(screen.getByRole('heading', { name: 'Why this exists' })).toBeVisible();

    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Input' })).toBeVisible());
    expect(screen.queryByRole('heading', { name: 'Why this exists' })).not.toBeInTheDocument();
  });

  it('shows Setup when loaded at /setup', () => {
    window.history.pushState({}, '', '/setup');
    try {
      render(<App />);
      expect(screen.getByRole('heading', { name: 'Why this exists' })).toBeVisible();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });
});
