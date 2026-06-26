/**
 * Worker HTTP API — generic, node:http, no framework.
 *
 *   GET  /health         open liveness + identity
 *   POST /apply          bearer → validate → (idempotent) enqueue → 202 {task_id}
 *   GET  /tasks/:id      bearer → task status / result / reason
 *
 * Async by default: POST acks immediately; the worker drains the queue and runs
 * the apply. `Idempotency-Key` makes a retry return the same task. Auth is a
 * server-to-server bearer (empty token = open, dev only). The body is generic
 * (`target_url` + `fields` k/v) — NO project-specific shape.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { TaskStore } from "./task-store.js";

export interface ServerConfig {
  /** Bearer token callers must present. Empty string = open (dev only). */
  apiToken: string;
  workerId: string;
}

export interface ServerDeps {
  config: ServerConfig;
  store: TaskStore;
  /** key → task_id map for in-flight idempotent dedup. */
  idempotency: Map<string, string>;
}

const MAX_BODY_BYTES = 2_000_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("body_too_large");
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function authorized(req: IncomingMessage, token: string): boolean {
  if (token.length === 0) return true; // open (dev)
  const header = req.headers.authorization ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? (header[0] ?? "") : header);
  return m !== null && m[1] === token;
}

export function createWorkerServer(deps: ServerDeps): Server {
  const { config, store, idempotency } = deps;

  return createServer((req, res) => {
    void handle(req, res).catch((err) => {
      send(res, 500, { error: "internal", detail: err instanceof Error ? err.message : String(err) });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    if (method === "GET" && path === "/health") {
      send(res, 200, { ok: true, worker_id: config.workerId });
      return;
    }

    const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
    if (method === "GET" && taskMatch) {
      if (!authorized(req, config.apiToken)) return send(res, 401, { error: "unauthorized" });
      const task = store.get(taskMatch[1]!);
      if (!task) return send(res, 404, { error: "task_not_found" });
      return send(res, 200, {
        task_id: task.task_id,
        status: task.status,
        reason: task.reason,
        result: task.result,
        created_at: task.created_at,
        updated_at: task.updated_at,
      });
    }

    if (method === "POST" && path === "/apply") {
      if (!authorized(req, config.apiToken)) return send(res, 401, { error: "unauthorized" });

      const idemKey = (req.headers["idempotency-key"] as string | undefined) ?? "";
      if (idemKey && idempotency.has(idemKey)) {
        return send(res, 202, { task_id: idempotency.get(idemKey), status: "queued", idempotent: true });
      }

      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return send(res, 400, { error: "body_must_be_object" });
      }
      const b = body as Record<string, unknown>;
      const targetUrl = typeof b.target_url === "string" ? b.target_url : "";
      if (!targetUrl) return send(res, 400, { error: "missing_param:target_url" });
      const fields = b.fields && typeof b.fields === "object" && !Array.isArray(b.fields) ? b.fields : {};

      const task = store.create({
        endpoint: "/apply",
        macro_id: "apply",
        params: { target_url: targetUrl, fields, dry_run: b.dry_run, arm: b.arm, idempotency_key: idemKey },
      });
      if (idemKey) idempotency.set(idemKey, task.task_id);
      return send(res, 202, { task_id: task.task_id, status: task.status });
    }

    send(res, 404, { error: "not_found" });
  }
}
