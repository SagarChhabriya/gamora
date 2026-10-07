import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { plainlyUnanswerable, questionCheckFor } from "@/lib/grounding/verify";
import { fallbackPlan, isThinConcept, MAX_MISSIONS, missionBudget, teachableConcepts, type LearnerProfile } from "@/lib/planner/plan";
import { buildPanels, fallbackStoryboard, ideasIn, sceneBudget } from "@/lib/storyboard/generate";
import { fallbackActivity, lessonNotes } from "@/lib/tutor/activity";
import type { Activity } from "@/lib/tutor/types";

const profile = (overrides: Partial<LearnerProfile> = {}): LearnerProfile => ({ persona: "new_joiner", time_budget_min: 15, language: "en", ...overrides });
const concept = (index: number, summary = `Idea ${index} explains how the process works in practice.`) => ({ id: `c${index}`, name: `Topic ${index}`, summary, difficulty: 2 });

describe("storyboard scenes", () => {
  it("gives each topic one scene per idea, within the per-topic and total limits", () => {
    expect(sceneBudget([1, 1, 1], 3, 12)).toEqual([1, 1, 1]);
    expect(sceneBudget([5, 2, 1], 3, 12)).toEqual([3, 2, 1]);
    // Every topic gets its first scene before any topic gets a third.
    expect(sceneBudget([7, 7, 7, 7], 7, 6)).toEqual([2, 2, 1, 1]);
    expect(sceneBudget([4, 4], 3, 3)).toEqual([2, 1]);
    expect(sceneBudget([2, 2, 2, 2], 3, 3)).toEqual([1, 1, 1, 0]);
  });

  it("counts key points as ideas, and a name alone as one idea", () => {
    const topic = { id: "t", name: "Saving", summary: "s", source_chunk_ids: [], content_id: "k" };
    expect(ideasIn({ topic: { ...topic, key_points: [{ name: "A" }, { name: "B" }, { name: "C" }] }, text: "" })).toBe(3);
    expect(ideasIn({ topic, text: "United Bank Limited" })).toBe(1);
    const prose = "Savings accounts pay a return on money you keep. Budgets split pay into needs and wants. Statements show every fee you were charged. Reviews each month catch the fees early.";
    expect(ideasIn({ topic, text: prose })).toBe(2);
  });

  it("keeps several scenes of one topic up to its allowance, and drops repeats", () => {
    const text = "A savings account pays a return on money you keep. Review your statement every month to catch hidden fees.";
    const sources = [{ topic: { id: "t1", name: "Saving", summary: "Saving summary.", source_chunk_ids: [], content_id: "k" }, text, label: "Source 1", scenes: 2 }];
    const panel = (heading: string) => ({ topic: "T1", heading, narration: "Ayesha checks her account.", key_idea: "Savings pay a return.", notes: [], flow: [], quote: "" });
    const panels = buildPanels([panel("Money waits"), panel("money waits"), panel("Check the fees"), panel("One too many")], sources);
    expect(panels.map((item) => item.heading)).toEqual(["Money waits", "Check the fees"]);
    // Each scene quotes a different line of the source.
    expect(panels[0].quote).not.toBe(panels[1].quote);
  });

  it("builds a scene per key point without a model", () => {
    const topic = {
      id: "t1",
      name: "Budgeting",
      summary: "Budgeting splits income on purpose.",
      source_chunk_ids: [],
      content_id: "k",
      key_points: [
        { name: "Needs", summary: "Needs cover rent and food." },
        { name: "Wants", summary: "Wants are optional spending." },
      ],
    };
    const board = fallbackStoryboard("Money", [{ topic, text: "Budgeting splits income on purpose and keeps spending in check.", label: "Source 1", scenes: 3 }], "en");
    expect(board.panels.map((item) => item.heading)).toEqual(["Budgeting", "Needs", "Wants"]);
  });

  it("allows longer storyboards in config", () => {
    expect(parseConfig({}).mechanics).toMatchObject({ storyboard_panels: 12, storyboard_scenes_per_topic: 3 });
    expect(() => parseConfig({ mechanics: { storyboard_scenes_per_topic: 8 } })).toThrow();
  });
});

describe("lesson sticky notes", () => {
  const chunks = [{ text: "United Bank Limited is a commercial bank in Pakistan. It offers savings accounts and loans to its customers. Its branches serve cities across the country." }];

  it("drops notes that only repeat the title or key idea and fills from the source", () => {
    const notes = lessonNotes(["United Bank Limited", "Offers loans"], ["United Bank Limited", "United Bank Limited"], chunks);
    expect(notes[0]).toBe("Offers loans");
    expect(notes).toHaveLength(3);
    expect(notes).not.toContain("United Bank Limited");
  });

  it("keeps at most eight notes, and fewer when the material is thin", () => {
    expect(lessonNotes(Array.from({ length: 10 }, (_, index) => `Fact number ${index}`), [], [])).toHaveLength(8);
    expect(lessonNotes([], ["United Bank Limited"], [{ text: "United Bank Limited" }])).toEqual([]);
  });
});

describe("answerable questions", () => {
  const base: Activity = {
    id: "a",
    type: "explain_ask",
    concept_id: "c",
    concept_name: "United Bank Limited",
    difficulty: 2,
    title: "t",
    display_text: "United Bank Limited",
    prompt: "How will you apply it?",
    hints: [],
    expected_points: [{ text: "United Bank Limited", refs: ["S1"] }],
    source_chunk_ids: [],
    grounded: "unverified",
  };

  it("rejects an open question whose answer is only the topic's name, without a model call", () => {
    expect(plainlyUnanswerable(base)).toBe(true);
    expect(plainlyUnanswerable({ ...base, expected_points: [] })).toBe(true);
    expect(plainlyUnanswerable({ ...base, expected_points: [{ text: "It offers savings accounts and loans.", refs: ["S1"] }] })).toBe(false);
    expect(plainlyUnanswerable({ ...base, type: "reflection" })).toBe(false);
  });

  it("sends the verifier everything the learner sees, and skips lessons and reflections", () => {
    const check = questionCheckFor({ ...base, type: "scenario", options: [{ id: "1", text: "Open an account", correct: true, consequence: "c" }] }, "Banks hold savings.");
    expect(check?.shown).toContain("Lesson just read: Banks hold savings.");
    expect(check?.shown).toContain("Choice: Open an account");
    expect(check?.expected).toEqual(["Correct choice: Open an account"]);
    expect(questionCheckFor({ ...base, type: "lesson" })).toBeNull();
    expect(questionCheckFor({ ...base, type: "reflection" })).toBeNull();
  });

  it("the fallback question asks about the passage it shows, not about real life", () => {
    const activity = fallbackActivity({
      type: "explain_ask",
      concept: { id: "c", name: "Savings", summary: "Savings earn a return." },
      chunks: [{ id: "x", idx: 0, ref: "S1", text: "A savings account pays a return on the money you keep in it." }],
      difficulty: 2,
      pace: "normal",
      modality: "open",
      language: "en",
      persona: "new_joiner",
      config: defaultConfig,
    });
    expect(activity.prompt).toContain("passage above");
    expect(activity.prompt).not.toContain("real life");
  });
});

describe("mission count", () => {
  it("gives two or more topics at least two missions", () => {
    expect(missionBudget(profile({ persona: "expert" }), 3, defaultConfig)).toEqual({ missions: 2, perMission: 2 });
    expect(missionBudget(profile({ route: "quick_scan" }), 3, defaultConfig).missions).toBe(2);
    expect(missionBudget(profile({ time_budget_min: 3 }), 6, defaultConfig).missions).toBeGreaterThanOrEqual(2);
  });

  it("never passes ten missions, capstone included", () => {
    const long = profile({ route: "focus", time_budget_min: 120 });
    expect(missionBudget(long, 40, defaultConfig).missions).toBe(MAX_MISSIONS - 1);
    const many = Array.from({ length: 40 }, (_, index) => concept(index));
    expect(fallbackPlan("T", many, [], long, defaultConfig).missions).toHaveLength(MAX_MISSIONS);
    expect(missionBudget(profile({ route: "quick_scan" }), 40, defaultConfig).missions).toBeLessThanOrEqual(MAX_MISSIONS);
  });

  it("turns a one-topic journey into a path of two missions", () => {
    const plan = fallbackPlan("T", [concept(1)], [], profile(), defaultConfig);
    expect(plan.missions).toHaveLength(2);
    expect(plan.missions[1]).toMatchObject({ title: "Put it to work", concept_ids: ["c1"], unlock_rule: { after_mission: 0 } });
  });

  it("leaves out topics whose material is only their name", () => {
    expect(isThinConcept({ name: "United Bank Limited", summary: "United Bank Limited" })).toBe(true);
    expect(isThinConcept({ name: "Savings", summary: "Savings accounts pay a return on money kept." })).toBe(false);
    const kept = teachableConcepts([concept(1), { ...concept(2), name: "United Bank Limited", summary: "United Bank Limited." }, concept(3)]);
    expect(kept.map((item) => item.id)).toEqual(["c1", "c3"]);
    // When every topic is thin, nothing is dropped, so a journey can still be built.
    expect(teachableConcepts([{ ...concept(1), summary: "s" }])).toHaveLength(1);
  });
});
