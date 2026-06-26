import { describe, it, expect } from "vitest";
import { substitute } from "./substitute.js";

describe("substitute", () => {
  it("resolves an exact $ref to the raw value, preserving type", () => {
    expect(substitute("$n", { n: 42 })).toBe(42);
    expect(substitute("$o", { o: { a: 1 } })).toEqual({ a: 1 });
    expect(substitute("$b", { b: true })).toBe(true);
  });

  it("interpolates inline $refs as strings", () => {
    expect(substitute("Hej $name, welcome", { name: "Anna" })).toBe("Hej Anna, welcome");
    expect(substitute("$a-$b", { a: 1, b: 2 })).toBe("1-2");
  });

  it("substitutes recursively through objects and arrays", () => {
    const out = substitute({ to: "$email", tags: ["$a", "lit"] }, { email: "x@y.z", a: "T" });
    expect(out).toEqual({ to: "x@y.z", tags: ["T", "lit"] });
  });

  it("leaves non-string scalars untouched", () => {
    expect(substitute(7, {})).toBe(7);
    expect(substitute(null, {})).toBe(null);
  });

  it("throws on an unbound reference (no silent blanks)", () => {
    expect(() => substitute("$missing", {})).toThrow(/unbound_var:missing/);
    expect(() => substitute("hi $missing", {})).toThrow(/unbound_var:missing/);
  });

  it("treats null/undefined context values as empty in inline position", () => {
    expect(substitute("[$x]", { x: null })).toBe("[]");
  });
});
