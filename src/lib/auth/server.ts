import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { getAuthenticatedUserId, supabaseRequest } from "@/lib/supabase/server";

export type AuthUser = { id: string; role: "learner" | "admin"; userHash: string };

export function hashUserId(id: string) {
  return createHash("sha256").update(`gamora:${id}`).digest("hex").slice(0, 32);
}

export async function getUser(request: Request): Promise<AuthUser | null> {
  const id = await getAuthenticatedUserId(request);
  if (!id) return null;
  const rows = await supabaseRequest<Array<{ role: "learner" | "admin" }>>(
    `profiles?id=eq.${encodeURIComponent(id)}&select=role`,
  );
  return { id, role: rows?.[0]?.role ?? "learner", userHash: hashUserId(id) };
}

/** Returns the user, or a ready-to-return error response. */
export async function requireUser(
  request: Request,
  role?: "admin",
): Promise<{ user: AuthUser; error?: never } | { user?: never; error: NextResponse }> {
  const user = await getUser(request);
  if (!user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (role === "admin" && user.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin role required" }, { status: 403 }) };
  }
  return { user };
}
