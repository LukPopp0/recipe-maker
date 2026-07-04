import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TAG_VOCABULARY } from 'shared';
import { TagEditor } from './TagEditor.tsx';

// Stateful harness mirroring how ReviewPanel threads onChange back into props.
function Harness({
  initial,
  onChange,
}: {
  initial: string[]
  onChange: (tags: string[]) => void
}) {
  const [tags, setTags] = useState(initial);
  return (
    <TagEditor
      tags={tags}
      onChange={(next) => {
        setTags(next);
        onChange(next);
      }}
    />
  );
}

describe('TagEditor', () => {
  it('renders all TAG_VOCABULARY entries as toggle chips', () => {
    render(<TagEditor tags={[]} onChange={vi.fn()} />);
    for (const tag of TAG_VOCABULARY) {
      expect(screen.getByRole('button', { name: tag })).toBeInTheDocument();
    }
  });

  it('clicking a vocabulary chip adds the tag', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Quick' }));

    expect(onChange).toHaveBeenLastCalledWith(['Quick']);
  });

  it('marks an applied vocabulary chip as pressed', () => {
    render(<TagEditor tags={['Quick']} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Quick' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Spicy' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking an applied vocabulary chip removes it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={['Quick']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Quick' }));

    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('clicking an applied chip remove control removes the tag', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={['Quick', 'Spicy']} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /remove tag quick/i }));

    expect(onChange).toHaveBeenLastCalledWith(['Spicy']);
  });

  it('adds a custom tag via input + Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText(/custom tag/i), 'Weeknight{Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['Weeknight']);
  });

  it('adds a custom tag via the Add button', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText(/custom tag/i), 'Weeknight');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onChange).toHaveBeenLastCalledWith(['Weeknight']);
  });

  it('clears the custom input after a successful add', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[]} onChange={vi.fn()} />);

    await user.type(screen.getByLabelText(/custom tag/i), 'Weeknight{Enter}');

    expect(screen.getByLabelText(/custom tag/i)).toHaveValue('');
  });

  it('rejects a case-insensitive duplicate custom tag with a hint', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={['Quick']} onChange={onChange} />);

    await user.type(screen.getByLabelText(/custom tag/i), 'quick{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/already/i)).toBeInTheDocument();
  });

  it('rejects an empty custom tag with a hint and does not call onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/1-40 characters/i)).toBeInTheDocument();
  });

  it('rejects a 41-character custom tag with a hint and does not call onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText(/custom tag/i), 'a'.repeat(41));
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/1-40 characters/i)).toBeInTheDocument();
  });

  it('trims whitespace from a custom tag before adding', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);

    await user.type(screen.getByLabelText(/custom tag/i), '  Weeknight  {Enter}');

    expect(onChange).toHaveBeenLastCalledWith(['Weeknight']);
  });

  it('shows the 5 tag maximum hint and disables unapplied vocab chips and the custom input at 5 tags', () => {
    const fiveTags = ['Quick', 'Spicy', 'Exotic', 'Vegetarian', 'Dessert'];
    render(<TagEditor tags={fiveTags} onChange={vi.fn()} />);

    expect(screen.getByText(/5 tag maximum/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High Protein' })).toBeDisabled();
    expect(screen.getByLabelText(/custom tag/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /^add$/i })).toBeDisabled();
  });

  it('does not disable applied vocab chips at 5 tags, so removal is still possible', async () => {
    const user = userEvent.setup();
    const fiveTags = ['Quick', 'Spicy', 'Exotic', 'Vegetarian', 'Dessert'];
    const onChange = vi.fn();
    render(<TagEditor tags={fiveTags} onChange={onChange} />);

    const quickChip = screen.getByRole('button', { name: 'Quick' });
    expect(quickChip).not.toBeDisabled();

    await user.click(quickChip);

    expect(onChange).toHaveBeenLastCalledWith(['Spicy', 'Exotic', 'Vegetarian', 'Dessert']);
  });

  it('cannot add a 6th tag by clicking a disabled vocab chip', async () => {
    const user = userEvent.setup();
    const fiveTags = ['Quick', 'Spicy', 'Exotic', 'Vegetarian', 'Dessert'];
    const onChange = vi.fn();
    render(<TagEditor tags={fiveTags} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'High Protein' }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('onChange always receives a fresh array, never mutating the tags prop', async () => {
    const user = userEvent.setup();
    const tags = ['Quick'];
    const before = [...tags];
    render(<TagEditor tags={tags} onChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Spicy' }));

    expect(tags).toEqual(before);
  });
});
