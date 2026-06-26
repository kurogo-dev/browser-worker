/**
 * Runtime (zod) validator for the macro shape. Every macro is parsed through
 * this on read from + write to the DB, and harvest validates its LLM-drafted
 * macros here before persisting — so a malformed macro never reaches the
 * executor.
 */
import { z } from "zod";
import type { Macro } from "./types.js";

export const MacroParamDefSchema = z.object({
  type: z.enum(["string", "number", "boolean", "object", "array"]),
  description: z.string(),
  secret: z.boolean().optional(),
});

export const MacroStepSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  set: z.string().min(1).optional(),
});

export const MacroSchema: z.ZodType<Macro> = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  site: z.string().min(1),
  category: z.string().default(""),
  params: z.record(z.string(), MacroParamDefSchema).default({}),
  steps: z.array(MacroStepSchema).min(1),
  submit_selector: z.string().min(1).optional(),
  version: z.number().int().positive().default(1),
  enabled: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
}) as unknown as z.ZodType<Macro>;

/** Parse + validate an unknown into a `Macro`. Throws on mismatch. */
export function parseMacro(value: unknown): Macro {
  return MacroSchema.parse(value);
}

export function safeParseMacro(value: unknown): ReturnType<typeof MacroSchema.safeParse> {
  return MacroSchema.safeParse(value);
}
