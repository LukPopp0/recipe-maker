import { describe, expect, it } from 'vitest'
import { PANTRY_ALLOWLIST, isPantryItem } from './pantry-allowlist.js'

describe('PANTRY_ALLOWLIST', () => {
  it('contains the expected entries', () => {
    expect(PANTRY_ALLOWLIST).toEqual([
      'salt',
      'pepper',
      'sugar',
      'butter',
      'oil (olive and vegetable)',
      'milk',
      'flour',
    ])
  })

  it('has exactly 7 entries', () => {
    expect(PANTRY_ALLOWLIST).toHaveLength(7)
  })
})

describe('isPantryItem', () => {
  it('matches exact entries case-insensitively', () => {
    expect(isPantryItem('salt')).toBe(true)
    expect(isPantryItem('Salt')).toBe(true)
    expect(isPantryItem('SALT')).toBe(true)
    expect(isPantryItem('pepper')).toBe(true)
    expect(isPantryItem('Pepper')).toBe(true)
    expect(isPantryItem('sugar')).toBe(true)
    expect(isPantryItem('SUGAR')).toBe(true)
    expect(isPantryItem('butter')).toBe(true)
    expect(isPantryItem('Butter')).toBe(true)
    expect(isPantryItem('milk')).toBe(true)
    expect(isPantryItem('MILK')).toBe(true)
    expect(isPantryItem('flour')).toBe(true)
    expect(isPantryItem('Flour')).toBe(true)
  })

  it('matches "olive oil" against the oil entry', () => {
    expect(isPantryItem('olive oil')).toBe(true)
    expect(isPantryItem('Olive Oil')).toBe(true)
    expect(isPantryItem('OLIVE OIL')).toBe(true)
  })

  it('matches "vegetable oil" against the oil entry', () => {
    expect(isPantryItem('vegetable oil')).toBe(true)
    expect(isPantryItem('Vegetable Oil')).toBe(true)
    expect(isPantryItem('VEGETABLE OIL')).toBe(true)
  })

  it('does not match "sesame oil" (not in the oil allowlist)', () => {
    expect(isPantryItem('sesame oil')).toBe(false)
    expect(isPantryItem('Sesame Oil')).toBe(false)
  })

  it('does not match oils other than olive and vegetable', () => {
    expect(isPantryItem('coconut oil')).toBe(false)
    expect(isPantryItem('peanut oil')).toBe(false)
    expect(isPantryItem('sunflower oil')).toBe(false)
  })

  it('does not match items not on the allowlist', () => {
    expect(isPantryItem('garlic')).toBe(false)
    expect(isPantryItem('onion')).toBe(false)
    expect(isPantryItem('basil')).toBe(false)
  })

  it('does not match partial strings', () => {
    expect(isPantryItem('salty')).toBe(false)
    expect(isPantryItem('peppercorn')).toBe(false)
    expect(isPantryItem('buttery')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isPantryItem('')).toBe(false)
  })
})
