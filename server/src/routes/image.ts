import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LinkImageRequestSchema, ImageSlotSchema, type ImageSlot } from 'shared';
import { z } from 'zod';
import type { ServerEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import { parseJsonBody } from '../middleware/validate.js';
import type { AppVariables } from '../middleware/request-id.js';
import { fetchAndStoreRemoteImage, type FetchAndStoreRemoteImageResult } from '../services/images/remote-image-fetcher.js';
import { hostUploadedImage } from '../services/images/upload-image-hoster.js';
import type { StorageAdapter } from '../services/storage/storage-adapter.js';

export type ImageDeps = {
  env: ServerEnv
  storageAdapter: StorageAdapter
}

// namespaceId becomes part of the storage key, so it must be a bare UUID -
// this is what blocks path traversal into other storage locations.
const StepImageFieldsSchema = z.object({
  namespaceId: z.string().uuid(),
  stepIndex: z.coerce.number().int().min(0).max(5),
});

const UploadImageFieldsSchema = z.object({
  namespaceId: z.string().uuid(),
  slot: ImageSlotSchema,
});

// Standalone image upload for the review panel (docs/specs/14): lets the user add
// or replace a single step image after ingestion, before Save. Reuses the
// manual-ingestion hosting path (same MIME/size validation, same
// recipes/{id}/step-{i}-{suffix} key scheme). Every upload gets a new unique
// key, so a re-upload never overwrites a file a saved recipe shows; the old
// file stays until the 24 h admin cleanup. Deliberately NOT mounted under /ingest/* -
// the ingestion rate limiter must not throttle uploads.
// User-facing reason for a failed Link download (the 401/403 and blocked cases
// are handled before this is called).
function describeLinkFailure(
  result: Extract<FetchAndStoreRemoteImageResult, { ok: false }>,
  maxBytes: number,
): string {
  switch (result.reason) {
    case 'blocked':
      return 'the address is blocked or invalid';
    case 'status':
      return `the site answered with status ${result.status}`;
    case 'unsupported-type':
      return `unsupported content type "${result.contentType}"`;
    case 'oversized':
      return `the image is over the ${maxBytes}-byte limit`;
    case 'timeout':
      return 'the download timed out';
    case 'error':
      return `the download failed (${result.message})`;
  }
}

export function createImageApp(deps: ImageDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { env, storageAdapter } = deps;

  const uploadLimit = bodyLimit({
    maxSize: env.MANUAL_REQUEST_MAX_BYTES,
    onError: () => {
      throw new AppError('INVALID_INPUT', 'The upload request exceeds the maximum allowed size.');
    },
  });
  app.use('/image/step', uploadLimit);
  app.use('/image/upload', uploadLimit);

  // Hosts an uploaded file in a slot ('main' or a step index) under a fresh unique key.
  async function hostSlotUpload(file: File, namespaceId: string, slot: ImageSlot): Promise<string> {
    const result = await hostUploadedImage(
      {
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
        filename: file.name,
      },
      {
        recipeId: namespaceId,
        storageAdapter,
        maxBytes: env.IMAGE_MAX_BYTES,
        kind: slot === 'main' ? 'main' : 'step',
        index: slot === 'main' ? 0 : slot,
      },
    );

    if ('warning' in result) {
      throw new AppError('INVALID_INPUT', result.warning);
    }
    return result.url;
  }

  app.post('/image/step', async (c) => {
    const requestId = c.get('requestId');

    const body = await c.req.parseBody();
    const parsed = StepImageFieldsSchema.safeParse({
      namespaceId: body.namespaceId,
      stepIndex: body.stepIndex,
    });
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', 'namespaceId must be a UUID and stepIndex an integer from 0 to 5.', {
        issues: parsed.error.issues,
      });
    }

    const file = body.file;
    if (!(file instanceof File)) {
      throw new AppError('INVALID_INPUT', 'A "file" image upload is required.');
    }

    const url = await hostSlotUpload(file, parsed.data.namespaceId, parsed.data.stepIndex);

    return c.json(ok(requestId, { url }));
  });

  app.post('/image/upload', async (c) => {
    const body = await c.req.parseBody();
    const parsed = UploadImageFieldsSchema.safeParse({
      namespaceId: body.namespaceId,
      slot: body.slot,
    });
    if (!parsed.success) {
      throw new AppError('INVALID_INPUT', 'namespaceId must be a UUID and slot "main" or an integer from 0 to 5.', {
        issues: parsed.error.issues,
      });
    }

    const file = body.file;
    if (!(file instanceof File)) {
      throw new AppError('INVALID_INPUT', 'A "file" image upload is required.');
    }

    const url = await hostSlotUpload(file, parsed.data.namespaceId, parsed.data.slot);
    return c.json(ok(c.get('requestId'), { url }));
  });

  // Downloads an image from a user-supplied URL into a slot. Every call gets a
  // fresh key suffix so a re-link never overwrites a file a saved recipe shows.
  app.post('/image/link', async (c) => {
    const { namespaceId, slot, url } = await parseJsonBody(c, LinkImageRequestSchema);
    const label = slot === 'main' ? 'main-0' : `step-${slot}`;

    const result = await fetchAndStoreRemoteImage(url, {
      storageAdapter,
      maxBytes: env.IMAGE_MAX_BYTES,
      keyPrefix: `recipes/${namespaceId}/${label}-${randomBytes(4).toString('hex')}`,
      timeoutMs: env.URL_FETCH_TIMEOUT_MS,
    });

    if (!result.ok) {
      if (result.reason === 'blocked') {
        throw new AppError('INVALID_URL', 'The image URL is invalid or points to a blocked address.');
      }
      if (result.reason === 'status' && (result.status === 401 || result.status === 403)) {
        throw new AppError(
          'IMAGE_DOWNLOAD_FAILED',
          'This site blocks downloads, copy the image and paste it instead.',
          { status: result.status },
        );
      }
      throw new AppError(
        'IMAGE_DOWNLOAD_FAILED',
        `Could not download the image: ${describeLinkFailure(result, env.IMAGE_MAX_BYTES)}.`,
      );
    }

    return c.json(ok(c.get('requestId'), { url: result.url }));
  });

  return app;
}
