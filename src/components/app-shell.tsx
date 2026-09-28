"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

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
