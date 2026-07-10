import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../lib/errors.js';
import {
  parseManualUploadBody,
  type ManualImageInput,
  type ParsedManualUpload,
} from './manual-upload-parser.js';

// Builds a throwaway Hono app that exposes parseManualUploadBody as a route
// handler, so we exercise real multipart parsing via Hono's own parseBody
// rather than mocking Hono internals.
function buildTestApp() {
  const app = new Hono();
  app.post('/x', async (c) => {
    const parsed = await parseManualUploadBody(c);
    return c.json(serializeForAssertions(parsed));
  });
  return app;
}

function summarizeImage(image: ManualImageInput) {
  return image.kind === 'file'
    ? { kind: 'file' as const, filename: image.filename, contentType: image.file.contentType }
    : { kind: 'url' as const, filename: image.filename, url: image.url };
}

// FormData Files aren't JSON-serializable, so summarize the parsed image inputs
// (file or url variant) for the test's JSON response assertions.
function serializeForAssertions(parsed: ParsedManualUpload) {
  return {
    ingredientsText: parsed.ingredientsText,
    stepsText: parsed.stepsText,
    mainImage: summarizeImage(parsed.mainImage),
    stepImages: parsed.stepImages.map(summarizeImage),
  };
}

function makeFile(name: string, contents = 'fake-image-bytes') {
  return new File([contents], name, { type: 'image/png' });
}

async function postFormData(app: Hono, formData: FormData) {
  const request = new Request('http://x/x', { method: 'POST', body: formData });
  return app.request(request);
}

type SerializedUpload = ReturnType<typeof serializeForAssertions>

async function postFormDataForBody(app: Hono, formData: FormData): Promise<SerializedUpload> {
  const response = await postFormData(app, formData);
  return (await response.json()) as SerializedUpload;
}

// Captures the AppError thrown by parseManualUploadBody so tests can assert on
// its code/message rather than only the HTTP status.
async function postCapturingError(formData: FormData): Promise<AppError> {
  let caughtError: unknown;
  const app = new Hono();
  app.post('/x', async (c) => {
    try {
      return c.json(serializeForAssertions(await parseManualUploadBody(c)));
    } catch (err) {
      caughtError = err;
      throw err;
    }
  });
  await postFormData(app, formData);
  return caughtError as AppError;
}

describe('parseManualUploadBody', () => {
  it('throws INVALID_INPUT when ingredientsText is missing', async () => {
    const formData = new FormData();
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));

    const error = await postCapturingError(formData);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('INVALID_INPUT');
    expect(error.message).toBe('ingredientsText is required.');
  });

  it('throws INVALID_INPUT when neither mainImage file nor mainImageUrl is provided', async () => {
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');

    const error = await postCapturingError(formData);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('INVALID_INPUT');
  });

  it('throws INVALID_INPUT when BOTH mainImage file and mainImageUrl are provided', async () => {
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));
    formData.set('mainImageUrl', 'https://example.com/main.jpg');

    const error = await postCapturingError(formData);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('INVALID_INPUT');
  });

  it('accepts a file main image and returns a file-kind mainImage', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));

    const body = await postFormDataForBody(app, formData);

    expect(body.mainImage).toEqual({ kind: 'file', filename: 'main.png', contentType: 'image/png' });
    expect(body.stepImages).toEqual([]);
  });

  it('accepts a mainImageUrl and returns a url-kind mainImage with a derived filename', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImageUrl', 'https://cdn.example.com/photos/main-photo.jpg');

    const body = await postFormDataForBody(app, formData);

    expect(body.mainImage).toEqual({
      kind: 'url',
      filename: 'main-photo.jpg',
      url: 'https://cdn.example.com/photos/main-photo.jpg',
    });
  });

  it('throws INVALID_INPUT on a non-http(s) mainImageUrl', async () => {
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImageUrl', 'ftp://example.com/main.jpg');

    const error = await postCapturingError(formData);

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe('INVALID_INPUT');
  });

  it('throws INVALID_INPUT on a malformed mainImageUrl', async () => {
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImageUrl', 'not a url');

    const error = await postCapturingError(formData);

    expect(error.code).toBe('INVALID_INPUT');
  });

  it('returns a single-element stepImages array when only one step image file is uploaded', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));
    formData.append('stepImages', makeFile('step-1.png'));

    const body = await postFormDataForBody(app, formData);

    expect(body.stepImages).toHaveLength(1);
    expect(body.stepImages[0]).toEqual({ kind: 'file', filename: 'step-1.png', contentType: 'image/png' });
  });

  it('mixes step image files and step image URLs in stepImages', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));
    formData.append('stepImages', makeFile('step-a.png'));
    formData.append('stepImageUrls', 'https://cdn.example.com/steps/step-b.png');

    const body = await postFormDataForBody(app, formData);

    expect(body.stepImages).toHaveLength(2);
    expect(body.stepImages).toContainEqual({ kind: 'file', filename: 'step-a.png', contentType: 'image/png' });
    expect(body.stepImages).toContainEqual({
      kind: 'url',
      filename: 'step-b.png',
      url: 'https://cdn.example.com/steps/step-b.png',
    });
  });

  it('accepts multiple stepImageUrls with no file uploads', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));
    formData.append('stepImageUrls', 'https://cdn.example.com/1.png');
    formData.append('stepImageUrls', 'https://cdn.example.com/2.png');

    const body = await postFormDataForBody(app, formData);

    expect(body.stepImages.map((s) => (s.kind === 'url' ? s.url : null))).toEqual([
      'https://cdn.example.com/1.png',
      'https://cdn.example.com/2.png',
    ]);
  });

  it('throws INVALID_INPUT when a stepImageUrl is not http(s)', async () => {
    const formData = new FormData();
    formData.set('ingredientsText', '2 eggs');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));
    formData.append('stepImageUrls', 'file:///etc/passwd');

    const error = await postCapturingError(formData);

    expect(error.code).toBe('INVALID_INPUT');
  });

  it('normalizes \\r\\n newlines to \\n in ingredientsText', async () => {
    const app = buildTestApp();
    const formData = new FormData();
    formData.set('ingredientsText', '  2 eggs\r\n1 cup flour\r\n  ');
    formData.set('stepsText', 'Step one.');
    formData.set('mainImage', makeFile('main.png'));

    const body = await postFormDataForBody(app, formData);

    expect(body.ingredientsText).toBe('2 eggs\n1 cup flour');
  });
});
