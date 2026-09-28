"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AdminNav } from "@/components/admin-nav";
import { AppShell } from "@/components/app-shell";
import { Alert, Button, Eyebrow } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";

type Content = { id: string; title: string; status: string; language: string | null; chunk_count: number; created_at: string; shared: boolean; mine: boolean };

function ContentAdmin() {
  const [contents, setContents] = useState<Content[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await authFetch("/api/contents");
    if (!response.ok) return setError("Could not load content");
    setContents(((await response.json()) as { contents: Content[] }).contents);
  }, []);

  useEffect(() => {
    // Initial load of all sources for the admin table.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggle(content: Content) {
    const response = await authFetch(`/api/admin/contents/${content.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shared: !content.shared }),
    });
    if (!response.ok) setError("Could not update sharing");
    await load();
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>Content</Eyebrow>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.03em]">Sources and sharing</h1>
          <p className="mt-2 text-ink/70">Share a source to put it in the &quot;Ready to learn&quot; list of every learner. Each learner gets a journey planned for their own profile.</p>
        </div>
        <Link href="/studio" className="inline-flex min-h-11 items-center bg-ink px-5 text-sm font-semibold text-paper hover:bg-accent">
          Add a source
        </Link>
      </header>
      {error ? <Alert>{error}</Alert> : null}
      {!contents ? (
        <p className="text-ink/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.1em] text-ink/60">
              <tr>
                <th className="py-2">Title</th>
                <th>Status</th>
                <th>Language</th>
                <th className="text-right">Sources</th>
                <th>Added</th>
                <th className="text-right">Shared with learners</th>
              </tr>
            </thead>
            <tbody>
              {contents.map((content) => (
                <tr key={content.id} className="border-t border-ink/10">
                  <td className="py-3 font-medium">{content.title}</td>
                  <td>{content.status}</td>
                  <td>{content.language ?? "unknown"}</td>
                  <td className="text-right tabular-nums">{content.chunk_count}</td>
                  <td>{new Date(content.created_at).toLocaleDateString()}</td>
                  <td className="text-right">
                    <Button variant={content.shared ? "primary" : "secondary"} className="min-h-9 px-3 py-1 text-xs" disabled={content.status !== "ready"} onClick={() => void toggle(content)} aria-pressed={content.shared}>
                      {content.shared ? "Shared" : "Share"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function AdminContentPage() {
  return (
    <AppShell requireRole="admin" wide>
      {() => (
        <>
          <AdminNav />
          <ContentAdmin />
        </>
      )}
    </AppShell>
  );
}
