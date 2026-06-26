/**
 * 4-gate dry-run safety — the one decision point between "filled the form" and
 * "performed the real, irreversible submit". `decideApply` returns `real` ONLY
 * when every gate passes, each with a stable, machine-readable reason code so a
 * caller/log scraper can tell exactly which gate stopped a real submit.
 *
 * Gates (in priority order — honoring an explicit dry-run request is the most
 * important, so it is reported first):
 *   1. `dryRun === false`              — caller explicitly opted out of dry-run
 *   2. `allowRealConfig === true`      — worker config flag (env ALLOW_REAL_SUBMIT=1)
 *   3. `armed === true`                — per-request explicit authorization
 *   4. host ∈ `allowedHosts`           — target host is allowlisted
 *
 * One short-circuit only: a configured TEST target bypasses gates 2–4 (so the
 * dummy harness can exercise a real submit), but STILL honors an explicit
 * `dryRun: true`. `dryRun` defaults to `true` when undefined — a missing flag
 * must NEVER be read as consent to submit.
 */
export type ApplyMode = "dry_run" | "real";

export type DryRunReason =
  | "caller_requested_dry_run"
  | "config_disallows_real"
  | "not_armed"
  | "host_not_allowed";

export interface SafetyInput {
  /** Caller-supplied flag. Undefined is treated as `true` (safe default). */
  dryRun?: boolean;
  /** Worker-side config gate (e.g. process.env.ALLOW_REAL_SUBMIT === "1"). */
  allowRealConfig: boolean;
  /** Per-request explicit authorization to perform the real action. */
  armed: boolean;
  /** Host the action targets. */
  host: string;
  /** Allowlisted hosts. */
  allowedHosts: string[];
  /** True when the target is a configured safe test harness (gate bypass). */
  testTarget?: boolean;
}

export interface SafetyDecision {
  mode: ApplyMode;
  /** Present iff mode === "dry_run": which gate forced dry-run. */
  reason?: DryRunReason;
  /** Present iff mode === "real" AND gates 2–4 were bypassed (test target). */
  bypassed?: boolean;
}

export function decideApply(input: SafetyInput): SafetyDecision {
  const dryRun = input.dryRun === undefined ? true : input.dryRun;

  // Test-target bypass — the only short-circuit. Still honors explicit dry-run.
  if (dryRun !== true && input.testTarget) return { mode: "real", bypassed: true };

  if (dryRun !== false) return { mode: "dry_run", reason: "caller_requested_dry_run" };
  if (!input.allowRealConfig) return { mode: "dry_run", reason: "config_disallows_real" };
  if (!input.armed) return { mode: "dry_run", reason: "not_armed" };
  if (!input.allowedHosts.includes(input.host)) return { mode: "dry_run", reason: "host_not_allowed" };
  return { mode: "real" };
}
