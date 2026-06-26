/**
 * Browser session + page inspection helpers. The only place (besides
 * macro/tools.ts) that touches Playwright. Provides:
 *   - launchSession(): a Chromium page + teardown
 *   - pageProbe(page): the PageProbe classify needs (url + selector presence)
 *   - readForm(page): the live form's fields → FormField[] for fieldmap
 *   - domDigest(page): a token-bounded summary of the visible form for the LLM
 *     (harvest / self-heal) — NOT raw HTML
 */
import { chromium, type Browser, type Page } from "playwright";
import type { PageProbe } from "./classify.js";
import type { FormField } from "./fieldmap.js";

export interface Session {
  page: Page;
  close: () => Promise<void>;
}

export async function launchSession(): Promise<Session> {
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  return { page, close: async () => { await browser.close().catch(() => {}); } };
}

export function pageProbe(page: Page): PageProbe {
  return {
    url: page.url(),
    has: async (selector) => (await page.locator(selector).count()) > 0,
  };
}

/** Extract the page's fillable fields with a best-effort human label. */
export async function readForm(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    function labelFor(el: Element): string {
      const id = el.getAttribute("id");
      if (id) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab?.textContent) return lab.textContent.trim();
      }
      const wrap = el.closest("label");
      if (wrap?.textContent) return wrap.textContent.trim();
      return (
        el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        el.getAttribute("id") ||
        ""
      );
    }
    function cssPath(el: Element): string {
      const id = el.getAttribute("id");
      if (id) return `#${CSS.escape(id)}`;
      const name = el.getAttribute("name");
      if (name) return `${el.tagName.toLowerCase()}[name="${name}"]`;
      return el.tagName.toLowerCase();
    }
    const out: Array<{ selector: string; label: string; type: string; required: boolean }> = [];
    const els = document.querySelectorAll("input, textarea, select");
    els.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const t = tag === "input" ? (el.getAttribute("type") || "text").toLowerCase() : tag === "textarea" ? "textarea" : "select";
      if (["hidden", "submit", "button", "reset", "image"].includes(t)) return;
      out.push({
        selector: cssPath(el),
        label: labelFor(el).replace(/\s+/g, " ").slice(0, 120),
        type: t,
        required: el.hasAttribute("required") || el.getAttribute("aria-required") === "true",
      });
    });
    return out;
  });
}

/** A compact, token-bounded description of the form for the LLM. */
export async function domDigest(page: Page): Promise<string> {
  const fields = await readForm(page);
  const lines = fields.map(
    (f) => `- ${f.type}${f.required ? " (required)" : ""} | label="${f.label}" | selector=${f.selector}`,
  );
  const title = await page.title().catch(() => "");
  return `URL: ${page.url()}\nTITLE: ${title}\nFORM FIELDS (${fields.length}):\n${lines.join("\n")}`;
}
