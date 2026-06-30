/**
 * Task store — the only durable state the worker owns. An embedded better-sqlite3
 * database tracking the async task lifecycle:
 *
 *   queued → running → done | exited(+reason)
 *
 * Near-stateless by design: just task records (status / result / reason) so a
 * caller can poll, and so status survives a restart. better-sqlite3 is
 * single-threaded + synchronous, so claimNext's select+update cannot interleave
 * with another claim (no lease/race handling needed within one process).
 *
 * Uses better-sqlite3 (the SAME store db.ts uses) — NOT node:sqlite. node:sqlite
 * (DatabaseSync) is experimental and throws on import unless run with
 * `--experimental-sqlite` (Node 22/23) or Node ≥24, so a normal container boot
 * crash-loops before the HTTP server can listen. better-sqlite3 is a prebuilt
 * native module that works on Node ≥18 with no flags.
 */
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";

export type TaskStatus = "queued" | "running" | "done" | "exited";

export interface TaskRow {
  task_id: string;
  endpoint: string;
  macro_id: string;
  params: Record<string, unknown>;
  status: TaskStatus;
  reason: string | null;
  result: unknown;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  endpoint: string;
  macro_id: string;
  params: Record<string, unknown>;
}

interface RawRow {
  task_id: string;
  endpoint: string;
  macro_id: string;
  params: string;
  status: string;
  reason: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
}

const nowIso = (): string => new Date().toISOString();

function hydrate(row: RawRow): TaskRow {
  return {
    task_id: row.task_id,
    endpoint: row.endpoint,
    macro_id: row.macro_id,
    params: JSON.parse(row.params) as Record<string, unknown>,
    status: row.status as TaskStatus,
    reason: row.reason,
    result: row.result === null ? null : (JSON.parse(row.result) as unknown),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class TaskStore {
  private readonly db: Database.Database;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        task_id    TEXT PRIMARY KEY,
        endpoint   TEXT NOT NULL,
        macro_id   TEXT NOT NULL,
        params     TEXT NOT NULL,
        status     TEXT NOT NULL,
        reason     TEXT,
        result     TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status, created_at);
    `);
  }

  create(input: CreateTaskInput): TaskRow {
    const id = `task_${randomUUID().replace(/-/g, "")}`;
    const ts = nowIso();
    this.db
      .prepare(
        `INSERT INTO tasks (task_id, endpoint, macro_id, params, status, reason, result, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)`,
      )
      .run(id, input.endpoint, input.macro_id, JSON.stringify(input.params), ts, ts);
    return this.get(id)!;
  }

  get(taskId: string): TaskRow | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE task_id = ?`).get(taskId) as RawRow | undefined;
    return row ? hydrate(row) : null;
  }

  /** Claim the oldest queued task and flip it to running. Returns null if none. */
  claimNext(): TaskRow | null {
    const row = this.db
      .prepare(`SELECT task_id FROM tasks WHERE status = 'queued' ORDER BY created_at, task_id LIMIT 1`)
      .get() as { task_id: string } | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE tasks SET status = 'running', updated_at = ? WHERE task_id = ? AND status = 'queued'`)
      .run(nowIso(), row.task_id);
    return this.get(row.task_id);
  }

  complete(taskId: string, result: unknown): void {
    this.db
      .prepare(`UPDATE tasks SET status = 'done', result = ?, reason = NULL, updated_at = ? WHERE task_id = ?`)
      .run(JSON.stringify(result ?? null), nowIso(), taskId);
  }

  fail(taskId: string, reason: string): void {
    this.db
      .prepare(`UPDATE tasks SET status = 'exited', reason = ?, updated_at = ? WHERE task_id = ?`)
      .run(reason, nowIso(), taskId);
  }

  close(): void {
    this.db.close();
  }
}
