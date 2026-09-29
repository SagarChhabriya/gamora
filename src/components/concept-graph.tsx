"use client";

import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useRef, useState } from "react";

import { cx } from "@/components/ui";
import { NODE_HEIGHT, NODE_WIDTH, layoutConceptMap, levelLabel, lineage, prepareConceptMap, type MapConcept, type MapEdge, type PreparedConcept } from "@/lib/concept-map";

type Focus = "none" | "self" | "before" | "after" | "dim";
type ConceptNode = Node<{ concept: PreparedConcept; focus: Focus }, "concept">;

const levelStyles: Record<string, string> = {
  Basic: "border-l-good",
  Intermediate: "border-l-[#c98a2b]",
  Advanced: "border-l-accent",
};

function ConceptCard({ data }: NodeProps<ConceptNode>) {
  const { concept, focus } = data;
  const level = levelLabel(concept.difficulty);
  return (
    <div
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
      className={cx(
        "flex flex-col justify-between border border-l-4 bg-panel px-3 py-2 text-left shadow-sm transition-opacity",
        levelStyles[level],
        focus === "self" ? "border-ink ring-2 ring-accent" : focus === "before" || focus === "after" ? "border-ink/60" : "border-ink/20",
        focus === "dim" && "opacity-25",
      )}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.1em]">
        <span className="text-ink/55">{level}</span>
        {concept.startHere ? <span className="bg-good px-1.5 py-0.5 text-paper">Start here</span> : null}
      </div>
      <p className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink" title={concept.name}>
        {concept.name}
      </p>
      <Handle type="source" position={Position.Right} isConnectable={false} className="!h-1 !w-1 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

const nodeTypes = { concept: ConceptCard };

type Props = { concepts: MapConcept[]; edges: MapEdge[] };

const readableZoom = 0.7;

/** Fits the whole map when it is readable. A large map opens at a readable zoom on its starting column. */
function startAtBeginning(instance: ReactFlowInstance<ConceptNode, Edge>) {
  void instance.fitView({ padding: 0.12, maxZoom: 1 }).then(() => {
    const { y, zoom } = instance.getViewport();
    if (zoom < readableZoom) void instance.setViewport({ x: 16, y: Math.min(16, y), zoom: readableZoom });
  });
}

/** Interactive concept map: learning order left to right, click a concept to trace its path. */
export function ConceptGraph({ concepts, edges }: Props) {
  const map = useMemo(() => prepareConceptMap(concepts, edges), [concepts, edges]);
  const positions = useMemo(() => layoutConceptMap(map), [map]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showRelated, setShowRelated] = useState(false);
  const flow = useRef<ReactFlowInstance<ConceptNode, Edge> | null>(null);

  function focusConcept(id: string) {
    setSelected(id);
    const position = positions.get(id);
    const zoom = Math.max(flow.current?.getZoom() ?? 1, readableZoom);
    if (position) void flow.current?.setCenter(position.x + NODE_WIDTH / 2, position.y + NODE_HEIGHT / 2, { zoom, duration: 400 });
  }

  const byId = useMemo(() => new Map(map.concepts.map((concept) => [concept.id, concept])), [map]);
  const path = useMemo(() => (selected ? lineage(selected, map.prerequisites) : null), [selected, map]);

  const nodes: ConceptNode[] = useMemo(
    () =>
      map.concepts.map((concept) => {
        const focus: Focus = !path
          ? "none"
          : concept.id === selected
            ? "self"
            : path.before.has(concept.id)
              ? "before"
              : path.after.has(concept.id)
                ? "after"
                : "dim";
        return { id: concept.id, type: "concept", position: positions.get(concept.id) ?? { x: 0, y: 0 }, data: { concept, focus }, draggable: false };
      }),
    [map, positions, path, selected],
  );

  const flowEdges: Edge[] = useMemo(() => {
    const inPath = (id: string) => id === selected || Boolean(path?.before.has(id) || path?.after.has(id));
    const onPath = (edge: MapEdge) => Boolean(path) && inPath(edge.from_id) && inPath(edge.to_id);
    const prereq = map.prerequisites.map((edge): Edge => {
      const active = onPath(edge);
      return {
        id: `p-${edge.from_id}-${edge.to_id}`,
        source: edge.from_id,
        target: edge.to_id,
        type: "default",
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: active ? "var(--accent)" : "var(--foreground)" },
        style: { stroke: active ? "var(--accent)" : "var(--foreground)", strokeWidth: active ? 2 : 1.25, opacity: path && !active ? 0.12 : active ? 1 : 0.45 },
      };
    });
    const related = showRelated
      ? map.related.map((edge): Edge => {
          const touches = selected !== null && (edge.from_id === selected || edge.to_id === selected);
          return {
            id: `r-${edge.from_id}-${edge.to_id}`,
            source: edge.from_id,
            target: edge.to_id,
            type: "straight",
            style: { stroke: "var(--accent)", strokeDasharray: "4 4", opacity: path && !touches ? 0.08 : 0.5 },
          };
        })
      : [];
    return [...prereq, ...related];
  }, [map, path, selected, showRelated]);

  if (!map.concepts.length) return null;

  const current = selected ? byId.get(selected) : undefined;
  const directBefore = current ? map.prerequisites.filter((edge) => edge.to_id === current.id).map((edge) => byId.get(edge.from_id)) : [];
  const directAfter = current ? map.prerequisites.filter((edge) => edge.from_id === current.id).map((edge) => byId.get(edge.to_id)) : [];
  const relatedTo = current
    ? map.related.filter((edge) => edge.from_id === current.id || edge.to_id === current.id).map((edge) => byId.get(edge.from_id === current.id ? edge.to_id : edge.from_id))
    : [];
  const ordered = [...map.concepts].sort((a, b) => a.order - b.order);

  const chips = (items: Array<PreparedConcept | undefined>, empty: string) => {
    const list = items.filter((item): item is PreparedConcept => Boolean(item));
    if (!list.length) return <p className="mt-1 text-xs text-ink/55">{empty}</p>;
    return (
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {list.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => focusConcept(item.id)} className="border border-ink/20 bg-paper px-2 py-1 text-xs font-medium hover:border-accent">
              {item.name}
            </button>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <figure className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-ink/70">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="Map legend">
          <li className="flex items-center gap-1.5">
            <span className="bg-good px-1.5 py-0.5 text-[10px] font-semibold uppercase text-paper">Start here</span> a good first concept
          </li>
          <li className="flex items-center gap-1.5">
            <svg width="34" height="10" aria-hidden="true">
              <line x1="0" y1="5" x2="26" y2="5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M26 1 L33 5 L26 9 z" fill="currentColor" />
            </svg>
            learn this first, then the next
          </li>
          <li className="flex items-center gap-1.5">
            <span className="h-3 w-1 bg-good" aria-hidden="true" /> Basic
            <span className="ml-2 h-3 w-1 bg-[#c98a2b]" aria-hidden="true" /> Intermediate
            <span className="ml-2 h-3 w-1 bg-accent" aria-hidden="true" /> Advanced
          </li>
        </ul>
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={showRelated} onChange={(event) => setShowRelated(event.target.checked)} className="accent-[var(--accent)]" />
          Show related links ({map.related.length})
        </label>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_18rem]">
        <div className="h-[520px] border border-ink/15 bg-paper" aria-label={`Concept map with ${map.concepts.length} concepts. A text version follows below.`}>
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelected((value) => (value === node.id ? null : node.id))}
            onPaneClick={() => setSelected(null)}
            nodesConnectable={false}
            nodesDraggable={false}
            onInit={(instance) => {
              flow.current = instance;
              startAtBeginning(instance);
            }}
            minZoom={0.2}
            maxZoom={1.75}
            colorMode="light"
          >
            <Background gap={24} size={1} color="var(--panel)" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="border border-ink/15 bg-panel p-4 text-sm" aria-live="polite">
          {current ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent">
                  {levelLabel(current.difficulty)}
                </p>
                <h3 className="mt-1 text-lg font-semibold leading-tight">{current.name}</h3>
                {current.summary ? <p className="mt-2 leading-6 text-ink/75">{current.summary}</p> : null}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/60">Learn first</p>
                {chips(directBefore, "Nothing. This is a starting point.")}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/60">Unlocks next</p>
                {chips(directAfter, "Nothing builds on this one.")}
              </div>
              {relatedTo.length ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink/60">Related</p>
                  {chips(relatedTo, "")}
                </div>
              ) : null}
              <button type="button" onClick={() => setSelected(null)} className="text-xs font-semibold text-accent underline underline-offset-4">
                Clear selection
              </button>
            </div>
          ) : (
            <div className="space-y-2 leading-6 text-ink/75">
              <p className="font-semibold text-ink">How to read this map</p>
              <p>Begin with a concept marked Start here. Each arrow points to a concept that builds on the one before it.</p>
              <p>Click any concept to see what to learn before it and what it unlocks. Scroll to zoom, drag to move around.</p>
            </div>
          )}
        </aside>
      </div>

      <details className="border border-ink/15 bg-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">Suggested learning order, as a list</summary>
        <ol className="mt-3 space-y-1 text-sm">
          {ordered.map((concept) => (
            <li key={concept.id}>
              <span className="mr-2 font-semibold text-accent">{concept.order}.</span>
              {concept.name}
              <span className="ml-2 text-xs text-ink/55">{levelLabel(concept.difficulty)}</span>
            </li>
          ))}
        </ol>
      </details>
    </figure>
  );
}
