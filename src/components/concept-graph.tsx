type Concept = { id: string; name: string; difficulty: number };
type Edge = { from_id: string; to_id: string; type: string };

/** Layered concept map: columns follow prerequisite depth. Pure SVG, no dependencies. */
export function ConceptGraph({ concepts, edges }: { concepts: Concept[]; edges: Edge[] }) {
  if (!concepts.length) return null;
  const prereq = edges.filter((edge) => edge.type === "prerequisite");
  const depth = new Map<string, number>(concepts.map((concept) => [concept.id, 0]));
  // Longest-path layering with a pass limit, so cycles from model output cannot loop forever.
  for (let pass = 0; pass < concepts.length; pass += 1) {
    let changed = false;
    for (const edge of prereq) {
      const next = (depth.get(edge.from_id) ?? 0) + 1;
      if (depth.has(edge.to_id) && next > (depth.get(edge.to_id) ?? 0) && next < concepts.length) {
        depth.set(edge.to_id, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, Concept[]>();
  for (const concept of concepts) {
    const level = depth.get(concept.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), concept]);
  }
  const levels = [...columns.keys()].sort((a, b) => a - b);
  const colWidth = 190;
  const rowHeight = 64;
  const maxRows = Math.max(...[...columns.values()].map((items) => items.length));
  const width = levels.length * colWidth + 20;
  const height = maxRows * rowHeight + 20;
  const position = new Map<string, { x: number; y: number }>();
  levels.forEach((level, column) => {
    (columns.get(level) ?? []).forEach((concept, row) => {
      position.set(concept.id, { x: 10 + column * colWidth, y: 10 + row * rowHeight });
    });
  });

  return (
    <figure className="overflow-x-auto border border-ink/15 bg-paper p-2">
      <svg width={width} height={height} role="img" aria-label={`Concept map with ${concepts.length} concepts`}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" className="text-ink/40" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const a = position.get(edge.from_id);
          const b = position.get(edge.to_id);
          if (!a || !b) return null;
          return (
            <line
              key={`${edge.from_id}-${edge.to_id}`}
              x1={a.x + 160}
              y1={a.y + 22}
              x2={b.x}
              y2={b.y + 22}
              stroke="currentColor"
              className={edge.type === "prerequisite" ? "text-ink/40" : "text-accent/30"}
              strokeDasharray={edge.type === "related" ? "4 4" : undefined}
              markerEnd={edge.type === "prerequisite" ? "url(#arrow)" : undefined}
            />
          );
        })}
        {concepts.map((concept) => {
          const p = position.get(concept.id);
          if (!p) return null;
          return (
            <g key={concept.id} transform={`translate(${p.x},${p.y})`}>
              <rect width="160" height="44" rx="2" className="fill-panel stroke-ink/25" />
              <text x="8" y="26" className="fill-ink text-[11px] font-semibold">
                {concept.name.length > 24 ? `${concept.name.slice(0, 23)}...` : concept.name}
              </text>
              <title>{concept.name}</title>
            </g>
          );
        })}
      </svg>
      <figcaption className="px-2 pt-2 text-xs text-ink/55">Solid arrows: learn first. Dashed: related.</figcaption>
    </figure>
  );
}
