import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { applyRewards, emptyGamification, nextStreak } from "@/lib/gamification/rewards";
import { applyEvidence, decayed, emptyMastery, masteryLabel } from "@/lib/learner-model/mastery";
import { signalsFor } from "@/lib/tutor/evaluate";
import { activitiesFor, fallbackPlan, orderConcepts } from "@/lib/planner/plan";

describe("mastery model", () => {
  it("rises with correct evidence and falls with errors", () => {
    const up = applyEvidence(emptyMastery, [{ signal: "correct", strength: 1 }], defaultConfig);
    expect(up.mastery).toBeGreaterThan(0);
    const down = applyEvidence(up, [{ signal: "wrong", strength: -1 }], defaultConfig);
    expect(down.mastery).toBeLessThan(up.mastery);
    expect(down.evidence_count).toBe(2);
  });

  it("gives transfer more weight than a plain correct answer", () => {
    const plain = applyEvidence(emptyMastery, [{ signal: "correct", strength: 1 }], defaultConfig);
    const transfer = applyEvidence(emptyMastery, [{ signal: "transfer", strength: 1 }], defaultConfig);
    expect(transfer.mastery).toBeGreaterThan(plain.mastery);
  });

  it("confidence grows with evidence and stays below 1", () => {
    let row = emptyMastery;
    for (let index = 0; index < 20; index += 1) row = applyEvidence(row, [{ signal: "correct", strength: 1 }], defaultConfig);
    expect(row.confidence).toBeGreaterThan(0.8);
    expect(row.confidence).toBeLessThan(1);
    expect(row.mastery).toBeLessThanOrEqual(1);
  });

  it("a strong learner can reach the unlock threshold within one mission", () => {
    let row = emptyMastery;
    row = applyEvidence(row, [{ signal: "correct", strength: 1 }], defaultConfig);
    row = applyEvidence(row, [{ signal: "correct", strength: 1 }, { signal: "transfer", strength: 1 }], defaultConfig);
    expect(row.mastery).toBeGreaterThanOrEqual(defaultConfig.mastery.unlock_threshold);
  });

  it("decays with time since last seen", () => {
    const row = { mastery: 0.8, confidence: 0.5, evidence_count: 4, last_seen: new Date(Date.now() - 10 * 86_400_000).toISOString() };
    expect(decayed(row, defaultConfig)).toBeLessThan(0.8);
    expect(decayed(row, parseConfig({ mastery: { decay_per_day: 0 } }))).toBe(0.8);
  });

  it("labels mastery bands from config thresholds", () => {
    expect(masteryLabel(0.85, defaultConfig)).toBe("mastered");
    expect(masteryLabel(0.65, defaultConfig)).toBe("solid");
    expect(masteryLabel(0, defaultConfig)).toBe("new");
  });
});

describe("evidence signals", () => {
  it("maps hints, self correction, and transfer", () => {
    expect(signalsFor({ type: "scenario", correctness: 1, attempts: 0, hintsUsed: 0, selfCorrection: false }).map((s) => s.signal)).toEqual(["correct", "transfer"]);
    expect(signalsFor({ type: "explain_ask", correctness: 1, attempts: 1, hintsUsed: 0, selfCorrection: true }).map((s) => s.signal)).toContain("self_corrected");
    expect(signalsFor({ type: "explain_ask", correctness: 0.9, attempts: 0, hintsUsed: 2, selfCorrection: false }).map((s) => s.signal)).toContain("hint_used");
    expect(signalsFor({ type: "spaced_recall", correctness: 0.2, attempts: 0, hintsUsed: 0, selfCorrection: false })[0].signal).toBe("recall_fail");
  });
});

describe("gamification", () => {
  it("awards XP for meaningful actions and badges on milestones", () => {
    const first = applyRewards(emptyGamification, { signals: [{ signal: "correct" }], missionCompleted: true }, defaultConfig);
    expect(first.gained).toBe(defaultConfig.mechanics.xp.correct + defaultConfig.mechanics.xp.mission_complete);
    expect(first.newBadges).toContain("first_steps");
    const again = applyRewards(first.row, { signals: [{ signal: "hint_used" }] }, defaultConfig);
    expect(again.gained).toBe(0);
    expect(again.newBadges).toEqual([]);
  });

  it("streaks never punish a missed day inside the grace window", () => {
    const row = { ...emptyGamification, streak: 4, last_active_on: "2026-09-26" };
    expect(nextStreak(row, defaultConfig, new Date("2026-09-28T10:00:00Z")).streak).toBe(5);
    expect(nextStreak(row, defaultConfig, new Date("2026-10-05T10:00:00Z")).streak).toBe(1);
  });
});

describe("journey planner", () => {
  const concepts = ["a", "b", "c", "d", "e"].map((id, index) => ({ id, name: id.toUpperCase(), summary: "s", difficulty: index + 1 }));

  it("orders concepts by prerequisites", () => {
    const ordered = orderConcepts(concepts, [{ from_id: "e", to_id: "a", type: "prerequisite" }]);
    expect(ordered.findIndex((concept) => concept.id === "e")).toBeLessThan(ordered.findIndex((concept) => concept.id === "a"));
  });

  it("fits the learner's time budget and unlocks by mastery", () => {
    const plan = fallbackPlan("T", concepts, [], { persona: "busy_rm", time_budget_min: 10, language: "en" }, defaultConfig);
    // Two missions fit the time budget; the closing capstone case comes after them.
    expect(plan.missions.length).toBe(3);
    expect(plan.missions.at(-1)?.title).toBe("Capstone case");
    expect(plan.missions[1].unlock_rule).toEqual({ min_mastery: defaultConfig.mastery.unlock_threshold, after_mission: 0 });
  });

  it("gives every concept in a mission at least one activity", () => {
    const activities = activitiesFor(["a", "b"], defaultConfig.mechanics.enabled_activities, "new_joiner", 1);
    expect(new Set(activities.map((activity) => activity.concept_id))).toEqual(new Set(["a", "b"]));
    expect(activities.some((activity) => activity.type === "spaced_recall")).toBe(true);
  });
});

describe("fair mastery", () => {
  it("two clean correct answers on a topic unlock the next mission, three master it", async () => {
    const { applyEvidence, emptyMastery } = await import("@/lib/learner-model/mastery");
    const { defaultConfig: config } = await import("@/lib/config/schema");
    const correct = [{ signal: "correct" as const, strength: 1 }];
    const one = applyEvidence(emptyMastery, correct, config);
    const two = applyEvidence(one, correct, config);
    const three = applyEvidence(two, correct, config);
    expect(one.mastery).toBeLessThan(config.mastery.unlock_threshold);
    expect(two.mastery).toBeGreaterThanOrEqual(config.mastery.unlock_threshold);
    expect(three.mastery).toBeGreaterThanOrEqual(config.mastery.mastered_threshold);
  });

  it("a mostly right answer counts for more than a barely right one", async () => {
    const { applyEvidence, emptyMastery } = await import("@/lib/learner-model/mastery");
    const { defaultConfig: config } = await import("@/lib/config/schema");
    const { signalsFor } = await import("@/lib/tutor/evaluate");
    const mostly = applyEvidence(emptyMastery, signalsFor({ type: "explain_ask", correctness: 0.75, attempts: 0, hintsUsed: 0, selfCorrection: false }), config);
    const barely = applyEvidence(emptyMastery, signalsFor({ type: "explain_ask", correctness: 0.45, attempts: 0, hintsUsed: 0, selfCorrection: false }), config);
    expect(mostly.mastery).toBeGreaterThan(barely.mastery);
  });
});
