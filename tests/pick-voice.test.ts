import { describe, expect, it } from "vitest";

import { isSouthAsian, pickVoice } from "@/lib/voice/pick-voice";

const v = (lang: string, name: string) => ({ lang, name });

describe("read-aloud voice", () => {
  it("prefers a Pakistani English voice, then South Asian English, never US first", () => {
    const voices = [v("en-US", "Google US English"), v("en-GB", "Daniel"), v("en-IN", "Microsoft Neerja Online (Natural)"), v("en-PK", "Pakistan English")];
    expect(pickVoice(voices)?.lang).toBe("en-PK");
    expect(pickVoice(voices.slice(0, 3))?.name).toContain("Neerja");
  });

  it("prefers a natural voice among South Asian ones", () => {
    expect(pickVoice([v("en-IN", "Microsoft Ravi"), v("en-IN", "Microsoft Prabhat Online (Natural)")])?.name).toContain("Prabhat");
  });

  it("does not use Urdu-script voices for Latin-alphabet text", () => {
    expect(pickVoice([v("ur-PK", "Microsoft Asad Online (Natural)"), v("en-US", "Samantha")])?.lang).toBe("en-US");
  });

  it("says whether the voice sounds South Asian", () => {
    expect(isSouthAsian(v("en-IN", "Rishi"))).toBe(true);
    expect(isSouthAsian(v("en-US", "Samantha"))).toBe(false);
    expect(isSouthAsian(undefined)).toBe(false);
  });
});
