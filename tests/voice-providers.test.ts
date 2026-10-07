import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { speechOrder, sttOrder } from "@/lib/voice/providers";

const voice = (overrides: Partial<typeof defaultConfig.voice>) => ({ ...defaultConfig.voice, ...overrides });
const allKeys = { gemini: true, deepgram: true, groq: true };

describe("voice providers", () => {
  it("keeps the current setup unless an admin picks Deepgram", () => {
    const config = parseConfig({});
    expect(config.voice.engine).toBe("cloud");
    expect(config.voice.stt_provider).toBe("groq");
    expect(config.voice.cloud_backup).toBe(false);
    expect(speechOrder(config.voice, "en", allKeys)).toEqual(["gemini"]);
    expect(sttOrder(config.voice, allKeys)).toEqual(["groq"]);
  });

  it("accepts saved configs from before Deepgram", () => {
    expect(parseConfig({ voice: { engine: "browser", cloud_voice: "Puck" } }).voice).toMatchObject({ engine: "browser", deepgram_voice: "aura-2-thalia-en", stt_provider: "groq" });
  });

  it("never sends a Roman Urdu line to Deepgram, which has no Urdu voice", () => {
    expect(speechOrder(voice({ engine: "deepgram" }), "en", allKeys)).toEqual(["deepgram"]);
    expect(speechOrder(voice({ engine: "deepgram" }), "roman_ur", allKeys)).toEqual(["gemini"]);
    expect(speechOrder(voice({ engine: "cloud", cloud_backup: true }), "roman_ur", allKeys)).toEqual(["gemini"]);
  });

  it("tries the other provider only when the backup is on", () => {
    expect(speechOrder(voice({ engine: "cloud", cloud_backup: true }), "en", allKeys)).toEqual(["gemini", "deepgram"]);
    expect(speechOrder(voice({ engine: "deepgram", cloud_backup: true }), "en", allKeys)).toEqual(["deepgram", "gemini"]);
    expect(sttOrder(voice({ stt_provider: "deepgram", cloud_backup: true }), allKeys)).toEqual(["deepgram", "groq"]);
    expect(sttOrder(voice({ stt_provider: "deepgram" }), allKeys)).toEqual(["deepgram"]);
  });

  it("skips providers without a key, and the device voice when cloud is off", () => {
    expect(speechOrder(voice({ engine: "deepgram" }), "en", { gemini: true, deepgram: false })).toEqual([]);
    expect(speechOrder(voice({ engine: "deepgram", cloud_backup: true }), "en", { gemini: true, deepgram: false })).toEqual(["gemini"]);
    expect(speechOrder(voice({ engine: "browser" }), "en", allKeys)).toEqual([]);
    expect(sttOrder(voice({ stt_provider: "deepgram", cloud_backup: true }), { groq: true, deepgram: false })).toEqual(["groq"]);
  });
});
