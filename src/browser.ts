/**
 * Browser wiring + step/screenshot reporting. Launches Playwright Chromium,
 * navigates to the job's target_url, delegates field-filling to the strategy,
 * runs the 4-gate safety check, and either submits (armed) or reports what it
 * WOULD submit (dry-run). Returns a structured outcome the worker stores.
 *
 * Reporting: every meaningful step is captured (label + screenshot as base64)
 * so the result is auditable — you can see exactly what the worker saw and did.
 */
import { chromium, type Browser } from "playwright";
import { fillForm } from "./strategy.js";
import { decideAction } from "./safety.js";
import type { WorkerManifest } from "./manifest.js";
import type { TaskRow } from "./task-store.js";
import type { MacroOutcome } from "./worker.js";

export interface Step {
  label: string;
  at: string;
  screenshot_b64?: string;
}

/** Build the executor the worker drains tasks through. Closes over the manifest
 *  (for the allowed-hosts gate). */
export function makeExecutor(manifest: WorkerManifest): (task: TaskRow) => Promise<MacroOutcome> {
  return async (task: TaskRow): Promise<MacroOutcome> => {
    const params = task.params;
    const targetUrl = typeof params.target_url === "string" ? params.target_url : "";
    const fields = (params.fields ?? {}) as Record<string, unknown>;
    if (!targetUrl) return { ok: false, reason: "missing_param:target_url" };

    const steps: Step[] = [];
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();

      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      steps.push(await snap(page, "loaded"));

      const fill = await fillForm(page, fields);
      steps.push(await snap(page, `filled ${fill.filledFields.length} field(s)`));

      const decision = decideAction(params, {
        pageUrl: page.url(),
        allowedHosts: manifest.allowed_hosts,
        requiredFields: fill.requiredFields,
        filledFields: fill.filledFields,
      });

      if (decision.action === "submit") {
        await fill.submit();
        steps.push(await snap(page, "submitted"));
        return { ok: true, result: { submitted: true, target_url: targetUrl, filled: fill.filledFields, steps } };
      }

      // Dry-run: report what it WOULD do, with the captured state.
      return {
        ok: true,
        result: {
          submitted: false,
          would_submit: fill.submitDescription,
          failed_gates: decision.failed_gates,
          target_url: targetUrl,
          filled: fill.filledFields,
          steps,
        },
      };
    } catch (err) {
      return { ok: false, reason: `browser_error:${err instanceof Error ? err.message : String(err)}` };
    } finally {
      await browser?.close().catch(() => {});
    }
  };
}

async function snap(page: import("playwright").Page, label: string): Promise<Step> {
  let screenshot_b64: string | undefined;
  try {
    screenshot_b64 = (await page.screenshot({ type: "png" })).toString("base64");
  } catch {
    screenshot_b64 = undefined;
  }
  return { label, at: new Date().toISOString(), ...(screenshot_b64 ? { screenshot_b64 } : {}) };
}
