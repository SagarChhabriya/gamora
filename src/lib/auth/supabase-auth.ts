import { z } from "zod";

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(200),
  display_name: z.string().trim().min(1).max(60).optional(),
});

export type SessionPayload = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string; email: string; role: "learner" | "admin"; display_name: string | null };
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: string; email: string };
};

function authConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase auth is not configured");
  return { url, key };
}

async function withProfile(token: TokenResponse): Promise<SessionPayload> {
  const { url } = authConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const response = await fetch(`${url}/rest/v1/profiles?id=eq.${token.user.id}&select=role,display_name`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    cache: "no-store",
  });
  const rows = response.ok ? ((await response.json()) as Array<{ role: "learner" | "admin"; display_name: string | null }>) : [];
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + token.expires_in,
    user: {
      id: token.user.id,
      email: token.user.email,
      role: rows[0]?.role ?? "learner",
      display_name: rows[0]?.display_name ?? null,
    },
  };
}

async function tokenRequest(grant: "password" | "refresh_token", body: Record<string, string>) {
  const { url, key } = authConfig();
  const response = await fetch(`${url}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return withProfile((await response.json()) as TokenResponse);
}

export function signInWithPassword(email: string, password: string) {
  return tokenRequest("password", { email, password });
}

export function refreshSession(refreshToken: string) {
  return tokenRequest("refresh_token", { refresh_token: refreshToken });
}

/** Creates a confirmed learner account through the admin API. Admin role is never granted here. */
export async function createLearnerAccount(email: string, password: string, displayName?: string) {
  const { url } = authConfig();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("Supabase service configuration is missing");
  const response = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: displayName ? { display_name: displayName } : {},
    }),
    cache: "no-store",
  });
  if (response.status === 422 || response.status === 409) return { error: "An account with this email already exists" };
  if (!response.ok) return { error: "Could not create the account" };
  return { error: null };
}
