import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import type { IngestDiagnostics } from '../../api/client.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { uploadImage } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  uploadImage: vi.fn(),
  linkImage: vi.fn(),
}));

const mockedUploadImage = vi.mocked(uploadImage);

// Stateful harness mirroring how App.tsx actually threads onChange back into
// props - needed for multi-keystroke interactions on a controlled input.
function Harness({
  initial,
  onChange,
  imageNamespaceId,
  placeholderImageUrl,
}: {
  initial: CanonicalRecipe
  onChange: (recipe: CanonicalRecipe) => void
  imageNamespaceId?: string
  placeholderImageUrl?: string
}) {
  const [recipe, setRecipe] = useState(initial);
  return (
    <ReviewPanel
      recipe={recipe}
      diagnostics={null}
      imageNamespaceId={imageNamespaceId}
      placeholderImageUrl={placeholderImageUrl}
      onChange={(next) => {
        setRecipe(next);
        onChange(next);
      }}
    />
  );
}

const RECIPE: CanonicalRecipe = {
  title: 'Spaghetti',
  tags: ['pasta'],
  time: 30,
  ingredients: [{ name: 'Pasta', amount_text: '200 g' }],
  pantry_items: ['Salt', 'Pepper'],
  main_image: '/images/spaghetti.png',
  steps: [{ step_header: 'Boil', step_description: 'Boil the pasta.' }],
  metadata: { source_type: 'manual', language: 'en', warnings: ['Time estimate is a guess.'] },
};

const DIAGNOSTICS: IngestDiagnostics = { extractor: 'manual', model: 'gemini-2.5', durationMs: 1234 };

describe('ReviewPanel', () => {
  it('renders title and time with the current values', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/title/i)).toHaveValue('Spaghetti');
    expect(screen.getByLabelText(/time/i)).toHaveValue(30);
  });

  it('editing the title calls onChange with a patched recipe and does not mutate the original', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    await user.type(screen.getByLabelText(/title/i), '!');

    expect(onChange).toHaveBeenLastCalledWith({ ...RECIPE, title: 'Spaghetti!' });
    expect(RECIPE.title).toBe('Spaghetti');
  });

  it('has a maxlength of 140 on the title input', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/title/i)).toHaveAttribute('maxlength', '140');
  });

  it('clearing the time input calls onChange with time: null', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    await user.clear(screen.getByLabelText(/time/i));

    expect(onChange).toHaveBeenLastCalledWith({ ...RECIPE, time: null });
  });

  it('typing a new integer into time calls onChange with that integer', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={RECIPE} onChange={onChange} />);

    await user.clear(screen.getByLabelText(/time/i));
    await user.type(screen.getByLabelText(/time/i), '45');

    expect(onChange).toHaveBeenLastCalledWith({ ...RECIPE, time: 45 });
  });

  it('a non-numeric change to the time input calls onChange with time: null, never NaN', () => {
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    // '.5' is a value jsdom's type=number sanitizer accepts as-is (leading
    // dot, no digit before it), but parseInt('.5', 10) is NaN.
    fireEvent.change(screen.getByLabelText(/time/i), { target: { value: '.5' } });

    expect(onChange).toHaveBeenLastCalledWith({ ...RECIPE, time: null });
  });

  it('renders pantry items read-only with no inputs', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={vi.fn()} />);

    expect(screen.getByText('Salt')).toBeInTheDocument();
    expect(screen.getByText('Pepper')).toBeInTheDocument();
    expect(screen.getByText(/derived from the fixed pantry allowlist/i)).toBeInTheDocument();
    // No editable controls in the pantry section.
    const pantrySection = screen.getByTestId('pantry-section');
    expect(pantrySection.querySelectorAll('input, textarea, button')).toHaveLength(0);
  });

  it('editing an ingredient field routes through onChange to a patched recipe', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    await user.type(screen.getByLabelText(/ingredient name/i), 'X');

    expect(onChange).toHaveBeenLastCalledWith({
      ...RECIPE,
      ingredients: [{ name: 'PastaX', amount_text: '200 g' }],
    });
  });

  it('editing a step field routes through onChange to a patched recipe', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    await user.type(screen.getByLabelText(/step header/i), '!');

    expect(onChange).toHaveBeenLastCalledWith({
      ...RECIPE,
      steps: [{ step_header: 'Boil!', step_description: 'Boil the pasta.' }],
    });
  });

  it('renders WarningsPanel warnings from recipe.metadata.warnings', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={vi.fn()} />);
    expect(screen.getByText('Time estimate is a guess.')).toBeInTheDocument();
  });

  it('hides warnings entirely when there are none', () => {
    const noWarnings = { ...RECIPE, metadata: { ...RECIPE.metadata, warnings: [] } };
    render(<ReviewPanel recipe={noWarnings} diagnostics={null} onChange={vi.fn()} />);
    expect(screen.queryByText(/guess/i)).not.toBeInTheDocument();
  });

  it('shows a diagnostics line with extractor/model/durationMs when diagnostics is present', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={DIAGNOSTICS} onChange={vi.fn()} />);

    expect(screen.getByText(/manual/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini-2\.5/)).toBeInTheDocument();
    expect(screen.getByText(/1234/)).toBeInTheDocument();
  });

  it('shows no diagnostics line when diagnostics is null', () => {
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={vi.fn()} />);
    expect(screen.queryByTestId('review-diagnostics')).not.toBeInTheDocument();
  });

  it('never mutates the original recipe object across an ingredient add/remove cycle', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const before = JSON.parse(JSON.stringify(RECIPE));
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /add ingredient/i }));

    expect(RECIPE).toEqual(before);
  });

  it('copies a one-shot image prompt with the dish name and every step description', async () => {
    // fireEvent instead of userEvent: userEvent installs its own clipboard
    // stub, which would shadow this spy.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const recipe: CanonicalRecipe = {
      ...RECIPE,
      steps: [
        { step_header: 'Boil', step_description: 'Boil the pasta.' },
        { step_header: 'Sauce', step_description: 'Simmer the sauce.' },
      ],
    };
    render(<ReviewPanel recipe={recipe} diagnostics={null} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /copy step image generation prompt/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const prompt = writeText.mock.calls[0][0] as string;
    expect(prompt).toContain('"Spaghetti"');
    expect(prompt).toContain('<steps>');
    expect(prompt).toContain('<step-1>\n  1. Boil the pasta.\n</step-1>');
    expect(prompt).toContain('<step-2>\n  2. Simmer the sauce.\n</step-2>');
    // Generation instruction with an explicit count comes AFTER the steps -
    // leading with it makes the model produce a single image.
    expect(prompt.indexOf('</steps>')).toBeLessThan(prompt.indexOf('generate one photorealistic'));
    expect(prompt).toContain('There should be 2 separate images.');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
  });
});

describe('main image and step image controls', () => {
  const PLACEHOLDER_RECIPE = { ...RECIPE, main_image: '/images/placeholder-recipe.png' };

  it('shows the Add main image prompt when main_image is the placeholder', () => {
    render(<ReviewPanel recipe={PLACEHOLDER_RECIPE} diagnostics={null} onChange={vi.fn()} imageNamespaceId="ns" />);

    expect(screen.getByRole('region', { name: 'Add main image' })).toBeVisible();
    expect(screen.getByText('Recipes are picked by their photo. Paste, link or upload one.')).toBeVisible();
  });

  it('uses the placeholder URL passed in from /api/me', () => {
    const url = 'https://cdn.x/p.png';
    render(
      <ReviewPanel
        recipe={{ ...RECIPE, main_image: url }}
        diagnostics={null}
        onChange={vi.fn()}
        imageNamespaceId="ns"
        placeholderImageUrl={url}
      />,
    );

    expect(screen.getByRole('region', { name: 'Add main image' })).toBeVisible();
  });

  it('shows no prompt for a remote main_image from Load JSON', () => {
    render(
      <ReviewPanel
        recipe={{ ...RECIPE, main_image: 'https://example.com/pic.jpg' }}
        diagnostics={null}
        onChange={vi.fn()}
        imageNamespaceId="ns"
      />,
    );

    expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Main image' })).toBeInTheDocument();
  });

  it('hides the prompt and clears main-image warnings once an image is set', async () => {
    const recipe = {
      ...PLACEHOLDER_RECIPE,
      metadata: { ...RECIPE.metadata, warnings: ['Main image was not re-hosted: blocked', 'Keep me'] },
    };
    const onChange = vi.fn();
    render(<ReviewPanel recipe={recipe} diagnostics={null} onChange={onChange} imageNamespaceId="ns" />);

    const group = screen.getByRole('group', { name: 'Main image' });
    const input = group.querySelector('input[type="file"]') as HTMLInputElement;
    mockedUploadImage.mockResolvedValue({ ok: true, value: { url: '/images/recipes/ns/main-0-x.jpg' } });
    await userEvent.setup().upload(input, new File(['x'], 'm.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as CanonicalRecipe;
    expect(next.main_image).toBe('/images/recipes/ns/main-0-x.jpg');
    expect(next.metadata.warnings).toEqual(['Keep me']);
  });

  it('clears a capture unhosted warning for the slot', async () => {
    const warning = '"main.heic" was not uploaded: x';
    const recipe = { ...PLACEHOLDER_RECIPE, metadata: { ...RECIPE.metadata, warnings: [warning] } };
    const onChange = vi.fn();
    render(
      <ReviewPanel
        recipe={recipe}
        diagnostics={null}
        onChange={onChange}
        imageNamespaceId="ns"
        unhosted={[{ slot: 'main', url: 'https://e.com/main.heic', warning }]}
      />,
    );

    const input = screen.getByRole('group', { name: 'Main image' }).querySelector('input[type="file"]') as HTMLInputElement;
    mockedUploadImage.mockResolvedValue({ ok: true, value: { url: '/images/recipes/ns/main-0-x.jpg' } });
    await userEvent.setup().upload(input, new File(['x'], 'm.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((onChange.mock.calls[0][0] as CanonicalRecipe).metadata.warnings).toEqual([]);
  });

  it('sets a step image through setSlotImage', async () => {
    const onChange = vi.fn();
    render(<ReviewPanel recipe={RECIPE} diagnostics={null} onChange={onChange} imageNamespaceId="ns" />);

    const input = screen.getByRole('group', { name: 'Step 1 image' }).querySelector('input[type="file"]') as HTMLInputElement;
    mockedUploadImage.mockResolvedValue({ ok: true, value: { url: '/images/recipes/ns/step-0-x.jpg' } });
    await userEvent.setup().upload(input, new File(['x'], 's.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect((onChange.mock.calls[0][0] as CanonicalRecipe).steps[0].image).toBe('/images/recipes/ns/step-0-x.jpg');
  });

  it('keeps both step images when two uploads overlap', async () => {
    const resolvers: Array<(value: { ok: true; value: { url: string } }) => void> = [];
    mockedUploadImage.mockReset();
    mockedUploadImage.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const onChange = vi.fn();
    const twoSteps = {
      ...RECIPE,
      steps: [
        { step_header: 'A', step_description: 'a' },
        { step_header: 'B', step_description: 'b' },
      ],
    };
    render(<Harness initial={twoSteps} onChange={onChange} imageNamespaceId="ns" />);
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });

    fireEvent.paste(screen.getByRole('group', { name: 'Step 1 image' }), { clipboardData: { files: [file], items: [] } });
    fireEvent.paste(screen.getByRole('group', { name: 'Step 2 image' }), { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    resolvers[0]({ ok: true, value: { url: '/s1.jpg' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    resolvers[1]({ ok: true, value: { url: '/s2.jpg' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));

    const last = onChange.mock.lastCall?.[0] as CanonicalRecipe;
    expect(last.steps[0].image).toBe('/s1.jpg');
    expect(last.steps[1].image).toBe('/s2.jpg');
  });

  it('keeps an edit made while an upload is pending', async () => {
    let resolveUpload: (value: { ok: true; value: { url: string } }) => void = () => {};
    mockedUploadImage.mockReset();
    mockedUploadImage.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve; }));
    const onChange = vi.fn();
    render(<Harness initial={RECIPE} onChange={onChange} imageNamespaceId="ns" />);
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });

    fireEvent.paste(screen.getByRole('group', { name: 'Step 1 image' }), { clipboardData: { files: [file], items: [] } });
    await waitFor(() => expect(mockedUploadImage).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Carbonara' } });
    resolveUpload({ ok: true, value: { url: '/s1.jpg' } });
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));

    const last = onChange.mock.lastCall?.[0] as CanonicalRecipe;
    expect(last.title).toBe('Carbonara');
    expect(last.steps[0].image).toBe('/s1.jpg');
    expect(screen.getByLabelText(/title/i)).toHaveValue('Carbonara');
  });

  it('keeps the main image control (and its focus) when an upload clears the prompt', async () => {
    mockedUploadImage.mockReset();
    mockedUploadImage.mockResolvedValue({ ok: true, value: { url: '/images/recipes/ns/main-0-x.jpg' } });
    render(<Harness initial={PLACEHOLDER_RECIPE} onChange={vi.fn()} imageNamespaceId="ns" />);

    const group = screen.getByRole('group', { name: 'Main image' });
    group.focus();
    const input = group.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'm.png', { type: 'image/png' })] } });

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Main image' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Main image' })).toBe(group);
    expect(group).toHaveFocus();
  });

  it('Remove on the main image restores the placeholder and shows the prompt again', async () => {
    const placeholder = 'https://cdn.x/p.png';
    const onChange = vi.fn();
    render(
      <Harness initial={RECIPE} onChange={onChange} imageNamespaceId="ns" placeholderImageUrl={placeholder} />,
    );
    expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument();

    const group = screen.getByRole('group', { name: 'Main image' });
    await userEvent.setup().click(within(group).getByRole('button', { name: 'Remove' }));

    expect((onChange.mock.lastCall?.[0] as CanonicalRecipe).main_image).toBe(placeholder);
    expect(screen.getByRole('region', { name: 'Add main image' })).toBeVisible();
  });

  it('shows no image controls in read-only mode', () => {
    render(<ReviewPanel recipe={PLACEHOLDER_RECIPE} diagnostics={null} readOnly imageNamespaceId="ns" />);

    expect(screen.queryByRole('region', { name: 'Add main image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
});

describe('readOnly mode', () => {
  const recipe: CanonicalRecipe = {
    title: 'Static Soup',
    tags: ['dinner'],
    time: 25,
    ingredients: [{ name: 'Carrot', amount_text: '2', unit: 'pcs', image: 'carrot.png' }],
    pantry_items: ['salt'],
    main_image: '/images/main.png',
    steps: [{ step_header: 'Chop', step_description: 'Chop the carrot.' }],
    metadata: { source_type: 'url', language: 'en', warnings: ['a warning'] },
  };

  it('renders no textboxes, spinbuttons, or buttons', () => {
    render(<ReviewPanel recipe={recipe} diagnostics={null} readOnly />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders all field values as static text', () => {
    render(<ReviewPanel recipe={recipe} diagnostics={null} readOnly />);
    expect(screen.getByText('Static Soup')).toBeInTheDocument();
    expect(screen.getByText(/25/)).toBeInTheDocument();
    expect(screen.getByText('dinner')).toBeInTheDocument();
    expect(screen.getByText('Carrot')).toBeInTheDocument();
    expect(screen.getByText('Chop')).toBeInTheDocument();
    expect(screen.getByText('Chop the carrot.')).toBeInTheDocument();
    expect(screen.getByText('salt')).toBeInTheDocument();
    expect(screen.getByText('a warning')).toBeInTheDocument();
  });
});
