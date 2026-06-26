/**
 * The worker's own LLM client. Used ONLY on the cold paths — harvest (build a
 * site macro once), self-heal (repair a drifted step), classify-fallback, and
 * fieldmap's novel-question answers. The hot path (replaying a known macro)
 * never calls this.
 *
 * Injectable behind the `Llm` interface so every consumer is unit-testable with
 * a stub and the worker has exactly one place that talks to Anthropic.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface Llm {
  complete(req: LlmRequest): Promise<string>;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

export function makeAnthropicLlm(apiKey: string, model = process.env.LLM_MODEL ?? DEFAULT_MODEL): Llm {
  const client = new Anthropic({ apiKey });
  return {
    async complete(req) {
      const msg = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
      });
      return msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    },
  };
}

/** Extract the first fenced ```json block (or the raw string) and JSON.parse it. */
export function parseJsonResponse<T = unknown>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  return JSON.parse(body.trim()) as T;
}
