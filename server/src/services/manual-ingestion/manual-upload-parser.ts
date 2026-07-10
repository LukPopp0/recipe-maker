import type { Context } from 'hono';
import { AppError } from '../../lib/errors.js';
import { validateUrlSyntax } from '../url-ingestion/url-security.js';
import type { UploadedFile } from '../images/upload-image-hoster.js';

// A manual-ingestion image is supplied either as an uploaded file or as a
// remote http(s) URL to fetch server-side. Both variants carry a top-level
// `filename` so step-image ordering (sortStepImageFilenames) works uniformly;
// for url entries it's a pseudo-filename derived from the URL path segment.
export type ManualImageInput =
  | { kind: 'file'; filename: string; file: UploadedFile }
  | { kind: 'url'; filename: string; url: string };

export interface ParsedManualUpload {
  ingredientsText: string
  stepsText: string
  mainImage: ManualImageInput
  stepImages: ManualImageInput[]
}

// Trims leading/trailing whitespace and normalizes CRLF/CR newlines to LF, per
// specs/05's manual-ingestion text-field normalization rule.
function normalizeText(value: string): string {
  return value.trim().replace(/\r\n?/g, '\n');
}

async function toUploadedFile(file: File): Promise<UploadedFile> {
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
    filename: file.name,
  };
}

// Derives a stable pseudo-filename for a url image input from the last non-empty
// path segment (falling back to the hostname), used for deterministic
// step-image ordering the same way uploaded filenames are.
function deriveUrlFilename(url: URL): string {
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : url.hostname;
}

// Validates a user-supplied image URL as http(s) and builds a url-kind image
// input. Rejects malformed or non-http(s) URLs with INVALID_INPUT so the same
// SSRF-relevant scheme guard as URL ingestion applies at the edge.
function toUrlImageInput(raw: string, fieldLabel: string): ManualImageInput {
  let url: URL;
  try {
    url = validateUrlSyntax(raw);
  } catch {
    throw new AppError('INVALID_INPUT', `${fieldLabel} must be a valid http(s) URL.`);
  }
  return { kind: 'url', filename: deriveUrlFilename(url), url: url.toString() };
}

// Hono's parseBody({ all: true }) returns a bare value (not an array) when a
// repeated field name appears once - coerce to an array so callers always get a
// consistent shape.
function toArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

// Parses and validates the multipart body of a manual-ingestion request
// (POST /ingest/manual): two text fields (ingredientsText, stepsText), a main
// image, and zero or more step images. Each image may be supplied as an
// uploaded file OR a remote http(s) URL; exactly one of mainImage/mainImageUrl
// is required, and step files/URLs may be mixed. Does not fetch or host any
// image - that's the pipeline's job.
export async function parseManualUploadBody(c: Context): Promise<ParsedManualUpload> {
  const body = await c.req.parseBody({ all: true });

  const rawIngredientsText = body.ingredientsText;
  if (typeof rawIngredientsText !== 'string' || normalizeText(rawIngredientsText) === '') {
    throw new AppError('INVALID_INPUT', 'ingredientsText is required.');
  }

  const rawStepsText = body.stepsText;
  if (typeof rawStepsText !== 'string' || normalizeText(rawStepsText) === '') {
    throw new AppError('INVALID_INPUT', 'stepsText is required.');
  }

  // Main image: exactly one of a file (mainImage) or a URL (mainImageUrl).
  const rawMainImage = body.mainImage;
  const rawMainImageUrl = body.mainImageUrl;
  const hasMainFile = rawMainImage instanceof File;
  const hasMainUrl = typeof rawMainImageUrl === 'string' && rawMainImageUrl.trim() !== '';

  if (hasMainFile && hasMainUrl) {
    throw new AppError('INVALID_INPUT', 'Provide either a main image file or a URL, not both.');
  }
  if (!hasMainFile && !hasMainUrl) {
    throw new AppError('INVALID_INPUT', 'A main image file or URL is required.');
  }

  const mainImage: ManualImageInput = hasMainFile
    ? { kind: 'file', filename: rawMainImage.name, file: await toUploadedFile(rawMainImage) }
    : toUrlImageInput((rawMainImageUrl as string).trim(), 'mainImageUrl');

  // Step images: any mix of uploaded files (stepImages) and URLs
  // (stepImageUrls). Files are collected in upload order, then URLs; the
  // pipeline re-sorts them deterministically by filename.
  const stepFileInputs = await Promise.all(
    toArray(body.stepImages)
      .filter((entry): entry is File => entry instanceof File)
      .map(async (file): Promise<ManualImageInput> => ({
        kind: 'file',
        filename: file.name,
        file: await toUploadedFile(file),
      })),
  );

  const stepUrlInputs = toArray(body.stepImageUrls)
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .map((raw) => toUrlImageInput(raw.trim(), 'stepImageUrls'));

  return {
    ingredientsText: normalizeText(rawIngredientsText),
    stepsText: normalizeText(rawStepsText),
    mainImage,
    stepImages: [...stepFileInputs, ...stepUrlInputs],
  };
}
