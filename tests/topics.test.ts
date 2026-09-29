import { describe, expect, it } from "vitest";

import { defaultConfig, parseConfig } from "@/lib/config/schema";
import { carryMastery, deterministicTopics, resolveTopicCap, sanitizeGroups, stepFocus, unitsFromConcepts, type TopicUnit } from "@/lib/ingest/topics";

function unit(index: number, difficulty = 2): TopicUnit {
  return { name: `Idea number ${index}`, summary: `Summary of idea ${index}.`, difficulty, source_chunk_ids: [`c${index}`], origin_id: `o${index}` };
}

const units = (count: number) => Array.from({ length: count }, (_, index) => unit(index));

describe("topic cap", () => {
  it("uses the learner limit inside the admin range, else the default", () => {
    expect(resolveTopicCap(null, defaultConfig)).toBe(12);
    expect(resolveTopicCap(20, defaultConfig)).toBe(20);
    expect(resolveTopicCap(99, defaultConfig)).toBe(30);
    expect(resolveTopicCap(1, defaultConfig)).toBe(3);
    expect(resolveTopicCap(25, parseConfig({ content: { topics_max: 15 } }))).toBe(15);
  });

  it("keeps a short source as it is", () => {
    const topics = deterministicTopics(units(5), 12);
    expect(topics).toHaveLength(5);
    expect(topics.every((topic) => topic.key_points.length === 0)).toBe(true);
  });

  it("splits a long source into at most cap runs in document order", () => {
    const topics = deterministicTopics(units(100), 12);
    expect(topics).toHaveLength(12);
    expect(topics.flatMap((topic) => topic.members.map((member) => member.origin_id))).toEqual(units(100).map((item) => item.origin_id));
    expect(topics[0].key_points.length).toBeGreaterThan(1);
    expect(topics[0].source_chunk_ids).toEqual(topics[0].key_points.flatMap((point) => point.source_chunk_ids));
  });

  it("places every idea exactly once, even when the model skips or repeats some", () => {
    const list = units(10);
    const topics = sanitizeGroups(
      {
        topics: [
          { name: "Getting started well", summary: "First ideas.", members: [0, 1, 2, 2] },
          { name: "The middle part", summary: "Middle ideas.", members: [4, 5, 99] },
          { name: "Finishing strong", summary: "Last ideas.", members: [8, 9, 1] },
        ],
      },
      list,
      12,
    );
    const placed = topics.flatMap((topic) => topic.members.map((member) => member.origin_id)).sort();
    expect(placed).toEqual(list.map((item) => item.origin_id).sort());
    expect(new Set(placed).size).toBe(10);
  });

  it("merges extra topics until the cap holds", () => {
    const list = units(8);
    const topics = sanitizeGroups({ topics: list.map((item, index) => ({ name: `Topic about part ${index}`, summary: "One idea.", members: [index] })) }, list, 3);
    expect(topics).toHaveLength(3);
    expect(topics.reduce((sum, topic) => sum + topic.members.length, 0)).toBe(8);
  });

  it("re-groups from the finest units, so a raised limit can split topics again", () => {
    const flat = unitsFromConcepts([
      { id: "t1", name: "Topic one", summary: "s", difficulty: 2, source_chunk_ids: ["c1", "c2"], key_points: [{ name: "A point", summary: "a", difficulty: 2, source_chunk_ids: ["c1"] }, { name: "B point", summary: "b", difficulty: 3, source_chunk_ids: ["c2"] }] },
      { id: "t2", name: "Topic two", summary: "s", difficulty: 1, source_chunk_ids: ["c3"], key_points: [] },
    ]);
    expect(flat.map((item) => [item.name, item.origin_id])).toEqual([
      ["A point", "t1"],
      ["B point", "t1"],
      ["Topic two", "t2"],
    ]);
  });
});

describe("progress carried to new topics", () => {
  it("averages over every member, counting unpractised ones as zero", () => {
    const rows = [
      { learner_id: "l1", concept_id: "a", mastery: 0.8, confidence: 0.6, evidence_count: 4, last_seen: "2026-09-01T00:00:00Z" },
      { learner_id: "l1", concept_id: "b", mastery: 0.4, confidence: 0.2, evidence_count: 2, last_seen: "2026-09-03T00:00:00Z" },
      { learner_id: "l2", concept_id: "z", mastery: 1, confidence: 1, evidence_count: 9, last_seen: null },
    ];
    const carried = carryMastery(["a", "b", "c", "d"], rows);
    expect(carried).toHaveLength(1);
    expect(carried[0]).toMatchObject({ learner_id: "l1", mastery: 0.3, confidence: 0.4, evidence_count: 6, last_seen: "2026-09-03T00:00:00Z" });
  });
});

describe("step focus inside a topic", () => {
  const topic = {
    name: "Money basics",
    summary: "How money moves.",
    source_chunk_ids: ["c1", "c2", "c3"],
    key_points: [
      { name: "Saving", summary: "Keep some aside.", difficulty: 2, source_chunk_ids: ["c2"] },
      { name: "Spending", summary: "Use it with care.", difficulty: 2, source_chunk_ids: ["c3"] },
    ],
  };

  it("names every key point in the lesson", () => {
    expect(stepFocus(topic, 0, true).summary).toContain("Saving; Spending");
  });

  it("takes key points in turn for practice, with their sources first", () => {
    expect(stepFocus(topic, 0, false)).toMatchObject({ query: "Saving", chunkIds: ["c2", "c1", "c3"] });
    expect(stepFocus(topic, 1, false)).toMatchObject({ query: "Spending", chunkIds: ["c3", "c1", "c2"] });
    expect(stepFocus(topic, 2, false).query).toBe("Saving");
  });

  it("leaves an ungrouped concept as it is", () => {
    expect(stepFocus({ ...topic, key_points: [] }, 3, false)).toEqual({ summary: "How money moves.", query: "Money basics", chunkIds: ["c1", "c2", "c3"] });
  });
});
