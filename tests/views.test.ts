import { describe, expect, it } from "vitest";

import { parseLessonVisual } from "@/lib/visuals/schema";
import { availableViews, defaultView, describeView, groundVisual, isShareOfWhole, sourceStates, visualClaims, type ViewSource } from "@/lib/visuals/views";

const base: ViewSource = { key_idea: "Budget your salary.", notes: ["Needs first", "Then wants"], flow: [] };

describe("lesson views", () => {
  it("offers only the views a lesson has data for, keeping notes and flow", () => {
    expect(availableViews(base)).toEqual(["notes", "checkpoints", "branch_tree"]);
    const withFlow = { ...base, flow: ["Earn", "Split", "Save"], visual: { cycle: true } };
    expect(availableViews(withFlow)).toEqual(["notes", "flow", "sequence", "loop", "checkpoints", "branch_tree"]);
  });

  it("tells a share of a whole from a trend", () => {
    const shares = [
      { label: "Needs", value: 50, unit: "%" },
      { label: "Wants", value: 30, unit: "%" },
      { label: "Savings", value: 20, unit: "%" },
    ];
    expect(isShareOfWhole(shares)).toBe(true);
    expect(availableViews({ ...base, visual: { figures: shares } })).toContain("share_split");
    expect(availableViews({ ...base, visual: { figures: shares } })).not.toContain("trend_bars");
    const trend = [
      { label: "Year 1", value: 100000, unit: "" },
      { label: "Year 3", value: 125971, unit: "" },
    ];
    expect(availableViews({ ...base, visual: { figures: trend } })).toEqual(expect.arrayContaining(["key_figure", "trend_bars"]));
  });

  it("starts on the model's pick only when the data supports it", () => {
    expect(defaultView({ ...base, visual: { best: "share_split" } })).toBe("notes");
    expect(defaultView({ ...base, flow: ["a step", "b step", "c step"], visual: { best: "quadrant" } })).toBe("flow");
    expect(defaultView({ ...base, visual: { best: "branch_tree" } })).toBe("branch_tree");
  });

  it("describes every view in words for screen readers", () => {
    const source: ViewSource = {
      ...base,
      flow: ["Earn", "Split", "Save"],
      visual: {
        figures: [{ label: "Needs", value: 50, unit: "%" }],
        compare: { left: { label: "Current", points: ["For movement"] }, right: { label: "Savings", points: ["Earns profit"] } },
        guard: { risk: "Scam calls", protections: ["Never share your PIN"] },
        chain: ["Low balance", "Fee charged", "Return eaten"],
        timeline: [{ when: "Day 1", what: "Open account" }],
      },
    };
    for (const view of availableViews(source)) expect(describeView(view, source).length).toBeGreaterThan(10);
    expect(describeView("cause_chain", source)).toContain("Low balance, which leads to Fee charged");
  });
});

describe("numbers in diagrams come from the source", () => {
  const source = "Split your salary: 50% for needs, 30% for wants and 20% saved. After three years the balance is 125,971 rupees. Opened in 2019.";

  it("finds numbers as the source writes them", () => {
    expect(sourceStates(50, source)).toBe(true);
    expect(sourceStates(125971, source)).toBe(true);
    expect(sourceStates(5, source)).toBe(false);
    expect(sourceStates(12597, source)).toBe(false);
  });

  it("drops figures and dates the source does not state", () => {
    const grounded = groundVisual(
      {
        figures: [
          { label: "Needs", value: 50, unit: "%" },
          { label: "Invented", value: 45, unit: "%" },
        ],
        timeline: [
          { when: "2019", what: "Opened" },
          { when: "2031", what: "Invented" },
          { when: "Later", what: "No number, kept" },
        ],
      },
      source,
    );
    expect(grounded?.figures?.map((figure) => figure.label)).toEqual(["Needs"]);
    expect(grounded?.timeline?.map((item) => item.what)).toEqual(["Opened", "No number, kept"]);
  });

  it("reads model output leniently, dropping only the broken part", () => {
    const visual = parseLessonVisual({
      figures: [{ label: "Needs", value: "50", unit: "percent" }],
      compare: { left: { label: "A" } },
      best: "not_a_view",
      chain: ["a cause", "an effect", "an outcome"],
    });
    expect(visual?.figures).toEqual([{ label: "Needs", value: 50, unit: "%" }]);
    expect(visual?.compare).toBeUndefined();
    expect(visual?.best).toBeUndefined();
    expect(visual?.chain).toHaveLength(3);
  });

  it("hands the verifier the facts a diagram states", () => {
    expect(visualClaims({ guard: { risk: "Phishing", protections: ["Check the sender"] } })).toEqual(["Phishing is protected against by: Check the sender."]);
  });
});
