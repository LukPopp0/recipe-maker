import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoadJsonTab } from './LoadJsonTab.tsx';
import type { CanonicalRecipe } from 'shared';
import { validateRecipe } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  validateRecipe: vi.fn(),
}));

const mockedValidateRecipe = vi.mocked(validateRecipe);

const RECIPE: CanonicalRecipe = {
  title: 'Normalized Recipe',
  tags: [],
  time: 30,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Step 1', step_description: 'Do the thing.' }],
  metadata: { source_type: 'manual', language: 'en', warnings: [] },
};

function jsonFile(contents: string, name = 'recipe.json') {
  return new File([contents], name, { type: 'application/json' });
}

async function uploadAndSubmit(user: ReturnType<typeof userEvent.setup>, file: File) {
  const input = screen.getByLabelText(/recipe json file/i);
  await user.upload(input, file);
  await user.click(screen.getByRole('button', { name: /load recipe/i }));
}

describe('LoadJsonTab', () => {
  beforeEach(() => {
    mockedValidateRecipe.mockReset();
  });

  it('shows a parse error for non-JSON file content without calling the API', async () => {
    const user = userEvent.setup();
    render(<LoadJsonTab onRecipe={vi.fn()} />);

    await uploadAndSubmit(user, jsonFile('not json at all {{{'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid json/i);
    expect(mockedValidateRecipe).not.toHaveBeenCalled();
  });

  it('renders each field error under its field name on a valid:false response', async () => {
    const user = userEvent.setup();
    mockedValidateRecipe.mockResolvedValueOnce({
      ok: true,
      value: {
        valid: false,
        errors: {
          formErrors: ['Top-level problem.'],
          fieldErrors: {
            title: ['Required'],
            'steps.0.step_header': ['Too short'],
          },
        },
      },
    });

    render(<LoadJsonTab onRecipe={vi.fn()} />);
    await uploadAndSubmit(user, jsonFile(JSON.stringify({ some: 'candidate' })));

    expect(await screen.findByText('Top-level problem.')).toBeInTheDocument();
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('steps.0.step_header')).toBeInTheDocument();
    expect(screen.getByText('Too short')).toBeInTheDocument();
  });

  it('fires onRecipe with the normalized recipe from the response on valid:true, with null diagnostics', async () => {
    const user = userEvent.setup();
    const onRecipe = vi.fn();
    mockedValidateRecipe.mockResolvedValueOnce({
      ok: true,
      value: { valid: true, recipe: RECIPE },
    });

    render(<LoadJsonTab onRecipe={onRecipe} />);
    await uploadAndSubmit(user, jsonFile(JSON.stringify({ some: 'raw candidate' })));

    expect(mockedValidateRecipe).toHaveBeenCalledWith({ some: 'raw candidate' });
    await vi.waitFor(() => {
      expect(onRecipe).toHaveBeenCalledWith(RECIPE, null);
    });
  });

  it('renders the ErrorBanner on a transport failure', async () => {
    const user = userEvent.setup();
    mockedValidateRecipe.mockResolvedValueOnce({
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'Could not reach the server.' },
    });

    render(<LoadJsonTab onRecipe={vi.fn()} />);
    await uploadAndSubmit(user, jsonFile(JSON.stringify({ some: 'candidate' })));

    expect(await screen.findByText('Could not reach the server.')).toBeInTheDocument();
  });

  it('disables the button until a file has been chosen', () => {
    render(<LoadJsonTab onRecipe={vi.fn()} />);
    expect(screen.getByRole('button', { name: /load recipe/i })).toBeDisabled();
  });

  it('shows an error and re-enables the button when reading the file fails, without calling the API', async () => {
    const user = userEvent.setup();
    const textSpy = vi.spyOn(File.prototype, 'text').mockRejectedValueOnce(new Error('read failed'));

    render(<LoadJsonTab onRecipe={vi.fn()} />);
    await uploadAndSubmit(user, jsonFile('irrelevant contents'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not read/i);
    expect(mockedValidateRecipe).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /load recipe/i })).toBeEnabled();

    textSpy.mockRestore();
  });
});
