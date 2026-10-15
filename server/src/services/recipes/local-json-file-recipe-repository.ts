import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalRecipe, RecipeSummary } from 'shared';
import { toRecipeSummary, type RecipeRepository, type StoredRecipe } from './recipe-repository.js';

// owner/updatedAt were added with multi-user support; files written before
// that lack them and are read as owned by "local" (the AUTH_MODE=none user).
type RecipeEnvelope = {
  id: string
  createdAt: string
  updatedAt?: string
  owner?: string
  recipe: CanonicalRecipe
}

const LEGACY_OWNER = 'local';

function toStored(envelope: RecipeEnvelope): StoredRecipe {
  return {
    id: envelope.id,
    owner: envelope.owner ?? LEGACY_OWNER,
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt ?? envelope.createdAt,
    recipe: envelope.recipe,
  };
}

function isNodeError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === code;
}

// Milestone 1 default RecipeRepository implementation per docs/specs/13: one JSON file
// per recipe under {dataDir}, named {id}.json, storing an envelope of
// {id, createdAt, updatedAt, owner, recipe} so list() can read summary fields without parsing the
// full canonical recipe body separately.
export class LocalJsonFileRecipeRepository implements RecipeRepository {
  constructor(private readonly dataDir: string) {}

  // Defense-in-depth against path traversal: callers (routes) should already
  // validate `id` as a UUID before it reaches this repository, but this class
  // must also be safe on its own if a future caller forgets to do so. Reject
  // any id containing a path separator outright, then confirm the resolved
  // path still lives inside dataDir.
  private filePath(id: string): string {
    if (id.includes('/') || id.includes('\\')) {
      throw new Error(`Invalid recipe id: "${id}"`);
    }

    const resolvedDataDir = path.resolve(this.dataDir);
    const resolvedPath = path.resolve(resolvedDataDir, `${id}.json`);

    if (resolvedPath !== path.join(resolvedDataDir, `${id}.json`) || !resolvedPath.startsWith(resolvedDataDir + path.sep)) {
      throw new Error(`Invalid recipe id: "${id}"`);
    }

    return resolvedPath;
  }

  async save(recipe: CanonicalRecipe, owner: string): Promise<{ id: string }> {
    await mkdir(this.dataDir, { recursive: true });

    const now = new Date().toISOString();
    const envelope: RecipeEnvelope = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      owner,
      recipe,
    };

    await writeFile(this.filePath(envelope.id), JSON.stringify(envelope, null, 2), 'utf-8');

    return { id: envelope.id };
  }

  private async readEnvelope(id: string): Promise<RecipeEnvelope | null> {
    try {
      const raw = await readFile(this.filePath(id), 'utf-8');
      return JSON.parse(raw) as RecipeEnvelope;
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return null;
      }
      throw err;
    }
  }

  async get(id: string): Promise<StoredRecipe | null> {
    const envelope = await this.readEnvelope(id);
    return envelope ? toStored(envelope) : null;
  }

  async update(id: string, recipe: CanonicalRecipe): Promise<boolean> {
    const envelope = await this.readEnvelope(id);
    if (!envelope) {
      return false;
    }

    const next = { ...toStored(envelope), recipe, updatedAt: new Date().toISOString() };
    await writeFile(this.filePath(id), JSON.stringify(next, null, 2), 'utf-8');

    return true;
  }

  private async readAll(): Promise<StoredRecipe[]> {
    let files: string[];
    try {
      files = await readdir(this.dataDir);
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return [];
      }
      throw err;
    }

    const all: StoredRecipe[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await readFile(path.join(this.dataDir, file), 'utf-8');
      all.push(toStored(JSON.parse(raw) as RecipeEnvelope));
    }

    return all;
  }

  async getAll(): Promise<StoredRecipe[]> {
    return this.readAll();
  }

  async list(filter: { owner?: string } = {}): Promise<RecipeSummary[]> {
    const all = await this.readAll();

    return all
      .filter((stored) => filter.owner === undefined || stored.owner === filter.owner)
      .map(toRecipeSummary)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async delete(id: string): Promise<void> {
    try {
      await rm(this.filePath(id));
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return;
      }
      throw err;
    }
  }
}
