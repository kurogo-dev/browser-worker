import { describe, it, expect } from "vitest";
import { parseMacro, safeParseMacro } from "./schema.js";

const base = {
  name: "apply",
  description: "Apply on the site",
  site: "example.com",
  steps: [{ tool: "goto", args: { url: "$url" } }],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("macro schema", () => {
  it("parses a valid macro and applies defaults", () => {
    const m = parseMacro(base);
    expect(m.category).toBe("");
    expect(m.params).toEqual({});
    expect(m.version).toBe(1);
    expect(m.enabled).toBe(true);
    expect(m.steps).toHaveLength(1);
  });

  it("round-trips through JSON", () => {
    const m = parseMacro(base);
    expect(parseMacro(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("rejects a macro with no steps", () => {
    expect(safeParseMacro({ ...base, steps: [] }).success).toBe(false);
  });

  it("rejects a step with an empty tool name", () => {
    expect(safeParseMacro({ ...base, steps: [{ tool: "", args: {} }] }).success).toBe(false);
  });

  it("requires a site", () => {
    const { site, ...noSite } = base;
    expect(safeParseMacro(noSite).success).toBe(false);
  });
});
