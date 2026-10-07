"use client";

import { useEffect, useState } from "react";

import { cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { LeaderboardEntry } from "@/lib/gamification/leaderboard";

type Board = { top: LeaderboardEntry[]; you: LeaderboardEntry | null };

function Row({ entry }: { entry: LeaderboardEntry }) {
  return (
    <li className={cx("flex items-center gap-3 px-3 py-2 text-sm", entry.you ? "bg-accent/10 font-semibold" : "odd:bg-ink/[0.03]")}>
      <span className="w-7 text-right tabular-nums text-ink/60">{entry.rank}</span>
      <span className="min-w-0 flex-1 truncate">
        {entry.name}
        {entry.you ? <span className="ml-2 text-xs font-semibold uppercase tracking-[0.12em] text-accent">You</span> : null}
      </span>
      <span className="text-xs text-ink/55">{entry.streak ? `${entry.streak}d streak` : ""}</span>
      <span className="w-16 text-right tabular-nums">{entry.xp} XP</span>
    </li>
  );
}

/** The XP leaderboard. Renders nothing unless the admin has turned it on. */
export function LeaderboardCard({ className }: { className?: string }) {
  const [board, setBoard] = useState<Board | null>(null);

  useEffect(() => {
    let live = true;
    authFetch("/api/leaderboard")
      .then(async (response) => (response.ok ? ((await response.json()) as Board) : null))
      .then((value) => live && setBoard(value))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  if (!board) return null;
  return (
    <section aria-label="Leaderboard" className={cx("space-y-3", className)} data-tour="leaderboard">
      <h2 className="text-xl font-semibold">Leaderboard</h2>
      <p className="text-sm text-ink/60">XP from missions, reviews and badges, across every learner. First names only.</p>
      {board.top.length ? (
        <ol className="border border-ink/15 bg-panel">
          {board.top.map((entry) => (
            <Row key={`${entry.rank}-${entry.name}-${entry.xp}`} entry={entry} />
          ))}
          {board.you ? (
            <>
              <li aria-hidden="true" className="px-3 text-center text-ink/40">
                ...
              </li>
              <Row entry={board.you} />
            </>
          ) : null}
        </ol>
      ) : (
        <p className="border border-ink/15 bg-panel p-4 text-sm text-ink/65">No one has earned XP yet. Finish a mission to be the first on the board.</p>
      )}
    </section>
  );
}
