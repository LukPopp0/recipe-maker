const MAX_STEPS = 6
const MAX_MERGED_HEADER_LENGTH = 80

// Raw step as produced by Gemini extraction, before schema validation.
// `image` mirrors RawIngredient/Step's optional image field; Option A (URL
// ingestion) never sets it today, but Option B (manual ingestion, Phase 3)
// will, and this module must pass it through unchanged.
export interface RawStep {
  step_header: string
  step_description: string
  image?: string
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// Cost used to pick which adjacent pair to merge next: shorter combined
// descriptions merge first ("prefer merging short adjacent steps").
function groupDescriptionLength(group: RawStep[]): number {
  return group.reduce((sum, step) => sum + (step.step_description ?? '').length, 0)
}

// A merged step can only display one image. Rule: first-image-wins, in
// original (pre-merge) order - the simplest deterministic, order-preserving
// choice consistent with this module's "never reorder" guardrail. Any image
// on a later step in the group is dropped (no way to show more than one).
function firstImage(group: RawStep[]): string | undefined {
  return group.find((step) => step.image !== undefined)?.image
}

function mergeGroup(group: RawStep[]): RawStep {
  if (group.length === 1) {
    return {
      step_header: group[0].step_header,
      step_description: group[0].step_description,
      ...(group[0].image !== undefined ? { image: group[0].image } : {}),
    }
  }

  // header = concise "A / B / ..." summary of grouped headers, capped.
  const joinedHeader = collapseWhitespace(
    group
      .map((step) => (step.step_header ?? '').trim())
      .filter((header) => header.length > 0)
      .join(' / '),
  )
  const header =
    joinedHeader.length <= MAX_MERGED_HEADER_LENGTH
      ? joinedHeader
      : joinedHeader.slice(0, MAX_MERGED_HEADER_LENGTH).trim()

  // description = concatenation of every grouped description (no text dropped,
  // so safety cues and timing cues are always preserved), whitespace cleaned.
  const description = collapseWhitespace(group.map((step) => step.step_description).join(' '))

  const image = firstImage(group)

  return { step_header: header, step_description: description, ...(image !== undefined ? { image } : {}) }
}

/**
 * Deterministic step compaction per specs/07:
 * - No-op when there are <= 6 steps.
 * - Otherwise merges adjacent steps into exactly 6 groups, always merging the
 *   shortest adjacent pair first (leftmost wins ties). Order is never changed
 *   and no description text is ever dropped.
 * - `image` passes through unchanged on the no-op path; on the merge path,
 *   first-image-wins within each merged group (see `firstImage`).
 */
export function compactSteps(steps: RawStep[]): RawStep[] {
  if (steps.length <= MAX_STEPS) {
    return steps.map((step) => ({
      step_header: step.step_header,
      step_description: step.step_description,
      ...(step.image !== undefined ? { image: step.image } : {}),
    }))
  }

  const groups: RawStep[][] = steps.map((step) => [step])

  while (groups.length > MAX_STEPS) {
    let bestIndex = 0
    let bestCost = Number.POSITIVE_INFINITY

    for (let i = 0; i < groups.length - 1; i++) {
      const cost = groupDescriptionLength(groups[i]) + groupDescriptionLength(groups[i + 1])
      // strict `<` keeps the leftmost pair on ties -> deterministic
      if (cost < bestCost) {
        bestCost = cost
        bestIndex = i
      }
    }

    groups.splice(bestIndex, 2, [...groups[bestIndex], ...groups[bestIndex + 1]])
  }

  return groups.map(mergeGroup)
}
