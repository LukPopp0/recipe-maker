import type { ApiErrorEnvelope, ApiSuccessEnvelope } from 'shared'
import { ERROR_STATUS_MAP, serializeError } from './errors.js'

// Builds a success envelope per specs/03: { ok: true, requestId, ...payload }.
export function ok<T extends object = Record<string, never>>(
  requestId: string,
  payload?: T,
): ApiSuccessEnvelope<T> {
  return {
    ok: true,
    requestId,
    ...(payload ?? ({} as T)),
  }
}

// Builds an error envelope (and matching HTTP status) from any thrown value,
// via serializeError, per specs/03: { ok: false, requestId, error }.
export function fail(requestId: string, err: unknown): { envelope: ApiErrorEnvelope; status: number } {
  const error = serializeError(err)

  return {
    envelope: {
      ok: false,
      requestId,
      error,
    },
    status: ERROR_STATUS_MAP[error.code],
  }
}
