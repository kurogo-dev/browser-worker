/**
 * ★ THE FILE YOU CUSTOMIZE ★
 *
 * A strategy maps a job's `fields` onto a specific kind of page. One strategy
 * per form type. Given the Playwright `page` and the request `fields`, it:
 *   - locates and fills inputs,
 *   - reports which field keys it considers REQUIRED (drives safety gate 3),
 *   - returns the locator/description of the final submit control.
 *
 * The stub below is a generic best-effort filler (match by name/id/placeholder/
 * label). Replace its body with selectors tuned to your target form — that is
 * the whole point of the template.
 */
import type { Page } from "playwright";

export interface FillResult {
  /** Field keys this strategy treats as required (safety gate 3). */
  requiredFields: string[];
  /** Field keys actually filled on the page. */
  filledFields: string[];
  /** A human-readable description of the submit control (for the report). */
  submitDescription: string;
  /** Perform the real submit click. Only called after the safety gates pass. */
  submit: () => Promise<void>;
}

export async function fillForm(page: Page, fields: Record<string, unknown>): Promise<FillResult> {
  const filled: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    const text = String(value);
    // Best-effort match: input/textarea by name, id, placeholder, or aria-label.
    const candidates = [
      page.locator(`input[name="${key}"], textarea[name="${key}"]`),
      page.locator(`#${cssEscape(key)}`),
      page.getByPlaceholder(new RegExp(key, "i")),
      page.getByLabel(new RegExp(key, "i")),
    ];
    for (const loc of candidates) {
      if ((await loc.count()) > 0) {
        try {
          await loc.first().fill(text, { timeout: 2000 });
          filled.push(key);
          break;
        } catch {
          /* try the next candidate */
        }
      }
    }
  }

  // Customize: which keys MUST be present for a real submit to be safe.
  const requiredFields = Object.keys(fields);

  const submitButton = page
    .locator('button[type="submit"], input[type="submit"]')
    .or(page.getByRole("button", { name: /apply|submit|send/i }))
    .first();

  return {
    requiredFields,
    filledFields: filled,
    submitDescription: "first submit/apply button",
    submit: async () => {
      await submitButton.click({ timeout: 5000 });
    },
  };
}

/** Minimal CSS.escape for ids that may contain unsafe chars. */
function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
