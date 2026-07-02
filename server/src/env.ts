import path from 'node:path'
import { z } from 'zod'

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
})

export type ServerEnv = z.infer<typeof ServerEnvSchema>

// Validates and normalizes raw process.env-style input into a typed ServerEnv,
// resolving RECIPE_DATA_DIR to an absolute path. Throws a descriptive error on
// invalid values (e.g. an unrecognized NODE_ENV or a non-numeric PORT).
export function loadServerEnv(raw: RawEnv): ServerEnv {
  const result = ServerEnvSchema.safeParse(raw)

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid server environment configuration: ${issues}`)
  }

  return result.data
}
