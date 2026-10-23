import { describe, expect, it } from 'vitest';
import { ImageSlotSchema } from './requests.js';

describe('ImageSlotSchema', () => {
  it.each([['main', 'main'], [0, 0], [5, 5], ['0', 0], ['3', 3]])('accepts %j', (input, out) => {
    expect(ImageSlotSchema.parse(input)).toBe(out);
  });

  it.each(['', ' ', null, false, true, [], 'cover', '6', 6, -1, '-1', 1.5, '1.5', undefined])(
    'rejects %j',
    (input) => {
      expect(ImageSlotSchema.safeParse(input).success).toBe(false);
    },
  );
});
