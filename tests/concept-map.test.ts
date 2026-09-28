import { describe, expect, it } from "vitest";

import { layoutConceptMap, levelLabel, lineage, prepareConceptMap } from "@/lib/concept-map";

const concept = (id: string, name = id, difficulty = 2) => ({ id, name, difficulty });
const prereq = (from_id: string, to_id: string) => ({ from_id, to_id, type: "prerequisite" });

describe("concept map preparation", () => {
  it("merges concepts that share a name and rewires their links", () => {
    const map = prepareConceptMap(
      [concept("a", "Residual Sum of Squares"), concept("b", "residual  sum of squares"), concept("c", "Gradient Descent")],
      [prereq("b", "c"), prereq("a", "c")],
    );
    expect(map.concepts.map((item) => item.name)).toEqual(["Residual Sum of Squares", "Gradient Descent"]);
    expect(map.concepts[0].mergedIds).toEqual(["a", "b"]);
    expect(map.prerequisites).toEqual([prereq("a", "c")]);
  });

  it("drops prerequisite links already implied by a longer path", () => {
    const map = prepareConceptMap([concept("a"), concept("b"), concept("c")], [prereq("a", "b"), prereq("b", "c"), prereq("a", "c")]);
    expect(map.prerequisites).toEqual([prereq("a", "b"), prereq("b", "c")]);
  });

  it("hides related links between concepts already joined by a prerequisite, and self links", () => {
    const map = prepareConceptMap(
      [concept("a"), concept("b"), concept("c")],
      [prereq("a", "b"), { from_id: "b", to_id: "a", type: "related" }, { from_id: "a", to_id: "a", type: "related" }, { from_id: "a", to_id: "c", type: "related" }],
    );
    expect(map.related).toEqual([{ from_id: "a", to_id: "c", type: "related" }]);
  });

  it("numbers stages and marks only path openers as starting points, even with a cycle from model output", () => {
    const map = prepareConceptMap([concept("a"), concept("b"), concept("c"), concept("d")], [prereq("a", "b"), prereq("b", "c"), prereq("c", "b")]);
    const byId = Object.fromEntries(map.concepts.map((item) => [item.id, item]));
    expect(byId.a).toMatchObject({ stage: 1, startHere: true, order: 1 });
    expect(byId.d.startHere).toBe(false);
    expect(byId.b.startHere).toBe(false);
    expect(byId.b.stage).toBeGreaterThan(1);
  });

  it("finds everything before and after a concept", () => {
    const edges = [prereq("a", "b"), prereq("b", "c"), prereq("x", "c")];
    const path = lineage("b", edges);
    expect([...path.before]).toEqual(["a"]);
    expect([...path.after]).toEqual(["c"]);
  });

  it("lays prerequisites out left to right", () => {
    const map = prepareConceptMap([concept("a"), concept("b")], [prereq("a", "b")]);
    const positions = layoutConceptMap(map);
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
  });

  it("labels difficulty in plain words", () => {
    expect([1, 2, 3, 4, 5].map(levelLabel)).toEqual(["Basic", "Basic", "Intermediate", "Advanced", "Advanced"]);
  });
});
