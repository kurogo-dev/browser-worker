# browser-worker

A self-contained, **standalone** browser-automation worker. You hook it to a DB
and it **harvests, replays, and self-heals** browser macros on its own — no
external orchestrator. Built as a Kurogo module template: a starting point you
scaffold (`template.instantiate`) and customize.

It exposes an HTTP API, queues each apply as a task, drives a real browser
(Playwright) to fill and (when armed) submit a form, and reports the result. A
**4-gate dry-run safety check** stops a real, irreversible submit until every
gate passes.

## The model: per-site macros, categories above, adaptive fields

- **A macro is per-WEBSITE** (one macro covers every page/ad on a site) — keyed
  by `site`. A site's form structure is stable across its ads, so the macro
  replays cheaply with no LLM.
- **Categories group sites** by platform (the ATS family). A category carries
  detection *signatures* (URL globs + DOM fingerprints) and an optional
  *skeleton* that **seeds harvesting** a new site in that family. A
  category-level macro (`site = "*"`) can serve every site in a uniform platform.
- **Per-ad variation** (custom screening questions) is absorbed by **adaptive
  field-mapping**: known fields are matched semantically; genuinely novel
  free-text questions are answered by the LLM from the profile. This is the only
  LLM use on the hot path.

## The three loops

- **harvest** (`src/harvest.ts`) — first time a site has no macro, the LLM drafts
  one from the live form (seeded by the category skeleton), it's replay-verified
  in dry-run, then persisted. Build-once.
- **replay** (`src/macro/executor.ts`) — runs a stored macro's structural steps
  with no LLM. The hot path.
- **self-heal** (`src/selfheal.ts`) — when a step's selector drifts, the LLM
  repairs just that step against the current page; on success a new macro version
  is persisted. This is what keeps macros alive as sites change.

## What you customize

1. **Categories + signatures** — seed the `categories` table (name, URL/DOM
   signatures, optional skeleton). This is the landscape map for your use case.
2. **`manifest.json`** — `worker_id`, `allowed_hosts` (real-submit allowlist),
   `test_targets` (safe harness bypass), `goal` (handed to harvest).
3. Macros are **learned, not written** — harvest builds them; you mostly curate.

## HTTP API

- `POST /apply` — bearer auth, `Idempotency-Key` header. Body: `{ "target_url":
  string, "fields": { ... }, "dry_run"?: boolean, "arm"?: boolean }`. Async: acks
  `202 { task_id }`; poll `GET /tasks/:id`.
- `GET /tasks/:id` — status / result.
- `GET /health`.

`fields` is generic k/v — map your domain profile onto it; the worker stays
project-agnostic.

## Safety (read before arming anything)

`decideApply()` (`src/safety.ts`) returns `real` only when ALL pass:

| Gate            | Passes when                                              |
|-----------------|---------------------------------------------------------|
| dry_run         | the request set `dry_run: false`                        |
| config          | env `ALLOW_REAL_SUBMIT=1`                                |
| armed           | the request set `arm: true`                             |
| host allowed    | the page host ∈ `allowed_hosts`                         |

A configured `test_targets` URL bypasses gates 2–4 (safe harness) but still
honors an explicit `dry_run: true`. A missing `dry_run` defaults to dry-run.

## Run

```bash
npm install
npx playwright install chromium
OPENROUTER_API_KEY=… ALLOW_REAL_SUBMIT=0 npm run dev   # node >= 22
```

Env: `PORT`, `API_TOKEN`, `ALLOW_REAL_SUBMIT`, `OPENROUTER_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`,
`MACRO_DB`, `TASKS_DB`, `CONFIG`.

## State & deploy

`MACRO_DB` (default `./data/worker.sqlite`) holds the **learned macros — the
worker's crown jewels**. Deploy it on a **persistent volume and back it up**;
losing it means re-harvesting every site. `better-sqlite3` is native (single-VM
deploy).

## Test

```bash
npm test                                   # unit + component (no browser)
SMOKE=1 npx vitest run src/smoke.live.test.ts   # live Playwright glue (needs chromium)
```
