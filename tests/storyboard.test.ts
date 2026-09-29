import { describe, expect, it } from "vitest";

import { buildPanels, fallbackStoryboard } from "@/lib/storyboard/generate";
import { firstSentence, numbersStated, panelSeconds, quoteInSource, storyContextFor, varyViews, type StoryPanel } from "@/lib/storyboard/story";

const sourceText =
  "A savings account pays a return on money you keep. Split your salary with 50% for needs, 30% for wants and 20% for savings. Review your statement every month to catch hidden fees.";

const topic = (id: string, name: string) => ({ id, name, summary: `${name} summary.`, source_chunk_ids: ["c1"], content_id: "k1" });
const sources = [
  { topic: topic("t1", "Saving"), text: sourceText, label: "Source 1" },
  { topic: topic("t2", "Budgeting"), text: sourceText, label: "Source 2" },
];

describe("storyboard grounding", () => {
  it("accepts a quote only when it is copied from the source", () => {
    expect(quoteInSource("pays a return on money you keep", sourceText)).toBe(true);
    expect(quoteInSource("“Review your  statement every month”", sourceText)).toBe(true);
    expect(quoteInSource("pays a big bonus on money you keep", sourceText)).toBe(false);
    expect(quoteInSource("savings", sourceText)).toBe(false);
  });

  it("checks every number in a sentence against the source", () => {
    expect(numbersStated("Half is 50% and a fifth is 20%.", sourceText)).toBe(true);
    expect(numbersStated("She saves 40% now.", sourceText)).toBe(false);
    expect(numbersStated("No numbers here.", sourceText)).toBe(true);
  });

  it("keeps grounded panels, replaces invented facts and made-up quotes", () => {
    const panels = buildPanels(
      [
        {
          topic: "T1",
          heading: "Where the money waits",
          narration: "Ayesha opens a savings account and earns 12% at once.",
          key_idea: "A savings account pays a return.",
          notes: ["It pays a return", "It pays 12% always"],
          flow: [],
          visual: { figures: [{ label: "Needs", value: 50, unit: "%" }, { label: "Wants", value: 30, unit: "%" }, { label: "Savings", value: 20, unit: "%" }], best: "share_split" },
          quote: "This quote is not in the source at all",
        },
        { topic: "T1", heading: "Duplicate", narration: "Again.", key_idea: "Again.", notes: [], flow: [], quote: "" },
        { topic: "T9", heading: "Unknown topic", narration: "Nope.", key_idea: "Nope.", notes: [], flow: [], quote: "" },
        { topic: "t2", heading: "Split the salary", narration: "Bilal splits his pay three ways.", key_idea: "Split salary into needs, wants and savings.", notes: [], flow: [], quote: "Split your salary with 50% for needs" },
      ],
      sources,
    );
    expect(panels.map((panel) => panel.topic_id)).toEqual(["t1", "t2"]);
    expect(panels[0].narration).toBe("A savings account pays a return.");
    expect(panels[0].source.notes).toEqual(["It pays a return"]);
    expect(panels[0].view).toBe("share_split");
    expect(panels[0].quote).toBe(firstSentence(sourceText));
    expect(panels[1].quote).toBe("Split your salary with 50% for needs");
  });

  it("builds a usable storyboard without a model", () => {
    const board = fallbackStoryboard("Money basics", sources, "en");
    expect(board.panels).toHaveLength(2);
    expect(board.generator).toBe("fallback");
    expect(board.panels.every((panel) => quoteInSource(panel.quote.replace("…", ""), sourceText))).toBe(true);
  });
});

describe("storyboard playback", () => {
  it("never shows the same drawing twice in a row when another fits", () => {
    const panel = (id: string): StoryPanel => ({
      topic_id: id,
      heading: id,
      narration: "n",
      view: "branch_tree",
      source: { key_idea: "k", notes: ["a note", "b note"], flow: [] },
      quote: "q",
      source_label: "Source 1",
    });
    const views = varyViews([panel("a"), panel("b")]).map((item) => item.view);
    expect(views[0]).not.toBe(views[1]);
  });

  it("gives each panel time to read", () => {
    expect(panelSeconds("short")).toBe(6);
    expect(panelSeconds(Array.from({ length: 30 }, () => "word").join(" "))).toBe(14);
    expect(panelSeconds(Array.from({ length: 90 }, () => "word").join(" "))).toBe(16);
  });

  it("keeps missions in the storyboard's world", () => {
    expect(storyContextFor({ setting: "A small bakery.", cast: [{ name: "Sana", role: "owner" }] })).toContain("Sana (owner)");
    expect(storyContextFor({ setting: "Anywhere.", cast: [] })).toBeUndefined();
  });
});
