import { NextResponse } from "next/server";
import { z } from "zod";

import { chunkText } from "@/lib/ingest/chunk";
import { extractConcepts } from "@/lib/ingest/concepts";
import { parseFile, parseRemoteSource, parseTextSource } from "@/lib/ingest/parse";
import { scanForPromptInjection } from "@/lib/ingest/security";
import { getAuthenticatedUserId, supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().max(1_000_000).optional(),
  url: z.string().url().optional(),
});

export async function POST(request: Request) {
  const ownerId = await getAuthenticatedUserId(request);
  if (!ownerId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  try {
    let title: string;
    let text: string;
    let sourceType: string;
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      title = z.string().trim().min(1).max(200).parse(form.get("title"));
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("A source file is required");
      text = await parseFile(file);
      sourceType = file.name.toLowerCase().endsWith(".pdf") ? "pdf" : file.name.toLowerCase().endsWith(".docx") ? "docx" : "text";
    } else {
      const body = bodySchema.parse(await request.json());
      title = body.title;
      if (body.url) {
        text = await parseRemoteSource(body.url);
        sourceType = "url";
      } else if (body.text) {
        text = await parseTextSource(body.text);
        sourceType = "text";
      } else {
        throw new Error("Provide text or url");
      }
    }

    const injectionFlags = scanForPromptInjection(text);
    if (injectionFlags.length) {
      return NextResponse.json({ error: "Source contains instruction-like text", injection_flags: injectionFlags }, { status: 422 });
    }

    const chunks = chunkText(text);
    if (!chunks.length) throw new Error("Source produced no chunks");
    const plan = await extractConcepts(chunks);
    const contentRows = await supabaseRequest<Array<{ id: string }>>("contents", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ owner_id: ownerId, title, source_type: sourceType, status: "ready", chunk_count: chunks.length }),
    });
    const contentId = contentRows?.[0]?.id;
    if (!contentId) throw new Error("Supabase did not return a content ID");

    const chunkRows = await supabaseRequest<Array<{ id: string; idx: number }>>("chunks", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(chunks.map((chunk) => ({ content_id: contentId, idx: chunk.index, text: chunk.text, tokens: chunk.tokens }))),
    });
    const chunkIds = new Map((chunkRows ?? []).map((chunk) => [chunk.idx, chunk.id]));
    const conceptRows = plan.concepts.map((concept) => ({
      content_id: contentId,
      name: concept.name,
      summary: concept.summary,
      difficulty: concept.difficulty,
      source_chunk_ids: concept.source_chunk_indexes.map((index) => chunkIds.get(index)).filter((id): id is string => Boolean(id)),
    }));
    let conceptIds: string[] = [];
    if (conceptRows.length) {
      const insertedConcepts = await supabaseRequest<Array<{ id: string }>>("concepts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(conceptRows),
      });
      conceptIds = (insertedConcepts ?? []).map((concept) => concept.id);
    }
    const edgeRows = plan.edges
      .map((edge) => ({
        from_id: conceptIds[edge.from],
        to_id: conceptIds[edge.to],
        type: edge.type,
      }))
      .filter((edge) => edge.from_id && edge.to_id);
    if (edgeRows.length) {
      await supabaseRequest("concept_edges", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(edgeRows),
      });
    }

    return NextResponse.json({ content_id: contentId, chunk_count: chunks.length, concepts: plan.concepts, edges: plan.edges });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ingestion failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
