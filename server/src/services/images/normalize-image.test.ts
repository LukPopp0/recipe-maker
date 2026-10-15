import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageDecodeError, MAX_INPUT_PIXELS, normalizeImage } from './normalize-image.js';

async function makePng(width: number, height: number, alpha = 1): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 0, b: 0, alpha } } }).png().toBuffer();
}

describe('normalizeImage', () => {
  it('shrinks the longest side to 1600 px and outputs JPEG', async () => {
    const out = await normalizeImage(await makePng(3200, 1000));
    const meta = await sharp(out).metadata();

    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(1600);
    expect(meta.height).toBe(500);
  });

  it('never upscales a small image', async () => {
    const meta = await sharp(await normalizeImage(await makePng(400, 300))).metadata();

    expect(meta.width).toBe(400);
    expect(meta.height).toBe(300);
  });

  it('flattens transparency onto white', async () => {
    const out = await normalizeImage(await makePng(10, 10, 0));
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });

    expect(data[0]).toBeGreaterThan(245);
    expect(data[1]).toBeGreaterThan(245);
    expect(data[2]).toBeGreaterThan(245);
  });

  it('applies EXIF rotation and strips metadata', async () => {
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const meta = await sharp(await normalizeImage(rotated)).metadata();

    expect(meta.width).toBe(100);
    expect(meta.height).toBe(200);
    expect(meta.orientation).toBeUndefined();
    expect(meta.exif).toBeUndefined();
  });

  it('throws ImageDecodeError for bytes that are not an image', async () => {
    await expect(normalizeImage(Buffer.from('definitely not an image'))).rejects.toBeInstanceOf(ImageDecodeError);
  });

  it('rejects an image above the input pixel cap as ImageDecodeError', async () => {
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 1;
    const huge = await sharp({ create: { width: side, height: side, channels: 3, background: '#fff' } })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(normalizeImage(huge)).rejects.toBeInstanceOf(ImageDecodeError);
  });
});
