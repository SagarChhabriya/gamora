import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultConfig } from "@/lib/config/schema";
import { playerLevel, starsFor } from "@/lib/gamification/rewards";
import { loadJourneyView } from "@/lib/journey/load";
import { missedLanguage } from "@/lib/tutor/activity";
import { historyFromTurns, stepKinds, withLessons } from "@/lib/tutor/session";
import type { ClientActivity } from "@/lib/tutor/types";

describe("learn first, then practise", () => {
  it("puts a lesson before the first question on each concept", () => {
    const queue = withLessons([
      { type: "explain_ask", concept_id: "a", intent: "introduce" },
      { type: "scenario", concept_id: "a", intent: "apply" },
      { type: "spaced_recall", concept_id: "z", intent: "recall" },
      { type: "scenario", concept_id: "b", intent: "introduce" },
      { type: "reflection", concept_id: "b", intent: "confidence" },
    ]);
    expect(queue.map((item) => `${item.type}:${item.concept_id}`)).toEqual([
      "lesson:a",
      "explain_ask:a",
      "scenario:a",
      "spaced_recall:z",
      "lesson:b",
      "scenario:b",
      "reflection:b",
    ]);
    expect(queue[1].intent).toContain("do not re-teach");
    expect(stepKinds(queue).slice(0, 2)).toEqual(["lesson", "question"]);
  });

  it("does not add a second lesson when one is already queued", () => {
    const queue = withLessons([
      { type: "lesson", concept_id: "a", intent: "teach" },
      { type: "explain_ask", concept_id: "a", intent: "introduce" },
    ]);
    expect(queue).toHaveLength(2);
  });
});

describe("conversation replay after a reload", () => {
  const activity = {
    id: "act1",
    type: "scenario",
    title: "A decision",
    prompt: "What do you do?",
    options: [
      { id: "o1", text: "Verify the ID" },
      { id: "o2", text: "Skip it" },
    ],
    sources: [],
  } as unknown as ClientActivity;

  it("rebuilds activities, answers, feedback, hints and character lines in order", () => {
    const items = historyFromTurns(
      [
        { role: "assistant", activity_type: "scenario", content: { activity, position: { index: 1, total: 4 } }, source_chunk_ids: [] },
        { role: "assistant", activity_type: "hint", content: { hint: "Think about KYC." }, source_chunk_ids: [] },
        { role: "learner", activity_type: "scenario", content: { choice_id: "o1" }, source_chunk_ids: [] },
        { role: "assistant", activity_type: "scenario.feedback", content: { feedback: "Right call.", correctness: 1 }, source_chunk_ids: ["c1"] },
        { role: "assistant", activity_type: "roleplay.feedback", content: { feedback: "I am in a hurry!", character: "Ayesha" }, source_chunk_ids: [] },
        { role: "learner", activity_type: "lesson", content: { continue: true }, source_chunk_ids: [] },
      ],
      (ids) => ids.map((id) => ({ id, label: "Source 1", excerpt: "text" })),
    );
    expect(items.map((item) => item.kind)).toEqual(["activity", "hint", "learner", "feedback", "character"]);
    expect(items[2]).toMatchObject({ text: "Verify the ID" });
    expect(items[3]).toMatchObject({ correctness: 1, sources: [{ id: "c1" }] });
    expect(items[4]).toMatchObject({ name: "Ayesha", text: "I am in a hurry!" });
    expect(items[0]).toMatchObject({ position: { index: 1, total: 4 } });
  });
});

describe("rewards shown to the learner", () => {
  it("computes a player level with progress inside it", () => {
    expect(playerLevel(0)).toEqual({ level: 1, into: 0, span: 200 });
    expect(playerLevel(450)).toEqual({ level: 3, into: 50, span: 200 });
  });

  it("gives one to three stars from mastery", () => {
    expect(starsFor(0.9, 0.6, defaultConfig)).toBe(3);
    expect(starsFor(0.65, 0.6, defaultConfig)).toBe(2);
    expect(starsFor(0.3, 0.6, defaultConfig)).toBe(1);
  });
});

describe("language drift", () => {
  it("flags English text when Roman Urdu was asked for", () => {
    expect(missedLanguage("roman_ur", "The customer must show a valid CNIC before the account is opened.")).toBe(true);
    expect(missedLanguage("roman_ur", "Customer ko account kholne se pehle valid CNIC dikhana zaroori hai.")).toBe(false);
    expect(missedLanguage("en", "The customer must show a valid CNIC.")).toBe(false);
  });
});

describe("journey map after a reload", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("keeps a completed mission completed when a practice round is open", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://db.test";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    const rows: Record<string, unknown[]> = {
      missions: [{ id: "m1", idx: 0, title: "One", story: "", concept_ids: ["c1"], activities: [{ type: "explain_ask" }], unlock_rule: {} }],
      sessions: [
        { mission_id: "m1", completed_at: null, state: { index: 0, queue: [1, 2] } },
        { mission_id: "m1", completed_at: "2026-09-28T10:00:00Z", state: { index: 2, queue: [1, 2] } },
      ],
      concepts: [{ id: "c1", name: "KYC" }],
      mastery: [{ concept_id: "c1", mastery: 0.9, confidence: 0.8, evidence_count: 3, last_seen: new Date().toISOString() }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(rows[new URL(url).pathname.split("/").pop() ?? ""] ?? []))),
    );
    const [mission] = await loadJourneyView("j1", "u1", defaultConfig);
    expect(mission.status).toBe("completed");
    expect(mission.progress).toBe(1);
  });
});
