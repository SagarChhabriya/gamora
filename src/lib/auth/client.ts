"use client";

import { useCallback, useEffect, useState } from "react";

import type { SessionPayload } from "@/lib/auth/supabase-auth";

const storageKey = "gamora.session";
const listeners = new Set<(session: SessionPayload | null) => void>();

function read(): SessionPayload | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as SessionPayload) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: SessionPayload | null) {
  try {
    if (session) window.localStorage.setItem(storageKey, JSON.stringify(session));
    else window.localStorage.removeItem(storageKey);
  } catch {
    // Private windows can block storage. The session then lasts for this page only.
  }
  memory = session;
  listeners.forEach((listener) => listener(session));
}

let memory: SessionPayload | null = null;
let refreshing: Promise<SessionPayload | null> | null = null;

async function refresh(session: SessionPayload) {
  refreshing ??= fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  })
    .then(async (response) => (response.ok ? ((await response.json()) as SessionPayload) : null))
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  const next = await refreshing;
  saveSession(next);
  return next;
}

export async function currentSession() {
  const session = memory ?? read();
  if (!session) return null;
  if (session.expires_at - 60 < Date.now() / 1000) return refresh(session);
  return session;
}

/** fetch with the learner's bearer token. Refreshes once on 401. */
export async function authFetch(input: string, init: RequestInit = {}) {
  const session = await currentSession();
  const withToken = (token?: string) =>
    fetch(input, {
      ...init,
      headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  let response = await withToken(session?.access_token);
  if (response.status === 401 && session) {
    const next = await refresh(session);
    if (next) response = await withToken(next.access_token);
  }
  return response;
}

export function signOut() {
  saveSession(null);
}

export function useSession() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    currentSession().then((value) => {
      if (!active) return;
      setSession(value);
      setReady(true);
    });
    listeners.add(setSession);
    return () => {
      active = false;
      listeners.delete(setSession);
    };
  }, []);

  const update = useCallback((value: SessionPayload | null) => saveSession(value), []);
  return { session, ready, setSession: update };
}
