/**
 * 4-gate dry-run safety. The single decision point between "filled the form" and
 * "performed the real, irreversible action". `decideAction` returns `"submit"`
 * ONLY when every gate passes; otherwise `"dry_run"` with the failing gates.
 *
 * Keep all four gates. They are deliberately conservative — the default is to
 * NOT submit. This is what stops a bug or a bad input from silently doing
 * something real (a job application, a purchase, a destructive click).
 */
export interface ActionRequest {
  /** The request must explicitly opt OUT of dry-run (false) to allow a submit. */
  dry_run?: boolean;
  /** Per-request explicit opt-in to perform the real action. */
  arm?: boolean;
}

export interface SafetyContext {
  /** The page URL the action would target. */
  pageUrl: string;
  /** Hosts the worker is allowed to act on (from the manifest). */
  allowedHosts: string[];
  /** Field keys the strategy marked required. */
  requiredFields: string[];
  /** Field keys the strategy actually filled. */
  filledFields: string[];
}

export type ActionDecision =
  | { action: "submit" }
  | { action: "dry_run"; failed_gates: string[] };

export function decideAction(req: ActionRequest, ctx: SafetyContext): ActionDecision {
  const failed: string[] = [];

  // Gate 1 — dry_run is on unless the caller explicitly set it false.
  if (req.dry_run !== false) failed.push("dry_run_not_disabled");

  // Gate 2 — the target host must be allowlisted.
  let host = "";
  try {
    host = new URL(ctx.pageUrl).hostname;
  } catch {
    host = "";
  }
  if (!host || !ctx.allowedHosts.includes(host)) failed.push(`host_not_allowed:${host || "invalid_url"}`);

  // Gate 3 — every required field must have been filled.
  const missing = ctx.requiredFields.filter((k) => !ctx.filledFields.includes(k));
  if (missing.length > 0) failed.push(`missing_required:${missing.join(",")}`);

  // Gate 4 — an explicit per-request arm flag.
  if (req.arm !== true) failed.push("not_armed");

  return failed.length === 0 ? { action: "submit" } : { action: "dry_run", failed_gates: failed };
}
