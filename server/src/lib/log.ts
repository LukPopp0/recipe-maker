export type StageLogFields = {
  requestId: string;
  stage: 'fetch' | 'extract' | 'host-images' | 'normalize' | 'post-process' | 'image-rehost';
  durationMs: number;
  outcome: 'ok' | 'error';
  errorCode?: string;
} & Record<string, unknown>;

// Emits one structured JSON log line with stage-specific details,
// rounded durationMs, and spread extra fields (fetchMode, imageCount, etc).
export function logStage(fields: StageLogFields): void {
  console.log(
    JSON.stringify({
      ...fields,
      durationMs: Math.round(fields.durationMs),
    }),
  );
}
