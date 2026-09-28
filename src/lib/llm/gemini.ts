import { readJsonResponse, withTimeout } from "@/lib/llm/http";
import type { GenerateRequest, GenerateResponse, LLMProvider, StreamChunk } from "@/lib/llm/types";

const baseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

type GeminiEmbeddingResponse = { embedding?: { values?: number[] } };

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    const started = Date.now();
    const timeout = withTimeout(request.signal, request.timeoutMs);
    try {
      const response = await fetch(`${baseUrl}/${request.model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: request.messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role === "assistant" ? "model" : "user",
              parts: [{ text: message.content }],
            })),
          systemInstruction: request.messages.find((message) => message.role === "system")
            ? { parts: [{ text: request.messages.find((message) => message.role === "system")?.content }] }
            : undefined,
          generationConfig: {
            temperature: request.temperature ?? 0.2,
            maxOutputTokens: request.maxTokens ?? 1_024,
            ...(request.jsonMode ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: timeout.signal,
      });
      const data = await readJsonResponse<GeminiResponse>(response, this.name);
      const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!text) throw new Error("Gemini returned an empty response");
      return {
        text,
        provider: this.name,
        model: request.model,
        inputTokens: data.usageMetadata?.promptTokenCount,
        outputTokens: data.usageMetadata?.candidatesTokenCount,
        latencyMs: Date.now() - started,
      };
    } finally {
      timeout.clear();
    }
  }

  async *stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    yield { text: (await this.generate(request)).text, done: true };
  }

  async embed(texts: string[], model: string): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    const vectors: number[][] = [];
    for (const text of texts) {
      const response = await fetch(`${baseUrl}/${model}:embedContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
      });
      const data = await readJsonResponse<GeminiEmbeddingResponse>(response, this.name);
      if (!data.embedding?.values) throw new Error("Gemini returned an empty embedding");
      vectors.push(data.embedding.values);
    }
    return vectors;
  }
}
