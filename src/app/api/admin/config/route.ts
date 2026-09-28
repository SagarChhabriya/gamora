import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/auth/server";
import { clearConfigCache, getActiveConfig } from "@/lib/config/active";
import { diffConfig } from "@/lib/config/diff";
import { appConfigSchema, defaultConfig, parseConfig } from "@/lib/config/schema";
import { logEvent } from "@/lib/observability/events";
import { getOrCreateRequestId } from "@/lib/observability/request-id";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { supabaseRequest } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Version = { id: string; version: number; config: unknown; author_id: string; note: string | null; is_active: boolean; created_at: string };

export async function GET(request: Request) {
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const [active, versions] = await Promise.all([
    getActiveConfig(),
    supabaseRequest<Version[]>("configs?select=id,version,config,author_id,note,is_active,created_at&order=version.desc&limit=30"),
  ]);
  const authors = [...new Set((versions ?? []).map((row) => row.author_id))];
  const names = authors.length
    ? ((await supabaseRequest<Array<{ id: string; display_name: string | null }>>(`profiles?id=in.(${authors.join(",")})&select=id,display_name`)) ?? [])
    : [];
  const list = versions ?? [];
  return NextResponse.json({
    active: active.config,
    active_version: active.version,
    defaults: defaultConfig,
    versions: list.map((row, index) => ({
      version: row.version,
      note: row.note,
      is_active: row.is_active,
      created_at: row.created_at,
      author: names.find((name) => name.id === row.author_id)?.display_name ?? "Admin",
      diff: diffConfig(parseConfig(list[index + 1]?.config ?? {}), parseConfig(row.config)),
    })),
  });
}

const saveSchema = z.object({
  config: z.unknown(),
  note: z.string().trim().max(200).optional(),
  rollback_to: z.number().int().nonnegative().optional(),
});

/** Saves a new version and activates it. Rollback copies an old version forward, keeping history. */
export async function POST(request: Request) {
  const requestId = getOrCreateRequestId(request.headers.get("x-request-id"));
  const auth = await requireUser(request, "admin");
  if (auth.error) return auth.error;
  const limited = await enforceRateLimit(auth.user.id, "default");
  if (limited) return limited;
  const body = saveSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  let next: z.infer<typeof appConfigSchema>;
  let note = body.data.note ?? null;
  if (body.data.rollback_to === 0) {
    next = defaultConfig;
    note = "Rollback to built-in defaults";
  } else if (body.data.rollback_to) {
    const rows = await supabaseRequest<Version[]>(`configs?version=eq.${body.data.rollback_to}&select=config`);
    if (!rows?.[0]) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    next = parseConfig(rows[0].config);
    note = `Rollback to version ${body.data.rollback_to}`;
  } else {
    const parsed = appConfigSchema.safeParse(body.data.config);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Config is not valid", issues: parsed.error.issues.slice(0, 10).map((issue) => ({ path: issue.path.join("."), message: issue.message })) },
        { status: 422 },
      );
    }
    next = parsed.data;
    if (next.difficulty.min > next.difficulty.max) {
      return NextResponse.json({ error: "Config is not valid", issues: [{ path: "difficulty.min", message: "Minimum difficulty cannot exceed maximum" }] }, { status: 422 });
    }
  }

  const current = await getActiveConfig();
  const latest = await supabaseRequest<Array<{ version: number }>>("configs?select=version&order=version.desc&limit=1");
  const version = (latest?.[0]?.version ?? 0) + 1;
  await supabaseRequest("configs?is_active=eq.true", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ is_active: false }) });
  await supabaseRequest("configs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ version, config: next, author_id: auth.user.id, note, is_active: true }),
  });
  clearConfigCache();
  const diff = diffConfig(current.config, next);
  await logEvent({ request_id: requestId, user_hash: auth.user.userHash, type: "admin.config_saved", payload: { version, changes: diff.length, rollback: Boolean(body.data.rollback_to) } });
  return NextResponse.json({ version, diff });
}
