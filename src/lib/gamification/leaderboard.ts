export type LeaderboardRow = { learner_id: string; xp: number; streak: number; display_name: string | null };
export type LeaderboardEntry = { rank: number; name: string; xp: number; streak: number; you: boolean };

/** First word of a display name, so the board never shows a full name or an email. */
export function publicName(displayName: string | null) {
  const first = (displayName ?? "").trim().split(/[\s@._-]+/)[0] ?? "";
  return first ? first.slice(0, 18) : "Learner";
}

/**
 * Ranks learners by XP, then by streak. Learners with no XP are left off. Equal scores share a
 * rank. The top `limit` are returned, plus the viewer's own row when it is lower down.
 */
export function rankLeaderboard(rows: LeaderboardRow[], viewerId: string, limit = 10): { top: LeaderboardEntry[]; you: LeaderboardEntry | null } {
  const sorted = rows.filter((row) => row.xp > 0).sort((a, b) => b.xp - a.xp || b.streak - a.streak);
  let rank = 0;
  const ranked = sorted.map((row, index) => {
    const previous = sorted[index - 1];
    if (!previous || previous.xp !== row.xp || previous.streak !== row.streak) rank = index + 1;
    return { rank, name: publicName(row.display_name), xp: row.xp, streak: row.streak, you: row.learner_id === viewerId };
  });
  const top = ranked.slice(0, limit);
  const you = ranked.find((entry) => entry.you) ?? null;
  return { top, you: you && !top.includes(you) ? you : null };
}
