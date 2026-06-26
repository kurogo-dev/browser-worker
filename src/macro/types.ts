/**
 * The standalone macro shape. A macro is a per-SITE recipe (one macro covers
 * every job ad on that site); `site: "*"` marks a category-level macro that can
 * serve any site in its category. The structure is a linear list of steps —
 * each step calls a named tool with args, optionally capturing the result into
 * a variable (`set`) later steps can `$reference`. Modeled on the substrate's
 * proven executor shape but fully self-contained (no @kurogo imports).
 */
export type MacroParamType = "string" | "number" | "boolean" | "object" | "array";

export interface MacroParamDef {
  type: MacroParamType;
  description: string;
  /** Hint that the value is sensitive (kept out of logs/reports). */
  secret?: boolean;
}

export interface MacroStep {
  /** Name of a tool in the executor's tool registry (goto, fill, click, …). */
  tool: string;
  /** Args passed to the tool; values may contain `$param`/`$var` references. */
  args: Record<string, unknown>;
  /** When set, the tool's return value is captured into this context variable. */
  set?: string;
}

export interface Macro {
  name: string;
  description: string;
  /** Domain this macro targets (e.g. "boards.greenhouse.io"). "*" = category-level. */
  site: string;
  /** Grouping category (the ATS/platform family). Empty when uncategorized. */
  category: string;
  params: Record<string, MacroParamDef>;
  steps: MacroStep[];
  version: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}
