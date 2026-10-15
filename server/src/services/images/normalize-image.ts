import sharp from 'sharp';

export const MAX_IMAGE_DIMENSION = 1600;
export const JPEG_QUALITY = 82;

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
  try {
    return await sharp(input, { failOn: 'error' })
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
    throw new ImageDecodeError(err instanceof Error ? err.message : 'unreadable image');
  }
}
