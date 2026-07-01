# Spec 06: Image Re-hosting and Storage

## Goal
Download and serve recipe images from app-managed storage for stable rendering.

## Storage Abstraction
Define interface:
- put(fileBuffer, key, contentType) -> publicUrl
- get(key) -> stream/buffer
- delete(key)

Implementations:
- LocalDiskStorageAdapter (milestone 1 default).
- CloudStorageAdapter (future).

## Image Sources
- Option A: remote image URLs from extracted recipe.
- Option B: user-uploaded files.

## Processing Rules
1. Validate MIME type (jpeg/png/webp).
2. Validate max size per image.
3. Optionally normalize image dimensions and compress.
4. Generate deterministic key naming:
   - recipes/{recipeId}/{kind}-{index}.{ext}
5. Store image and return hosted URL.

## Metadata Rules
- Keep source image URL in diagnostics metadata for Option A.
- Canonical recipe should use hosted URL/path.

## Failure Behavior
- If non-critical image download fails, keep recipe and attach warning.
- If main image required by design but missing, keep null and show warning.

## Acceptance Criteria
- Hosted URLs are stable across sessions.
- Card renderer consumes hosted URLs only.
- Missing images do not break recipe output.