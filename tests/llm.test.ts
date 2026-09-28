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

describe("contributor key pool", () => {
  it("switches to the next contributor key on a rate limit without waiting", async () => {
    const { resetKeyPool } = await import("@/lib/llm/keys");
    resetKeyPool();
    process.env.LLM_PRIMARY_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "owner-key";
    process.env.GROQ_API_KEY_SUM = "sum-key";
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const auth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
      seen.push(auth);
      return auth.includes("owner-key")
        ? new Response("Rate limit reached. Please try again in 30s.", { status: 429 })
        : new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });
    const result = await generateWithFallback({ model: "m", messages: [{ role: "user", content: "hi" }] });
    expect(result.keyLabel).toBe("sum");
    expect(seen.some((auth) => auth.includes("sum-key"))).toBe(true);
    delete process.env.GROQ_API_KEY_SUM;
  });

  it("keeps the fallback sequence: the owner key serves every request until it is rate limited", async () => {
    const { resetKeyPool, restKey, keyOrder } = await import("@/lib/llm/keys");
    resetKeyPool();
    process.env.GROQ_API_KEY = "owner-key";
    process.env.GROQ_API_KEY_SUM = "sum-key";
    process.env.GROQ_API_KEY_EDU = "edu-key";
    expect(keyOrder("groq").map((key) => key.label)).toEqual(["owner", "sum", "edu"]);
    expect(keyOrder("groq").map((key) => key.label)).toEqual(["owner", "sum", "edu"]);
    restKey("groq", "owner", 30_000);
    expect(keyOrder("groq").map((key) => key.label)).toEqual(["sum", "edu", "owner"]);
    restKey("groq", "sum", 30_000);
    expect(keyOrder("groq")[0].label).toBe("edu");
    resetKeyPool();
    delete process.env.GROQ_API_KEY_SUM;
    delete process.env.GROQ_API_KEY_EDU;
  });

  it("lists keys by contributor label and never exposes values in labels", async () => {
    const { providerKeys } = await import("@/lib/llm/keys");
    process.env.GEMINI_API_KEY = "a";
    process.env.GEMINI_API_KEY_EDU = "b";
    process.env.GEMINI_API_KEY_33 = "c";
    expect(providerKeys("gemini").map((key) => key.label)).toEqual(["owner", "edu", "33"]);
    delete process.env.GEMINI_API_KEY_EDU;
    delete process.env.GEMINI_API_KEY_33;
  });

  it("uses OpenRouter from the provider chain", async () => {
    process.env.LLM_PROVIDER_CHAIN = "groq,openrouter";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.LLM_OPENROUTER_FAST_MODEL = "google/gemma-4-31b-it:free";
    delete process.env.GROQ_API_KEY;
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    const result = await generateWithFallback({ model: "", task: "fast", messages: [{ role: "user", content: "hi" }] });
    expect(result.provider).toBe("openrouter");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("openrouter.ai");
    delete process.env.LLM_PROVIDER_CHAIN;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.LLM_OPENROUTER_FAST_MODEL;
  });
});
