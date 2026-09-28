import { describe, expect, it } from "vitest";

import { askAssistant, pickLinks } from "@/lib/assistant/answer";
import { formatSnapshot, snapshotLinks, type LearnerSnapshot } from "@/lib/assistant/context";
import { appGuide } from "@/lib/assistant/guide";
import { parseConfig } from "@/lib/config/schema";

const snapshot: LearnerSnapshot = {
  name: "Aisha",
  persona: "Beginner",
  language: "en",
  goal: "Prepare for an exam or interview",
  xp: 450,
  streak: 3,
  bestStreak: 5,
  badges: ["first_steps"],
  sources: { ready: 2, processing: 0, failed: 1, library: 4 },
  journeys: [
    { id: "j1", title: "Linear regression", done: 1, total: 3, next: { id: "m2", title: "Gradient descent", status: "available" }, weakest: [{ name: "Learning rate", mastery: 0.2 }] },
    { id: "j2", title: "Cells", done: 0, total: 2, next: { id: "m9", title: "Mitochondria", status: "locked", lockReason: "Finish \"Cell walls\" first." }, weakest: [] },
  ],
};

describe("help assistant context", () => {
  it("describes only this learner's own progress, with readable badge names", () => {
    const text = formatSnapshot(snapshot);
    expect(text).toContain("XP 450, level 3 (150 XP to the next level)");
    expect(text).toContain("Badges: First Steps.");
    expect(text).toContain('Next mission: "Gradient descent" (available)');
    expect(text).toContain("Weakest concepts: Learning rate 20%");
    expect(text).toContain('Finish "Cell walls" first.');
  });

  it("offers a continue link only for missions that are open", () => {
    const hrefs = snapshotLinks(snapshot).map((link) => link.href);
    expect(hrefs).toContain("/journey/j1/mission/m2");
    expect(hrefs).not.toContain("/journey/j2/mission/m9");
    expect(hrefs).toContain("/journey/j2");
  });

  it("keeps only offered links, without duplicates, at most two", () => {
    const offered = snapshotLinks(snapshot);
    expect(pickLinks(["l2", "L2", "L99", "https://evil.example", "L1", "L4"], offered)).toEqual([
      { label: "Studio: add material", href: "/studio" },
      { label: "Your journeys", href: "/" },
    ]);
  });

  it("builds the app guide from the live config", () => {
    const guide = appGuide(parseConfig({ content: { url_domains: ["wikipedia.org"] }, mastery: { unlock_threshold: 0.7 } }));
    expect(guide).toContain("supported sites: wikipedia.org");
    expect(guide).toContain("reach 70% mastery");
    expect(appGuide(parseConfig({ content: { url_domains: [] } }))).toContain("any public website");
  });

  it("answers safely when no model provider is available", async () => {
    const result = await askAssistant({ message: "How do I earn XP?", history: [], guide: "g", snapshot: "s", links: [], language: "roman_ur" });
    expect(result.ok).toBe(false);
    expect(result.links).toEqual([]);
    expect(result.reply).toContain("dobara try");
  });
});
