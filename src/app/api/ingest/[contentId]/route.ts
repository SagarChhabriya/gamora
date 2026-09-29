import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { getJobForContent, publicJob } from "@/lib/ingest/pipeline";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ contentId: string }> };

type Content = {
  id: string;
  owner_id: string;
  title: string;
  source_type: string;
  status: string;
  language: string | null;
  chunk_count: number;
};

/** The source map for Studio: content, job status, passages, topics and the links between them. */
export async function GET(request: Request, context: RouteContext) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;

  const { contentId } = await context.params;
  if (!z.string().uuid().safeParse(contentId).success) {
    return NextResponse.json({ error: "Invalid content ID" }, { status: 400 });
  }
  const ownerFilter = auth.user.role === "admin" ? "" : `&owner_id=eq.${encodeURIComponent(auth.user.id)}`;
  try {
    const contents = await supabaseRequest<Content[]>(
      `contents?id=eq.${contentId}${ownerFilter}&select=id,owner_id,title,source_type,status,language,chunk_count,topic_cap`,
    );
    const content = contents?.[0];
    if (!content) return NextResponse.json({ error: "Content not found" }, { status: 404 });

    const [chunks, concepts, job] = await Promise.all([
      supabaseRequest<Array<{ id: string; idx: number; text: string; tokens: number | null }>>(
        `chunks?content_id=eq.${contentId}&select=id,idx,text,tokens&order=idx.asc`,
      ),
      supabaseRequest<Array<{ id: string; name: string; summary: string; difficulty: number; source_chunk_ids: string[]; key_points: Array<{ name: string; summary: string }> }>>(
        `concepts?content_id=eq.${contentId}&retired_at=is.null&select=id,name,summary,difficulty,source_chunk_ids,key_points&order=created_at.asc`,
      ),
      getJobForContent(contentId),
    ]);

    const conceptIds = concepts?.map((concept) => concept.id) ?? [];
    const edges = conceptIds.length
      ? await supabaseRequest<Array<{ from_id: string; to_id: string; type: string }>>(
          `concept_edges?from_id=in.(${conceptIds.join(",")})&select=from_id,to_id,type`,
        )
      : [];

    return NextResponse.json({
      content,
      job: job ? publicJob(job) : null,
      chunks: chunks ?? [],
      concepts: concepts ?? [],
      edges: edges ?? [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Debug lookup failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
