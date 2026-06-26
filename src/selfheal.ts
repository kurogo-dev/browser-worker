/**
 * Self-heal — repair a drifted step. When replay throws a `StepError` (a
 * selector no longer matches), `repairStep` hands the LLM the failing step + the
 * current page digest and gets back a single repaired step (schema-validated).
 * The caller (apply.ts) swaps it in, retries, and on success persists a new
 * macro version. This is what keeps per-site macros alive as sites drift —
 * without it the worker is as brittle as the old per-domain recordings.
 */
import { MacroStepSchema } from "./macro/schema.js";
import type { MacroStep } from "./macro/types.js";
import { parseJsonResponse, type Llm } from "./llm.js";

export interface RepairInput {
  /** The step that failed (post-substitution args, as the executor saw it). */
  failedStep: MacroStep;
  /** Structured reason from the StepError. */
  reason: string;
  /** The selector that didn't match, if any. */
  selector?: string;
  /** Current page digest (browser.domDigest). */
  digest: string;
}

export function buildRepairPrompt(input: RepairInput): { system: string; user: string } {
  const system =
    "You repair a single browser-automation step whose selector stopped matching. " +
    "Given the failed step and the CURRENT form, return ONE corrected step as strict JSON (same tool, fixed selector/args). " +
    "Keep the same tool and intent; only change what's needed to match the current page. Output ONLY a json code block.";
  const user =
    `FAILED STEP: ${JSON.stringify(input.failedStep)}\n` +
    `REASON: ${input.reason}${input.selector ? `\nSELECTOR THAT FAILED: ${input.selector}` : ""}\n\n` +
    `CURRENT PAGE:\n${input.digest}\n\n` +
    `Return JSON: {"tool","args","set?"}`;
  return { system, user };
}

export async function repairStep(input: RepairInput, llm: Llm): Promise<MacroStep> {
  const { system, user } = buildRepairPrompt(input);
  const text = await llm.complete({ system, user, maxTokens: 512 });
  const raw = parseJsonResponse<unknown>(text);
  return MacroStepSchema.parse(raw) as MacroStep;
}
