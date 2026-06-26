/**
 * Adaptive field-mapping — absorbs the per-ad variation a per-site macro can't
 * encode. Given the form's actual fields and the request's `fields` (k/v), it
 * matches known fields by semantic role (normalized label/name overlap), and
 * leaves genuinely NOVEL fields (a custom screening question with no provided
 * answer) for the LLM to answer from profile context.
 *
 * `matchKnownFields` is pure (TDD); `mapFields` layers the injected LLM on top
 * for the novel free-text questions — the only hot-path LLM use.
 */
export interface FormField {
  selector: string;
  /** Best human label for the field: visible label, name, placeholder, or aria. */
  label: string;
  type: string;
  required: boolean;
}

export interface FieldAssignment {
  selector: string;
  value: string;
  source: "profile" | "generated";
}

export interface MatchResult {
  fills: FieldAssignment[];
  /** Form fields with no profile match — candidates for LLM answering. */
  novel: FormField[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function score(fieldLabel: string, key: string): number {
  const nf = normalize(fieldLabel);
  const nk = normalize(key);
  if (!nf || !nk) return 0;
  if (nf === nk) return 1;
  if (nf.includes(nk) || nk.includes(nf)) return 0.8;
  const tf = tokens(fieldLabel);
  const tk = tokens(key);
  let shared = 0;
  for (const t of tk) if (tf.has(t)) shared++;
  const union = new Set([...tf, ...tk]).size;
  return union ? (shared / union) * 0.7 : 0;
}

const MATCH_THRESHOLD = 0.34;

/** Greedy best-match assignment of request fields onto form fields. Each
 *  request key is used at most once. Pure + deterministic. */
export function matchKnownFields(
  formFields: FormField[],
  requestFields: Record<string, unknown>,
): MatchResult {
  const keys = Object.keys(requestFields);
  const used = new Set<string>();
  const fills: FieldAssignment[] = [];
  const novel: FormField[] = [];

  for (const field of formFields) {
    let bestKey: string | null = null;
    let best = MATCH_THRESHOLD;
    for (const key of keys) {
      if (used.has(key)) continue;
      const s = score(field.label, key);
      if (s > best) {
        best = s;
        bestKey = key;
      }
    }
    if (bestKey !== null) {
      used.add(bestKey);
      const raw = requestFields[bestKey];
      fills.push({ selector: field.selector, value: raw == null ? "" : String(raw), source: "profile" });
    } else {
      novel.push(field);
    }
  }
  return { fills, novel };
}

/** An injected answerer for novel free-text questions. */
export type NovelAnswerer = (field: FormField, profile: Record<string, unknown>) => Promise<string | null>;

/** Full mapping: known fields by semantics + LLM-answered novel free-text
 *  fields. Non-text novel fields (file/select with no match) are left unfilled
 *  and returned so the caller can decide (often → dry-run report). */
export async function mapFields(
  formFields: FormField[],
  requestFields: Record<string, unknown>,
  answerNovel: NovelAnswerer,
  profile: Record<string, unknown>,
): Promise<{ fills: FieldAssignment[]; unfilled: FormField[] }> {
  const { fills, novel } = matchKnownFields(formFields, requestFields);
  const unfilled: FormField[] = [];
  for (const field of novel) {
    const isText = field.type === "text" || field.type === "textarea";
    if (!isText) {
      unfilled.push(field);
      continue;
    }
    const answer = await answerNovel(field, profile);
    if (answer === null) unfilled.push(field);
    else fills.push({ selector: field.selector, value: answer, source: "generated" });
  }
  return { fills, unfilled };
}
