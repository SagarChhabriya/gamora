import { describe, expect, it } from "vitest";

import { appGuide } from "@/lib/assistant/guide";
import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { publicName, rankLeaderboard } from "@/lib/gamification/leaderboard";
import { applyEvidence, emptyMastery } from "@/lib/learner-model/mastery";
import { signalsFor } from "@/lib/tutor/evaluate";

describe("mastery", () => {
  it("rises from zero with a partly right answer", () => {
    const row = applyEvidence(emptyMastery, signalsFor({ type: "explain_ask", correctness: 0.5, attempts: 0, hintsUsed: 0, selfCorrection: false }), defaultConfig);
    expect(row.mastery).toBeGreaterThan(0);
  });

  it("counts a half-remembered recall as partial credit, not a failed recall", () => {
    expect(signalsFor({ type: "spaced_recall", correctness: 0.5, attempts: 0, hintsUsed: 0, selfCorrection: false })).toEqual([{ signal: "partial", strength: 0.5 }]);
    expect(signalsFor({ type: "spaced_recall", correctness: 0.2, attempts: 0, hintsUsed: 0, selfCorrection: false })[0].signal).toBe("recall_fail");
  });

  it("never lets one setback remove more than half of what was built", () => {
    const built = { mastery: 0.3, confidence: 0.2, evidence_count: 2, last_seen: new Date().toISOString() };
    const after = applyEvidence(built, [{ signal: "recall_fail", strength: -1 }], defaultConfig);
    expect(after.mastery).toBeGreaterThanOrEqual(0.15);
    expect(after.mastery).toBeLessThan(0.3);
  });

  it("does not wipe a topic to zero after a mix of partial answers and misses", () => {
    let row = emptyMastery;
    for (const correctness of [0.75, 0.2, 0.5, 0.2]) {
      row = applyEvidence(row, signalsFor({ type: "spaced_recall", correctness, attempts: 0, hintsUsed: 0, selfCorrection: false }), defaultConfig);
    }
    expect(row.mastery).toBeGreaterThan(0);
  });
});

describe("leaderboard", () => {
  const rows = [
    { learner_id: "a", xp: 120, streak: 2, display_name: "Ayesha Khan" },
    { learner_id: "b", xp: 300, streak: 1, display_name: "bilal.ahmed@example.com" },
    { learner_id: "c", xp: 120, streak: 2, display_name: null },
    { learner_id: "d", xp: 0, streak: 0, display_name: "Zero" },
    { learner_id: "e", xp: 50, streak: 0, display_name: "Esa" },
  ];

  it("ranks by XP then streak, shares ranks on ties, and leaves out learners with no XP", () => {
    const { top } = rankLeaderboard(rows, "a");
    expect(top.map((entry) => [entry.rank, entry.name, entry.you])).toEqual([
      [1, "bilal", false],
      [2, "Ayesha", true],
      [2, "Learner", false],
      [4, "Esa", false],
    ]);
  });

  it("adds the viewer's own row when it is below the top", () => {
    const board = rankLeaderboard(rows, "e", 2);
    expect(board.top).toHaveLength(2);
    expect(board.you).toMatchObject({ rank: 4, name: "Esa", you: true });
    expect(rankLeaderboard(rows, "b", 2).you).toBeNull();
  });

  it("shows first names only", () => {
    expect(publicName("Sagar Chhabriya")).toBe("Sagar");
    expect(publicName("someone@mail.com")).toBe("someone");
    expect(publicName("  ")).toBe("Learner");
  });
});

describe("help assistant guide", () => {
  it("knows where the leaderboard is, and says when it is off", () => {
    expect(appGuide(parseConfig({ mechanics: { leaderboard: true } }))).toContain("on the home page below your journeys");
    expect(appGuide(defaultConfig)).toContain("Leaderboard: turned off by the Gamora team");
  });

  it("covers the newer features", () => {
    const guide = appGuide(defaultConfig);
    for (const phrase of ["2 to 10 missions", "3 to 8 sticky notes", "learning topic or brief", "review card", "leaves voice on", "a few scenes per topic"]) expect(guide).toContain(phrase);
  });
});
