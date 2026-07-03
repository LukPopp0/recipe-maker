import { describe, it, expect } from 'vitest'
import { compactSteps, type RawStep } from './step-compaction.js'

function makeSteps(count: number, descLen = 20): RawStep[] {
  return Array.from({ length: count }, (_, i) => ({
    step_header: `Header ${i + 1}`,
    step_description: `Step ${i + 1} ${'x'.repeat(descLen)}`,
  }))
}

describe('compactSteps', () => {
  it('is a no-op for 6-step input', () => {
    const input = makeSteps(6)
    expect(compactSteps(input)).toEqual(input)
  })

  it('leaves fewer-than-6-step inputs unchanged', () => {
    const input = makeSteps(3)
    expect(compactSteps(input)).toEqual(input)
  })

  it.each([7, 8, 10, 12])('compacts a %i-step input to exactly 6 steps', (count) => {
    const result = compactSteps(makeSteps(count))
    expect(result).toHaveLength(6)
    result.forEach((s) => {
      expect(s.step_header.length).toBeGreaterThan(0)
      expect(s.step_description.length).toBeGreaterThan(0)
    })
  })

  it('preserves original order (first and last descriptions appear at the ends)', () => {
    const result = compactSteps(makeSteps(10))
    expect(result[0].step_description).toContain('Step 1 ')
    expect(result[result.length - 1].step_description).toContain('Step 10 ')
  })

  it('never drops a safety cue from a merged description', () => {
    const steps: RawStep[] = makeSteps(9)
    steps[4] = { step_header: 'Cook', step_description: 'Cook chicken to 74C internal temperature.' }

    const result = compactSteps(steps)
    const allText = result.map((s) => s.step_description).join(' ')
    expect(allText).toContain('cook chicken to 74C'.replace('cook', 'Cook'))
    expect(allText).toContain('74C')
  })

  it('preserves every original description across the merged output', () => {
    const input = makeSteps(12)
    const result = compactSteps(input)
    const merged = result.map((s) => s.step_description).join(' ')
    input.forEach((s) => {
      expect(merged).toContain(s.step_description)
    })
  })

  it('is deterministic for identical input (run twice)', () => {
    const input = makeSteps(11)
    const first = compactSteps(input)
    const second = compactSteps(input)
    expect(first).toEqual(second)
  })

  it('passes through step image fields unchanged on the no-op (<=6) path', () => {
    const input = makeSteps(4)
    input[1].image = 'ingredient-images/step-2.jpg'
    input[3].image = 'ingredient-images/step-4.jpg'

    const result = compactSteps(input)

    expect(result).toEqual(input)
    expect(result[0].image).toBeUndefined()
    expect(result[1].image).toBe('ingredient-images/step-2.jpg')
    expect(result[2].image).toBeUndefined()
    expect(result[3].image).toBe('ingredient-images/step-4.jpg')
  })

  it('keeps the first image found (in original order) when a merge group has multiple images', () => {
    // steps[2] and steps[3] are the shortest adjacent pair (see whitespace test
    // below), so they merge; steps[3] carries an image and should survive since
    // it is the only image in that merge group.
    const steps: RawStep[] = [
      { step_header: 'A', step_description: 'aaaaaaaaaaaaaaaaaaaa' },
      { step_header: 'B', step_description: 'bbbbbbbbbbbbbbbbbbbb' },
      { step_header: 'C', step_description: 'mix now' },
      { step_header: 'D', step_description: 'bake now', image: 'ingredient-images/bake.jpg' },
      { step_header: 'E', step_description: 'eeeeeeeeeeeeeeeeeeee' },
      { step_header: 'F', step_description: 'ffffffffffffffffffff' },
      { step_header: 'G', step_description: 'gggggggggggggggggggg' },
    ]

    const result = compactSteps(steps)
    const merged = result.find((s) => s.step_description.includes('mix now'))
    expect(merged?.image).toBe('ingredient-images/bake.jpg')
  })

  it('keeps only the first image (original order) when both merged steps have an image', () => {
    const steps: RawStep[] = [
      { step_header: 'A', step_description: 'aaaaaaaaaaaaaaaaaaaa' },
      { step_header: 'B', step_description: 'bbbbbbbbbbbbbbbbbbbb' },
      { step_header: 'C', step_description: 'mix now', image: 'ingredient-images/mix.jpg' },
      { step_header: 'D', step_description: 'bake now', image: 'ingredient-images/bake.jpg' },
      { step_header: 'E', step_description: 'eeeeeeeeeeeeeeeeeeee' },
      { step_header: 'F', step_description: 'ffffffffffffffffffff' },
      { step_header: 'G', step_description: 'gggggggggggggggggggg' },
    ]

    const result = compactSteps(steps)
    const merged = result.find((s) => s.step_description.includes('mix now'))
    expect(merged?.image).toBe('ingredient-images/mix.jpg')
  })

  it('collapses duplicate whitespace when merging adjacent descriptions', () => {
    // steps[2] and steps[3] are the shortest adjacent pair, so they merge; both
    // carry double spaces that must be collapsed in the merged description.
    const steps: RawStep[] = [
      { step_header: 'A', step_description: 'aaaaaaaaaaaaaaaaaaaa' },
      { step_header: 'B', step_description: 'bbbbbbbbbbbbbbbbbbbb' },
      { step_header: 'C', step_description: 'mix  now' },
      { step_header: 'D', step_description: 'bake  now' },
      { step_header: 'E', step_description: 'eeeeeeeeeeeeeeeeeeee' },
      { step_header: 'F', step_description: 'ffffffffffffffffffff' },
      { step_header: 'G', step_description: 'gggggggggggggggggggg' },
    ]
    const result = compactSteps(steps)
    expect(result).toHaveLength(6)
    const merged = result.find((s) => s.step_description.includes('mix now'))
    expect(merged?.step_description).toBe('mix now bake now')
    expect(merged?.step_header).toBe('C / D')
  })
})
