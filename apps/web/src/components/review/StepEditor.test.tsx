import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Step } from 'shared';
import { StepEditor } from './StepEditor.tsx';
import { uploadImage } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  uploadImage: vi.fn(),
  linkImage: vi.fn(),
}));

const mockedUploadImage = vi.mocked(uploadImage);

const STEPS: Step[] = [
  { step_header: 'Prep', step_description: 'Chop the onions.' },
  { step_header: 'Cook', step_description: 'Fry until golden.', image: 'step-2.png' },
];

const NAMESPACE = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
  mockedUploadImage.mockReset();
});

// Stateful harness mirroring how ReviewPanel actually threads onChange back
// into props - StepEditor is a controlled component.
function Harness({ initial, onChange }: { initial: Step[]; onChange: (steps: Step[]) => void }) {
  const [steps, setSteps] = useState(initial);
  return (
    <StepEditor
      steps={steps}
      onChange={(next) => {
        setSteps(next);
        onChange(next);
      }}
    />
  );
}

describe('StepEditor', () => {
  it('renders one block per step with header and description', () => {
    render(<StepEditor steps={STEPS} onChange={vi.fn()} />);

    expect(screen.getByDisplayValue('Prep')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Chop the onions.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Cook')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fry until golden.')).toBeInTheDocument();
  });

  it('shows a thumbnail only for steps with an image, and no image control without a namespace', () => {
    render(<StepEditor steps={STEPS} onChange={vi.fn()} />);

    const thumbs = screen.getAllByTestId('step-image-thumb');
    expect(thumbs).toHaveLength(1);
    expect(thumbs[0]).toHaveAttribute('src', 'step-2.png');
    expect(screen.queryAllByRole('group', { name: /step \d image/i })).toHaveLength(0);
  });

  it('renders an image control per step when a namespace is provided', () => {
    render(<StepEditor steps={STEPS} onChange={vi.fn()} imageNamespaceId={NAMESPACE} />);

    expect(screen.getByRole('group', { name: 'Step 1 image' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Step 2 image' })).toBeInTheDocument();
  });

  it('reports image changes through onImageChange', async () => {
    const user = userEvent.setup();
    const onImageChange = vi.fn();
    mockedUploadImage.mockResolvedValue({ ok: true, value: { url: '/images/recipes/x/step-0.jpg' } });
    render(<StepEditor steps={STEPS} onChange={vi.fn()} onImageChange={onImageChange} imageNamespaceId={NAMESPACE} />);

    const group = screen.getByRole('group', { name: 'Step 1 image' });
    const input = group.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'pan.png', { type: 'image/png' }));

    await vi.waitFor(() => expect(onImageChange).toHaveBeenCalledWith(0, '/images/recipes/x/step-0.jpg'));
    expect(mockedUploadImage.mock.calls[0][0]).toBe(NAMESPACE);
    expect(mockedUploadImage.mock.calls[0][1]).toBe(0);
  });

  it('removes a step image through onImageChange(index, null)', async () => {
    const user = userEvent.setup();
    const onImageChange = vi.fn();
    render(<StepEditor steps={STEPS} onChange={vi.fn()} onImageChange={onImageChange} imageNamespaceId={NAMESPACE} />);

    const group = screen.getByRole('group', { name: 'Step 2 image' });
    await user.click(within(group).getByRole('button', { name: /remove/i }));

    expect(onImageChange).toHaveBeenCalledWith(1, null);
  });

  it('editing step_header/step_description calls onChange with a patched, non-mutated array', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness initial={STEPS} onChange={onChange} />);

    const headerInputs = screen.getAllByLabelText(/step header/i);
    await user.clear(headerInputs[0]);
    await user.type(headerInputs[0], 'Prep it');

    expect(onChange).toHaveBeenLastCalledWith([
      { step_header: 'Prep it', step_description: 'Chop the onions.' },
      { step_header: 'Cook', step_description: 'Fry until golden.', image: 'step-2.png' },
    ]);
    expect(STEPS[0]).toEqual({ step_header: 'Prep', step_description: 'Chop the onions.' });
  });

  it('has a maxlength of 600 on the description textarea and shows a live character count', () => {
    render(<StepEditor steps={STEPS} onChange={vi.fn()} />);

    const textareas = screen.getAllByLabelText(/step description/i);
    expect(textareas[0]).toHaveAttribute('maxlength', '600');
    expect(screen.getByText(/17\s*\/\s*600/)).toBeInTheDocument();
  });

  it('updates the character count live as the description is edited', async () => {
    const user = userEvent.setup();
    render(<Harness initial={[{ step_header: 'A', step_description: '' }]} onChange={vi.fn()} />);

    const textarea = screen.getByLabelText(/step description/i);
    await user.type(textarea, 'Hello');

    expect(screen.getByText(/5\s*\/\s*600/)).toBeInTheDocument();
  });

  it('adds a step (disabled at 6) with the max-6-steps hint shown when at the cap', () => {
    const sixSteps: Step[] = Array.from({ length: 6 }, (_, i) => ({
      step_header: `Step ${i + 1}`,
      step_description: 'Do it.',
    }));
    render(<StepEditor steps={sixSteps} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /add step/i })).toBeDisabled();
    expect(screen.getByText(/max 6 steps/i)).toBeInTheDocument();
  });

  it('enables add step and hides the hint below 6 steps', () => {
    render(<StepEditor steps={STEPS} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /add step/i })).toBeEnabled();
    expect(screen.queryByText(/max 6 steps/i)).not.toBeInTheDocument();
  });

  it('adding a step appends a blank step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepEditor steps={STEPS} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /add step/i }));

    expect(onChange).toHaveBeenLastCalledWith([...STEPS, { step_header: '', step_description: '' }]);
  });

  it('removing a step is disabled at 1 step', () => {
    render(<StepEditor steps={[STEPS[0]]} onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: /remove step/i })).toBeDisabled();
  });

  it('removes a step above the 1-step floor', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<StepEditor steps={STEPS} onChange={onChange} />);

    const removeButtons = screen.getAllByRole('button', { name: /remove step/i });
    await user.click(removeButtons[0]);

    expect(onChange).toHaveBeenLastCalledWith([STEPS[1]]);
  });
});
