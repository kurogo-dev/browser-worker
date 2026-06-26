/**
 * Live browser smoke — exercises the Playwright glue (launch, goto, readForm's
 * DOM-evaluate, fill, screenshot) that the unit tests fake. Gated behind SMOKE=1
 * because it needs a real Chromium (npx playwright install chromium). Run:
 *   SMOKE=1 npx vitest run src/smoke.live.test.ts
 */
import { describe, it, expect } from "vitest";
import { makePlaywrightSession } from "./browser.js";
import { matchKnownFields } from "./fieldmap.js";

const FORM = `data:text/html,${encodeURIComponent(`
  <form>
    <label for="email">Email address</label><input id="email" name="email" type="email" required>
    <label for="name">Full name</label><input id="name" name="name" type="text" required>
    <label for="note">Why this role?</label><textarea id="note" name="note"></textarea>
    <button id="submit" type="submit">Apply</button>
  </form>
`)}`;

describe.skipIf(!process.env.SMOKE)("live browser smoke", () => {
  it("reads the form, maps fields, and fills them via Playwright", async () => {
    const session = await makePlaywrightSession(FORM);
    try {
      const fields = await session.readForm();
      // 3 fillable controls (email, name, textarea) — the submit button is excluded.
      expect(fields.length).toBe(3);
      expect(fields.map((f) => f.label)).toContain("Email address");

      const { fills } = matchKnownFields(fields, { email: "anna@example.se", full_name: "Anna Andersson" });
      expect(fills.length).toBeGreaterThanOrEqual(2);
      // Filling without throwing proves the selectors readForm produced are valid + actionable.
      for (const fa of fills) await session.fill(fa.selector, fa.value);

      const shot = await session.screenshot();
      expect(typeof shot).toBe("string");
      expect((shot ?? "").length).toBeGreaterThan(100);
    } finally {
      await session.close();
    }
  }, 60_000);
});
