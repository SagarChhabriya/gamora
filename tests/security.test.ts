import { beforeEach, describe, expect, it } from "vitest";

import { logEvent } from "@/lib/observability/events";
import { checkRateLimit } from "@/lib/security/rate-limit";

beforeEach(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("security utilities", () => {
  it("fails closed when rate limiting is not configured", async () => {
    await expect(checkRateLimit("test-user")).resolves.toMatchObject({
      allowed: false,
      reason: "not_configured",
    });
  });

  it("does not throw when event logging is not configured", async () => {
    await expect(
      logEvent({
        request_id: "90e2f566-553f-4586-8844-8929955e4e96",
        type: "test.event",
      }),
    ).resolves.toEqual({ ok: false });
  });

  it("rejects malformed events before making a network request", async () => {
    await expect(
      logEvent({ request_id: "not-a-uuid", type: "test.event" }),
    ).resolves.toEqual({ ok: false });
  });
});
