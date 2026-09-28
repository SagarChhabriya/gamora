import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { decide, initialPolicyState, type PolicyInput } from "@/lib/tutor/policy";
import type { EvidenceRecord } from "@/lib/tutor/types";

const ev = (correct: boolean, hints = 0): EvidenceRecord => ({ concept_id: "c1", signal: correct ? "correct" : "wrong", correct, hints, at: 0 });
const base = initialPolicyState("new_joiner", "en", defaultConfig);
const last = (overrides: Partial<NonNullable<PolicyInput["last"]>> = {}): NonNullable<PolicyInput["last"]> => ({
  correct: true,
  partial: false,
  hints: 0,
  responseMs: 20_000,
  replyWords: 20,
  replyLanguage: "en",
  selfCorrected: false,
  overconfident: false,
  ...overrides,
});
const codes = (input: PolicyInput) => decide(input).reasons.map((reason) => reason.code);

/** Ten scripted learner traces. Each expects a specific, explainable adaptation (M4 exit). */
describe("adaptation policy traces", () => {
  it("1. two strong answers in a row raise difficulty and pace", () => {
    const out = decide({ state: base, persona: "new_joiner", evidence: [ev(true), ev(true)], last: last(), config: defaultConfig });
    expect(out.difficulty).toBe(base.difficulty + 1);
    expect(out.pace).toBe("brisk");
    expect(out.reasons[0].code).toBe("raise_difficulty");
  });

  it("2. a single correct answer does not raise difficulty at medium sensitivity", () => {
    expect(decide({ state: base, persona: "new_joiner", evidence: [ev(false), ev(true)], last: last(), config: defaultConfig }).difficulty).toBe(base.difficulty);
  });

  it("3. two errors in a row lower difficulty, add a worked example, switch to choices", () => {
    const out = decide({ state: { ...base, difficulty: 3 }, persona: "new_joiner", evidence: [ev(false), ev(false)], last: last({ correct: false }), config: defaultConfig });
    expect(out.difficulty).toBe(2);
    expect(out.worked_example).toBe(true);
    expect(out.modality).toBe("choices");
    expect(out.override).toBe("scenario");
    expect(codes({ state: { ...base, difficulty: 3 }, persona: "new_joiner", evidence: [ev(false), ev(false)], last: last({ correct: false }), config: defaultConfig })).toContain("lower_difficulty");
  });

  it("4. heavy hint use on a wrong answer lowers difficulty even without an error streak", () => {
    const out = decide({ state: { ...base, difficulty: 3 }, persona: "new_joiner", evidence: [ev(true), ev(false, 2)], last: last({ correct: false, hints: 2 }), config: defaultConfig });
    expect(out.difficulty).toBe(2);
    expect(out.reasons[0].text).toMatch(/hints/);
  });

  it("5. slow and short replies shorten content and offer choices", () => {
    const out = decide({ state: base, persona: "new_joiner", evidence: [ev(true)], last: last({ responseMs: 120_000, replyWords: 3 }), config: defaultConfig });
    expect(out.modality).toBe("choices");
    expect(out.pace).toBe("brisk");
    expect(out.reasons.map((reason) => reason.code)).toContain("shorten");
  });

  it("6. replying in Roman Urdu switches the tutor language", () => {
    const out = decide({ state: base, persona: "new_joiner", evidence: [ev(true)], last: last({ replyLanguage: "roman_ur" }), config: defaultConfig });
    expect(out.language).toBe("roman_ur");
    expect(out.reasons.map((reason) => reason.code)).toContain("language_switch");
  });

  it("7. recovery after a struggle returns to open questions", () => {
    const out = decide({ state: { ...base, modality: "choices" }, persona: "new_joiner", evidence: [ev(false), ev(false), ev(true)], last: last(), config: defaultConfig });
    expect(out.modality).toBe("open");
    expect(out.reasons.map((reason) => reason.code)).toContain("recovered");
  });

  it("8. self correction keeps the level and says why", () => {
    const out = decide({ state: base, persona: "new_joiner", evidence: [ev(false), ev(true)], last: last({ selfCorrected: true }), config: defaultConfig });
    expect(out.difficulty).toBe(base.difficulty);
    expect(out.reasons.map((reason) => reason.code)).toContain("self_corrected");
  });

  it("9. overconfidence schedules a revisit of the concept", () => {
    const out = decide({ state: base, persona: "new_joiner", evidence: [ev(false)], last: last({ correct: false, overconfident: true }), config: defaultConfig });
    expect(out.revisit).toBe("c1");
  });

  it("10. difficulty never leaves the admin configured range", () => {
    const config = parseConfig({ difficulty: { min: 2, max: 3 } });
    const high = decide({ state: { ...base, difficulty: 3 }, persona: "expert", evidence: [ev(true), ev(true)], last: last(), config });
    const low = decide({ state: { ...base, difficulty: 2 }, persona: "new_joiner", evidence: [ev(false), ev(false)], last: last({ correct: false }), config });
    expect(high.difficulty).toBe(3);
    expect(low.difficulty).toBe(2);
  });

  it("11. high sensitivity raises difficulty after one strong answer", () => {
    const config = parseConfig({ difficulty: { sensitivity: "high" } });
    expect(decide({ state: base, persona: "new_joiner", evidence: [ev(true)], last: last(), config }).difficulty).toBe(base.difficulty + 1);
  });

  it("12. personas set sensible starting points", () => {
    expect(initialPolicyState("expert", "en", defaultConfig).difficulty).toBe(4);
    expect(initialPolicyState("busy_rm", "en", defaultConfig).pace).toBe("brisk");
    expect(initialPolicyState("low_bandwidth", "en", defaultConfig).pace).toBe("brisk");
  });

  it("every adaptation carries a readable reason", () => {
    const out = decide({ state: { ...base, difficulty: 3 }, persona: "new_joiner", evidence: [ev(false), ev(false)], last: last({ correct: false }), config: defaultConfig });
    for (const reason of out.reasons) expect(reason.text.length).toBeGreaterThan(15);
  });
});
