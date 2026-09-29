"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { authFetch, signOut } from "@/lib/auth/client";
import type { SessionPayload } from "@/lib/auth/supabase-auth";

/** Profile icon in the header. Holds account actions, including delete my data. */
export function AccountMenu({ session }: { session: SessionPayload }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const name = session.user.display_name ?? session.user.email.split("@")[0];
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setConfirming(false);
      setError(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function deleteMyData() {
    setDeleting(true);
    setError(null);
    const response = await authFetch("/api/profile", { method: "DELETE" }).catch(() => null);
    if (response?.ok) {
      signOut();
      router.replace("/login");
      return;
    }
    setDeleting(false);
    setError("Could not delete your data. Please try again.");
  }

  const item = "block w-full px-4 py-2.5 text-left text-sm hover:bg-paper";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="ml-2 grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-semibold text-paper hover:bg-accent"
      >
        {initial}
      </button>
      {open ? (
        <div role="menu" aria-label="Account" className="absolute right-0 z-50 mt-2 w-72 border border-ink/20 bg-panel shadow-lg">
          <div className="border-b border-ink/15 px-4 py-3">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-xs text-ink/60">{session.user.email}</p>
          </div>
          {confirming ? (
            <div className="space-y-3 px-4 py-3 text-sm">
              <p className="font-semibold text-danger">Delete your account?</p>
              <p className="text-ink/70">This permanently removes your account, journeys, progress and settings. It cannot be undone.</p>
              {error ? <p role="alert" className="text-danger">{error}</p> : null}
              <div className="flex gap-2">
                <button type="button" onClick={() => void deleteMyData()} disabled={deleting} className="min-h-9 bg-danger px-3 text-sm font-semibold text-paper disabled:opacity-60">
                  {deleting ? "Deleting..." : "Delete permanently"}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={deleting} className="min-h-9 border border-ink/25 px-3 text-sm font-semibold">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="py-1">
              <Link role="menuitem" href="/profile" className={item} onClick={() => setOpen(false)}>
                Learning preferences
              </Link>
              <Link role="menuitem" href="/onboarding" className={item} onClick={() => setOpen(false)}>
                Update my profile
              </Link>
              <button
                role="menuitem"
                type="button"
                className={item}
                onClick={() => {
                  signOut();
                  router.replace("/login");
                }}
              >
                Sign out
              </button>
              <div className="mt-1 border-t border-ink/15 pt-1">
                <p className="px-4 pt-2 text-xs text-ink/55">We keep only what is needed to adapt your learning. Audio is never stored.</p>
                <button role="menuitem" type="button" className={`${item} font-semibold text-danger`} onClick={() => setConfirming(true)}>
                  Delete my data
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
