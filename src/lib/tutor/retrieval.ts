import { supabaseRequest } from "@/lib/supabase/server";
import type { SourceChunk } from "@/lib/tutor/types";

type ChunkRow = { id: string; idx: number; text: string };

function toSources(rows: ChunkRow[]): SourceChunk[] {
  return rows.map((row, index) => ({ ...row, ref: `S${index + 1}` }));
}

/**
 * Chunks for one concept: its own cited chunks first, then full-text matches on the concept name
 * (or the learner's question) from the same content. Hybrid retrieval without embeddings.
 */
export async function retrieveForConcept(input: {
  contentId: string;
  sourceChunkIds: string[];
  query?: string;
  limit?: number;
}): Promise<SourceChunk[]> {
  const limit = input.limit ?? 4;
  const own = input.sourceChunkIds.length
    ? ((await supabaseRequest<ChunkRow[]>(`chunks?id=in.(${input.sourceChunkIds.join(",")})&select=id,idx,text&order=idx.asc`)) ?? [])
    : [];
  const rows = [...own];
  const terms = (input.query ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 8);
  if (terms.length && rows.length < limit) {
    const query = encodeURIComponent(terms.join(" or "));
    const matches =
      (await supabaseRequest<ChunkRow[]>(
        `chunks?content_id=eq.${input.contentId}&tsv=wfts(simple).${query}&select=id,idx,text&limit=${limit}`,
      ).catch(() => [])) ?? [];
    for (const match of matches) if (!rows.some((row) => row.id === match.id) && rows.length < limit) rows.push(match);
  }
  return toSources(rows.slice(0, limit));
}

export function sourceBlock(chunks: SourceChunk[]) {
  return chunks.map((chunk) => `<chunk ref="${chunk.ref}">${chunk.text}</chunk>`).join("\n");
}

export function refsToIds(refs: string[], chunks: SourceChunk[]) {
  const map = new Map(chunks.map((chunk) => [chunk.ref.toLowerCase(), chunk.id]));
  return [...new Set(refs.map((ref) => map.get(ref.trim().toLowerCase())).filter((id): id is string => Boolean(id)))];
}
