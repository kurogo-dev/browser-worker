/**
 * The worker's durable store (better-sqlite3, WAL). Holds the crown-jewel
 * state: the macros it has harvested. A deploy MUST keep this DB on a
 * persistent volume + back it up — losing it means re-harvesting every site.
 *
 * Tables:
 *   - categories: the landscape grouping (ATS/platform families) + the
 *     detection signatures and an optional skeleton macro that seeds harvest
 *     for a new site in the category.
 *   - macros: PER-SITE recipes (PRIMARY KEY (site, name)); `site = '*'` is a
 *     category-level macro that serves any site in that category.
 *   - tasks: async apply-task lifecycle (queued → running → done | exited).
 *   - idempotency: last result per Idempotency-Key (retry-safe), with expiry.
 */
import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { parseMacro } from "./macro/schema.js";
import type { Macro } from "./macro/types.js";

export interface CategoryRow {
  id: string;
  name: string;
  /** URL globs + DOM fingerprints that mark this platform. */
  signatures: unknown[];
  /** Optional bootstrap macro for harvesting a new site in this category. */
  skeleton: Macro | null;
  description: string;
}

export interface WorkerDb {
  // categories
  upsertCategory(c: Omit<CategoryRow, "skeleton"> & { skeleton?: Macro | null }): void;
  listCategories(): CategoryRow[];
  // macros (per-site)
  putMacro(macro: Macro): void;
  /** Resolve a macro for a site: exact site → category-level ('*') → null. */
  resolveMacro(site: string, category: string, name: string): Macro | null;
  getMacro(site: string, name: string): Macro | null;
  listMacros(): Macro[];
  // idempotency
  getIdempotent(key: string): unknown | undefined;
  putIdempotent(key: string, result: unknown, ttlMs: number): void;
  close(): void;
}

interface MacroRawRow {
  site: string;
  name: string;
  category: string;
  spec_json: string;
}

export function openDb(dbPath: string): WorkerDb {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL,
      signatures_json TEXT NOT NULL DEFAULT '[]',
      skeleton_json   TEXT,
      description     TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS macros (
      site       TEXT NOT NULL,
      name       TEXT NOT NULL,
      category   TEXT NOT NULL DEFAULT '',
      spec_json  TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (site, name)
    );
    CREATE INDEX IF NOT EXISTS macros_category_idx ON macros (category);
    CREATE TABLE IF NOT EXISTS idempotency (
      key         TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      expires_at  INTEGER NOT NULL
    );
  `);

  const upsertCategoryStmt = db.prepare(`
    INSERT INTO categories (id, name, signatures_json, skeleton_json, description)
    VALUES (@id, @name, @signatures_json, @skeleton_json, @description)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      signatures_json = excluded.signatures_json,
      skeleton_json = excluded.skeleton_json,
      description = excluded.description
  `);
  const listCategoriesStmt = db.prepare(`SELECT * FROM categories ORDER BY name`);

  const putMacroStmt = db.prepare(`
    INSERT INTO macros (site, name, category, spec_json, version, enabled, updated_at)
    VALUES (@site, @name, @category, @spec_json, @version, @enabled, @updated_at)
    ON CONFLICT(site, name) DO UPDATE SET
      category = excluded.category,
      spec_json = excluded.spec_json,
      version = excluded.version,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `);
  const getMacroStmt = db.prepare(`SELECT spec_json FROM macros WHERE site = ? AND name = ? AND enabled = 1`);
  const resolveExactStmt = db.prepare(
    `SELECT spec_json FROM macros WHERE site = ? AND name = ? AND enabled = 1`,
  );
  const resolveCategoryStmt = db.prepare(
    `SELECT spec_json FROM macros WHERE site = '*' AND category = ? AND name = ? AND enabled = 1`,
  );
  const listMacrosStmt = db.prepare(`SELECT spec_json FROM macros ORDER BY site, name`);

  const getIdemStmt = db.prepare(`SELECT result_json, expires_at FROM idempotency WHERE key = ?`);
  const putIdemStmt = db.prepare(`
    INSERT INTO idempotency (key, result_json, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET result_json = excluded.result_json, expires_at = excluded.expires_at
  `);

  const toMacro = (row: { spec_json: string } | undefined): Macro | null =>
    row ? parseMacro(JSON.parse(row.spec_json)) : null;

  return {
    upsertCategory(c) {
      upsertCategoryStmt.run({
        id: c.id,
        name: c.name,
        signatures_json: JSON.stringify(c.signatures ?? []),
        skeleton_json: c.skeleton ? JSON.stringify(c.skeleton) : null,
        description: c.description ?? "",
      });
    },
    listCategories() {
      const rows = listCategoriesStmt.all() as Array<{
        id: string; name: string; signatures_json: string; skeleton_json: string | null; description: string;
      }>;
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        signatures: JSON.parse(r.signatures_json) as unknown[],
        skeleton: r.skeleton_json ? parseMacro(JSON.parse(r.skeleton_json)) : null,
        description: r.description,
      }));
    },
    putMacro(macro) {
      putMacroStmt.run({
        site: macro.site,
        name: macro.name,
        category: macro.category,
        spec_json: JSON.stringify(macro),
        version: macro.version,
        enabled: macro.enabled ? 1 : 0,
        updated_at: macro.updated_at,
      });
    },
    resolveMacro(site, category, name) {
      return (
        toMacro(resolveExactStmt.get(site, name) as { spec_json: string } | undefined) ??
        toMacro(resolveCategoryStmt.get(category, name) as { spec_json: string } | undefined)
      );
    },
    getMacro(site, name) {
      return toMacro(getMacroStmt.get(site, name) as { spec_json: string } | undefined);
    },
    listMacros() {
      const rows = listMacrosStmt.all() as MacroRawRow[];
      return rows.map((r) => parseMacro(JSON.parse(r.spec_json)));
    },
    getIdempotent(key) {
      const row = getIdemStmt.get(key) as { result_json: string; expires_at: number } | undefined;
      if (!row || row.expires_at < Date.now()) return undefined;
      return JSON.parse(row.result_json);
    },
    putIdempotent(key, result, ttlMs) {
      putIdemStmt.run(key, JSON.stringify(result ?? null), Date.now() + ttlMs);
    },
    close() {
      db.close();
    },
  };
}
