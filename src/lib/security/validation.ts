import { z } from "zod";

export const requestIdSchema = z.string().uuid();

export const healthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  request_id: requestIdSchema,
  checks: z.object({
    app: z.literal("ok"),
    supabase: z.enum(["configured", "missing"]),
    llm: z.enum(["configured", "missing"]),
    redis: z.enum(["configured", "missing"]),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
