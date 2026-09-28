import { z } from "zod";

const eventSchema = z.object({
  request_id: z.string().uuid(),
  user_hash: z.string().max(128).optional(),
  type: z.string().min(1).max(80),
  payload: z.record(z.string(), z.unknown()).default({}),
  latency_ms: z.number().int().nonnegative().optional(),
  tokens_in: z.number().int().nonnegative().optional(),
  tokens_out: z.number().int().nonnegative().optional(),
  provider: z.string().max(80).optional(),
  ok: z.boolean().default(true),
});

export type EventInput = z.input<typeof eventSchema>;

export async function logEvent(event: EventInput): Promise<{ ok: boolean }> {
  const parsed = eventSchema.safeParse(event);
  if (!parsed.success) return { ok: false };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return { ok: false };

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/events`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(parsed.data),
      cache: "no-store",
    });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}
