/**
 * Entry point — wire config, the macro DB, task store, browser, apply
 * orchestration, worker loop, and HTTP server, then listen.
 *
 *   POST /apply → server enqueues a task → worker drains → runApply (browser +
 *   classify + macro replay/harvest/self-heal + fieldmap + 4-gate safety)
 *
 * Env:
 *   PORT                 listen port (default 8080)
 *   CONFIG               path to config json (default ./manifest.json)
 *   MACRO_DB             worker DB path (default ./data/worker.sqlite) — PERSIST + back up
 *   TASKS_DB             task DB path (default ./data/tasks.sqlite)
 *   API_TOKEN            bearer token callers must present (empty = open dev)
 *   ALLOW_REAL_SUBMIT    "1" enables real submits (gate 2)
 *   OPENROUTER_API_KEY   enables harvest / self-heal / novel-answer (cold paths)
 *   LLM_MODEL            override the model (default anthropic/claude-sonnet-4-6)
 *   LLM_BASE_URL         override the provider (default https://openrouter.ai/api/v1)
 */
import { loadConfig } from "./manifest.js";
import { openDb } from "./db.js";
import { TaskStore } from "./task-store.js";
import { Worker, type MacroOutcome } from "./worker.js";
import { createWorkerServer } from "./server.js";
import { makePlaywrightSession } from "./browser.js";
import { runApply, type ApplyConfig, type ApplyDeps } from "./apply.js";
import { makeLlm, type Llm } from "./llm.js";
import type { TaskRow } from "./task-store.js";

const PORT = Number(process.env.PORT ?? 8080);
const CONFIG_PATH = process.env.CONFIG ?? "./manifest.json";
const MACRO_DB = process.env.MACRO_DB ?? "./data/worker.sqlite";
const TASKS_DB = process.env.TASKS_DB ?? "./data/tasks.sqlite";

const cfg = loadConfig(CONFIG_PATH);
const db = openDb(MACRO_DB);
const store = new TaskStore(TASKS_DB);
const idempotency = new Map<string, string>();

const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const llm: Llm | undefined = apiKey ? makeLlm(apiKey) : undefined;

const applyConfig: ApplyConfig = {
  categories: db.listCategories().map((c) => ({ category: c.name, signatures: c.signatures as never })),
  allowedHosts: cfg.allowed_hosts,
  allowRealConfig: process.env.ALLOW_REAL_SUBMIT === "1",
  testTargets: cfg.test_targets,
  macroName: "apply",
  goal: cfg.goal,
};

const applyDeps: ApplyDeps = {
  resolveMacro: (site, category, name) => db.resolveMacro(site, category, name),
  putMacro: (m) => db.putMacro(m),
  getSkeleton: (category) => db.listCategories().find((c) => c.name === category)?.skeleton ?? null,
  openSession: (url) => makePlaywrightSession(url),
  ...(llm ? { llm } : {}),
};

async function runTask(task: TaskRow): Promise<MacroOutcome> {
  const p = task.params;
  const targetUrl = typeof p.target_url === "string" ? p.target_url : "";
  const fields = (p.fields ?? {}) as Record<string, unknown>;
  if (!targetUrl) return { ok: false, reason: "missing_param:target_url" };
  const result = await runApply(
    {
      targetUrl,
      fields,
      ...(typeof p.dry_run === "boolean" ? { dryRun: p.dry_run } : {}),
      ...(p.arm === true ? { armed: true } : {}),
    },
    applyConfig,
    applyDeps,
  );
  return { ok: true, result };
}

const worker = new Worker(store, runTask);
const server = createWorkerServer({ config: { apiToken: process.env.API_TOKEN ?? "", workerId: cfg.worker_id }, store, idempotency });

worker.start();
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[browser-worker] ${cfg.worker_id} on :${PORT} — llm=${llm ? "on" : "off"} real_submit=${process.env.ALLOW_REAL_SUBMIT === "1"}`);
});

function shutdown(): void {
  worker.stop();
  server.close();
  store.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
