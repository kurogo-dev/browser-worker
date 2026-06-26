/**
 * Macro executor — runs a macro's steps in order over an injected tool layer.
 * The tool layer is what binds steps to the world (Playwright in production, a
 * fake in tests), so the executor itself is pure orchestration + substitution
 * and fully unit-testable without a browser.
 *
 * On a tool failure the executor throws a structured `StepError` carrying the
 * step index, tool, selector, and reason — this is the hook self-heal repairs
 * against (it sees exactly which step + selector drifted).
 */
import { substituteArgs, type SubstCtx } from "./substitute.js";
import type { Macro, MacroStep } from "./types.js";

/** A tool: receives the substituted args + the live run context, returns a
 *  value (captured by `set` if present). Throws to signal a failed step. */
export type ToolFn = (args: Record<string, unknown>, ctx: SubstCtx) => Promise<unknown>;
export type ToolRegistry = Record<string, ToolFn>;

export class StepError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly tool: string,
    readonly reason: string,
    readonly selector?: string,
  ) {
    super(`step ${stepIndex} (${tool}) failed: ${reason}`);
    this.name = "StepError";
  }
}

export interface StepTrace {
  index: number;
  tool: string;
  set?: string;
  ok: boolean;
}

export interface ExecuteResult {
  /** Final run context (params + every captured `set` var). */
  vars: SubstCtx;
  trace: StepTrace[];
}

export interface ExecuteOptions {
  /** Run only steps [0, untilIndex). Used by self-heal to replay a prefix. */
  untilIndex?: number;
}

export async function executeMacro(
  macro: Macro,
  params: SubstCtx,
  tools: ToolRegistry,
  opts: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const ctx: SubstCtx = { ...params };
  const trace: StepTrace[] = [];
  const limit = opts.untilIndex ?? macro.steps.length;

  for (let i = 0; i < limit; i++) {
    const step = macro.steps[i] as MacroStep;
    const fn = tools[step.tool];
    if (!fn) throw new StepError(i, step.tool, "unknown_tool");

    let resolved: Record<string, unknown>;
    try {
      resolved = substituteArgs(step.args, ctx);
    } catch (err) {
      throw new StepError(i, step.tool, err instanceof Error ? err.message : String(err));
    }

    try {
      const result = await fn(resolved, ctx);
      if (step.set) ctx[step.set] = result;
      trace.push({ index: i, tool: step.tool, ...(step.set ? { set: step.set } : {}), ok: true });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const selector = typeof resolved.selector === "string" ? resolved.selector : undefined;
      throw new StepError(i, step.tool, reason, selector);
    }
  }

  return { vars: ctx, trace };
}
