import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WarningsPanel } from './WarningsPanel.tsx';

describe('WarningsPanel', () => {
  it('renders each warning as non-blocking notice text', () => {
    render(<WarningsPanel warnings={['Could not find an image for "saffron".', 'Time estimate is a guess.']} />);

    expect(screen.getByText('Could not find an image for "saffron".')).toBeInTheDocument();
    expect(screen.getByText('Time estimate is a guess.')).toBeInTheDocument();
  });

  it('renders nothing when warnings is empty', () => {
    const { container } = render(<WarningsPanel warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
