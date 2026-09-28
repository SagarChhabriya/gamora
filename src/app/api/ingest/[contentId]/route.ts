import { NextResponse } from "next/server";

import { getAuthenticatedUserId, supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contentId: string }> };

type Content = {
  id: string;
  owner_id: string;
  title: string;
  source_type: string;
  status: string;
  chunk_count: number;
};

export async function GET(request: Request, context: RouteContext) {
  const ownerId = await getAuthenticatedUserId(request);
  if (!ownerId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { contentId } = await context.params;
  try {
    const contents = await supabaseRequest<Content[]>(
      `contents?id=eq.${encodeURIComponent(contentId)}&owner_id=eq.${encodeURIComponent(ownerId)}&select=id,owner_id,title,source_type,status,chunk_count`,
    );
    const content = contents?.[0];
    if (!content) return NextResponse.json({ error: "Content not found" }, { status: 404 });

    const [chunks, concepts] = await Promise.all([
      supabaseRequest<Array<{ id: string; idx: number; text: string; tokens: number | null }>>(
        `chunks?content_id=eq.${encodeURIComponent(contentId)}&select=id,idx,text,tokens&order=idx.asc`,
      ),
      supabaseRequest<Array<{ id: string; name: string; summary: string; difficulty: number; source_chunk_ids: string[] }>>(
        `concepts?content_id=eq.${encodeURIComponent(contentId)}&select=id,name,summary,difficulty,source_chunk_ids`,
      ),
    ]);

    const conceptIds = concepts?.map((concept) => concept.id) ?? [];
    const edges = conceptIds.length
      ? await supabaseRequest<Array<{ from_id: string; to_id: string; type: string }>>(
          `concept_edges?from_id=in.(${conceptIds.join(",")})&select=from_id,to_id,type`,
        )
      : [];

    return NextResponse.json({ content, chunks: chunks ?? [], concepts: concepts ?? [], edges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debug lookup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
