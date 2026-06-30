# Deploying the browser-worker to Fly.io

The worker is a private HTTP service (Chromium via Playwright) the API reaches at
`http://<app>.internal:8080`. This file is the **proven recipe** — following it
avoids the deploy traps a first deploy otherwise rediscovers by crash-loop.

## The recipe

1. **Use the shipped `Dockerfile` + `fly.toml`** (in this repo). The Dockerfile is
   `FROM mcr.microsoft.com/playwright:v1.49.0-jammy`, so Chromium + its system
   deps are already present — do NOT reinvent an apt install. Rename `app` in
   `fly.toml`.
2. **Deploy FIRST, secrets SECOND.** Fly only materializes the app on the first
   `flyctl deploy` — you cannot set secrets before the app exists. Order:
   `flyctl deploy` (creates the app + volume) → `flyctl secrets set` →
   it redeploys with the secrets. The worker **boots without any secrets**
   (`OPENROUTER_API_KEY` and `API_TOKEN` are optional), so the `/health` check
   passes on that first deploy.
3. **Secrets:** `OPENROUTER_API_KEY` (enables the LLM cold paths: harvest /
   self-heal / novel-answer) and `API_TOKEN` (request auth). Neither is required
   to boot or to pass `/health`.
4. **Durable state** (`worker.sqlite` macros + `tasks.sqlite`) lives on the
   `worker_data` volume mounted at `/app/data` — keep it across redeploys.

## Traps this recipe already avoids

- **node:sqlite crash-loop.** The task store uses **better-sqlite3** (a prebuilt
  native module), NOT `node:sqlite` (`DatabaseSync`). `node:sqlite` is
  experimental and throws on import unless run with `--experimental-sqlite`
  (Node 22/23) or Node ≥24 — on a normal container it crash-loops the process
  *before* the HTTP server can `listen()`, so the deploy health check never
  passes and Fly stops the machine after max-restarts. Both stores
  (`db.ts` macros, `task-store.ts` tasks) now use better-sqlite3.
- **Health check needs secrets.** It doesn't — `/health` is served immediately on
  boot, independent of `OPENROUTER_API_KEY`/`API_TOKEN`, so the first
  secret-less deploy is healthy.
- **No Dockerfile.** Now shipped + tested against the Playwright base image.
