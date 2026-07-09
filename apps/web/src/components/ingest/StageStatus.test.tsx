import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StageStatus } from './StageStatus.tsx';
import type { IngestStatus } from '../../workspace-types.ts';

describe('StageStatus', () => {
  it('renders "Submitting..." for the submitting phase', () => {
    render(<StageStatus status={{ phase: 'submitting' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Submitting...');
  });

  it('renders the fixed processing message for the processing phase', () => {
    render(
      <StageStatus
        status={{ phase: 'processing', message: 'ignored - text is fixed, not from message prop' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Extracting and normalizing (this can take up to a minute)...',
    );
  });

  it('renders "Complete." for the complete phase', () => {
    render(<StageStatus status={{ phase: 'complete' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Complete.');
  });

  it('renders nothing for the idle phase', () => {
    const { container } = render(<StageStatus status={{ phase: 'idle' }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for the error phase', () => {
    const status: IngestStatus = {
      phase: 'error',
      error: { code: 'URL_EXTRACTION_FAILED', message: 'Failed.' },
    };
    const { container } = render(<StageStatus status={status} />);
    expect(container).toBeEmptyDOMElement();
  });
});
