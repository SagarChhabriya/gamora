import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth/server";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ContentRow = { id: string; owner_id: string; title: string; status: string; language: string | null; chunk_count: number; created_at: string; shared: boolean };

/**
 * Sources the user owns, plus sources an admin shared with everyone. This holds for admins too, so
 * their own Studio and home never list other people's material. The admin content table asks for
 * every source explicitly with ?scope=all.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const wantsAll = new URL(request.url).searchParams.get("scope") === "all";
  if (wantsAll && auth.user.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  const filter = wantsAll ? "" : `&or=(owner_id.eq.${auth.user.id},shared.eq.true)`;
  const contents = await supabaseRequest<ContentRow[]>(
    `contents?select=id,owner_id,title,status,language,chunk_count,created_at,shared${filter}&order=created_at.desc&limit=50`,
  );
  const ids = (contents ?? []).map((content) => content.id);
  const journeys = ids.length
    ? await supabaseRequest<Array<{ id: string; content_id: string }>>(
        `journeys?content_id=in.(${ids.join(",")})&learner_id=eq.${auth.user.id}&status=eq.ready&select=id,content_id&order=created_at.desc`,
      )
    : [];
  const byContent = new Map<string, string>();
  for (const journey of journeys ?? []) if (!byContent.has(journey.content_id)) byContent.set(journey.content_id, journey.id);

  return NextResponse.json({
    contents: (contents ?? []).map((content) => ({
      id: content.id,
      title: content.title,
      status: content.status,
      language: content.language,
      chunk_count: content.chunk_count,
      created_at: content.created_at,
      shared: content.shared,
      mine: content.owner_id === auth.user.id,
      journey_id: byContent.get(content.id) ?? null,
    })),
  });
}
