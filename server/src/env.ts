import path from 'node:path';
import { z } from 'zod';

// Raw process.env-shaped input: every value is a string (or undefined) before
// coercion/validation.
export type RawEnv = Record<string, string | undefined>

const ServerEnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  RECIPE_DATA_DIR: z
    .string()
    .default('./data/recipes')
    .transform((value) => path.resolve(value)),
  DEFAULT_MAIN_IMAGE_URL: z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  URL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  BROWSER_FALLBACK_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value !== 'false' && value !== '0'),
  BROWSER_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  URL_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(3),
  URL_MAX_RESPONSE_BYTES: z.coerce.number().int().positive().default(5_000_000),
  IMAGE_DATA_DIR: z
    .string()
    .default('./data/images')
    .transform((value) => path.resolve(value)),
  IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(8_000_000),
  MANUAL_REQUEST_MAX_BYTES: z.coerce.number().int().positive().default(20_000_000),
  INGREDIENT_ASSET_DIR: z
    .string()
    .default('../shared/assets/ingredients')
    .transform((value) => path.resolve(value)),
  // No schema-level default: PUBLIC_BASE_URL defaults to
  // `http://localhost:{PORT}` in loadServerEnv below, once PORT is known.
  PUBLIC_BASE_URL: z
    .string()
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
});

// PUBLIC_BASE_URL is optional at the schema level but loadServerEnv always
// resolves it (defaulting to http://localhost:{PORT}), so the exported type
// guarantees a string for callers.
export type ServerEnv = Omit<z.infer<typeof ServerEnvSchema>, 'PUBLIC_BASE_URL'> & {
  PUBLIC_BASE_URL: string
}

// Validates and normalizes raw process.env-style input into a typed ServerEnv,
// resolving RECIPE_DATA_DIR/IMAGE_DATA_DIR/INGREDIENT_ASSET_DIR to absolute paths and defaulting
// PUBLIC_BASE_URL to `http://localhost:{PORT}` when not supplied. Throws a
// descriptive error on invalid values (e.g. an unrecognized NODE_ENV or a
// non-numeric PORT).
export function loadServerEnv(raw: RawEnv): ServerEnv {
  const result = ServerEnvSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server environment configuration: ${issues}`);
  }

  return {
    ...result.data,
    PUBLIC_BASE_URL: result.data.PUBLIC_BASE_URL ?? `http://localhost:${result.data.PORT}`,
  };
}
