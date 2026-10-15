import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { CanonicalRecipe, RecipeSummary } from 'shared';
import { toRecipeSummary, type RecipeRepository, type StoredRecipe } from './recipe-repository.js';

type RecipeRow = {
  id: string
  owner: string
  created_at: string
  updated_at: string
  data: string
}

const SCHEMA_VERSION = 1;

// Applies schema migrations in order, tracked by PRAGMA user_version.
function migrate(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS recipes (
        id          TEXT PRIMARY KEY,
        owner       TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        data        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recipes_owner_created ON recipes (owner, created_at);
    `);
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

function toStored(row: RecipeRow): StoredRecipe {
  return {
    id: row.id,
    owner: row.owner,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipe: JSON.parse(row.data) as CanonicalRecipe,
  };
}

// Production RecipeRepository (deployment spec section 3): one SQLite file,
// recipe bodies stored as JSON text. better-sqlite3 is synchronous; methods
// stay async to match the interface. WAL lets reads run during a write.
export class SqliteRecipeRepository implements RecipeRepository {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    migrate(this.db);
  }

  close(): void {
    this.db.close();
  }

  async save(recipe: CanonicalRecipe, owner: string): Promise<{ id: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO recipes (id, owner, created_at, updated_at, data) VALUES (?, ?, ?, ?, ?)')
      .run(id, owner, now, now, JSON.stringify(recipe));
    return { id };
  }

  async update(id: string, recipe: CanonicalRecipe): Promise<boolean> {
    const result = this.db
      .prepare('UPDATE recipes SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(recipe), new Date().toISOString(), id);
    return result.changes > 0;
  }

  async get(id: string): Promise<StoredRecipe | null> {
    const row = this.db.prepare('SELECT * FROM recipes WHERE id = ?').get(id) as RecipeRow | undefined;
    return row ? toStored(row) : null;
  }

  async getAll(): Promise<StoredRecipe[]> {
    const rows = this.db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all() as RecipeRow[];
    return rows.map(toStored);
  }

  async list(filter: { owner?: string } = {}): Promise<RecipeSummary[]> {
    const rows = (
      filter.owner === undefined
        ? this.db.prepare('SELECT * FROM recipes ORDER BY created_at DESC').all()
        : this.db.prepare('SELECT * FROM recipes WHERE owner = ? ORDER BY created_at DESC').all(filter.owner)
    ) as RecipeRow[];
    return rows.map((row) => toRecipeSummary(toStored(row)));
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM recipes WHERE id = ?').run(id);
  }
}
