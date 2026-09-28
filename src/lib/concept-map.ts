import dagre from "@dagrejs/dagre";

export type MapConcept = { id: string; name: string; difficulty: number; summary?: string };
export type MapEdge = { from_id: string; to_id: string; type: string };

export type PreparedConcept = MapConcept & { stage: number; order: number; startHere: boolean; mergedIds: string[] };
export type PreparedMap = {
  concepts: PreparedConcept[];
  prerequisites: MapEdge[];
  related: MapEdge[];
};

export const NODE_WIDTH = 224;
export const NODE_HEIGHT = 84;

function nameKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Beginner-facing label for the 1 to 5 difficulty scale. */
export function levelLabel(difficulty: number) {
  if (difficulty <= 2) return "Basic";
  if (difficulty === 3) return "Intermediate";
  return "Advanced";
}

function reachable(from: string, to: string, adjacency: Map<string, string[]>, skip: MapEdge) {
  const seen = new Set<string>([from]);
  const stack = (adjacency.get(from) ?? []).filter((next) => next !== skip.to_id);
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === to) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    stack.push(...(adjacency.get(node) ?? []));
  }
  return false;
}

/**
 * Cleans a model-built concept graph for beginners: merges concepts with the same name, drops
 * self links and duplicate links, removes prerequisite links already implied by a longer path,
 * and numbers each concept with a learning stage.
 */
export function prepareConceptMap(concepts: MapConcept[], edges: MapEdge[]): PreparedMap {
  const canonical = new Map<string, string>();
  const byKey = new Map<string, MapConcept & { mergedIds: string[] }>();
  for (const concept of concepts) {
    const key = nameKey(concept.name) || concept.id;
    const existing = byKey.get(key);
    if (existing) {
      existing.mergedIds.push(concept.id);
      canonical.set(concept.id, existing.id);
    } else {
      byKey.set(key, { ...concept, mergedIds: [concept.id] });
      canonical.set(concept.id, concept.id);
    }
  }
  const unique = [...byKey.values()];

  const seen = new Set<string>();
  const prereq: MapEdge[] = [];
  const relatedAll: MapEdge[] = [];
  for (const edge of edges) {
    const from = canonical.get(edge.from_id);
    const to = canonical.get(edge.to_id);
    if (!from || !to || from === to) continue;
    const type = edge.type === "prerequisite" ? "prerequisite" : "related";
    const key = `${type}:${from}:${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (type === "prerequisite" ? prereq : relatedAll).push({ from_id: from, to_id: to, type });
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of prereq) adjacency.set(edge.from_id, [...(adjacency.get(edge.from_id) ?? []), edge.to_id]);
  // Transitive reduction: A -> C is noise when A -> B -> C already says it.
  const prerequisites = prereq.filter((edge) => !reachable(edge.from_id, edge.to_id, adjacency, edge));

  const linked = new Set(prerequisites.flatMap((edge) => [`${edge.from_id}:${edge.to_id}`, `${edge.to_id}:${edge.from_id}`]));
  const related = relatedAll.filter((edge) => !linked.has(`${edge.from_id}:${edge.to_id}`));

  // Longest-path stages with a pass limit, so cycles from model output cannot loop forever.
  const depth = new Map(unique.map((concept) => [concept.id, 0]));
  for (let pass = 0; pass < unique.length; pass += 1) {
    let changed = false;
    for (const edge of prerequisites) {
      const next = (depth.get(edge.from_id) ?? 0) + 1;
      if (next > (depth.get(edge.to_id) ?? 0) && next < unique.length) {
        depth.set(edge.to_id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const hasPrereq = new Set(prerequisites.map((edge) => edge.to_id));
  const unlocks = new Set(prerequisites.map((edge) => edge.from_id));
  const sorted = [...unique].sort((a, b) => (depth.get(a.id) ?? 0) - (depth.get(b.id) ?? 0) || a.difficulty - b.difficulty);
  const order = new Map(sorted.map((concept, index) => [concept.id, index + 1]));

  return {
    concepts: unique.map((concept) => ({
      ...concept,
      stage: (depth.get(concept.id) ?? 0) + 1,
      order: order.get(concept.id) ?? 0,
      // A starting point opens a path. A concept with no links at all is not a place to begin a path.
      startHere: !hasPrereq.has(concept.id) && unlocks.has(concept.id),
    })),
    prerequisites,
    related,
  };
}

/** Every concept that must come before (up) or can come after (down) the given one. */
export function lineage(id: string, prerequisites: MapEdge[]) {
  const walk = (start: string, next: (edge: MapEdge) => [string, string]) => {
    const found = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const current = stack.pop() as string;
      for (const edge of prerequisites) {
        const [source, target] = next(edge);
        if (source === current && !found.has(target) && target !== start) {
          found.add(target);
          stack.push(target);
        }
      }
    }
    return found;
  };
  return {
    before: walk(id, (edge) => [edge.to_id, edge.from_id]),
    after: walk(id, (edge) => [edge.from_id, edge.to_id]),
  };
}

/**
 * Left-to-right layered positions from dagre, top-left anchored for React Flow. Concepts with no
 * links go in a row under the map, so the first column holds only real starting points.
 */
export function layoutConceptMap(map: PreparedMap) {
  const linked = new Set(map.prerequisites.flatMap((edge) => [edge.from_id, edge.to_id]));
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90, marginx: 16, marginy: 16 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const concept of map.concepts) if (linked.has(concept.id)) graph.setNode(concept.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  for (const edge of map.prerequisites) graph.setEdge(edge.from_id, edge.to_id);
  dagre.layout(graph);

  const positions = new Map<string, { x: number; y: number }>();
  let bottom = 0;
  for (const id of graph.nodes()) {
    const node = graph.node(id);
    positions.set(id, { x: node.x - NODE_WIDTH / 2, y: node.y - NODE_HEIGHT / 2 });
    bottom = Math.max(bottom, node.y + NODE_HEIGHT / 2);
  }
  const loose = map.concepts.filter((concept) => !linked.has(concept.id));
  const perRow = 4;
  loose.forEach((concept, index) => {
    positions.set(concept.id, {
      x: 16 + (index % perRow) * (NODE_WIDTH + 28),
      y: bottom + 56 + Math.floor(index / perRow) * (NODE_HEIGHT + 28),
    });
  });
  return positions;
}
