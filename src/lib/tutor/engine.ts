import { z } from "zod";

import type { AuthUser } from "@/lib/auth/server";
import { getActiveConfig } from "@/lib/config/active";
import { personaLabels, personas, type ActivityType, type AppConfig, type Persona } from "@/lib/config/schema";
import { applyRewards, badgeCatalog, emptyGamification, starsFor, type GamificationRow } from "@/lib/gamification/rewards";
import { answerQuestion, generateGroundedActivity } from "@/lib/grounding/verify";
import { detectLanguage } from "@/lib/ingest/language";
import { applyEvidence, decayed, emptyMastery, type MasteryRow } from "@/lib/learner-model/mastery";
import { kvDel, kvGet, kvSet } from "@/lib/llm/cache";
import { logEvent } from "@/lib/observability/events";
import { supabaseRequest } from "@/lib/supabase/server";
import { toClientActivity } from "@/lib/tutor/activity";
import { evaluateAnswer, type LearnerAnswer } from "@/lib/tutor/evaluate";
import { decide, initialPolicyState } from "@/lib/tutor/policy";
import { retrieveForConcept } from "@/lib/tutor/retrieval";
import { historyFromTurns, stepKinds, withLessons, type HistoryItem, type Position, type TurnRow } from "@/lib/tutor/session";
import type { Activity, AdaptationReason, ClientActivity, Evaluation, Language, SessionState, SourceChunk } from "@/lib/tutor/types";

export const turnSchema = z.object({
  mission_id: z.string().uuid(),
  action: z.enum(["start", "practice", "continue", "answer", "hint", "ask", "set_language", "set_persona", "set_text_only"]),
  reply: z.string().max(2_000).optional(),
  choice_id: z.string().max(40).optional(),
  order: z.array(z.string().max(40)).max(10).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  question: z.string().max(600).optional(),
  language: z.enum(["en", "roman_ur"]).optional(),
  persona: z.enum(personas).optional(),
  text_only: z.boolean().optional(),
  response_ms: z.number().int().min(0).max(3_600_000).optional(),
});
export type TurnRequest = z.infer<typeof turnSchema>;

export type TurnEvent =
  | { type: "status"; text: string }
  | { type: "feedback"; text: string; correctness: number; done: boolean; sources: ClientActivity["sources"]; follow_up?: string }
  | { type: "character"; text: string; name: string }
  | { type: "hint"; text: string; remaining: number }
  | { type: "answer"; text: string; sources: ClientActivity["sources"]; abstained: boolean }
  | { type: "adaptation"; reasons: AdaptationReason[]; state: { difficulty: number; pace: string; modality: string; language: Language; persona: Persona; text_only: boolean } }
  | { type: "mastery"; concepts: Array<{ id: string; name: string; mastery: number; delta: number }> }
  | { type: "xp"; gained: number; total: number; streak: number; new_badges: Array<{ id: string; name: string; description: string }> }
  | { type: "activity"; activity: ClientActivity; position: Position }
  | { type: "history"; items: HistoryItem[] }
  | { type: "mission_complete"; summary: MissionSummary }
  | { type: "error"; message: string }
  | { type: "done"; session_id: string };

export type MissionSummary = {
  mission_id: string;
  title: string;
  mastery: number;
  unlocked_next: boolean;
  threshold: number;
  xp_earned: number;
  stars: number;
  concepts: Array<{ id: string; name: string; mastery: number }>;
};

type Mission = { id: string; journey_id: string; idx: number; title: string; story: string; concept_ids: string[]; activities: SessionState["queue"]; unlock_rule: { min_mastery?: number } };
type Journey = { id: string; learner_id: string; content_id: string; language: string; persona: string | null };
type Concept = { id: string; name: string; summary: string; difficulty: number; source_chunk_ids: string[]; content_id: string };
type SessionRow = { id: string; state: SessionState; language: string };

class TurnError extends Error {}

async function loadMissionContext(missionId: string, user: AuthUser) {
  const missions = await supabaseRequest<Mission[]>(`missions?id=eq.${missionId}&select=id,journey_id,idx,title,story,concept_ids,activities,unlock_rule`);
  const mission = missions?.[0];
  if (!mission) throw new TurnError("Mission not found");
  const journeys = await supabaseRequest<Journey[]>(`journeys?id=eq.${mission.journey_id}&select=id,learner_id,content_id,language,persona`);
  const journey = journeys?.[0];
  if (!journey || (journey.learner_id !== user.id && user.role !== "admin")) throw new TurnError("Mission not found");
  return { mission, journey };
}

async function loadConcepts(ids: string[]) {
  if (!ids.length) return new Map<string, Concept>();
  const rows = await supabaseRequest<Concept[]>(`concepts?id=in.(${[...new Set(ids)].join(",")})&select=id,name,summary,difficulty,source_chunk_ids,content_id`);
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

async function loadMastery(learnerId: string, conceptIds: string[]) {
  if (!conceptIds.length) return new Map<string, MasteryRow>();
  const rows = await supabaseRequest<Array<MasteryRow & { concept_id: string }>>(
    `mastery?learner_id=eq.${learnerId}&concept_id=in.(${[...new Set(conceptIds)].join(",")})&select=concept_id,mastery,confidence,evidence_count,last_seen`,
  );
  return new Map((rows ?? []).map((row) => [row.concept_id, { mastery: Number(row.mastery), confidence: Number(row.confidence), evidence_count: row.evidence_count, last_seen: row.last_seen }]));
}

async function loadGamification(learnerId: string): Promise<GamificationRow> {
  const rows = await supabaseRequest<GamificationRow[]>(`gamification?learner_id=eq.${learnerId}&select=xp,streak,best_streak,badges,last_active_on,stats`);
  const row = rows?.[0];
  return row ? { ...emptyGamification, ...row, badges: Array.isArray(row.badges) ? row.badges : [], stats: row.stats ?? {} } : emptyGamification;
}

async function saveState(sessionId: string, state: SessionState, extra: Record<string, unknown> = {}) {
  await supabaseRequest(`sessions?id=eq.${sessionId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ state, language: state.language, ...extra }),
  });
}

async function nextTurnIdx(sessionId: string) {
  const rows = await supabaseRequest<Array<{ idx: number }>>(`turns?session_id=eq.${sessionId}&select=idx&order=idx.desc&limit=1`);
  return (rows?.[0]?.idx ?? -1) + 1;
}

async function writeTurns(sessionId: string, turns: Array<{ role: "assistant" | "learner" | "system"; activity_type?: string; content: unknown; source_chunk_ids?: string[]; latency_ms?: number }>) {
  if (!turns.length) return;
  const start = await nextTurnIdx(sessionId);
  await supabaseRequest("turns", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(
      turns.map((turn, offset) => ({
        session_id: sessionId,
        idx: start + offset,
        role: turn.role,
        activity_type: turn.activity_type ?? null,
        content: turn.content,
        source_chunk_ids: turn.source_chunk_ids ?? [],
        latency_ms: turn.latency_ms ?? null,
      })),
    ),
  });
}

/**
 * The learner's latest session for this mission, finished or not. A finished mission stays finished
 * across reloads; only an explicit practice request opens a new session after completion.
 */
async function getOrCreateSession(input: { user: AuthUser; mission: Mission; journey: Journey; config: AppConfig; persona: Persona; language: Language; textOnly: boolean; practice: boolean }) {
  const existing = await supabaseRequest<SessionRow[]>(
    `sessions?learner_id=eq.${input.user.id}&mission_id=eq.${input.mission.id}&select=id,state,language&order=started_at.desc&limit=1`,
  );
  const latest = existing?.[0];
  if (latest?.state?.queue && !(input.practice && latest.state.completed)) return latest;
  const state: SessionState = {
    ...initialPolicyState(input.persona, input.language, input.config),
    mission_id: input.mission.id,
    journey_id: input.journey.id,
    persona: input.persona,
    queue: (input.mission.activities ?? []).filter((item) => input.config.mechanics.enabled_activities.includes(item.type as ActivityType)),
    index: 0,
    current: null,
    prefetched: null,
    attempts: 0,
    hints_used: 0,
    roleplay_turns: [],
    evidence: [],
    asked_at: Date.now(),
    completed: false,
    xp_earned: 0,
    reasons: [],
    text_only: input.textOnly,
  };
  if (!state.queue.length) state.queue = input.mission.concept_ids.map((id) => ({ type: "explain_ask" as ActivityType, concept_id: id, intent: "introduce" }));
  state.queue = withLessons(state.queue);
  const rows = await supabaseRequest<SessionRow[]>("sessions?select=id,state,language", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      learner_id: input.user.id,
      journey_id: input.journey.id,
      mission_id: input.mission.id,
      language: input.language,
      mode: "text",
      persona: input.persona,
      state,
    }),
  });
  const session = rows?.[0];
  if (!session) throw new TurnError("Could not start a session");
  return session;
}

function prefetchKey(sessionId: string, index: number, state: SessionState) {
  return `prefetch:${sessionId}:${index}:${state.difficulty}:${state.language}:${state.persona}:${state.worked_example ? 1 : 0}`;
}

type Ctx = {
  user: AuthUser;
  requestId: string;
  config: AppConfig;
  journey: Journey;
  mission: Mission;
  concepts: Map<string, Concept>;
};

async function chunksFor(concept: Concept) {
  return retrieveForConcept({ contentId: concept.content_id, sourceChunkIds: concept.source_chunk_ids, query: concept.name, limit: 4 });
}

/** Generates, verifies, and if needed regenerates or abstains. */
async function buildActivity(ctx: Ctx, state: SessionState, index: number): Promise<{ activity: Activity; chunks: SourceChunk[] }> {
  const item = state.queue[index];
  const concept = ctx.concepts.get(item.concept_id) ?? (await loadConcepts([item.concept_id])).get(item.concept_id);
  if (!concept) throw new TurnError("Concept not found for this activity");
  ctx.concepts.set(concept.id, concept);
  const chunks = await chunksFor(concept);
  const recentReply = state.roleplay_turns.filter((turn) => turn.role === "learner").at(-1)?.text;
  const input = {
    type: state.text_only && item.type === "roleplay" ? ("scenario" as ActivityType) : item.type,
    concept: { id: concept.id, name: concept.name, summary: concept.summary },
    chunks,
    difficulty: state.difficulty,
    pace: state.pace,
    modality: state.modality,
    language: state.language,
    persona: state.persona,
    intent: item.intent,
    workedExample: state.worked_example,
    learnerContext: recentReply,
    config: ctx.config,
    requestId: ctx.requestId,
    userHash: ctx.user.userHash,
  };
  const started = Date.now();
  const activity = await generateGroundedActivity(input, (check) =>
    logEvent({
      request_id: ctx.requestId,
      user_hash: ctx.user.userHash,
      type: "grounding.check",
      latency_ms: Date.now() - started,
      ok: check.ok,
      payload: { activity_type: check.type, checked: check.checked, unsupported: check.unsupported.length, attempt: check.attempt, strictness: ctx.config.grounding.verifier },
    }).then(() => undefined),
  );
  if (activity.grounded === "abstained") {
    await logEvent({ request_id: ctx.requestId, user_hash: ctx.user.userHash, type: "grounding.abstain", payload: { concept_id: concept.id } });
  }
  return { activity, chunks };
}

async function allChunks(ids: string[]) {
  if (!ids.length) return [];
  return (await supabaseRequest<Array<{ id: string; idx: number; text: string }>>(`chunks?id=in.(${[...new Set(ids)].join(",")})&select=id,idx,text`)) ?? [];
}

async function clientSources(ids: string[]) {
  const chunks = await allChunks(ids);
  return ids
    .map((id) => chunks.find((chunk) => chunk.id === id))
    .filter((chunk): chunk is { id: string; idx: number; text: string } => Boolean(chunk))
    .map((chunk) => ({ id: chunk.id, label: `Source ${chunk.idx + 1}`, excerpt: chunk.text.slice(0, 280) }));
}

function adaptationEvent(state: SessionState, reasons: AdaptationReason[]): TurnEvent {
  return {
    type: "adaptation",
    reasons,
    state: { difficulty: state.difficulty, pace: state.pace, modality: state.modality, language: state.language, persona: state.persona, text_only: state.text_only },
  };
}

function positionOf(state: SessionState): Position {
  return { index: state.index, total: state.queue.length, steps: stepKinds(state.queue) };
}

/** The conversation so far, so a reload shows everything the learner already did. */
async function sessionHistory(sessionId: string) {
  const turns = (await supabaseRequest<TurnRow[]>(`turns?session_id=eq.${sessionId}&select=role,activity_type,content,source_chunk_ids&order=idx.asc&limit=400`)) ?? [];
  const chunks = await allChunks(turns.filter((turn) => !turn.content?.activity).flatMap((turn) => turn.source_chunk_ids ?? []));
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return historyFromTurns(turns, (ids) =>
    ids
      .map((id) => byId.get(id))
      .filter((chunk): chunk is { id: string; idx: number; text: string } => Boolean(chunk))
      .map((chunk) => ({ id: chunk.id, label: `Source ${chunk.idx + 1}`, excerpt: chunk.text.slice(0, 280) })),
  );
}

async function stats(learnerId: string): Promise<TurnEvent> {
  const row = await loadGamification(learnerId);
  return { type: "xp", gained: 0, total: row.xp, streak: row.streak, new_badges: [] };
}

async function presentActivity(ctx: Ctx, session: SessionRow, state: SessionState): Promise<TurnEvent[]> {
  const key = prefetchKey(session.id, state.index, state);
  const cached = await kvGet<{ activity: Activity; chunkIds: string[] }>(key);
  let activity: Activity;
  let chunkIds: string[];
  if (cached) {
    activity = cached.activity;
    chunkIds = cached.chunkIds;
    await kvDel(key);
  } else {
    const built = await buildActivity(ctx, state, state.index);
    activity = built.activity;
    chunkIds = built.chunks.map((chunk) => chunk.id);
  }
  state.current = activity;
  state.attempts = 0;
  state.hints_used = 0;
  state.roleplay_turns = activity.roleplay ? [{ role: "character", text: activity.roleplay.opening }] : [];
  state.asked_at = Date.now();
  state.worked_example = false;
  await saveState(session.id, state);
  const sourceChunks = await allChunks([...activity.source_chunk_ids, ...chunkIds]);
  const client = toClientActivity(activity, sourceChunks);
  const position = positionOf(state);
  await writeTurns(session.id, [{ role: "assistant", activity_type: activity.type, content: { activity: client, grounded: activity.grounded, position }, source_chunk_ids: activity.source_chunk_ids }]);
  return [{ type: "activity", activity: client, position }];
}

/** Prefetch the next activity while the learner works on this one (architecture 7.7). */
export async function prefetchNext(ctx: Ctx, sessionId: string, state: SessionState) {
  const next = state.index + 1;
  if (next >= state.queue.length) return;
  const key = prefetchKey(sessionId, next, state);
  if (await kvGet(key)) return;
  try {
    const built = await buildActivity(ctx, state, next);
    await kvSet(key, { activity: built.activity, chunkIds: built.chunks.map((chunk) => chunk.id) }, 1_800);
  } catch {
    // Prefetch is best effort.
  }
}

async function recordEvidence(ctx: Ctx, sessionId: string, conceptId: string, evaluation: Evaluation) {
  if (!evaluation.signals.length) return null;
  const masteryMap = await loadMastery(ctx.user.id, [conceptId]);
  const before = masteryMap.get(conceptId) ?? emptyMastery;
  const beforeValue = decayed(before, ctx.config);
  const after = applyEvidence(before, evaluation.signals, ctx.config);
  await supabaseRequest("evidence_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(
      evaluation.signals.map((signal) => ({
        session_id: sessionId,
        learner_id: ctx.user.id,
        concept_id: conceptId,
        signal: signal.signal,
        value: signal.strength,
        weight: ctx.config.mastery.evidence_weights[signal.signal] ?? 0.5,
      })),
    ),
  });
  await supabaseRequest("mastery?on_conflict=learner_id,concept_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ learner_id: ctx.user.id, concept_id: conceptId, ...after }),
  });
  return { before: beforeValue, after: after.mastery };
}

async function missionSummary(ctx: Ctx, state: SessionState): Promise<MissionSummary> {
  const masteryMap = await loadMastery(ctx.user.id, ctx.mission.concept_ids);
  const concepts = ctx.mission.concept_ids.map((id) => ({
    id,
    name: ctx.concepts.get(id)?.name ?? "Concept",
    mastery: decayed(masteryMap.get(id) ?? emptyMastery, ctx.config),
  }));
  const mastery = concepts.length ? concepts.reduce((sum, concept) => sum + concept.mastery, 0) / concepts.length : 0;
  const threshold = ctx.mission.unlock_rule?.min_mastery ?? ctx.config.mastery.unlock_threshold;
  return { mission_id: ctx.mission.id, title: ctx.mission.title, mastery, unlocked_next: mastery >= threshold, threshold, xp_earned: state.xp_earned, stars: starsFor(mastery, threshold, ctx.config), concepts };
}

async function countMastered(learnerId: string, config: AppConfig) {
  const rows = await supabaseRequest<Array<{ concept_id: string }>>(`mastery?learner_id=eq.${learnerId}&mastery=gte.${config.mastery.mastered_threshold}&select=concept_id`);
  return rows?.length ?? 0;
}

async function reward(ctx: Ctx, input: { signals: Evaluation["signals"]; activityType?: string; missionCompleted?: boolean }): Promise<TurnEvent | null> {
  if (!input.signals.length && !input.missionCompleted) return null;
  const row = await loadGamification(ctx.user.id);
  const mastered = await countMastered(ctx.user.id, ctx.config);
  const result = applyRewards(row, { ...input, masteredCount: mastered }, ctx.config);
  await supabaseRequest("gamification?on_conflict=learner_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ learner_id: ctx.user.id, ...result.row }),
  });
  if (result.newBadges.length) {
    await logEvent({ request_id: ctx.requestId, user_hash: ctx.user.userHash, type: "gamification.badge", payload: { badges: result.newBadges } });
  }
  return {
    type: "xp",
    gained: result.gained,
    total: result.row.xp,
    streak: result.row.streak,
    new_badges: result.newBadges.map((id) => ({ id, ...badgeCatalog[id] })),
  };
}

async function completeMission(ctx: Ctx, session: SessionRow, state: SessionState): Promise<TurnEvent[]> {
  state.completed = true;
  state.current = null;
  const xp = await reward(ctx, { signals: [], missionCompleted: true });
  if (xp?.type === "xp") state.xp_earned += xp.gained;
  const summary = await missionSummary(ctx, state);
  await saveState(session.id, state, { ended_at: new Date().toISOString(), completed_at: new Date().toISOString() });
  await logEvent({
    request_id: ctx.requestId,
    user_hash: ctx.user.userHash,
    type: "mission.complete",
    payload: { mission_id: ctx.mission.id, journey_id: ctx.journey.id, mastery: summary.mastery, unlocked_next: summary.unlocked_next, xp: state.xp_earned },
  });
  return [...(xp ? [xp] : []), { type: "mission_complete", summary }];
}

function wordCount(text?: string) {
  return (text ?? "").trim().split(/\s+/).filter(Boolean).length;
}

/** Runs one tutor turn and yields events as they become ready, so the client can render progressively. */
export async function* runTurn(user: AuthUser, body: TurnRequest, requestId: string): AsyncGenerator<TurnEvent> {
  const started = Date.now();
  const [{ config }, { mission, journey }, profileRows] = await Promise.all([
    getActiveConfig(),
    loadMissionContext(body.mission_id, user),
    supabaseRequest<Array<{ persona: string | null; language_pref: string }>>(`profiles?id=eq.${user.id}&select=persona,language_pref`),
  ]);
  const persona = (personas as readonly string[]).includes(profileRows?.[0]?.persona ?? "") ? (profileRows?.[0]?.persona as Persona) : config.learner.default_persona;
  const language: Language = journey.language === "roman_ur" || profileRows?.[0]?.language_pref === "roman_ur" ? "roman_ur" : "en";
  const [concepts, session] = await Promise.all([
    loadConcepts([...mission.concept_ids, ...(mission.activities ?? []).map((item) => item.concept_id)]),
    getOrCreateSession({ user, mission, journey, config, persona, language, textOnly: persona === "low_bandwidth" || config.ui.text_only_default, practice: body.action === "practice" }),
  ]);
  const ctx: Ctx = { user, requestId, config, journey, mission, concepts };
  const state = session.state;

  if (body.action === "start" || body.action === "practice") {
    const [history, xp] = await Promise.all([sessionHistory(session.id), stats(user.id)]);
    yield xp;
    if (history.length) yield { type: "history", items: history };
    if (state.completed) {
      yield adaptationEvent(state, []);
      yield { type: "mission_complete", summary: await missionSummary(ctx, state) };
    } else if (state.current) {
      const sources = await allChunks(state.current.source_chunk_ids);
      yield adaptationEvent(state, []);
      // The history already holds this activity and its replies; this event makes it the active card.
      yield { type: "activity", activity: toClientActivity(state.current, sources), position: positionOf(state) };
    } else {
      yield { type: "status", text: "Preparing your first activity..." };
      yield adaptationEvent(state, []);
      for (const event of await presentActivity(ctx, session, state)) yield event;
    }
    yield { type: "done", session_id: session.id };
    await logEvent({ request_id: requestId, user_hash: user.userHash, type: "turn.start", latency_ms: Date.now() - started, payload: { mission_id: mission.id } });
    return;
  }

  if (body.action === "set_language" || body.action === "set_persona" || body.action === "set_text_only") {
    const reasons: AdaptationReason[] = [];
    if (body.action === "set_language" && body.language && body.language !== state.language) {
      state.language = body.language;
      reasons.push({ code: "language_switch", text: body.language === "roman_ur" ? "Switched to Roman Urdu. Technical terms stay in English." : "Switched to English." });
      await supabaseRequest(`profiles?id=eq.${user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ language_pref: body.language }) });
    }
    if (body.action === "set_persona" && body.persona && body.persona !== state.persona) {
      const fresh = initialPolicyState(body.persona, state.language, config);
      state.persona = body.persona;
      state.difficulty = fresh.difficulty;
      state.pace = fresh.pace;
      state.text_only = body.persona === "low_bandwidth" ? true : state.text_only;
      reasons.push({ code: "persona_switch", text: `Adapting for ${personaLabels[body.persona].toLowerCase()}: level ${fresh.difficulty}, ${fresh.pace} pace.` });
      await supabaseRequest(`profiles?id=eq.${user.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ persona: body.persona }) });
    }
    if (body.action === "set_text_only" && typeof body.text_only === "boolean" && body.text_only !== state.text_only) {
      state.text_only = body.text_only;
      reasons.push({ code: "text_only", text: body.text_only ? "Text only mode on. Voice and heavy content are off." : "Voice and rich content back on." });
    }
    await logEvent({ request_id: requestId, user_hash: user.userHash, type: "adapt.decision", payload: { mission_id: mission.id, reasons: reasons.map((reason) => reason.code), manual: true } });
    state.reasons = [...state.reasons, ...reasons].slice(-10);
    yield adaptationEvent(state, reasons);
    // Visible adaptation in the same turn: regenerate the unanswered activity in the new mode.
    if (reasons.length && state.current && !state.completed && state.attempts === 0 && body.action !== "set_text_only") {
      yield { type: "status", text: "Adapting this activity..." };
      for (const event of await presentActivity(ctx, session, state)) yield event;
    } else {
      await saveState(session.id, state);
    }
    yield { type: "done", session_id: session.id };
    return;
  }

  if (body.action === "continue") {
    // The learner finished reading a lesson. Lessons are never scored, so no evidence or XP.
    if (!state.current || state.current.type !== "lesson" || state.completed) throw new TurnError("Nothing to continue here. Reload the mission.");
    await writeTurns(session.id, [{ role: "learner", activity_type: "lesson", content: { continue: true } }]);
    state.index += 1;
    if (state.index >= state.queue.length) for (const event of await completeMission(ctx, session, state)) yield event;
    else {
      yield { type: "status", text: state.language === "roman_ur" ? "Aapka check tayyar ho raha hai..." : "Preparing your check..." };
      for (const event of await presentActivity(ctx, session, state)) yield event;
    }
    yield { type: "done", session_id: session.id };
    return;
  }

  if (body.action === "hint") {
    const activity = state.current;
    if (!activity) throw new TurnError("No active activity");
    const hint = activity.hints[state.hints_used] ?? activity.hints.at(-1) ?? "Look again at the source excerpt below the activity.";
    state.hints_used += 1;
    await saveState(session.id, state);
    await writeTurns(session.id, [{ role: "assistant", activity_type: "hint", content: { hint } }]);
    yield { type: "hint", text: hint, remaining: Math.max(0, activity.hints.length - state.hints_used) };
    yield { type: "done", session_id: session.id };
    return;
  }

  if (body.action === "ask") {
    const question = (body.question ?? "").trim();
    if (!question) throw new TurnError("Type a question first");
    const pool = [...concepts.values()].filter((concept) => mission.concept_ids.includes(concept.id));
    const contentId = pool[0]?.content_id ?? journey.content_id;
    const chunks = await retrieveForConcept({ contentId, sourceChunkIds: pool.flatMap((concept) => concept.source_chunk_ids).slice(0, 2), query: question, limit: 5 });
    const result = await answerQuestion({ question, chunks, config, persona: state.persona, language: state.language, pace: state.pace, requestId, userHash: user.userHash });
    await writeTurns(session.id, [
      { role: "learner", activity_type: "ask", content: { question } },
      { role: "assistant", activity_type: "ask", content: { answer: result.text, abstained: result.abstained }, source_chunk_ids: result.source_chunk_ids },
    ]);
    await logEvent({ request_id: requestId, user_hash: user.userHash, type: "tutor.ask", latency_ms: Date.now() - started, payload: { abstained: result.abstained, cited: result.source_chunk_ids.length } });
    yield { type: "answer", text: result.text, sources: await clientSources(result.source_chunk_ids), abstained: result.abstained };
    yield { type: "done", session_id: session.id };
    return;
  }

  // action === "answer"
  const activity = state.current;
  if (!activity || state.completed) throw new TurnError("No active activity. Start the mission first.");
  if (activity.type === "lesson") throw new TurnError("This step is a lesson. Tap Got it to continue.");
  const answer: LearnerAnswer = { reply: body.reply, choice_id: body.choice_id, order: body.order, confidence: body.confidence };
  const activityConcept = concepts.get(activity.concept_id) ?? (await loadConcepts([activity.concept_id])).get(activity.concept_id);
  if (!activityConcept) throw new TurnError("Concept not found for this activity");
  const [chunks, masteryMap] = await Promise.all([chunksFor(activityConcept), loadMastery(user.id, [activity.concept_id])]);
  const masteryNow = decayed(masteryMap.get(activity.concept_id) ?? emptyMastery, config);
  yield { type: "status", text: activity.type === "roleplay" ? "..." : "Reading your answer..." };

  let evaluation: Evaluation;
  try {
    evaluation = await evaluateAnswer({
      activity,
      answer,
      attempts: state.attempts,
      hintsUsed: state.hints_used,
      chunks,
      mastery: masteryNow,
      config,
      persona: state.persona,
      language: state.language,
      pace: state.pace,
      roleplayTurns: state.roleplay_turns,
      requestId,
      userHash: user.userHash,
    });
  } catch (error) {
    if (error instanceof Error && /^(Choose|Pick|Place|Write|Say)/.test(error.message)) throw new TurnError(error.message);
    // Evaluator unavailable: accept the reply as partial evidence, never block the learner.
    evaluation = {
      correctness: 0.5,
      points_hit: [],
      points_missed: [],
      self_correction: false,
      signals: [{ signal: "partial", strength: 0.4 }],
      feedback_text: state.language === "roman_ur" ? "Shukriya. Main is waqt poori tarah check nahi kar saki, lekin chaliye aage barhte hain." : "Thanks. I could not fully check that just now, so let us keep going.",
      source_chunk_ids: activity.source_chunk_ids,
      done: true,
    };
  }

  const replyText = body.reply ?? "";
  await writeTurns(session.id, [
    { role: "learner", activity_type: activity.type, content: { reply: replyText.slice(0, 2_000), choice_id: body.choice_id, order: body.order, confidence: body.confidence } },
    {
      role: "assistant",
      activity_type: `${activity.type}.feedback`,
      content: {
        feedback: evaluation.feedback_text,
        correctness: evaluation.correctness,
        signals: evaluation.signals,
        follow_up: evaluation.follow_up,
        // A role-play reply that is not the debrief is the character speaking, not feedback.
        character: activity.type === "roleplay" && !evaluation.done ? (activity.roleplay?.character ?? "") : undefined,
      },
      source_chunk_ids: evaluation.source_chunk_ids,
      latency_ms: Date.now() - started,
    },
  ]);

  if (activity.type === "roleplay" && !evaluation.done) {
    state.roleplay_turns = [...state.roleplay_turns, { role: "learner", text: replyText }, { role: "character", text: evaluation.feedback_text }];
    await saveState(session.id, state);
    yield { type: "character", text: evaluation.feedback_text, name: activity.roleplay?.character ?? "" };
    yield { type: "done", session_id: session.id };
    return;
  }

  yield {
    type: "feedback",
    text: evaluation.feedback_text,
    correctness: evaluation.correctness,
    done: evaluation.done,
    sources: await clientSources(evaluation.source_chunk_ids),
    follow_up: evaluation.follow_up,
  };

  // Evidence, mastery, and rewards.
  const change = await recordEvidence(ctx, session.id, activity.concept_id, evaluation);
  if (change) {
    yield { type: "mastery", concepts: [{ id: activity.concept_id, name: activity.concept_name, mastery: change.after, delta: change.after - change.before }] };
    await logEvent({ request_id: requestId, user_hash: user.userHash, type: "evidence.recorded", payload: { concept_id: activity.concept_id, signals: evaluation.signals.map((signal) => signal.signal), mastery: change.after, delta: change.after - change.before } });
  }
  const xp = await reward(ctx, { signals: evaluation.signals, activityType: activity.type });
  if (xp?.type === "xp") {
    state.xp_earned += xp.gained;
    yield xp;
  }

  if (!evaluation.done) {
    state.attempts += 1;
    await saveState(session.id, state);
    yield { type: "done", session_id: session.id };
    return;
  }

  // Adaptation decision for the next activity.
  const correct = evaluation.correctness >= (activity.type === "spaced_recall" ? 0.6 : 0.8);
  if (activity.type !== "reflection") {
    state.evidence = [
      ...state.evidence,
      { concept_id: activity.concept_id, signal: evaluation.signals[0]?.signal ?? "partial", correct, hints: state.hints_used, at: Date.now() },
    ].slice(-12);
  }
  const replyLanguage = replyText ? detectLanguage(replyText) : undefined;
  const decision = decide({
    state,
    persona: state.persona,
    evidence: state.evidence,
    last: activity.type === "reflection" ? undefined : {
      correct,
      partial: evaluation.correctness >= 0.4 && !correct,
      hints: state.hints_used,
      responseMs: body.response_ms ?? Date.now() - state.asked_at,
      replyWords: wordCount(replyText),
      replyLanguage: replyLanguage === "ur" ? "roman_ur" : replyLanguage,
      selfCorrected: evaluation.self_correction || evaluation.signals.some((signal) => signal.signal === "self_corrected"),
      overconfident: evaluation.signals.some((signal) => signal.signal === "overconfident"),
    },
    config,
  });
  state.difficulty = decision.difficulty;
  state.pace = decision.pace;
  state.modality = decision.modality;
  state.language = decision.language;
  state.worked_example = decision.worked_example;
  state.reasons = [...state.reasons, ...decision.reasons].slice(-10);
  const nextIndex = state.index + 1;
  if (decision.override && nextIndex < state.queue.length && config.mechanics.enabled_activities.includes(decision.override)) {
    const upcoming = state.queue[nextIndex];
    if (["explain_ask", "teach_back"].includes(upcoming.type)) state.queue[nextIndex] = { ...upcoming, type: decision.override, intent: "guided practice with choices" };
  }
  // A confident reflection that does not match the evidence schedules a revisit (policy rule 7).
  if (activity.type === "reflection" && evaluation.signals.some((signal) => signal.signal === "overconfident")) {
    decision.revisit = activity.concept_id;
    decision.reasons.push({ code: "revisit", text: "I will bring this idea back once more later, so it sticks." });
  }
  if (decision.revisit && config.mechanics.enabled_activities.includes("spaced_recall")) {
    state.queue.push({ type: "spaced_recall", concept_id: decision.revisit, intent: "revisit after overconfidence" });
  }
  if (decision.reasons.length) {
    await logEvent({ request_id: requestId, user_hash: user.userHash, type: "adapt.decision", payload: { mission_id: mission.id, reasons: decision.reasons.map((reason) => reason.code), difficulty: state.difficulty, pace: state.pace, modality: state.modality, language: state.language } });
  }
  yield adaptationEvent(state, decision.reasons);

  state.index = nextIndex;
  if (state.index >= state.queue.length) {
    for (const event of await completeMission(ctx, session, state)) yield event;
  } else {
    for (const event of await presentActivity(ctx, session, state)) yield event;
  }
  await logEvent({ request_id: requestId, user_hash: user.userHash, type: "turn.answer", latency_ms: Date.now() - started, payload: { mission_id: mission.id, activity_type: activity.type, correctness: evaluation.correctness } });
  yield { type: "done", session_id: session.id };
}

/** Called after a response is sent: loads the session and prefetches the next activity. */
export async function schedulePrefetch(user: AuthUser, missionId: string, requestId: string) {
  try {
    const { config } = await getActiveConfig();
    const { mission, journey } = await loadMissionContext(missionId, user);
    const sessions = await supabaseRequest<SessionRow[]>(
      `sessions?learner_id=eq.${user.id}&mission_id=eq.${missionId}&ended_at=is.null&select=id,state,language&order=started_at.desc&limit=1`,
    );
    const session = sessions?.[0];
    if (!session?.state?.current || session.state.completed) return;
    const concepts = await loadConcepts((mission.activities ?? []).map((item) => item.concept_id));
    await prefetchNext({ user, requestId, config, journey, mission, concepts }, session.id, session.state);
  } catch {
    // Best effort.
  }
}

export { TurnError };
