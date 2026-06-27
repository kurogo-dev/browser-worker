/**
 * Apply orchestration — the heart of the worker. For one apply request:
 *   classify → resolve (or harvest) the site macro → run its structural steps
 *   (self-healing a drifted step) → fieldmap fills the form (semantic + LLM for
 *   novel questions) → 4-gate safety → gated submit → structured result.
 *
 * Coupling to Playwright is behind the `Session` interface, so the whole flow
 * is unit-testable with a fake session + stub LLM (no browser, no network).
 */
import { classify, type CategorySignatures, type Classification } from "./classify.js";
import { mapFields, type FormField, type NovelAnswerer } from "./fieldmap.js";
import { executeMacro, StepError, type ToolRegistry } from "./macro/executor.js";
import { decideApply, type SafetyDecision } from "./safety.js";
import { draftMacro } from "./harvest.js";
import { repairStep } from "./selfheal.js";
import type { Macro } from "./macro/types.js";
import type { Llm } from "./llm.js";

export interface Session {
  url(): string;
  has(selector: string): Promise<boolean>;
  readForm(): Promise<FormField[]>;
  digest(): Promise<string>;
  /** Tool registry the executor drives the structural steps through. */
  tools: ToolRegistry;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  screenshot(): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface ApplyRequest {
  targetUrl: string;
  fields: Record<string, unknown>;
  dryRun?: boolean;
  armed?: boolean;
}

export interface ApplyConfig {
  categories: CategorySignatures[];
  allowedHosts: string[];
  allowRealConfig: boolean;
  /** URL fragments that mark a safe test harness (safety bypass). */
  testTargets: string[];
  /** Macro name to resolve/harvest (the apply recipe). */
  macroName: string;
  /** Goal text handed to harvest. */
  goal: string;
}

export interface ApplyDeps {
  resolveMacro: (site: string, category: string, name: string) => Macro | null;
  putMacro: (macro: Macro) => void;
  getSkeleton?: (category: string) => Macro | null;
  openSession: (url: string) => Promise<Session>;
  llm?: Llm;
}

export interface ApplyResult {
  mode: "dry_run" | "real";
  site: string;
  category: string;
  macro: string;
  harvested: boolean;
  healed: boolean;
  filled: string[];
  unfilled: string[];
  submitted: boolean;
  would_submit?: string;
  gates: SafetyDecision;
  screenshot?: string;
  /** Per-step execution trace (observability). */
  trace?: unknown[];
  /** The substitution param keys available to the macro (debugging). */
  params_keys?: string[];
}

function makeNovelAnswerer(llm: Llm): NovelAnswerer {
  return async (field, profile) => {
    const text = await llm.complete({
      system:
        "Answer a job-application screening question from the applicant profile, in the profile's language. " +
        "Be concise and truthful to the profile. Output ONLY the answer text, no preamble.",
      user: `QUESTION: ${field.label}\n\nPROFILE:\n${JSON.stringify(profile)}`,
      maxTokens: 400,
    });
    const trimmed = text.trim();
    return trimmed.length ? trimmed : null;
  };
}

/** Run the macro's structural steps; on a StepError, repair the step via the
 *  LLM and retry once. Returns the (possibly patched) macro + whether it healed. */
async function runStepsWithSelfHeal(
  macro: Macro,
  params: Record<string, unknown>,
  session: Session,
  llm: Llm | undefined,
): Promise<{ macro: Macro; healed: boolean; trace: unknown[] }> {
  try {
    const r = await executeMacro(macro, params, session.tools);
    return { macro, healed: false, trace: r.trace };
  } catch (err) {
    if (!(err instanceof StepError) || !llm) throw err;
    const digest = await session.digest();
    const repaired = await repairStep(
      {
        failedStep: macro.steps[err.stepIndex]!,
        reason: err.reason,
        ...(err.selector ? { selector: err.selector } : {}),
        digest,
      },
      llm,
    );
    const patched: Macro = {
      ...macro,
      steps: macro.steps.map((s, i) => (i === err.stepIndex ? repaired : s)),
      version: macro.version + 1,
      updated_at: new Date().toISOString(),
    };
    const r2 = await executeMacro(patched, params, session.tools); // retry once — throws if still broken
    return { macro: patched, healed: true, trace: r2.trace };
  }
}

/** Specialize a category skeleton to a concrete site. The deterministic harvest
 *  path when no LLM is available: the skeleton (site "*") is materialized as the
 *  per-site macro (its `site` rewritten to the live host) so resolveMacro's
 *  exact-site lookup hits it next time — build-once/replay-many without an LLM. */
function specializeSkeleton(skeleton: Macro, site: string): Macro {
  const now = new Date().toISOString();
  return { ...skeleton, site, enabled: true, created_at: now, updated_at: now };
}

export async function runApply(req: ApplyRequest, cfg: ApplyConfig, deps: ApplyDeps): Promise<ApplyResult> {
  const session = await deps.openSession(req.targetUrl);
  try {
    // 1. classify
    const cls: Classification = await classify({ url: session.url(), has: (s) => session.has(s) }, cfg.categories);

    // 2. resolve or harvest the site macro
    let macro = deps.resolveMacro(cls.site, cls.category, cfg.macroName);
    let harvested = false;
    if (!macro) {
      if (deps.llm) {
        // LLM-driven harvest (the primary path).
        macro = await draftMacro(
          {
            site: cls.site,
            category: cls.category,
            goal: cfg.goal,
            digest: await session.digest(),
            fieldKeys: Object.keys(req.fields),
            ...(deps.getSkeleton ? { skeleton: deps.getSkeleton(cls.category) } : {}),
          },
          deps.llm,
        );
        harvested = true;
      } else {
        // Deterministic fallback: if the classified category ships a skeleton,
        // materialize it as the per-site macro. Satisfies build-once/replay-many
        // for sites with hand-written skeletons even with NO LLM key provisioned.
        const skeleton = deps.getSkeleton ? deps.getSkeleton(cls.category) : null;
        if (!skeleton) throw new Error("no_macro_and_no_llm_to_harvest");
        macro = specializeSkeleton(skeleton, cls.site);
        harvested = true;
      }
    }

    // 3. run structural steps (self-healing). The target URL is always available
    // as a step param under BOTH camelCase ($targetUrl, LLM-drafted macros) and
    // snake_case ($target_url, hand-written skeletons) — either works.
    const params = { targetUrl: req.targetUrl, target_url: req.targetUrl, ...req.fields };
    const ran = await runStepsWithSelfHeal(macro, params, session, deps.llm);
    macro = ran.macro;

    // 4. fieldmap fills the live form
    const formFields = await session.readForm();
    const novelAnswerer: NovelAnswerer = deps.llm ? makeNovelAnswerer(deps.llm) : async () => null;
    const { fills, unfilled } = await mapFields(formFields, req.fields, novelAnswerer, req.fields);
    for (const fa of fills) await session.fill(fa.selector, fa.value).catch(() => {});

    // 5. safety
    const decision = decideApply({
      ...(req.dryRun !== undefined ? { dryRun: req.dryRun } : {}),
      allowRealConfig: cfg.allowRealConfig,
      armed: req.armed === true,
      host: cls.site,
      allowedHosts: cfg.allowedHosts,
      testTarget: cfg.testTargets.some((t) => req.targetUrl.includes(t)),
    });

    // 6. gated submit
    let submitted = false;
    if (decision.mode === "real" && macro.submit_selector) {
      await session.click(macro.submit_selector);
      submitted = true;
    }

    // 7. persist a harvested or healed macro only after a clean run
    if (harvested || ran.healed) deps.putMacro(macro);

    const screenshot = await session.screenshot().catch(() => undefined);

    return {
      mode: decision.mode,
      site: cls.site,
      category: cls.category,
      macro: macro.name,
      harvested,
      healed: ran.healed,
      filled: fills.map((f) => f.selector),
      unfilled: unfilled.map((u) => u.selector),
      submitted,
      ...(!submitted && macro.submit_selector ? { would_submit: macro.submit_selector } : {}),
      gates: decision,
      ...(screenshot ? { screenshot } : {}),
      trace: ran.trace,
      params_keys: Object.keys(params),
    };
  } finally {
    await session.close();
  }
}
