import type { Context } from 'hono';
import type { z } from 'zod';
import { AppError } from '../lib/errors.js';

// Parses the request body as JSON, throwing a standard INVALID_INPUT AppError
// if the body is missing or not valid JSON. Exported separately from
// parseJsonBody so callers that need a different error code on *schema*
// failure (e.g. /recipe/save uses SCHEMA_VALIDATION_FAILED rather than
// INVALID_INPUT) can still reuse the malformed-JSON handling here instead of
// duplicating it.
export async function parseJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError('INVALID_INPUT', 'The request body must be valid JSON.');
  }
}

// Generic body parser+validator for routes that want a single INVALID_INPUT
// error code for both malformed JSON and schema-validation failures. Parses
// the request JSON (via parseJson) then validates it against the given zod
// schema, throwing AppError('INVALID_INPUT', ..., {issues}) with the
// flattened zod error on validation failure. Returns the parsed, typed data
// on success.
export async function parseJsonBody<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  const body = await parseJson(c);
  const result = schema.safeParse(body);

  if (!result.success) {
    throw new AppError('INVALID_INPUT', 'The request payload was invalid.', {
      issues: result.error.flatten(),
    });
  }

  return result.data;
}
