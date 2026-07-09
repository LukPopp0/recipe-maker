import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldErrors } from './FieldErrors.tsx';

describe('FieldErrors', () => {
  it('renders with role="alert"', () => {
    render(<FieldErrors formErrors={['Something went wrong.']} fieldErrors={{}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('lists top-level form errors', () => {
    render(<FieldErrors formErrors={['Invalid recipe.', 'Missing title.']} fieldErrors={{}} />);
    expect(screen.getByText('Invalid recipe.')).toBeInTheDocument();
    expect(screen.getByText('Missing title.')).toBeInTheDocument();
  });

  it('groups field errors under their field name', () => {
    render(
      <FieldErrors
        formErrors={[]}
        fieldErrors={{ title: ['Required'], 'steps.0.step_header': ['Too long'] }}
      />,
    );
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('steps.0.step_header')).toBeInTheDocument();
    expect(screen.getByText('Too long')).toBeInTheDocument();
  });

  it('renders no form error list when formErrors is empty', () => {
    const { container } = render(<FieldErrors formErrors={[]} fieldErrors={{ title: ['Required'] }} />);
    expect(container.querySelector('.field-errors-form')).toBeNull();
  });
});
