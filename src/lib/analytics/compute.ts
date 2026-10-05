import { createHash } from "node:crypto";

import type { AppConfig, EvidenceSignal } from "@/lib/config/schema";
import { applyEvidence, emptyMastery } from "@/lib/learner-model/mastery";

export type Filters = {
  from?: string;
  to?: string;
  persona?: string;
  language?: string;
  content_id?: string;
  learner?: string;
  cohort?: "all" | "real" | "demo";
};

export type Raw = {
  profiles: Array<{ id: string; display_name: string | null; persona: string | null; language_pref: string; role: string; is_demo: boolean; created_at: string }>;
  sessions: Array<{ id: string; learner_id: string; journey_id: string; mission_id: string | null; started_at: string; ended_at: string | null; completed_at: string | null; language: string; persona: string | null }>;
  evidence: Array<{ session_id: string; learner_id: string; concept_id: string; signal: EvidenceSignal; value: number; created_at: string }>;
  mastery: Array<{ learner_id: string; concept_id: string; mastery: number; confidence: number; evidence_count: number }>;
  journeys: Array<{ id: string; learner_id: string; content_id: string }>;
  missions: Array<{ id: string; journey_id: string; idx: number }>;
  concepts: Array<{ id: string; name: string; content_id: string }>;
  contents: Array<{ id: string; title: string }>;
  events: Array<{ type: string; ok: boolean; latency_ms: number | null; tokens_in: number | null; tokens_out: number | null; provider: string | null; payload: Record<string, unknown>; user_hash: string | null; created_at: string }>;
};

export function pseudonym(id: string) {
  return `Learner ${createHash("sha256").update(`pseudo:${id}`).digest("hex").slice(0, 6).toUpperCase()}`;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** Applies dashboard filters to the raw rows. Learner-level filters cascade to their sessions and evidence. */
export function applyFilters(raw: Raw, filters: Filters): Raw {
  const inRange = (date: string) => (!filters.from || date >= filters.from) && (!filters.to || date <= `${filters.to}T23:59:59`);
  const learners = raw.profiles.filter(
    (profile) =>
      profile.role === "learner" &&
      (!filters.persona || profile.persona === filters.persona) &&
      (!filters.learner || profile.id === filters.learner) &&
      (filters.cohort === "demo" ? profile.is_demo : filters.cohort === "real" ? !profile.is_demo : true),
  );
  const learnerIds = new Set(learners.map((profile) => profile.id));
  const journeys = raw.journeys.filter((journey) => learnerIds.has(journey.learner_id) && (!filters.content_id || journey.content_id === filters.content_id));
  const journeyIds = new Set(journeys.map((journey) => journey.id));
  const sessions = raw.sessions.filter(
    (session) => learnerIds.has(session.learner_id) && journeyIds.has(session.journey_id) && inRange(session.started_at) && (!filters.language || session.language === filters.language),
  );
  const sessionIds = new Set(sessions.map((session) => session.id));
  const concepts = filters.content_id ? raw.concepts.filter((concept) => concept.content_id === filters.content_id) : raw.concepts;
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  return {
    ...raw,
    profiles: learners,
    journeys,
    sessions,
    evidence: raw.evidence.filter((row) => sessionIds.has(row.session_id)),
    mastery: raw.mastery.filter((row) => learnerIds.has(row.learner_id) && conceptIds.has(row.concept_id)),
    concepts,
    events: raw.events.filter((event) => inRange(event.created_at)),
  };
}

export function computeDashboard(raw: Raw, config: AppConfig, options: { reveal: boolean }) {
  const name = (id: string) => {
    const profile = raw.profiles.find((row) => row.id === id);
    return options.reveal ? (profile?.display_name ?? pseudonym(id)) : pseudonym(id);
  };
  const conceptName = new Map(raw.concepts.map((concept) => [concept.id, concept.name]));

  // Overview
  const activeLearners = new Set(raw.sessions.map((session) => session.learner_id));
  const completed = raw.sessions.filter((session) => session.completed_at);
  const minutes = raw.sessions
    .filter((session) => session.ended_at)
    .map((session) => (new Date(session.ended_at as string).getTime() - new Date(session.started_at).getTime()) / 60_000)
    .filter((value) => value > 0 && value < 240);

  // Outcomes: replay each learner-concept evidence stream. Pre = after first evidence, post = final.
  const streams = new Map<string, Raw["evidence"]>();
  for (const row of [...raw.evidence].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = `${row.learner_id}:${row.concept_id}`;
    streams.set(key, [...(streams.get(key) ?? []), row]);
  }
  const gains: number[] = [];
  const pre: number[] = [];
  const post: number[] = [];
  const timeToMastery: number[] = [];
  for (const rows of streams.values()) {
    let state = emptyMastery;
    let first: number | null = null;
    let masteredAt: number | null = null;
    const start = new Date(rows[0].created_at).getTime();
    const bySecond = new Map<string, Raw["evidence"]>();
    for (const row of rows) bySecond.set(row.created_at.slice(0, 19), [...(bySecond.get(row.created_at.slice(0, 19)) ?? []), row]);
    for (const group of bySecond.values()) {
      const at = new Date(group[0].created_at).getTime();
      state = applyEvidence(state, group.map((row) => ({ signal: row.signal, strength: Number(row.value) })), { ...config, mastery: { ...config.mastery, decay_per_day: 0 } }, at);
      if (first === null) first = state.mastery;
      if (masteredAt === null && state.mastery >= config.mastery.unlock_threshold) masteredAt = at;
    }
    pre.push(first ?? 0);
    post.push(state.mastery);
    gains.push(state.mastery - (first ?? 0));
    if (masteredAt !== null) timeToMastery.push((masteredAt - start) / 60_000);
  }
  const calibrated = raw.evidence.filter((row) => row.signal === "calibrated").length;
  const overconfident = raw.evidence.filter((row) => row.signal === "overconfident").length;

  // Heatmap: learners by concepts.
  const topConcepts = [...new Set(raw.mastery.map((row) => row.concept_id))].slice(0, 14);
  const heatLearners = [...new Set(raw.mastery.map((row) => row.learner_id))].slice(0, 30);
  const heatmap = {
    concepts: topConcepts.map((id) => ({ id, name: conceptName.get(id) ?? "Concept" })),
    rows: heatLearners.map((learnerId) => ({
      learner: name(learnerId),
      values: topConcepts.map((conceptId) => {
        const row = raw.mastery.find((item) => item.learner_id === learnerId && item.concept_id === conceptId);
        return row ? Number(row.mastery) : null;
      }),
    })),
  };

  // Funnel.
  const withEvidence = new Set(raw.evidence.map((row) => row.learner_id));
  const withMission = new Set(completed.map((session) => session.learner_id));
  const missionsPerJourney = new Map<string, number>();
  for (const mission of raw.missions) missionsPerJourney.set(mission.journey_id, (missionsPerJourney.get(mission.journey_id) ?? 0) + 1);
  const finishedJourney = new Set(
    raw.journeys
      .filter((journey) => {
        const done = new Set(completed.filter((session) => session.journey_id === journey.id).map((session) => session.mission_id));
        return done.size > 0 && done.size >= (missionsPerJourney.get(journey.id) ?? Infinity);
      })
      .map((journey) => journey.learner_id),
  );
  const funnel = [
    { stage: "Started a mission", count: activeLearners.size },
    { stage: "Answered an activity", count: withEvidence.size },
    { stage: "Completed a mission", count: withMission.size },
    { stage: "Completed a journey", count: finishedJourney.size },
  ];

  // Friction: concepts where learners struggle most.
  const friction = [...new Set(raw.evidence.map((row) => row.concept_id))]
    .map((conceptId) => {
      const rows = raw.evidence.filter((row) => row.concept_id === conceptId);
      const hints = rows.filter((row) => row.signal === "hint_used").length;
      const errors = rows.filter((row) => row.signal === "wrong" || row.signal === "recall_fail").length;
      const attempts = rows.filter((row) => row.signal !== "hint_used").length;
      return { concept: conceptName.get(conceptId) ?? "Concept", hints, errors, attempts, friction: attempts ? (hints + errors) / attempts : 0 };
    })
    .filter((row) => row.attempts > 0)
    .sort((a, b) => b.friction - a.friction)
    .slice(0, 10);

  // Usage and performance from events.
  const llm = raw.events.filter((event) => event.type === "llm.call");
  const llmOk = llm.filter((event) => event.ok);
  const turns = raw.events.filter((event) => event.type === "turn.answer" && event.latency_ms !== null);
  const providers = new Map<string, number>();
  for (const event of llmOk) providers.set(event.provider ?? "unknown", (providers.get(event.provider ?? "unknown") ?? 0) + 1);
  const grounding = raw.events.filter((event) => event.type === "grounding.check");
  const asks = raw.events.filter((event) => event.type === "tutor.ask");
  const adaptations = raw.events.filter((event) => event.type === "adapt.decision");
  const ratings = raw.events.filter((event) => event.type === "reply.rated");
  const reasonCounts = new Map<string, number>();
  for (const event of adaptations) for (const code of (event.payload.reasons as string[] | undefined) ?? []) reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + 1);

  // Adaptation effectiveness: after a difficulty drop, does the next evidence show a gain?
  const byUser = new Map<string, Raw["events"]>();
  for (const event of raw.events.filter((item) => item.user_hash && (item.type === "adapt.decision" || item.type === "evidence.recorded"))) {
    byUser.set(event.user_hash as string, [...(byUser.get(event.user_hash as string) ?? []), event]);
  }
  let drops = 0;
  let recovered = 0;
  for (const list of byUser.values()) {
    const sorted = list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    sorted.forEach((event, index) => {
      if (event.type !== "adapt.decision" || !((event.payload.reasons as string[] | undefined) ?? []).includes("lower_difficulty")) return;
      const next = sorted.slice(index + 1).find((item) => item.type === "evidence.recorded");
      if (!next) return;
      drops += 1;
      if (Number(next.payload.delta ?? 0) > 0) recovered += 1;
    });
  }

  const errorsCount = raw.events.filter((event) => event.type === "error" || (!event.ok && event.type !== "llm.call")).length;
  const tokensIn = llmOk.reduce((sum, event) => sum + (event.tokens_in ?? 0), 0);
  const tokensOut = llmOk.reduce((sum, event) => sum + (event.tokens_out ?? 0), 0);
  const cost = llmOk.reduce((sum, event) => sum + Number(event.payload.cost_usd ?? 0), 0);
  // Voice and images, priced at list rates when made (media/pricing).
  const speech = raw.events.filter((event) => event.type === "voice.tts");
  const images = raw.events.filter((event) => event.type === "media.image");
  const mediaCost = (rows: Raw["events"]) => rows.filter((event) => event.ok).reduce((sum, event) => sum + Number(event.payload.cost_usd ?? 0), 0);
  // Re-engagement: nudges sent by the daily job, seen on the home page, and reviews started from the card.
  const count = (type: string) => raw.events.filter((event) => event.type === type).length;
  const nudgesSent = count("nudge.sent");
  const reviewsStarted = count("nudge.review_started");

  return {
    overview: {
      active_learners: activeLearners.size,
      sessions: raw.sessions.length,
      missions_completed: completed.length,
      completion_rate: raw.sessions.length ? completed.length / raw.sessions.length : 0,
      avg_mastery_gain: mean(gains),
      avg_session_minutes: mean(minutes),
      evidence_events: raw.evidence.length,
    },
    heatmap,
    funnel,
    friction,
    usage: {
      llm_calls: llm.length,
      llm_errors: llm.length - llmOk.length,
      fallback_calls: llmOk.filter((event) => event.payload.fallback_used).length,
      cached_calls: llmOk.filter((event) => event.payload.cached).length,
      llm_p50_ms: percentile(llmOk.map((event) => event.latency_ms ?? 0), 50),
      llm_p95_ms: percentile(llmOk.map((event) => event.latency_ms ?? 0), 95),
      turn_p50_ms: percentile(turns.map((event) => event.latency_ms ?? 0), 50),
      turn_p95_ms: percentile(turns.map((event) => event.latency_ms ?? 0), 95),
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      est_cost_usd: cost,
      providers: [...providers.entries()].map(([provider, calls]) => ({ provider, calls })),
      errors: errorsCount,
      tts_clips: speech.filter((event) => event.ok).length,
      tts_fallbacks: speech.filter((event) => !event.ok).length,
      tts_cost_usd: mediaCost(speech),
      images_made: images.filter((event) => event.ok).length,
      images_failed: images.filter((event) => !event.ok).length,
      image_cost_usd: mediaCost(images),
    },
    engagement: {
      nudges_sent: nudgesSent,
      nudges_seen: raw.events.filter((event) => event.type === "nudge.seen").reduce((sum, event) => sum + Number(event.payload.count ?? 1), 0),
      reviews_started: reviewsStarted,
      reviews_from_nudge: raw.events.filter((event) => event.type === "nudge.review_started" && event.payload.from_nudge).length,
      dismissed: count("nudge.dismissed"),
      // Share of sent nudges that led to a review. Reviews started without a nudge are counted separately.
      nudge_return_rate: nudgesSent ? raw.events.filter((event) => event.type === "nudge.review_started" && event.payload.from_nudge).length / nudgesSent : null,
    },
    quality: {
      grounding_pass_rate: grounding.length ? grounding.filter((event) => event.ok).length / grounding.length : null,
      grounding_checks: grounding.length,
      abstains: raw.events.filter((event) => event.type === "grounding.abstain").length,
      // Learners rate tutor replies useful or not. Only the verdict is stored, never the reply text.
      replies_rated: ratings.length,
      replies_useful_rate: ratings.length ? ratings.filter((event) => event.payload.useful === true).length / ratings.length : null,
      questions: asks.length,
      question_abstain_rate: asks.length ? asks.filter((event) => event.payload.abstained).length / asks.length : null,
      adaptations: adaptations.length,
      adaptation_reasons: [...reasonCounts.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
      recovery_rate: drops ? recovered / drops : null,
      recovery_sample: drops,
    },
    outcomes: {
      learner_concepts: gains.length,
      pre_mastery: mean(pre),
      post_mastery: mean(post),
      avg_gain: mean(gains),
      time_to_mastery_min: timeToMastery.length ? percentile(timeToMastery, 50) : null,
      reached_threshold: timeToMastery.length,
      calibration_rate: calibrated + overconfident ? calibrated / (calibrated + overconfident) : null,
      overconfident,
    },
    learners: raw.profiles.map((profile) => {
      const rows = raw.mastery.filter((row) => row.learner_id === profile.id);
      return {
        learner: name(profile.id),
        persona: profile.persona ?? "",
        language: profile.language_pref,
        demo: profile.is_demo,
        sessions: raw.sessions.filter((session) => session.learner_id === profile.id).length,
        missions_completed: completed.filter((session) => session.learner_id === profile.id).length,
        avg_mastery: mean(rows.map((row) => Number(row.mastery))),
        concepts_mastered: rows.filter((row) => Number(row.mastery) >= config.mastery.mastered_threshold).length,
      };
    }),
  };
}

export type Dashboard = ReturnType<typeof computeDashboard>;
