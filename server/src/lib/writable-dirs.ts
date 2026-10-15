import { access, constants, mkdir } from 'node:fs/promises';

export type WritableDirsResult = { ok: true } | { ok: false; name: string; dir: string; error: string };

// Creates each directory if missing and checks it is writable. Stops at the
// first failure and names it, so a wrong volume permission on one directory
// is identifiable from the startup log and /api/health instead of surfacing
// later as failing saves or image uploads.
export async function ensureWritableDirs(dirs: Record<string, string>): Promise<WritableDirsResult> {
  for (const [name, dir] of Object.entries(dirs)) {
    try {
      await mkdir(dir, { recursive: true });
      await access(dir, constants.W_OK);
    } catch (err) {
      return { ok: false, name, dir, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true };
}
