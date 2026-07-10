import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { ActionTray } from './ActionTray.tsx';
import { saveRecipe } from '../api/client.ts';
import type { WorkspaceRecipeState } from '../workspace-types.ts';

vi.mock('../api/client.ts', async () => {
  const actual = await vi.importActual<typeof import('../api/client.ts')>('../api/client.ts');
  return { ...actual, saveRecipe: vi.fn() };
});

const mockedSaveRecipe = vi.mocked(saveRecipe);

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

function stateFor(recipe: CanonicalRecipe, overrides: Partial<{ savedId: string | null; dirty: boolean }> = {}): WorkspaceRecipeState {
  return { recipe, diagnostics: null, savedId: null, dirty: false, ...overrides };
}

function renderTray(
  recipeState: WorkspaceRecipeState,
  overrides: Partial<{ visible: boolean; onSaved: () => void; onPreviewCard: () => void }> = {},
) {
  const onSaved = vi.fn();
  const onPreviewCard = vi.fn();
  const props = { recipeState, visible: true, onSaved, onPreviewCard, ...overrides };
  const view = render(<ActionTray {...props} />);
  return { ...view, onSaved: props.onSaved, onPreviewCard: props.onPreviewCard };
}

describe('ActionTray', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no recipe is loaded', () => {
    renderTray(null);
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
  });

  it('renders nothing when not visible (Library or card preview showing)', () => {
    renderTray(stateFor(RECIPE), { visible: false });
    expect(screen.queryByRole('button', { name: /save recipe/i })).not.toBeInTheDocument();
  });

  it('saves the exact current recipe and shows the returned id on success', async () => {
    const user = userEvent.setup();
    mockedSaveRecipe.mockResolvedValueOnce({ ok: true, value: { id: 'recipe-123' } });
    const { onSaved } = renderTray(stateFor(RECIPE));

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(mockedSaveRecipe).toHaveBeenCalledWith(RECIPE);
    expect(await screen.findByText(/saved.*recipe-123/i)).toBeInTheDocument();
    expect(onSaved).toHaveBeenCalledWith('recipe-123');
  });

  it('blocks save on an invalid recipe without calling saveRecipe', async () => {
    const user = userEvent.setup();
    renderTray(stateFor(INVALID_RECIPE));

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
    renderTray(stateFor(RECIPE));

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
    renderTray(stateFor(RECIPE));

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
    renderTray(stateFor(RECIPE));

    await user.click(screen.getByRole('button', { name: /save recipe/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on the server.')).toBeInTheDocument();
  });

  it('never calls saveRecipe automatically on mount or recipe changes', () => {
    const { rerender } = render(
      <ActionTray recipeState={stateFor(RECIPE)} visible onSaved={vi.fn()} onPreviewCard={vi.fn()} />,
    );
    rerender(
      <ActionTray
        recipeState={stateFor({ ...RECIPE, title: 'Changed' }, { dirty: true })}
        visible
        onSaved={vi.fn()}
        onPreviewCard={vi.fn()}
      />,
    );

    expect(mockedSaveRecipe).not.toHaveBeenCalled();
  });

  it('shows an unsaved-changes note when dirty and not yet saved', () => {
    renderTray(stateFor(RECIPE, { dirty: true, savedId: null }));
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('does not show the unsaved-changes note once saved', () => {
    renderTray(stateFor(RECIPE, { dirty: false, savedId: 'recipe-123' }));
    expect(screen.queryByText(/unsaved changes/i)).not.toBeInTheDocument();
  });

  it('calls onPreviewCard for a valid recipe', async () => {
    const user = userEvent.setup();
    const { onPreviewCard } = renderTray(stateFor(RECIPE));
    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(onPreviewCard).toHaveBeenCalled();
  });

  it('blocks preview and shows validation errors for an invalid recipe', async () => {
    const user = userEvent.setup();
    const { onPreviewCard } = renderTray(stateFor(INVALID_RECIPE));
    await user.click(screen.getByRole('button', { name: /preview card/i }));
    expect(onPreviewCard).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument(); // FieldErrors container
  });
});
