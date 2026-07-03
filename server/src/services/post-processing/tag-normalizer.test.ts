import { describe, it, expect } from 'vitest'
import { normalizeTags } from './tag-normalizer.js'

describe('normalizeTags', () => {
  it('normalizes casing for a controlled-vocabulary match', () => {
    expect(normalizeTags(['high protein'])).toEqual(['High Protein'])
    expect(normalizeTags(['SPICY'])).toEqual(['Spicy'])
  })

  it('preserves an unmatched custom tag (trimmed)', () => {
    expect(normalizeTags(['  Gluten Free  '])).toEqual(['Gluten Free'])
  })

  it('deduplicates case-insensitively', () => {
    expect(normalizeTags(['Spicy', 'spicy', 'SPICY'])).toEqual(['Spicy'])
  })

  it('caps at 5, keeping vocabulary matches before custom tags', () => {
    const result = normalizeTags([
      'custom-a',
      'High Protein',
      'custom-b',
      'Spicy',
      'custom-c',
      'Quick',
      'custom-d',
    ])

    expect(result).toHaveLength(5)
    // all three vocab matches kept, then two customs fill the remaining slots
    expect(result).toEqual(['High Protein', 'Spicy', 'Quick', 'custom-a', 'custom-b'])
  })

  it('drops empty and over-40-char custom tags', () => {
    const long = 'x'.repeat(41)
    expect(normalizeTags(['', '   ', long, 'Vegetarian'])).toEqual(['Vegetarian'])
  })

  it('returns an empty array for no tags', () => {
    expect(normalizeTags([])).toEqual([])
  })
})
