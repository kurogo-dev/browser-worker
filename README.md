# browser-worker

A small, self-contained **browser-automation worker** you scaffold into a project
and build upon. It exposes an HTTP API, queues each request as a task, drives a
real browser (Playwright) to perform the task, and reports steps + screenshots.
A **4-gate dry-run safety check** stops it from performing a real, irreversible
action (a form submit, a purchase, a destructive click) until every gate passes.

This is a **template** — a starting point, not a finished service. After
`template.instantiate`, the files are your own editable code. Customize them.

## What you customize (in order)

1. **`src/strategy.ts`** — the form-fill / interaction strategy. This is the
   heart of the worker: given a page and a job's `fields`, decide what to type,
   click, and select. One strategy per *form type* (a job board, a checkout, a
   signup). Start with the stub and grow it.
2. **`manifest.json`** — the worker's identity, its HTTP endpoints, the macro
   each endpoint runs, and (optionally) API keys. An empty `api_keys` list is
   open (dev only).
3. **`src/safety.ts`** — the 4 gates (`dry_run`, target allowlist, required
   fields, arm token). Defaults are deliberately conservative; tune them for
   your use case, but keep them — they are what stop a bad submit.

## What you should NOT need to touch

- `src/server.ts` — manifest-driven `node:http` API (health, endpoints, task
  status). No framework.
- `src/task-store.ts` — `node:sqlite` task lifecycle (`queued → running → done |
  exited`). Survives a restart.
- `src/worker.ts` — the drain loop (claims the oldest queued task, runs it).
- `src/browser.ts` — Playwright wiring + step/screenshot reporting.

## Run it

```bash
npm install
npx playwright install chromium
npm run dev          # serves the manifest's endpoints on PORT (default 8080)
```

Then POST a job to an endpoint (see `manifest.json`) and poll `/tasks/:id`.
By default `dry_run` is on: the worker fills the form and reports what it WOULD
submit, but does not submit. Pass `"arm": true` (and clear the other gates) to
perform the real action.

## The safety model (read before you arm anything)

`decideAction()` returns `submit` only when **all** gates pass:

| Gate            | Passes when                                                        |
|-----------------|--------------------------------------------------------------------|
| `dry_run`       | the request explicitly set `dry_run: false`                        |
| target allowed  | the page URL host is in `manifest.allowed_hosts`                   |
| required fields | every field the strategy marked required was filled               |
| arm token       | the request carried `arm: true` (an explicit, per-request opt-in)  |

Any gate failing → the worker reports `would_submit` with the captured form
state and screenshots, and exits the task cleanly. No silent real submits.
