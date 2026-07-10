import { describe, expect, it } from 'vitest';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_MANUAL_REQUEST_BYTES, validateManualUpload } from './upload-limits.ts';

function makeFile(name: string, type: string, size: number): File {
  const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('upload-limits constants', () => {
  it('exposes the accepted image mime types', () => {
    expect(ACCEPTED_IMAGE_TYPES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('exposes the per-image and total request byte limits', () => {
    expect(MAX_IMAGE_BYTES).toBe(8_000_000);
    expect(MAX_MANUAL_REQUEST_BYTES).toBe(20_000_000);
  });
});

describe('validateManualUpload', () => {
  const validMainImage = makeFile('main.jpg', 'image/jpeg', 1000);

  it('returns [] for a clean payload', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: validMainImage,
      stepImages: [makeFile('step1.png', 'image/png', 1000)],
    });

    expect(errors).toEqual([]);
  });

  it('reports missing ingredientsText', () => {
    const errors = validateManualUpload({
      ingredientsText: '',
      stepsText: 'Whisk the eggs.',
      mainImage: validMainImage,
      stepImages: [],
    });

    expect(errors).toContain('Ingredients text is required.');
  });

  it('reports missing stepsText', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: '   ',
      mainImage: validMainImage,
      stepImages: [],
    });

    expect(errors).toContain('Steps text is required.');
  });

  it('reports a missing main image when neither file nor URL is given', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: undefined,
      stepImages: [],
    });

    expect(errors).toContain('A main image file or URL is required.');
  });

  it('accepts a main image URL in place of a file', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: undefined,
      mainImageUrl: 'https://example.com/main.jpg',
      stepImages: [],
    });

    expect(errors).toEqual([]);
  });

  it('rejects providing both a main image file and a URL', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: validMainImage,
      mainImageUrl: 'https://example.com/main.jpg',
      stepImages: [],
    });

    expect(errors).toContain('Provide either a main image file or a URL, not both.');
  });

  it('rejects a non-http(s) main image URL', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: undefined,
      mainImageUrl: 'ftp://example.com/main.jpg',
      stepImages: [],
    });

    expect(errors).toContain('The main image URL must be a valid http(s) URL.');
  });

  it('accepts step image URLs alongside a main image', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: validMainImage,
      stepImages: [],
      stepImageUrls: ['https://example.com/step-1.jpg', 'https://example.com/step-2.jpg'],
    });

    expect(errors).toEqual([]);
  });

  it('rejects a malformed step image URL', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: validMainImage,
      stepImages: [],
      stepImageUrls: ['not a url'],
    });

    expect(errors).toContain('One or more step image URLs are not valid http(s) URLs.');
  });

  it('reports an oversized file', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: makeFile('main.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1),
      stepImages: [],
    });

    expect(errors).toContain('main.jpg is too large (max 8 MB per image).');
  });

  it('reports a wrong-type file', () => {
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: makeFile('main.gif', 'image/gif', 1000),
      stepImages: [],
    });

    expect(errors).toContain('main.gif is not a supported image type (jpeg, png, webp only).');
  });

  it('reports total-size overflow across all files', () => {
    const bigSize = Math.floor(MAX_MANUAL_REQUEST_BYTES / 2) + 1;
    const errors = validateManualUpload({
      ingredientsText: '2 eggs',
      stepsText: 'Whisk the eggs.',
      mainImage: makeFile('main.jpg', 'image/jpeg', bigSize),
      stepImages: [makeFile('step1.jpg', 'image/jpeg', bigSize)],
    });

    expect(errors).toContain('The total upload size exceeds the 20 MB limit.');
  });
});
