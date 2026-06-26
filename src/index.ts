/**
 * Entry point — wire the manifest, task store, browser executor, worker loop,
 * and HTTP server together, then listen.
 *
 *   manifest.json → server (enqueues tasks) → worker (drains) → browser executor
 *
 * Env:
 *   PORT          listen port (default 8080)
 *   MANIFEST      path to manifest.json (default ./manifest.json)
 *   TASKS_DB      sqlite path (default :memory:)
 */
import { loadManifest } from "./manifest.js";
import { TaskStore } from "./task-store.js";
import { Worker } from "./worker.js";
import { makeExecutor } from "./browser.js";
import { createWorkerServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 8080);
const MANIFEST_PATH = process.env.MANIFEST ?? "./manifest.json";
const TASKS_DB = process.env.TASKS_DB ?? ":memory:";

const manifest = loadManifest(MANIFEST_PATH);
const store = new TaskStore(TASKS_DB);
const worker = new Worker(store, makeExecutor(manifest));
const server = createWorkerServer({ manifest, store });

worker.start();
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[browser-worker] ${manifest.worker_id} listening on :${PORT} (${manifest.endpoints.length} endpoint(s))`);
});

function shutdown(): void {
  worker.stop();
  server.close();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
