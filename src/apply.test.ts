import { describe, it, expect } from "vitest";
import { runApply, type ApplyConfig, type ApplyDeps, type Session } from "./apply.js";
import type { ToolRegistry } from "./macro/executor.js";
import type { FormField } from "./fieldmap.js";
import type { Macro } from "./macro/types.js";
import type { Llm } from "./llm.js";

function macro(over: Partial<Macro> = {}): Macro {
  return {
    name: "apply",
    description: "apply",
    site: "jobs.acme.se",
    category: "teamtailor",
    params: {},
    steps: [{ tool: "goto", args: { url: "$targetUrl" } }],
    submit_selector: "#submit",
    version: 1,
    enabled: true,
    created_at: "x",
    updated_at: "x",
    ...over,
  };
}

interface FakeOpts {
  form?: FormField[];
  failTool?: { name: string; times: number };
}

function fakeSession(url: string, opts: FakeOpts = {}): Session & { calls: Record<string, unknown[][]> } {
  const calls: Record<string, unknown[][]> = { fill: [], click: [], tool: [] };
  let failsLeft = opts.failTool?.times ?? 0;
  const tools: ToolRegistry = new Proxy(
    {},
    {
      get: (_t, name: string) => async (args: Record<string, unknown>) => {
        calls.tool.push([name, args]);
        if (opts.failTool && name === opts.failTool.name && failsLeft > 0) {
          failsLeft--;
          throw new Error("element_not_found");
        }
        return undefined;
      },
    },
  ) as ToolRegistry;
  return {
    calls,
    url: () => url,
    has: async () => false,
    readForm: async () => opts.form ?? [],
    digest: async () => "DIGEST",
    tools,
    fill: async (s, v) => { calls.fill.push([s, v]); },
    click: async (s) => { calls.click.push([s]); },
    screenshot: async () => "b64png",
    close: async () => {},
  };
}

const cfg: ApplyConfig = {
  categories: [{ category: "teamtailor", signatures: [{ url_glob: "*acme.se/*" }] }],
  allowedHosts: ["jobs.acme.se"],
  allowRealConfig: true,
  testTargets: ["/test-employer/"],
  macroName: "apply",
  goal: "fill and submit the application",
};

const form: FormField[] = [
  { selector: "#email", label: "Email", type: "email", required: true },
  { selector: "#name", label: "Full name", type: "text", required: true },
];

const stubLlm = (text: string): Llm => ({ complete: async () => text });

describe("runApply", () => {
  it("dry-runs by default: fills via fieldmap, withholds the submit, reports would_submit", async () => {
    const session = fakeSession("https://jobs.acme.se/jobs/1", { form });
    const deps: ApplyDeps = {
      resolveMacro: () => macro(),
      putMacro: () => {},
      openSession: async () => session,
    };
    const res = await runApply({ targetUrl: "https://jobs.acme.se/jobs/1", fields: { email: "a@b.se", full_name: "Anna" } }, cfg, deps);
    expect(res.mode).toBe("dry_run");
    expect(res.submitted).toBe(false);
    expect(res.would_submit).toBe("#submit");
    expect(session.calls.fill.length).toBe(2);
    expect(session.calls.click.length).toBe(0);
    expect(res.screenshot).toBe("b64png");
  });

  it("submits when armed on a test target (gate bypass)", async () => {
    const session = fakeSession("https://jobs.acme.se/test-employer/x", { form });
    const deps: ApplyDeps = { resolveMacro: () => macro(), putMacro: () => {}, openSession: async () => session };
    const res = await runApply(
      { targetUrl: "https://jobs.acme.se/test-employer/x", fields: { email: "a@b.se", full_name: "Anna" }, dryRun: false },
      cfg,
      deps,
    );
    expect(res.mode).toBe("real");
    expect(res.submitted).toBe(true);
    expect(session.calls.click).toEqual([["#submit"]]);
  });

  it("harvests a macro when none is registered, then persists it", async () => {
    const session = fakeSession("https://jobs.acme.se/jobs/9", { form });
    let saved: Macro | null = null;
    const draft = JSON.stringify({
      name: "apply",
      description: "harvested",
      params: {},
      steps: [{ tool: "goto", args: { url: "$targetUrl" } }],
      submit_selector: "#submit",
    });
    const deps: ApplyDeps = {
      resolveMacro: () => null,
      putMacro: (m) => { saved = m; },
      openSession: async () => session,
      llm: stubLlm("```json\n" + draft + "\n```"),
    };
    const res = await runApply({ targetUrl: "https://jobs.acme.se/jobs/9", fields: { email: "a@b.se" } }, cfg, deps);
    expect(res.harvested).toBe(true);
    expect(saved).not.toBeNull();
    expect(saved!.site).toBe("jobs.acme.se");
  });

  it("self-heals a drifted step and persists the new version", async () => {
    const session = fakeSession("https://jobs.acme.se/jobs/3", { form, failTool: { name: "click", times: 1 } });
    const m = macro({ steps: [{ tool: "click", args: { selector: "#old" } }], version: 2 });
    let saved: Macro | null = null;
    const deps: ApplyDeps = {
      resolveMacro: () => m,
      putMacro: (x) => { saved = x; },
      openSession: async () => session,
      llm: stubLlm("```json\n" + JSON.stringify({ tool: "click", args: { selector: "#new" } }) + "\n```"),
    };
    const res = await runApply({ targetUrl: "https://jobs.acme.se/jobs/3", fields: {} }, cfg, deps);
    expect(res.healed).toBe(true);
    expect(saved).not.toBeNull();
    expect(saved!.version).toBe(3);
  });
});
