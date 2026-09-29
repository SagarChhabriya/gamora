import { describe, expect, it } from "vitest";

import { activityTypes, defaultConfig, parseConfig } from "@/lib/config/schema";
import { applyRewards, emptyGamification } from "@/lib/gamification/rewards";
import { activitiesFor, capstoneTopics, fallbackPlan, missionBudget, withCapstone, type LearnerProfile, type PlannedMission } from "@/lib/planner/plan";
import { signalsFor } from "@/lib/tutor/evaluate";
import { withCrossroads, withLessons } from "@/lib/tutor/session";

const profile = (route?: LearnerProfile["route"]): LearnerProfile => ({ persona: "new_joiner", time_budget_min: 15, language: "en", route });
const enabled = [...activityTypes];
const concepts = Array.from({ length: 12 }, (_, index) => ({ id: `c${index}`, name: `Topic ${index}`, summary: "s", difficulty: 2 }));

describe("learning routes", () => {
  it("quick scan covers every topic regardless of time", () => {
    const budget = missionBudget({ ...profile("quick_scan"), time_budget_min: 5 }, 12, defaultConfig);
    expect(budget.missions * budget.perMission).toBeGreaterThanOrEqual(12);
    expect(activitiesFor(["a", "b"], enabled, "new_joiner", 0, "quick_scan")).toEqual([
      { type: "explain_ask", concept_id: "a", intent: "one light check that the main idea landed" },
      { type: "explain_ask", concept_id: "b", intent: "one light check that the main idea landed" },
    ]);
  });

  it("focus takes one topic per mission with a teach-back", () => {
    expect(missionBudget(profile("focus"), 12, defaultConfig).perMission).toBe(1);
    const types = activitiesFor(["a"], enabled, "new_joiner", 1, "focus").map((item) => item.type);
    expect(types).toEqual(["explain_ask", "spaced_recall", "teach_back", "spot_error", "reflection"]);
  });

  it("scenarios opens every topic with a situation to act in", () => {
    const plan = activitiesFor(["a", "b"], enabled, "new_joiner", 0, "scenarios");
    expect(plan.filter((item) => item.intent.startsWith("a real situation")).map((item) => item.type)).toEqual(["scenario", "scenario"]);
  });

  it("respects activity types an admin switched off", () => {
    const types = activitiesFor(["a"], ["explain_ask", "spot_error", "reflection"], "new_joiner", 0, "scenarios").map((item) => item.type);
    expect(types.every((type) => ["explain_ask", "spot_error", "reflection"].includes(type))).toBe(true);
  });

  it("the fallback plan records its route", () => {
    expect(fallbackPlan("T", concepts, [], profile("focus"), defaultConfig).route).toBe("focus");
    expect(fallbackPlan("T", concepts, [], profile(), defaultConfig).route).toBe("narrative");
  });
});

describe("capstone case", () => {
  const missions: PlannedMission[] = [0, 1, 2].map((idx) => ({
    idx,
    title: `M${idx}`,
    story_hook: "h",
    concept_ids: [`c${idx * 2}`, `c${idx * 2 + 1}`],
    activities: [],
    unlock_rule: { min_mastery: 0.6, after_mission: idx ? idx - 1 : null },
  }));
  const names = new Map(concepts.map((concept) => [concept.id, concept.name]));

  it("picks up to three topics spread across the journey", () => {
    expect(capstoneTopics(["a"])).toEqual([]);
    expect(capstoneTopics(["a", "b"])).toEqual(["a", "b"]);
    expect(capstoneTopics(["a", "b", "c", "d", "e"])).toEqual(["a", "c", "e"]);
  });

  it("closes the journey with one case over several topics, unlocked after the last mission", () => {
    const planned = withCapstone(missions, profile(), defaultConfig, names);
    const last = planned.at(-1);
    expect(planned).toHaveLength(4);
    expect(last?.title).toBe("Capstone case");
    expect(last?.unlock_rule.after_mission).toBe(2);
    expect(last?.activities[0]).toMatchObject({ type: "capstone", concept_ids: ["c0", "c3", "c5"] });
    expect(last?.story_hook).toContain("Topic 0, Topic 3 and Topic 5");
  });

  it("is skipped for quick scans and when switched off", () => {
    expect(withCapstone(missions, profile("quick_scan"), defaultConfig, names)).toHaveLength(3);
    expect(withCapstone(missions, profile(), parseConfig({ mechanics: { capstone: false } }), names)).toHaveLength(3);
  });

  it("never gets a lesson of its own and counts as applying ideas", () => {
    const queue = withLessons([{ type: "capstone", concept_id: "c0", intent: "case", concept_ids: ["c0", "c1"] }]);
    expect(queue.map((item) => item.type)).toEqual(["capstone"]);
    expect(signalsFor({ type: "capstone", correctness: 1, attempts: 0, hintsUsed: 0, selfCorrection: false }).map((item) => item.signal)).toContain("transfer");
  });

  it("awards Capstone Cleared only without hints", () => {
    const clean = applyRewards(emptyGamification, { signals: [{ signal: "correct" }], activityType: "capstone", correctness: 0.9, hintsUsed: 0 }, defaultConfig);
    expect(clean.newBadges).toContain("capstone_cleared");
    const hinted = applyRewards(emptyGamification, { signals: [{ signal: "correct" }], activityType: "capstone", correctness: 0.9, hintsUsed: 1 }, defaultConfig);
    expect(hinted.newBadges).not.toContain("capstone_cleared");
  });
});

describe("crossroads", () => {
  const queue = withLessons([
    { type: "explain_ask", concept_id: "a", intent: "i" },
    { type: "scenario", concept_id: "a", intent: "i" },
    { type: "explain_ask", concept_id: "b", intent: "i" },
    { type: "spot_error", concept_id: "b", intent: "i" },
    { type: "reflection", concept_id: "b", intent: "i" },
  ]);

  it("turns one practice step into a crossroads, never the check right after a lesson", () => {
    const forked = withCrossroads(queue);
    const at = forked.findIndex((item) => item.type === "crossroads");
    expect(forked.filter((item) => item.type === "crossroads")).toHaveLength(1);
    expect(forked[at - 1]?.type).not.toBe("lesson");
    expect(forked.slice(0, at).some((item) => item.type !== "lesson")).toBe(true);
  });

  it("adds none when there is no room, and never a second one", () => {
    expect(withCrossroads(withLessons([{ type: "scenario", concept_id: "a", intent: "i" }])).some((item) => item.type === "crossroads")).toBe(false);
    const once = withCrossroads(queue);
    expect(withCrossroads(once)).toBe(once);
  });

  it("rewards taking the source's path", () => {
    expect(applyRewards(emptyGamification, { signals: [{ signal: "correct" }], activityType: "crossroads" }, defaultConfig).newBadges).toContain("pathfinder");
  });
});
