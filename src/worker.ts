/**
 * Worker loop — drains the task store. Claims the oldest queued task, runs it
 * through an injected executor (a browser macro in production), and records the
 * terminal state: `done` with a result, or `exited` with a structured reason
 * (fail-fast — no in-worker human-in-loop in v1).
 *
 * The executor is injected so the lifecycle is testable without a browser.
 * Concurrency is one task at a time (one browser); raise later with a pool.
 */
import type { TaskRow, TaskStore } from "./task-store.js";

export interface MacroOutcome {
  ok: boolean;
  result?: unknown;
  reason?: string;
  logs?: string[];
}

export type ExecuteFn = (task: TaskRow) => Promise<MacroOutcome>;

export class Worker {
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: TaskStore,
    private readonly execute: ExecuteFn,
    private readonly pollMs = 250,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Process one claimed task if available. Returns its id, or null if idle. */
  async runOnce(): Promise<string | null> {
    const task = this.store.claimNext();
    if (!task) return null;
    try {
      const outcome = await this.execute(task);
      if (outcome.ok) {
        this.store.complete(task.task_id, outcome.result ?? null);
      } else {
        this.store.fail(task.task_id, outcome.reason ?? "macro_failed");
      }
    } catch (err) {
      this.store.fail(task.task_id, `runner_error:${err instanceof Error ? err.message : String(err)}`);
    }
    return task.task_id;
  }

  private tick(): void {
    if (!this.running) return;
    void this.runOnce().finally(() => {
      if (this.running) this.timer = setTimeout(() => this.tick(), this.pollMs);
    });
  }
}
