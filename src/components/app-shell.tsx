"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { AccountMenu } from "@/components/account-menu";
import { useSession } from "@/lib/auth/client";
import type { SessionPayload } from "@/lib/auth/supabase-auth";
import { cx } from "@/components/ui";

type Props = {
  children: (session: SessionPayload) => ReactNode;
  requireRole?: "admin";
  wide?: boolean;
};

const learnerLinks = [
  { href: "/", label: "Journeys" },
  { href: "/studio", label: "Studio" },
];

const contrastKey = "gamora.contrast";

/** High contrast lives in the header so it applies to every page and survives reloads. */
function ContrastToggle() {
  const [high, setHigh] = useState(false);

  useEffect(() => {
    let saved = false;
    try {
      saved = window.localStorage.getItem(contrastKey) === "high";
    } catch {
      // Storage can be blocked. The toggle then lasts for this page only.
    }
    // Read once on mount: the saved choice is only available in the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHigh(saved);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.contrast = high ? "high" : "";
  }, [high]);

  return (
    <button
      type="button"
      aria-pressed={high}
      title="High contrast"
      onClick={() => {
        const next = !high;
        setHigh(next);
        try {
          window.localStorage.setItem(contrastKey, next ? "high" : "normal");
        } catch {
          // Ignore blocked storage.
        }
      }}
      className={cx("inline-flex min-h-9 items-center gap-1.5 border px-2.5 text-xs font-semibold", high ? "border-ink bg-ink text-paper" : "border-ink/25 text-ink/70 hover:border-accent hover:text-accent")}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
      </svg>
      <span className="hidden sm:inline">High contrast</span>
      <span className="sr-only sm:hidden">High contrast</span>
    </button>
  );
}

/** Signed-in layout. Redirects to /login when there is no session. */
export function AppShell({ children, requireRole, wide }: Props) {
  const { session, ready } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !session) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [ready, session, router, pathname]);

  if (!ready || !session) {
    return (
      <main className="grid min-h-screen place-items-center" aria-busy="true">
        <p className="text-sm text-ink/60">Loading your space...</p>
      </main>
    );
  }

  const links = session.user.role === "admin" ? [...learnerLinks, { href: "/admin", label: "Admin" }] : learnerLinks;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="border-b border-ink/15">
        <div className={cx("mx-auto flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8", wide ? "max-w-[1440px]" : "max-w-6xl")}>
          <Link href="/" className="text-base font-semibold uppercase tracking-[0.22em]">
            Gamora
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm">
            {links.map((link) => {
              const active = link.href === "/" ? pathname === "/" || pathname.startsWith("/journey") : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cx("px-3 py-2 font-medium", active ? "text-accent underline underline-offset-8" : "text-ink/70 hover:text-ink")}
                >
                  {link.label}
                </Link>
              );
            })}
            <ContrastToggle />
            <AccountMenu session={session} />
          </nav>
        </div>
      </header>
      <main id="main" className={cx("mx-auto px-4 py-8 sm:px-8", wide ? "max-w-[1440px]" : "max-w-6xl")}>
        {requireRole === "admin" && session.user.role !== "admin" ? (
          <p role="alert">This area is for admins. Ask your L&amp;D team for access.</p>
        ) : (
          children(session)
        )}
      </main>
    </div>
  );
}
