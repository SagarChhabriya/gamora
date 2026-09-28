import { readJsonResponse, withTimeout } from "@/lib/llm/http";
import type { GenerateRequest, GenerateResponse, LLMProvider, StreamChunk } from "@/lib/llm/types";

const endpoint = "https://openrouter.ai/api/v1/chat/completions";

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string; code?: number };
};

/** OpenRouter: OpenAI-compatible gateway, used for its free models as a third provider. */
export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter";

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = request.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
    const started = Date.now();
    const timeout = withTimeout(request.signal, request.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.APP_ORIGIN ?? "https://gamora-web.vercel.app",
          "X-Title": "Gamora",
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 1_024,
          // Keep hidden reasoning short and out of the answer.
          reasoning: { effort: "low", exclude: true },
          ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: timeout.signal,
      });
      const data = await readJsonResponse<OpenRouterResponse>(response, this.name);
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error(`OpenRouter returned an empty response${data.error?.message ? `: ${data.error.message}` : ""}`);
      return {
        text,
        provider: this.name,
        model: request.model,
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
        latencyMs: Date.now() - started,
      };
    } finally {
      timeout.clear();
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    yield { text: (await this.generate(request)).text, done: true };
  }
}
