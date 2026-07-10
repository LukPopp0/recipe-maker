import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { CanonicalRecipe, Step } from 'shared';
import { CardPage2 } from './CardPage2.tsx';

function makeRecipe(steps: Step[], overrides: Partial<CanonicalRecipe> = {}): CanonicalRecipe {
  return {
    title: 'Korean Beef Bowls',
    tags: [],
    time: 15,
    ingredients: [{ name: 'potatoes', amount_text: '2' }],
    pantry_items: ['salt', 'pepper', 'oil'],
    main_image: '/images/main.png',
    steps,
    metadata: { source_type: 'url', language: 'en', warnings: [] },
    ...overrides,
  };
}

const STEP_WITH_IMAGE: Step = {
  step_header: 'Roast',
  step_description: 'Cut potatoes into rounds.',
  image: '/images/step-1.png',
};

const STEP_WITHOUT_IMAGE: Step = {
  step_header: 'Season',
  step_description: 'Season generously.',
};

describe('CardPage2', () => {
  it('renders the pantry banner with heading and joined items', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITHOUT_IMAGE])} />);
    expect(screen.getByText('Pantry Items')).toBeInTheDocument();
    expect(screen.getByText(/salt, pepper, oil/)).toBeInTheDocument();
  });

  it('hides the pantry banner when pantry_items is empty', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITHOUT_IMAGE], { pantry_items: [] })} />);
    expect(screen.queryByText('Pantry Items')).not.toBeInTheDocument();
  });

  it('numbers steps and renders image and text-only variants', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE, STEP_WITHOUT_IMAGE])} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByTestId('card-step-image')).toHaveAttribute('src', '/images/step-1.png');
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveClass('card-step-no-image');
    expect(items[1]).toHaveClass('card-step-no-image');
  });

  it('bolds ingredient mentions in step descriptions', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE])} />);
    const bolded = screen.getByText('potatoes');
    expect(bolded.tagName).toBe('STRONG');
  });

  it('degrades a step whose image fails to load to the text-only variant', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITH_IMAGE])} />);
    fireEvent.error(screen.getByTestId('card-step-image'));
    expect(screen.queryByTestId('card-step-image')).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).toHaveClass('card-step-no-image');
  });

  it('shows the source URL footer for a URL-ingested recipe', () => {
    const recipe = makeRecipe([STEP_WITHOUT_IMAGE], {
      metadata: {
        source_type: 'url',
        source_url: 'https://example.com/korean-beef-bowls',
        language: 'en',
        warnings: [],
      },
    });
    render(<CardPage2 recipe={recipe} />);
    expect(screen.getByText(/Source: https:\/\/example\.com\/korean-beef-bowls/)).toBeInTheDocument();
  });

  it('renders no source footer when source_url is absent (manual recipe)', () => {
    render(<CardPage2 recipe={makeRecipe([STEP_WITHOUT_IMAGE], { metadata: { source_type: 'manual', language: 'en', warnings: [] } })} />);
    expect(screen.queryByText(/^Source:/)).not.toBeInTheDocument();
  });

  it('never renders more than 6 steps', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({
      step_header: `Step ${i + 1}`,
      step_description: 'Do it.',
    }));
    // Bypass the schema cap on purpose - the renderer must enforce it too.
    render(<CardPage2 recipe={makeRecipe(seven)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });
});
