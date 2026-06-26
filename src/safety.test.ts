import { describe, it, expect } from "vitest";
import { decideApply, type SafetyInput } from "./safety.js";

const pass: SafetyInput = {
  dryRun: false,
  allowRealConfig: true,
  armed: true,
  host: "jobs.example.com",
  allowedHosts: ["jobs.example.com"],
};

describe("decideApply (4-gate)", () => {
  it("defaults a missing dryRun to dry-run", () => {
    const { dryRun, ...noDryRun } = pass;
    expect(decideApply(noDryRun)).toEqual({
      mode: "dry_run",
      reason: "caller_requested_dry_run",
    });
  });

  it("honors an explicit dryRun:true even when every other gate would pass", () => {
    expect(decideApply({ ...pass, dryRun: true })).toEqual({
      mode: "dry_run",
      reason: "caller_requested_dry_run",
    });
  });

  it("reports config_disallows_real when the config flag is off", () => {
    expect(decideApply({ ...pass, allowRealConfig: false }).reason).toBe("config_disallows_real");
  });

  it("reports not_armed when the request is not armed", () => {
    expect(decideApply({ ...pass, armed: false }).reason).toBe("not_armed");
  });

  it("reports host_not_allowed for an unlisted host", () => {
    expect(decideApply({ ...pass, host: "evil.com" }).reason).toBe("host_not_allowed");
  });

  it("returns real only when all four gates pass", () => {
    expect(decideApply(pass)).toEqual({ mode: "real" });
  });

  it("bypasses gates 2–4 for a test target (still real)", () => {
    expect(decideApply({ ...pass, dryRun: false, allowRealConfig: false, armed: false, testTarget: true })).toEqual({
      mode: "real",
      bypassed: true,
    });
  });

  it("still honors explicit dry-run on a test target", () => {
    expect(decideApply({ ...pass, dryRun: true, testTarget: true })).toEqual({
      mode: "dry_run",
      reason: "caller_requested_dry_run",
    });
  });
});
