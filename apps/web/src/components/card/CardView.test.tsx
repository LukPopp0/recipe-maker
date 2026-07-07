import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CanonicalRecipe } from 'shared';
import { CardView } from './CardView.tsx';

const RECIPE: CanonicalRecipe = {
  title: 'Korean Beef Bowls',
  tags: ['Spicy'],
  time: 15,
  ingredients: [{ name: 'Ground Beef', amount_text: '250 g' }],
  pantry_items: ['salt'],
  main_image: '/images/main.png',
  steps: [{ step_header: 'Cook', step_description: 'Cook the ground beef.' }],
  metadata: { source_type: 'url', language: 'en', warnings: [] },
};

describe('CardView', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders both card pages with page labels', () => {
    render(<CardView recipe={RECIPE} onBack={vi.fn()} />);
    expect(screen.getByLabelText('Recipe card page 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Recipe card page 2')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 2')).toBeInTheDocument();
  });

  it('fires onBack from the Back button', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<CardView recipe={RECIPE} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalled();
  });

  it('calls window.print from the print button', async () => {
    const user = userEvent.setup();
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    render(<CardView recipe={RECIPE} onBack={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /print/i }));
    expect(printSpy).toHaveBeenCalled();
  });
});
