/**
 * Variable substitution for macro step args. References are `$name` where name
 * is an identifier bound in the run context (a macro `param` or a value
 * captured by an earlier step's `set`).
 *
 * Rules:
 *   - A string that is EXACTLY "$name" resolves to the raw context value
 *     (preserving its type — number, object, etc.).
 *   - A string with inline "$name" occurrences interpolates each as a string.
 *   - Objects and arrays are substituted recursively.
 *   - A reference to an unbound name throws (fail-fast — a macro that needs a
 *     value it wasn't given should not silently fill blanks).
 */
export type SubstCtx = Record<string, unknown>;

const EXACT_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;
const INLINE_REF = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

export function substitute(value: unknown, ctx: SubstCtx): unknown {
  if (typeof value === "string") return substituteString(value, ctx);
  if (Array.isArray(value)) return value.map((v) => substitute(v, ctx));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = substitute(v, ctx);
    }
    return out;
  }
  return value;
}

function substituteString(s: string, ctx: SubstCtx): unknown {
  const exact = EXACT_REF.exec(s);
  if (exact) {
    const name = exact[1]!;
    if (!(name in ctx)) throw new Error(`unbound_var:${name}`);
    return ctx[name];
  }
  return s.replace(INLINE_REF, (_m, name: string) => {
    if (!(name in ctx)) throw new Error(`unbound_var:${name}`);
    const v = ctx[name];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Convenience: substitute every value in a step's args record. */
export function substituteArgs(args: Record<string, unknown>, ctx: SubstCtx): Record<string, unknown> {
  return substitute(args, ctx) as Record<string, unknown>;
}
