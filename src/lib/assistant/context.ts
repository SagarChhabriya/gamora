import type { AppConfig, Persona } from "@/lib/config/schema";
import { personaLabels } from "@/lib/config/schema";
import { badgeCatalog, playerLevel } from "@/lib/gamification/rewards";
import { loadJourneyView, type MissionView } from "@/lib/journey/load";
import { supabaseRequest } from "@/lib/supabase/server";

export type AssistantLink = { id: string; label: string; href: string };

export type LearnerSnapshot = {
  name: string;
  persona: string;
  language: "en" | "roman_ur";
  goal: string | null;
  xp: number;
  streak: number;
  bestStreak: number;
  badges: string[];
  sources: { ready: number; processing: number; failed: number; library: number };
  journeys: Array<{
    id: string;
    title: string;
    done: number;
    total: number;
    next: { id: string; title: string; status: MissionView["status"]; lockReason?: string } | null;
    weakest: Array<{ name: string; mastery: number }>;
  }>;
};

const journeyLimit = 3;

/** Only the signed-in learner's own rows. Nothing about other users ever enters the prompt. */
export async function loadLearnerSnapshot(userId: string, fallbackName: string, config: AppConfig): Promise<LearnerSnapshot> {
  const [profiles, game, contents, journeys] = await Promise.all([
    supabaseRequest<Array<{ display_name: string | null; persona: string | null; language_pref: string; onboarding: { goal?: string } | null }>>(
      `profiles?id=eq.${userId}&select=display_name,persona,language_pref,onboarding`,
    ),
    supabaseRequest<Array<{ xp: number; streak: number; best_streak: number; badges: string[] }>>(`gamification?learner_id=eq.${userId}&select=xp,streak,best_streak,badges`),
    supabaseRequest<Array<{ owner_id: string; status: string }>>(`contents?or=(owner_id.eq.${userId},shared.eq.true)&select=owner_id,status&limit=200`),
    supabaseRequest<Array<{ id: string; title: string | null }>>(`journeys?learner_id=eq.${userId}&status=eq.ready&select=id,title&order=created_at.desc&limit=${journeyLimit}`),
  ]);
  const profile = profiles?.[0];
  const stats = game?.[0];
  const own = (contents ?? []).filter((content) => content.owner_id === userId);
  const views = await Promise.all((journeys ?? []).map((journey) => loadJourneyView(journey.id, userId, config)));
  const persona = profile?.persona && profile.persona in personaLabels ? personaLabels[profile.persona as Persona] : personaLabels[config.learner.default_persona];

  return {
    name: profile?.display_name ?? fallbackName,
    persona,
    language: profile?.language_pref === "roman_ur" ? "roman_ur" : "en",
    goal: profile?.onboarding?.goal ?? null,
    xp: stats?.xp ?? 0,
    streak: stats?.streak ?? 0,
    bestStreak: stats?.best_streak ?? 0,
    badges: Array.isArray(stats?.badges) ? stats.badges : [],
    sources: {
      ready: own.filter((content) => content.status === "ready").length,
      processing: own.filter((content) => content.status === "processing").length,
      failed: own.filter((content) => content.status === "failed").length,
      library: (contents ?? []).length - own.length,
    },
    journeys: (journeys ?? []).map((journey, index) => {
      const missions = views[index] ?? [];
      const next = missions.find((mission) => mission.status === "in_progress") ?? missions.find((mission) => mission.status === "available") ?? missions.find((mission) => mission.status === "locked");
      const concepts = new Map(missions.flatMap((mission) => mission.concepts).map((concept) => [concept.id, concept]));
      return {
        id: journey.id,
        title: journey.title ?? "Untitled journey",
        done: missions.filter((mission) => mission.status === "completed").length,
        total: missions.length,
        next: next ? { id: next.id, title: next.title, status: next.status, lockReason: next.lock_reason } : null,
        weakest: [...concepts.values()]
          .sort((a, b) => a.mastery - b.mastery)
          .slice(0, 3)
          .map((concept) => ({ name: concept.name, mastery: concept.mastery })),
      };
    }),
  };
}

/** Pages the assistant may point to. The model picks link ids; it can never invent a URL. */
export function snapshotLinks(snapshot: LearnerSnapshot): AssistantLink[] {
  const links: AssistantLink[] = [
    { id: "L1", label: "Your journeys", href: "/" },
    { id: "L2", label: "Studio: add material", href: "/studio" },
    { id: "L3", label: "Update my profile", href: "/onboarding" },
    { id: "L4", label: "Learning preferences", href: "/profile" },
  ];
  for (const journey of snapshot.journeys) {
    links.push({ id: `L${links.length + 1}`, label: `Journey map: ${journey.title}`, href: `/journey/${journey.id}` });
    if (journey.next && journey.next.status !== "locked") {
      links.push({ id: `L${links.length + 1}`, label: `Continue: ${journey.next.title}`, href: `/journey/${journey.id}/mission/${journey.next.id}` });
    }
  }
  return links;
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

/** Compact, readable facts for the prompt. */
export function formatSnapshot(snapshot: LearnerSnapshot) {
  const level = playerLevel(snapshot.xp);
  const lines = [
    `Name: ${snapshot.name}. Learner type: ${snapshot.persona}. Language: ${snapshot.language === "roman_ur" ? "Roman Urdu" : "English"}.${snapshot.goal ? ` Goal: ${snapshot.goal}.` : ""}`,
    `XP ${snapshot.xp}, level ${level.level} (${level.span - level.into} XP to the next level). Streak ${snapshot.streak} days, best ${snapshot.bestStreak}. Badges: ${snapshot.badges.length ? snapshot.badges.map((id) => badgeCatalog[id]?.name ?? id).join(", ") : "none yet"}.`,
    `Own sources: ${snapshot.sources.ready} ready, ${snapshot.sources.processing} processing, ${snapshot.sources.failed} failed. Library sources available: ${snapshot.sources.library}.`,
  ];
  if (!snapshot.journeys.length) lines.push("Journeys: none yet.");
  for (const journey of snapshot.journeys) {
    const next = journey.next
      ? `Next mission: "${journey.next.title}" (${journey.next.status.replace("_", " ")}${journey.next.lockReason ? `; ${journey.next.lockReason}` : ""}).`
      : "All missions completed.";
    const weakest = journey.weakest.length ? ` Weakest concepts: ${journey.weakest.map((concept) => `${concept.name} ${pct(concept.mastery)}`).join(", ")}.` : "";
    lines.push(`Journey "${journey.title}": ${journey.done} of ${journey.total} missions done. ${next}${weakest}`);
  }
  return lines.join("\n");
}
