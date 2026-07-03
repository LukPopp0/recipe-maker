import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { CanonicalRecipe, RecipeSummary } from 'shared';
import type { RecipeRepository } from './recipe-repository.js';

type RecipeEnvelope = {
  id: string
  createdAt: string
  recipe: CanonicalRecipe
}

function isNodeError(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === code;
}

// Milestone 1 default RecipeRepository implementation per specs/13: one JSON file
// per recipe under {dataDir}, named {id}.json, storing an envelope of
// {id, createdAt, recipe} so list() can read summary fields without parsing the
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

  async save(recipe: CanonicalRecipe): Promise<{ id: string }> {
    await mkdir(this.dataDir, { recursive: true });

    const envelope: RecipeEnvelope = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      recipe,
    };

    await writeFile(this.filePath(envelope.id), JSON.stringify(envelope, null, 2), 'utf-8');

    return { id: envelope.id };
  }

  async get(id: string): Promise<CanonicalRecipe | null> {
    try {
      const raw = await readFile(this.filePath(id), 'utf-8');
      const envelope = JSON.parse(raw) as RecipeEnvelope;
      return envelope.recipe;
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return null;
      }
      throw err;
    }
  }

  async list(): Promise<RecipeSummary[]> {
    let files: string[];
    try {
      files = await readdir(this.dataDir);
    } catch (err) {
      if (isNodeError(err, 'ENOENT')) {
        return [];
      }
      throw err;
    }

    const summaries: RecipeSummary[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const raw = await readFile(path.join(this.dataDir, file), 'utf-8');
      const envelope = JSON.parse(raw) as RecipeEnvelope;
      summaries.push({
        id: envelope.id,
        title: envelope.recipe.title,
        tags: envelope.recipe.tags,
        main_image: envelope.recipe.main_image,
        createdAt: envelope.createdAt,
      });
    }

    summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return summaries;
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
