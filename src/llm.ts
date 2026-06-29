/**
 * The worker's own LLM client. Used ONLY on the cold paths — harvest (build a
 * site macro once), self-heal (repair a drifted step), classify-fallback, and
 * fieldmap's novel-question answers. The hot path (replaying a known macro)
 * never calls this.
 *
 * Routed through OpenRouter (OpenAI-compatible chat-completions). One key, any
 * model — switch model via LLM_MODEL without touching code. Plain `fetch` (Node
 * >= 22), so no SDK dependency. Injectable behind the `Llm` interface so every
 * consumer is unit-testable with a stub and the worker has exactly one place
 * that talks to a model provider.
 */
export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface Llm {
  complete(req: LlmRequest): Promise<string>;
}

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";

export function makeLlm(
  apiKey: string,
  model = process.env.LLM_MODEL ?? DEFAULT_MODEL,
  baseUrl = process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL,
): Llm {
  return {
    async complete(req) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          // OpenRouter attribution headers (optional but recommended).
          "HTTP-Referer": process.env.LLM_REFERER ?? "https://kurogo.dev",
          "X-Title": "browser-worker",
        },
        body: JSON.stringify({
          model,
          max_tokens: req.maxTokens ?? 1024,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`llm_request_failed:${res.status}:${detail.slice(0, 300)}`);
      }
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return body.choices?.[0]?.message?.content ?? "";
    },
  };
}

/** Extract the first fenced ```json block (or the raw string) and JSON.parse it. */
export function parseJsonResponse<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  return JSON.parse(body.trim()) as T;
}
