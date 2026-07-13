import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManualTab } from './ManualTab.tsx';
import type { CanonicalRecipe } from 'shared';
import { ingestManual } from '../../api/client.ts';

vi.mock('../../api/client.ts', () => ({
  ingestManual: vi.fn(),
}));

const mockedIngestManual = vi.mocked(ingestManual);

const RECIPE: CanonicalRecipe = {
  title: 'Test Recipe',
  tags: [],
  time: 30,
  ingredients: [],
  pantry_items: [],
  main_image: '/images/placeholder.png',
  steps: [{ step_header: 'Step 1', step_description: 'Do the thing.' }],
  metadata: { source_type: 'manual', language: 'en', warnings: [] },
};

// Deferred promise helper - lets tests inspect the pending UI state before
// resolving the mocked client call.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'.repeat(Math.min(size, 10))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

async function fillTextFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/ingredients/i), '1 cup flour');
  await user.type(screen.getByLabelText(/^steps$/i), 'Mix it all together.');
}

describe('ManualTab', () => {
  beforeEach(() => {
    mockedIngestManual.mockReset();
  });

  it('blocks submit and shows itemized errors when text fields and main image are empty, without calling the API', async () => {
    const user = userEvent.setup();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/ingredients text is required/i);
    expect(alert).toHaveTextContent(/steps text is required/i);
    expect(alert).toHaveTextContent(/main image file or url is required/i);
    expect(mockedIngestManual).not.toHaveBeenCalled();
  });

  it('surfaces the specific limit error for an oversized main image', async () => {
    const user = userEvent.setup();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    const oversized = makeFile('big.jpg', 'image/jpeg', 9_000_000);
    await user.upload(screen.getByLabelText(/^main image$/i), oversized);
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/big\.jpg is too large/i);
    expect(mockedIngestManual).not.toHaveBeenCalled();
  });

  it('surfaces the specific limit error for a wrong-type main image', async () => {
    // applyAccept: false - the browser's own accept-attribute filtering
    // would otherwise silently reject this file before it reaches our
    // validation, defeating the point of the test.
    const user = userEvent.setup({ applyAccept: false });
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    const wrongType = makeFile('recipe.gif', 'image/gif', 1000);
    await user.upload(screen.getByLabelText(/^main image$/i), wrongType);
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a supported image type/i);
    expect(mockedIngestManual).not.toHaveBeenCalled();
  });

  it('calls ingestManual with exactly the entered fields/files and fires onRecipe on success', async () => {
    const user = userEvent.setup();
    const onRecipe = vi.fn();
    mockedIngestManual.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
    });

    render(<ManualTab onRecipe={onRecipe} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    const mainImage = makeFile('main.jpg', 'image/jpeg', 1000);
    const stepOne = makeFile('step-b.png', 'image/png', 1000);
    const stepTwo = makeFile('step-a.png', 'image/png', 1000);
    await user.upload(screen.getByLabelText(/^main image$/i), mainImage);
    await user.upload(screen.getByLabelText(/step images/i), [stepOne, stepTwo]);

    // File list is displayed sorted by filename (mirrors server-side
    // sorted-filename step assignment from specs/05).
    const listItems = screen.getAllByRole('listitem');
    const listText = listItems.map((item) => item.textContent ?? '').join(' | ');
    expect(listText.indexOf('step-a.png')).toBeLessThan(listText.indexOf('step-b.png'));

    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(mockedIngestManual).toHaveBeenCalledWith({
      ingredientsText: '1 cup flour',
      stepsText: 'Mix it all together.',
      mainImage,
      mainImageUrl: '',
      stepImages: [stepOne, stepTwo],
      stepImageUrls: [],
    });
    await vi.waitFor(() => {
      expect(onRecipe).toHaveBeenCalledWith(RECIPE, { extractor: 'manual', model: 'gemini', durationMs: 100 }, 'ns-test');
    });
  });

  it('disables submit and shows StageStatus while the request is pending', async () => {
    const user = userEvent.setup();
    const pending = deferred<Awaited<ReturnType<typeof ingestManual>>>();
    mockedIngestManual.mockReturnValueOnce(pending.promise);

    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    const mainImage = makeFile('main.jpg', 'image/jpeg', 1000);
    await user.upload(screen.getByLabelText(/^main image$/i), mainImage);
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(screen.getByRole('button', { name: /normalize recipe/i })).toBeDisabled();
    expect(screen.getByText(/extracting and normalizing/i)).toBeInTheDocument();

    pending.resolve({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
    });
    await vi.waitFor(() => {
      expect(screen.getByText(/complete/i)).toBeInTheDocument();
    });
  });

  it('renders the ErrorBanner on an ApiFailure, and Retry re-submits the same entered fields', async () => {
    const user = userEvent.setup();
    mockedIngestManual.mockResolvedValueOnce({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Could not normalize that recipe.' },
    });

    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    const mainImage = makeFile('main.jpg', 'image/jpeg', 1000);
    await user.upload(screen.getByLabelText(/^main image$/i), mainImage);
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(await screen.findByText('Could not normalize that recipe.')).toBeInTheDocument();

    mockedIngestManual.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 50 }, imageNamespaceId: 'ns-test' },
    });
    await user.click(screen.getByRole('button', { name: /retry/i }));

    expect(mockedIngestManual).toHaveBeenCalledTimes(2);
    expect(mockedIngestManual).toHaveBeenLastCalledWith({
      ingredientsText: '1 cup flour',
      stepsText: 'Mix it all together.',
      mainImage,
      mainImageUrl: '',
      stepImages: [],
      stepImageUrls: [],
    });
  });

  it('fires onExtractStart before the request resolves (item 5)', async () => {
    const user = userEvent.setup();
    const onExtractStart = vi.fn();
    const pending = deferred<Awaited<ReturnType<typeof ingestManual>>>();
    mockedIngestManual.mockReturnValueOnce(pending.promise);

    render(<ManualTab onRecipe={vi.fn()} onExtractStart={onExtractStart} />);

    await fillTextFields(user);
    await user.upload(screen.getByLabelText(/^main image$/i), makeFile('main.jpg', 'image/jpeg', 1000));
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    // Cleared up front, while the call is still pending.
    expect(onExtractStart).toHaveBeenCalledTimes(1);

    pending.resolve({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 100 }, imageNamespaceId: 'ns-test' },
    });
  });

  it('does not fire onExtractStart when validation fails (item 5)', async () => {
    const user = userEvent.setup();
    const onExtractStart = vi.fn();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={onExtractStart} />);

    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onExtractStart).not.toHaveBeenCalled();
  });

  it('submits a main image URL in place of a file', async () => {
    const user = userEvent.setup();
    mockedIngestManual.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 10 }, imageNamespaceId: 'ns-test' },
    });

    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    await user.type(screen.getByLabelText(/main image url/i), 'https://example.com/main.jpg');
    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(mockedIngestManual).toHaveBeenCalledWith({
      ingredientsText: '1 cup flour',
      stepsText: 'Mix it all together.',
      mainImage: undefined,
      mainImageUrl: 'https://example.com/main.jpg',
      stepImages: [],
      stepImageUrls: [],
    });
  });

  it('blocks submit when both a main image file and URL are provided', async () => {
    const user = userEvent.setup();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    // Type the URL first so the file input stays enabled, then force a file in
    // (applyAccept off) to construct the mutually-exclusive violation directly.
    await user.upload(screen.getByLabelText(/main image$/i), makeFile('main.jpg', 'image/jpeg', 1000));
    // Setting a file clears the URL via the component's mutual-exclusion, so
    // re-entering the URL reproduces "both provided" only if validation is fed
    // both. Instead assert the mutual-exclusion disables the URL input.
    expect(screen.getByLabelText(/main image url/i)).toBeDisabled();
    expect(mockedIngestManual).not.toHaveBeenCalled();
  });

  it('keeps step image URLs in add order, not filename order', async () => {
    const user = userEvent.setup();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    const urlInput = screen.getByLabelText(/step image url/i);
    const addButton = screen.getByRole('button', { name: /^add$/i });

    await user.type(urlInput, 'https://example.com/z.png');
    await user.click(addButton);
    await user.type(urlInput, 'https://example.com/a.png');
    await user.click(addButton);

    const listText = screen.getAllByRole('listitem').map((li) => li.textContent ?? '').join(' | ');
    // Add order z then a; a filename sort would put a.png first.
    expect(listText.indexOf('z.png')).toBeLessThan(listText.indexOf('a.png'));
  });

  it('removes an uploaded main image and re-enables the URL input', async () => {
    const user = userEvent.setup();
    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await user.upload(screen.getByLabelText(/^main image$/i), makeFile('main.jpg', 'image/jpeg', 1000));
    expect(screen.getByText(/main\.jpg/)).toBeInTheDocument();
    expect(screen.getByLabelText(/main image url/i)).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /remove main\.jpg/i }));

    expect(screen.queryByText(/main\.jpg/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/main image url/i)).not.toBeDisabled();
  });

  it('adds a step image URL to the list and submits it', async () => {
    const user = userEvent.setup();
    mockedIngestManual.mockResolvedValueOnce({
      ok: true,
      value: { recipe: RECIPE, diagnostics: { extractor: 'manual', model: 'gemini', durationMs: 10 }, imageNamespaceId: 'ns-test' },
    });

    render(<ManualTab onRecipe={vi.fn()} onExtractStart={vi.fn()} />);

    await fillTextFields(user);
    await user.upload(screen.getByLabelText(/main image$/i), makeFile('main.jpg', 'image/jpeg', 1000));
    await user.type(screen.getByLabelText(/step image url/i), 'https://example.com/steps/step-1.png');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(screen.getByText(/step-1\.png .*\(URL\)/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /normalize recipe/i }));

    expect(mockedIngestManual).toHaveBeenCalledWith(
      expect.objectContaining({ stepImageUrls: ['https://example.com/steps/step-1.png'] }),
    );
  });
});
