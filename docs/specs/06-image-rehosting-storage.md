# Spec 06: Image Re-hosting and Storage

## Goal
Download and serve recipe images from app-managed storage for stable rendering.

## Storage Abstraction
Define interface:
- put(fileBuffer, key, contentType) -> publicUrl
- get(key) -> stream/buffer
- delete(key)
- list(prefix) -> StoredObject[] ({ key, sizeBytes, modifiedAt })

Implementations:
- LocalDiskStorageAdapter (milestone 1 default).
- ResizingStorageAdapter: decorator around any adapter (wraps LocalDiskStorageAdapter
  in the server entry point). Every put (step uploads, manual ingest images,
  re-hosted URL images) goes through normalization first, so call sites need no
  changes.
- CloudStorageAdapter (future).

## Image Sources
- Option A: remote image URLs from extracted recipe.
- Option B: user-uploaded files.

## Processing Rules
1. Validate MIME type (jpeg/png/webp).
2. Validate max size per image.
3. Normalize every image (sharp): EXIF auto-rotate, fit inside 1600x1600 (never
   upscale), flatten transparency onto white (#ffffff), strip metadata, re-encode
   as JPEG quality 82.
4. Generate key naming:
   - re-hosted URL images: recipes/{recipeId}/{kind}-{index}.jpg (fresh namespace
     per ingest, so the key is deterministic within it)
   - uploaded images (manual ingest, step upload):
     recipes/{recipeId}/{kind}-{index}-{8 hex chars}.jpg. The random suffix makes
     every upload a new file: a re-upload never rewrites a file a saved recipe
     already shows (or another recipe's, via a shared namespace), and the URL
     changes so browsers never serve a cached old image. Replaced files become
     unreferenced and the admin "Unused images" cleanup removes them.
   The extension is always `.jpg` (the key is rewritten whatever the source
   format) and the stored content type is `image/jpeg`.
5. Store image and return hosted URL.

Only JPEG, PNG and WebP are decoded, whatever the declared content type (checked from the
file header before decoding); SVG, GIF, TIFF, HEIF etc. are rejected like undecodable bytes.

Undecodable bytes (corrupt data with an image content type) are not stored and
never cause a 500: the upload hoster returns the warning "<file> was not
uploaded: the file is not a readable image."; the remote fetcher returns its
generic image-download error result.

## Image Lifecycle
- Image URLs of the form `${PUBLIC_BASE_URL}/images/<key>` or `/images/<key>`
  map to a storage key; only keys matching `recipes/<namespace>/<file>` count.
  External URLs, the default placeholder and ingredient catalog filenames never
  map to a key and are never deleted.
- Deleting a recipe deletes the local images it references that no other saved
  recipe references. Failures (including failing to list the remaining recipes)
  are logged and never fail the delete.
- Which keys are still *used* (by remaining recipes on delete, by all recipes in
  the admin cleanup) is decided from the URL path only, ignoring origin and
  query string, so images saved under an older `PUBLIC_BASE_URL` are not treated
  as unused. A `PUBLIC_BASE_URL` with a path (`https://host/app`) also counts:
  `/app/images/...` and `/images/...` both match. `PUBLIC_BASE_URL` is stored
  without trailing slashes. Which keys a delete may remove stays strict (own origin or
  root-relative only).
- Images of unsaved ingests stay on disk until an admin cleans them up.
- Admin "Unused images" cleanup (Library scope bar, admin only): lists stored
  images under `recipes/` that no saved recipe references and that are older than
  24 hours (so a fresh, not-yet-saved ingest is never offered), with a total, and
  "Delete all" (after confirmation). The server re-derives the unused set on
  delete, so referenced or foreign keys sent by a client are ignored. The
  server accepts at most 500 keys per delete request; the UI sends "Delete all"
  in sequential batches of 500 and stops at the first failure. See spec 03 for
  the endpoints.

## Metadata Rules
- Keep source image URL in diagnostics metadata for Option A.
- Canonical recipe should use hosted URL/path.

## Failure Behavior
- If non-critical image download fails, keep recipe and attach warning.
- If main image required by design but missing, keep null and show warning.

## Acceptance Criteria
- Hosted URLs are stable across sessions.
- Inputs above 50 million decoded pixels are rejected as undecodable (guards
  against decompression bombs).
- Stored images are at most 1600 px on the longest side, JPEG, without metadata.
- Card renderer consumes hosted URLs only.
- Missing images do not break recipe output.