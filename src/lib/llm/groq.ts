import { readJsonResponse, withTimeout } from "@/lib/llm/http";
import type { GenerateRequest, GenerateResponse, LLMProvider, StreamChunk } from "@/lib/llm/types";

const endpoint = "https://api.groq.com/openai/v1/chat/completions";

type GroqResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export class GroqProvider implements LLMProvider {
  readonly name = "groq";

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
    const started = Date.now();
    const timeout = withTimeout(request.signal);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 1_024,
          ...(request.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: timeout.signal,
      });
      const data = await readJsonResponse<GroqResponse>(response, this.name);
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Groq returned an empty response");
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
