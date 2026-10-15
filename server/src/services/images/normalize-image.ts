import sharp from 'sharp';

export const MAX_IMAGE_DIMENSION = 1600;
export const JPEG_QUALITY = 82;
// Decoded-size cap so a small decompression-bomb file cannot exhaust memory
// on the 4 GB server; larger inputs fail as ImageDecodeError.
export const MAX_INPUT_PIXELS = 50_000_000;

// Formats we decode. Anything else (SVG, GIF, TIFF, HEIF, ...) is refused
// before the resize pipeline, matching the accepted types in docs/specs/06.
// The magic-byte sniff below runs before any sharp call, so the other
// loaders (librsvg parses whole SVGs even for metadata()) never see the
// bytes; the metadata() format check stays as a second guard.
export const DECODABLE_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp']);

function hasAllowedMagicBytes(input: Buffer): boolean {
  const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const isPng =
    input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp =
    input.length >= 12 && input.toString('latin1', 0, 4) === 'RIFF' && input.toString('latin1', 8, 12) === 'WEBP';
  return isJpeg || isPng || isWebp;
}

// Thrown when the input bytes cannot be decoded as an image, so callers can
// report it like any other rejected upload instead of a 500.
export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

// Every stored image goes through here (deployment spec section 7): apply
// EXIF rotation, fit inside 1600x1600 without upscaling, put transparent
// pixels on white (JPEG has no alpha), and re-encode as JPEG. sharp drops
// EXIF/ICC metadata unless asked to keep it.
export async function normalizeImage(input: Buffer): Promise<Buffer> {
  if (!hasAllowedMagicBytes(input)) throw new ImageDecodeError('unsupported image format');
  try {
    // Header-only read: confirms the format and enforces the pixel limit
    // before any pixel decoding happens.
    const { format } = await sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (!format || !DECODABLE_FORMATS.has(format)) {
      throw new ImageDecodeError(`unsupported image format: ${format ?? 'unknown'}`);
    }
    return await sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: MAX_IMAGE_DIMENSION,
        height: MAX_IMAGE_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (err) {
    if (err instanceof ImageDecodeError) throw err;
    throw new ImageDecodeError(err instanceof Error ? err.message : 'unreadable image');
  }
}
