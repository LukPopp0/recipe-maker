import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ServerEnv } from '../env.js';
import { AppError } from '../lib/errors.js';
import { ok } from '../lib/response.js';
import type { AppVariables } from '../middleware/request-id.js';
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

// Standalone image upload for the review panel (specs/14): lets the user add
// or replace a single step image after ingestion, before Save. Reuses the
// manual-ingestion hosting path (same MIME/size validation, same
// recipes/{id}/step-{i} key scheme), so a re-upload for the same step
// overwrites the previous file. Deliberately NOT mounted under /ingest/* -
// the ingestion rate limiter must not throttle uploads.
export function createImageApp(deps: ImageDeps) {
  const app = new Hono<{ Variables: AppVariables }>();
  const { env, storageAdapter } = deps;

  app.use(
    '/image/step',
    bodyLimit({
      maxSize: env.MANUAL_REQUEST_MAX_BYTES,
      onError: () => {
        throw new AppError('INVALID_INPUT', 'The upload request exceeds the maximum allowed size.');
      },
    }),
  );

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

    const result = await hostUploadedImage(
      {
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
        filename: file.name,
      },
      {
        recipeId: parsed.data.namespaceId,
        storageAdapter,
        maxBytes: env.IMAGE_MAX_BYTES,
        kind: 'step',
        index: parsed.data.stepIndex,
      },
    );

    if ('warning' in result) {
      throw new AppError('INVALID_INPUT', result.warning);
    }

    return c.json(ok(requestId, { url: result.url }));
  });

  return app;
}
