"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cx } from "@/components/ui";

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/config", label: "Configuration" },
  { href: "/admin/content", label: "Content" },
  { href: "/admin/report", label: "Outcome report" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="mb-8 flex flex-wrap gap-1 border-b border-ink/15 print:hidden">
      {links.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx("-mb-px border-b-2 px-4 py-3 text-sm font-semibold", active ? "border-accent text-accent" : "border-transparent text-ink/60 hover:text-ink")}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
