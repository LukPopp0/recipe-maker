import { TAG_VOCABULARY } from 'shared'

const MAX_TAGS = 5
const MAX_CUSTOM_TAG_LENGTH = 40

// Case-insensitive lookup from vocabulary key -> canonical display casing.
const VOCABULARY_BY_KEY = new Map<string, string>(
  TAG_VOCABULARY.map((tag) => [tag.toLowerCase(), tag]),
)

/**
 * Normalizes raw tags per specs/02 rule 2 + normalization rules:
 * - Controlled-vocabulary matches (case-insensitive) adopt the canonical casing.
 * - Unmatched tags are kept as custom (trimmed, 1-40 chars).
 * - Deduplicated case-insensitively (first-seen display form wins).
 * - Capped at 5, with vocabulary matches taking priority over custom tags.
 */
export function normalizeTags(rawTags: string[]): string[] {
  const seenKeys = new Set<string>()
  const vocabularyMatches: string[] = []
  const customTags: string[] = []

  for (const rawTag of rawTags) {
    const trimmed = (rawTag ?? '').trim()
    if (trimmed.length === 0) continue

    const key = trimmed.toLowerCase()
    if (seenKeys.has(key)) continue
    seenKeys.add(key)

    const canonical = VOCABULARY_BY_KEY.get(key)
    if (canonical) {
      vocabularyMatches.push(canonical)
    } else if (trimmed.length <= MAX_CUSTOM_TAG_LENGTH) {
      customTags.push(trimmed)
    }
  }

  // Vocabulary matches first so they survive the cap-to-5 trim.
  return [...vocabularyMatches, ...customTags].slice(0, MAX_TAGS)
}
