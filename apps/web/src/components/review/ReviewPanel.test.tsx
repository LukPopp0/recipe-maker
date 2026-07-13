import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import type { IngestDiagnostics } from '../../api/client.ts';
import { ReviewPanel } from './ReviewPanel.tsx';

// Stateful harness mirroring how App.tsx actually threads onChange back into
// props - needed for multi-keystroke interactions on a controlled input.
function Harness({
  initial,
  onChange,
}: {
  initial: CanonicalRecipe
  onChange: (recipe: CanonicalRecipe) => void
}) {
  const [recipe, setRecipe] = useState(initial);
  return (
    <ReviewPanel
      recipe={recipe}
      diagnostics={null}
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
