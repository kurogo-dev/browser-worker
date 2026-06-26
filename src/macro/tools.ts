/**
 * The Playwright-backed tool vocabulary macro steps call. This is the only
 * module that touches the live browser; the executor stays pure over the
 * `ToolRegistry` this produces. Keeping the set small and declarative is what
 * lets a macro be a portable JSON recipe.
 *
 * Tools (args are post-substitution):
 *   goto      { url }
 *   fill      { selector, value }
 *   click     { selector }
 *   select    { selector, value }
 *   upload    { selector, path }
 *   waitFor   { selector, timeout_ms? }
 *   readText  { selector }            → string
 *   exists    { selector }            → boolean
 *   screenshot {}                     → base64 png
 */
import type { Page } from "playwright";
import type { ToolRegistry } from "./executor.js";

const DEFAULT_TIMEOUT = 8000;

function sel(args: Record<string, unknown>): string {
  const s = args.selector;
  if (typeof s !== "string" || !s) throw new Error("missing_arg:selector");
  return s;
}

export function makePlaywrightTools(page: Page): ToolRegistry {
  return {
    goto: async (args) => {
      const url = String(args.url ?? "");
      if (!url) throw new Error("missing_arg:url");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    },
    fill: async (args) => {
      await page.locator(sel(args)).first().fill(String(args.value ?? ""), { timeout: DEFAULT_TIMEOUT });
    },
    click: async (args) => {
      await page.locator(sel(args)).first().click({ timeout: DEFAULT_TIMEOUT });
    },
    select: async (args) => {
      await page.locator(sel(args)).first().selectOption(String(args.value ?? ""), { timeout: DEFAULT_TIMEOUT });
    },
    upload: async (args) => {
      const path = String(args.path ?? "");
      if (!path) throw new Error("missing_arg:path");
      await page.locator(sel(args)).first().setInputFiles(path, { timeout: DEFAULT_TIMEOUT });
    },
    waitFor: async (args) => {
      const timeout = typeof args.timeout_ms === "number" ? args.timeout_ms : DEFAULT_TIMEOUT;
      await page.locator(sel(args)).first().waitFor({ state: "visible", timeout });
    },
    readText: async (args) => {
      return (await page.locator(sel(args)).first().textContent({ timeout: DEFAULT_TIMEOUT }))?.trim() ?? "";
    },
    exists: async (args) => {
      return (await page.locator(sel(args)).count()) > 0;
    },
    screenshot: async () => {
      return (await page.screenshot({ type: "png" })).toString("base64");
    },
  };
}
