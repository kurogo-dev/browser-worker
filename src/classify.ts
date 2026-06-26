/**
 * Page → { site, category }. `site` is the page host (one macro per website);
 * `category` groups sites by platform (the ATS family). Categories carry
 * detection `signatures`: a signature matches when all its present conditions
 * hold (URL glob AND/OR a DOM selector being present); a category matches if
 * ANY of its signatures match. Deterministic-first — the LLM fallback (when no
 * signature matches) lives in apply.ts so this stays pure + unit-testable.
 */
export interface Signature {
  /** Glob against the full URL (e.g. "*.teamtailor.com/*"). */
  url_glob?: string;
  /** A selector that must be present on the page. */
  selector?: string;
}

export interface CategorySignatures {
  category: string;
  signatures: Signature[];
}

/** A minimal page probe so classify is testable without Playwright. */
export interface PageProbe {
  url: string;
  has(selector: string): boolean | Promise<boolean>;
}

export function siteOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
}

async function signatureMatches(sig: Signature, probe: PageProbe): Promise<boolean> {
  if (sig.url_glob === undefined && sig.selector === undefined) return false;
  if (sig.url_glob !== undefined && !globToRegExp(sig.url_glob).test(probe.url)) return false;
  if (sig.selector !== undefined && !(await probe.has(sig.selector))) return false;
  return true;
}

export interface Classification {
  site: string;
  category: string;
}

export async function classify(probe: PageProbe, categories: CategorySignatures[]): Promise<Classification> {
  const site = siteOf(probe.url);
  for (const cat of categories) {
    for (const sig of cat.signatures) {
      if (await signatureMatches(sig, probe)) return { site, category: cat.category };
    }
  }
  return { site, category: "" };
}
