// Client-side mirror of the manual-upload limits enforced server-side, so the
// UI can reject bad uploads before spending a round trip. Keep these in sync
// with server/src/env.ts's IMAGE_MAX_BYTES / MANUAL_REQUEST_MAX_BYTES
// defaults and server/src/services/images/image-rehoster.ts's accepted mime
// types.
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Matches server/src/env.ts IMAGE_MAX_BYTES default.
export const MAX_IMAGE_BYTES = 8_000_000;

// Matches server/src/env.ts MANUAL_REQUEST_MAX_BYTES default.
export const MAX_MANUAL_REQUEST_BYTES = 20_000_000;

export type ManualUploadFields = {
  ingredientsText: string
  stepsText: string
  mainImage: File | undefined
  stepImages: File[]
}

function isAcceptedType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

function validateImageFile(file: File, errors: string[]): void {
  if (file.size > MAX_IMAGE_BYTES) {
    errors.push(`${file.name} is too large (max ${MAX_IMAGE_BYTES / 1_000_000} MB per image).`);
  }

  if (!isAcceptedType(file.type)) {
    errors.push(`${file.name} is not a supported image type (jpeg, png, webp only).`);
  }
}

// Returns a list of human-readable error messages for a manual-ingestion
// upload payload; an empty list means the payload is clean.
export function validateManualUpload(fields: ManualUploadFields): string[] {
  const errors: string[] = [];

  if (fields.ingredientsText.trim().length === 0) {
    errors.push('Ingredients text is required.');
  }

  if (fields.stepsText.trim().length === 0) {
    errors.push('Steps text is required.');
  }

  if (!fields.mainImage) {
    errors.push('A main image is required.');
  }

  const allFiles = [fields.mainImage, ...fields.stepImages].filter((file): file is File => Boolean(file));

  for (const file of allFiles) {
    validateImageFile(file, errors);
  }

  const totalBytes = allFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_MANUAL_REQUEST_BYTES) {
    errors.push(`The total upload size exceeds the ${MAX_MANUAL_REQUEST_BYTES / 1_000_000} MB limit.`);
  }

  return errors;
}
