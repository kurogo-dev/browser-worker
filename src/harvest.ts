/**
 * Harvest — the "build-once" half of build-once/replay-many. Given a page
 * digest + goal, the LLM drafts a per-SITE macro (schema-validated before it's
 * trusted), seeded from the category skeleton when one exists. `draftMacro` is
 * the pure LLM→Macro step (testable with a stub LLM); the caller (apply.ts)
 * replay-verifies the draft in dry-run before persisting.
 */
import { parseMacro } from "./macro/schema.js";
import type { Macro } from "./macro/types.js";
import { parseJsonResponse, type Llm } from "./llm.js";

export interface HarvestInput {
  site: string;
  category: string;
  /** What the macro should accomplish (e.g. "fill and submit the application"). */
  goal: string;
  /** Token-bounded description of the live form (browser.domDigest). */
  digest: string;
  /** The request field keys → become macro params the steps may `$reference`. */
  fieldKeys: string[];
  /** Category skeleton to specialize from, if any. */
  skeleton?: Macro | null;
}

const TOOLS_DOC = `Available step tools (use ONLY these):
  goto      { url }
  fill      { selector, value }
  click     { selector }
  select    { selector, value }
  upload    { selector, path }
  waitFor   { selector, timeout_ms? }
  readText  { selector }   (capture with "set")
  exists    { selector }
A step is { "tool": <name>, "args": {...}, "set": <optional var> }.
Reference a provided field with "$<key>" in any arg value.`;

export function buildHarvestPrompt(input: HarvestInput): { system: string; user: string } {
  const system =
    "You author browser-automation macros as STRICT JSON. You receive a description of a web form and a goal. " +
    "Emit one macro that fills (and, where the goal says, submits) the form using ONLY the listed tools and the provided field keys. " +
    "Prefer stable selectors (id, name). Output ONLY a json code block with the macro object — no prose.";
  const seed = input.skeleton
    ? `\nStart from this skeleton for the '${input.category}' category and specialize it to THIS site:\n${JSON.stringify(
        { steps: input.skeleton.steps },
        null,
        2,
      )}\n`
    : "";
  const user =
    `${TOOLS_DOC}\n\nGOAL: ${input.goal}\nSITE: ${input.site}\nCATEGORY: ${input.category || "(none)"}\n` +
    `PROVIDED FIELD KEYS (reference as $key): ${["targetUrl", ...input.fieldKeys].join(", ")}\n` +
    `(the apply URL is always available as $targetUrl — the first step is usually goto { url: "$targetUrl" })\n${seed}\n` +
    `PAGE:\n${input.digest}\n\n` +
    `NOTE: put structural navigation (goto, clicks to reach the form, waits) in "steps". Do NOT fill the form fields here — that is done adaptively. Put the SUBMIT control's selector in "submit_selector" (it is withheld in dry-run).\n` +
    `Return JSON: { "name": string, "description": string, "params": { [key]: {"type":"string","description":string} }, "steps": [ {"tool","args","set?"} ], "submit_selector": string }`;
  return { system, user };
}

export async function draftMacro(input: HarvestInput, llm: Llm): Promise<Macro> {
  const { system, user } = buildHarvestPrompt(input);
  const text = await llm.complete({ system, user, maxTokens: 2048 });
  const raw = parseJsonResponse<Record<string, unknown>>(text);
  const now = new Date().toISOString();
  // Stamp the site/category/lifecycle fields the LLM shouldn't own.
  return parseMacro({
    ...raw,
    site: input.site,
    category: input.category,
    version: 1,
    enabled: true,
    created_at: now,
    updated_at: now,
  });
}
