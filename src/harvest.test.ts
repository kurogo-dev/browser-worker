import { describe, it, expect } from "vitest";
import { draftMacro, buildHarvestPrompt, type HarvestInput } from "./harvest.js";
import type { Llm } from "./llm.js";

const input: HarvestInput = {
  site: "careers.acme.se",
  category: "teamtailor",
  goal: "fill and submit the application",
  digest: "URL: ...\nFORM FIELDS (2):\n- email | #email\n- text | #name",
  fieldKeys: ["email", "name"],
};

const stub = (text: string): Llm => ({ complete: async () => text });

describe("buildHarvestPrompt", () => {
  it("includes the field keys, digest, and category seed when present", () => {
    const withSeed: HarvestInput = {
      ...input,
      skeleton: {
        name: "s", description: "s", site: "*", category: "teamtailor", params: {},
        steps: [{ tool: "goto", args: { url: "$url" } }], version: 1, enabled: true,
        created_at: "x", updated_at: "x",
      },
    };
    const { user } = buildHarvestPrompt(withSeed);
    expect(user).toContain("email, name");
    expect(user).toContain("FORM FIELDS");
    expect(user).toContain("skeleton");
  });
});

describe("draftMacro", () => {
  it("validates the LLM draft and stamps site/category/lifecycle", async () => {
    const llm = stub("```json\n" + JSON.stringify({
      name: "apply",
      description: "Apply on careers.acme.se",
      params: { email: { type: "string", description: "applicant email" } },
      steps: [
        { tool: "fill", args: { selector: "#email", value: "$email" } },
        { tool: "click", args: { selector: "#submit" } },
      ],
    }) + "\n```");
    const macro = await draftMacro(input, llm);
    expect(macro.site).toBe("careers.acme.se");
    expect(macro.category).toBe("teamtailor");
    expect(macro.version).toBe(1);
    expect(macro.enabled).toBe(true);
    expect(macro.steps).toHaveLength(2);
  });

  it("throws when the LLM emits a structurally invalid macro (no steps)", async () => {
    const llm = stub(JSON.stringify({ name: "x", description: "x", steps: [] }));
    await expect(draftMacro(input, llm)).rejects.toThrow();
  });
});
