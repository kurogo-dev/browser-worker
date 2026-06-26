import { describe, it, expect } from "vitest";
import { matchKnownFields, mapFields, type FormField } from "./fieldmap.js";

const f = (selector: string, label: string, type = "text", required = false): FormField => ({
  selector,
  label,
  type,
  required,
});

describe("matchKnownFields", () => {
  it("matches fields to request keys by semantic overlap", () => {
    const form = [f("#email", "Email address"), f("#name", "Full name"), f("#phone", "Phone number")];
    const { fills, novel } = matchKnownFields(form, { email: "a@b.se", full_name: "Anna A", phone: "+4670" });
    expect(novel).toHaveLength(0);
    const bySel = Object.fromEntries(fills.map((x) => [x.selector, x.value]));
    expect(bySel["#email"]).toBe("a@b.se");
    expect(bySel["#name"]).toBe("Anna A");
    expect(bySel["#phone"]).toBe("+4670");
    expect(fills.every((x) => x.source === "profile")).toBe(true);
  });

  it("returns unmatched form fields as novel", () => {
    const form = [f("#q1", "Why do you want to work here?", "textarea", true)];
    const { fills, novel } = matchKnownFields(form, { email: "a@b.se" });
    expect(fills).toHaveLength(0);
    expect(novel).toHaveLength(1);
    expect(novel[0]!.selector).toBe("#q1");
  });

  it("uses each request key at most once (greedy by score)", () => {
    const form = [f("#a", "Email"), f("#b", "Email confirm")];
    const { fills } = matchKnownFields(form, { email: "a@b.se" });
    // only one field gets the single email value
    expect(fills).toHaveLength(1);
    expect(fills[0]!.value).toBe("a@b.se");
  });
});

describe("mapFields", () => {
  const profile = { name: "Anna" };

  it("answers a novel free-text question via the injected LLM", async () => {
    const form = [f("#why", "Why this company?", "textarea", true)];
    const { fills, unfilled } = await mapFields(form, {}, async () => "Because…", profile);
    expect(unfilled).toHaveLength(0);
    expect(fills[0]).toMatchObject({ selector: "#why", source: "generated", value: "Because…" });
  });

  it("leaves a novel non-text field (file/select) unfilled", async () => {
    const form = [f("#cv", "Upload CV", "file", true)];
    const { fills, unfilled } = await mapFields(form, {}, async () => "x", profile);
    expect(fills).toHaveLength(0);
    expect(unfilled.map((u) => u.selector)).toEqual(["#cv"]);
  });

  it("leaves a novel text field unfilled when the LLM declines (null)", async () => {
    const form = [f("#opt", "Optional note", "text", false)];
    const { unfilled } = await mapFields(form, {}, async () => null, profile);
    expect(unfilled.map((u) => u.selector)).toEqual(["#opt"]);
  });
});
