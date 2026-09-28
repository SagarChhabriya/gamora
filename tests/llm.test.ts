import { afterEach, describe, expect, it, vi } from "vitest";

import { repairJson } from "@/lib/llm/json";
import { generateWithFallback } from "@/lib/llm/router";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.LLM_PRIMARY_PROVIDER;
  delete process.env.LLM_FALLBACK_PROVIDER;
  delete process.env.LLM_GROQ_FAST_MODEL;
  delete process.env.LLM_GEMINI_FAST_MODEL;
  delete process.env.GROQ_API_KEY;
  delete process.env.GEMINI_API_KEY;
});

describe("LLM helpers", () => {
  it("repairs fenced JSON", () => {
    expect(repairJson<{ value: number }>("```json\n{\"value\": 3}\n```")).toEqual({ value: 3 });
  });

  it("extracts JSON from surrounding model text", () => {
    expect(repairJson<{ ok: boolean }>("Here is the result: {\"ok\":true}")).toEqual({ ok: true });
  });

  it("rejects non-JSON output", () => {
    expect(() => repairJson("not structured")).toThrow("not valid JSON");
  });

  it("falls back with a provider-specific model", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "groq";
    process.env.LLM_FALLBACK_PROVIDER = "gemini";
    process.env.LLM_GROQ_FAST_MODEL = "openai/gpt-oss-20b";
    process.env.LLM_GEMINI_FAST_MODEL = "gemini-3.1-flash-lite";
    process.env.GROQ_API_KEY = "test-groq";
    process.env.GEMINI_API_KEY = "test-gemini";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("groq")
        ? new Response("overloaded", { status: 503 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "fallback" }] } }] }), {
            status: 200,
          }),
    );

    const result = await generateWithFallback({
      model: "ignored-by-task-routing",
      task: "fast",
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.provider).toBe("gemini");
    expect(result.fallbackUsed).toBe(true);
    const geminiCall = fetchMock.mock.calls.find(([input]) => String(input).includes("generativelanguage"));
    expect(String(geminiCall?.[0])).toContain("gemini-3.1-flash-lite");
  });

  it("tries the provider's other model before giving up on it", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "gemini";
    process.env.LLM_GEMINI_FAST_MODEL = "lite-a";
    process.env.LLM_GEMINI_REASONING_MODEL = "lite-b";
    process.env.GEMINI_API_KEY = "test-gemini";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("lite-a")
        ? new Response("busy", { status: 503 })
        : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }),
    );

    const result = await generateWithFallback({ model: "", task: "fast", messages: [{ role: "user", content: "hi" }] });
    expect(result.model).toBe("lite-b");
    delete process.env.LLM_GEMINI_REASONING_MODEL;
  });

  it("skips providers named in an outage drill", async () => {
    process.env.LLM_PRIMARY_PROVIDER = "groq";
    process.env.LLM_FALLBACK_PROVIDER = "gemini";
    process.env.GROQ_API_KEY = "test-groq";
    process.env.GEMINI_API_KEY = "test-gemini";
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), { status: 200 }));

    const result = await generateWithFallback({
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      skipProviders: ["groq"],
    });
    expect(result.provider).toBe("gemini");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("groq"))).toBe(false);
  });
});

describe("rate limit handling", () => {
  it("reads the provider's suggested wait", async () => {
    const { retryAfterMs } = await import("@/lib/llm/http");
    expect(retryAfterMs(new Response("", { status: 429 }), "Please try again in 2.2275s.")).toBeCloseTo(2227.5);
    expect(retryAfterMs(new Response("", { status: 429, headers: { "retry-after": "3" } }), "")).toBe(3000);
  });
});
