# Spec 07: Step Compaction (Max 6)

## Goal
Guarantee recipe.steps length <= 6 without losing essential procedure meaning.

## Trigger
If extracted step count <= 6, no compaction.
If count > 6, run compaction algorithm.

## Algorithm (Deterministic)
1. Normalize all steps into {header, description}.
2. Compute merge target count = 6.
3. Determine merge groups by adjacency:
   - Prefer merging short adjacent steps.
   - Keep major transitions separate (prep/cook/finish/serve markers).
4. Merge group:
   - header = concise summary of grouped headers.
   - description = concatenation with transition cleanup.
5. Re-index and return exactly 6 steps.

## Guardrails
- Never reorder steps.
- Never remove food safety instructions.
- Preserve timing cues where present.

## AI Assist Option
- Gemini may propose merged steps, but deterministic guard validation must verify:
  - <= 6 steps
  - sequence preserved
  - required safety cues present

## Test Cases
- 6, 7, 8, 10, 12-step inputs.
- Highly granular micro-steps.
- Inputs with warnings like "cook chicken to 74C".

## Acceptance Criteria
- All outputs have 1-6 steps.
- Sequence integrity preserved.
- Deterministic result for identical input.