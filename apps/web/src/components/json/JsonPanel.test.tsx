import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { JsonPanel } from './JsonPanel.tsx';
import { saveRecipe } from '../../api/client.ts';
import { buildRecipeFilename, downloadJson } from '../../lib/download.ts';

vi.mock('../../api/client.ts', async () => {
  const actual = await vi.importActual<typeof import('../../api/client.ts')>('../../api/client.ts');
  return { ...actual, saveRecipe: vi.fn() };
});

vi.mock('../../lib/download.ts', async () => {
  const actual = await vi.importActual<typeof import('../../lib/download.ts')>('../../lib/download.ts');
  return { ...actual, downloadJson: vi.fn() };
});

const mockedSaveRecipe = vi.mocked(saveRecipe);
const mockedDownloadJson = vi.mocked(downloadJson);

const RECIPE: CanonicalRecipe = {
  title: 'Spicy Noodles',
  tags: ['easy'],
  time: 30,
  ingredients: [{ name: 'Noodles', amount_text: '200g' }],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Boil', step_description: 'Boil the noodles.' }],
  metadata: { source_type: 'url', source_url: 'https://example.com/recipe', language: 'en', warnings: [] },
};

const INVALID_RECIPE: CanonicalRecipe = { ...RECIPE, title: '' };

function renderPanel(overrides: Partial<{ recipe: CanonicalRecipe; savedId: string | null; dirty: boolean }> = {}) {
  const onSaved = vi.fn();
  const props = {
    recipe: RECIPE,
    savedId: null as string | null,
    dirty: false,
    onSaved,
    ...overrides,
  };
  const view = render(<JsonPanel {...props} />);
  return { ...view, onSaved, props };
}

describe('JsonPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the pretty-printed JSON of the current recipe', () => {
    renderPanel();
    expect(screen.getByText(/"Spicy Noodles"/)).toBeInTheDocument();
  });

  it('reflects live edits when the recipe prop changes', () => {
    const { rerender } = render(
      <JsonPanel recipe={RECIPE} savedId={null} dirty={false} onSaved={vi.fn()} />,
    );
    expect(screen.getByText(/"Spicy Noodles"/)).toBeInTheDocument();

    const changed = { ...RECIPE, title: 'Mild Noodles' };
    rerender(<JsonPanel recipe={changed} savedId={null} dirty={false} onSaved={vi.fn()} />);

    expect(screen.queryByText(/"Spicy Noodles"/)).not.toBeInTheDocument();
    expect(screen.getByText(/"Mild Noodles"/)).toBeInTheDocument();
  });

  it('copies the exact JSON string to the clipboard and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPanel();
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(RECIPE, null, 2));
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('shows a fallback message instead of throwing when navigator.clipboard is unavailable', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    });

    renderPanel();
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(await screen.findByText(/copy failed.*select the json text manually/i)).toBeInTheDocument();
    expect(screen.queryByText(/^copied$/i)).not.toBeInTheDocument();
  });

  it('shows a fallback message when navigator.clipboard.writeText rejects', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderPanel();
    await user.click(screen.getByRole('button', { name: /copy json/i }));

    expect(await screen.findByText(/copy failed.*select the json text manually/i)).toBeInTheDocument();
    expect(screen.queryByText(/^copied$/i)).not.toBeInTheDocument();
  });

  it('blocks download on an invalid recipe and shows the failing field, without calling downloadJson', async () => {
    const user = userEvent.setup();
    renderPanel({ recipe: INVALID_RECIPE });

    await user.click(screen.getByRole('button', { name: /download json/i }));

    expect(await screen.findByText(/too small/i)).toBeInTheDocument();
    expect(mockedDownloadJson).not.toHaveBeenCalled();
  });

  it('downloads the deterministic filename with the current recipe state when valid', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: /download json/i }));

    expect(mockedDownloadJson).toHaveBeenCalledTimes(1);
    expect(mockedDownloadJson).toHaveBeenCalledWith(buildRecipeFilename(RECIPE.title), RECIPE);
  });

  it('saves the exact current recipe and shows the returned id on success', async () => {
    const user = userEvent.setup();
    mockedSaveRecipe.mockResolvedValueOnce({ ok: true, value: { id: 'recipe-123' } });
    const { onSaved } = renderPanel();

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(mockedSaveRecipe).toHaveBeenCalledWith(RECIPE);
    expect(await screen.findByText(/saved.*recipe-123/i)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith('recipe-123');
  });

  it('blocks save on an invalid recipe without calling saveRecipe', async () => {
    const user = userEvent.setup();
    renderPanel({ recipe: INVALID_RECIPE });

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(await screen.findByText(/too small/i)).toBeInTheDocument();
    expect(mockedSaveRecipe).not.toHaveBeenCalled();
  });

  it('renders server-flattened field errors on a 422 save failure', async () => {
    const user = userEvent.setup();
    mockedSaveRecipe.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Validation failed',
        details: { issues: { formErrors: [], fieldErrors: { title: ['Title is required'] } } },
      },
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(await screen.findByText('Title is required')).toBeInTheDocument();
  });

  it('renders an ErrorBanner instead of throwing on malformed 422 details', async () => {
    const user = userEvent.setup();
    mockedSaveRecipe.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: 'Validation failed',
        details: { issues: { formErrors: [] } },
      },
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Validation failed')).toBeInTheDocument();
  });

  it('renders an ErrorBanner on a non-validation save failure', async () => {
    const user = userEvent.setup();
    mockedSaveRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
    });
    renderPanel();

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on the server.')).toBeInTheDocument();
  });

  it('never calls saveRecipe automatically on mount or recipe prop changes', () => {
    const { rerender } = render(<JsonPanel recipe={RECIPE} savedId={null} dirty={false} onSaved={vi.fn()} />);
    rerender(
      <JsonPanel recipe={{ ...RECIPE, title: 'Changed' }} savedId={null} dirty onSaved={vi.fn()} />,
    );

    expect(mockedSaveRecipe).not.toHaveBeenCalled();
  });

  it('shows an unsaved-changes note when dirty and not yet saved', () => {
    renderPanel({ dirty: true, savedId: null });
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('does not show the unsaved-changes note once saved', () => {
    renderPanel({ dirty: false, savedId: 'recipe-123' });
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });
});
