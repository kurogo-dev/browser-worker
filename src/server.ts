/**
 * Worker HTTP API — manifest-driven, node:http, no framework.
 *
 *   GET  /health           open liveness + identity
 *   POST <endpoint.path>   auth → validate body → enqueue task
 *   GET  /tasks/:id        auth → task status / result / reason
 *
 * Async: POST returns `{task_id}` immediately (202); the worker drains the
 * queue. Auth is server-to-server bearer. An empty api_keys list means open
 * (dev only).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { WorkerEndpoint, WorkerManifest } from "./manifest.js";
import type { TaskStore } from "./task-store.js";

export interface WorkerServerDeps {
  manifest: WorkerManifest;
  store: TaskStore;
}

const MAX_BODY_BYTES = 1_000_000;

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

function authorized(req: IncomingMessage, manifest: WorkerManifest): boolean {
  const keys = manifest.auth.api_keys;
  if (keys.length === 0) return true; // open (dev)
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(Array.isArray(header) ? (header[0] ?? "") : header);
  return match !== null && keys.includes(match[1]!);
}

function missingRequired(endpoint: WorkerEndpoint, body: Record<string, unknown>): string[] {
  const required = endpoint.params_schema.required;
  if (!Array.isArray(required)) return [];
  return required.filter((k): k is string => typeof k === "string" && !(k in body));
}

export function createWorkerServer(deps: WorkerServerDeps): Server {
  const { manifest, store } = deps;
  const endpoints = new Map(manifest.endpoints.map((e) => [e.path, e]));

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
      send(res, 200, { ok: true, worker_id: manifest.worker_id, role: manifest.role });
      return;
    }

    const taskMatch = /^\/tasks\/([^/]+)$/.exec(path);
    if (method === "GET" && taskMatch) {
      if (!authorized(req, manifest)) return send(res, 401, { error: "unauthorized" });
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

    const endpoint = endpoints.get(path);
    if (method === "POST" && endpoint) {
      if (!authorized(req, manifest)) return send(res, 401, { error: "unauthorized" });
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(res, 400, { error: "invalid_json" });
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return send(res, 400, { error: "body_must_be_object" });
      }
      const params = body as Record<string, unknown>;
      const missing = missingRequired(endpoint, params);
      if (missing.length > 0) return send(res, 400, { error: "missing_params", missing });
      const task = store.create({ endpoint: endpoint.path, macro_id: endpoint.macro_id, params });
      return send(res, 202, { task_id: task.task_id, status: task.status });
    }

    send(res, 404, { error: "not_found" });
  }
}
