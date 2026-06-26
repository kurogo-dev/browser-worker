import { describe, it, expect } from "vitest";
import { executeMacro, StepError, type ToolRegistry } from "./executor.js";
import type { Macro } from "./types.js";

function macro(steps: Macro["steps"]): Macro {
  return {
    name: "t",
    description: "t",
    site: "example.com",
    category: "test",
    params: {},
    steps,
    version: 1,
    enabled: true,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

describe("executeMacro", () => {
  it("runs steps in order, substitutes args, and captures set vars", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const tools: ToolRegistry = {
      goto: async (args) => { calls.push({ tool: "goto", args }); return undefined; },
      readText: async (args) => { calls.push({ tool: "readText", args }); return "Acme"; },
      fill: async (args) => { calls.push({ tool: "fill", args }); return undefined; },
    };
    const m = macro([
      { tool: "goto", args: { url: "$url" } },
      { tool: "readText", args: { selector: "h1" }, set: "company" },
      { tool: "fill", args: { selector: "#note", value: "Applying to $company" } },
    ]);
    const res = await executeMacro(m, { url: "https://example.com/jobs/1" }, tools);
    expect(calls[0]!.args).toEqual({ url: "https://example.com/jobs/1" });
    expect(res.vars.company).toBe("Acme");
    expect(calls[2]!.args).toEqual({ selector: "#note", value: "Applying to Acme" });
    expect(res.trace.map((t) => t.ok)).toEqual([true, true, true]);
  });

  it("throws StepError(unknown_tool) for a missing tool", async () => {
    await expect(executeMacro(macro([{ tool: "nope", args: {} }]), {}, {})).rejects.toMatchObject({
      name: "StepError",
      stepIndex: 0,
      tool: "nope",
      reason: "unknown_tool",
    });
  });

  it("wraps a tool failure in StepError with index, selector, and reason", async () => {
    const tools: ToolRegistry = {
      click: async () => { throw new Error("element_not_found"); },
    };
    const m = macro([
      { tool: "click", args: { selector: "#x" } },
      { tool: "click", args: { selector: "#submit" } },
    ]);
    const err = await executeMacro(m, {}, tools).catch((e) => e);
    expect(err).toBeInstanceOf(StepError);
    expect(err.stepIndex).toBe(0);
    expect(err.selector).toBe("#x");
    expect(err.reason).toBe("element_not_found");
  });

  it("untilIndex replays only a prefix (for self-heal)", async () => {
    const seen: number[] = [];
    const tools: ToolRegistry = { mark: async (a) => { seen.push(a.i as number); } };
    const m = macro([
      { tool: "mark", args: { i: 0 } },
      { tool: "mark", args: { i: 1 } },
      { tool: "mark", args: { i: 2 } },
    ]);
    await executeMacro(m, {}, tools, { untilIndex: 2 });
    expect(seen).toEqual([0, 1]);
  });
});
