import { describe, it, expect } from "vitest";
import { repairStep, buildRepairPrompt, type RepairInput } from "./selfheal.js";
import type { Llm } from "./llm.js";

const input: RepairInput = {
  failedStep: { tool: "click", args: { selector: "#old-submit" } },
  reason: "element_not_found",
  selector: "#old-submit",
  digest: "FORM FIELDS:\n- button | label=Apply | selector=#apply-btn",
};

const stub = (text: string): Llm => ({ complete: async () => text });

describe("buildRepairPrompt", () => {
  it("includes the failed step, reason, and current page", () => {
    const { user } = buildRepairPrompt(input);
    expect(user).toContain("#old-submit");
    expect(user).toContain("element_not_found");
    expect(user).toContain("#apply-btn");
  });
});

describe("repairStep", () => {
  it("returns a validated repaired step", async () => {
    const llm = stub("```json\n" + JSON.stringify({ tool: "click", args: { selector: "#apply-btn" } }) + "\n```");
    const step = await repairStep(input, llm);
    expect(step.tool).toBe("click");
    expect(step.args.selector).toBe("#apply-btn");
  });

  it("throws on an invalid repaired step (empty tool)", async () => {
    const llm = stub(JSON.stringify({ tool: "", args: {} }));
    await expect(repairStep(input, llm)).rejects.toThrow();
  });
});
