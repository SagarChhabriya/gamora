// Demo seed: panel accounts, two shared demo sources with planned journeys, and a synthetic cohort of
// 20 learners flagged is_demo (ADR-006). Synthetic data covers learner behaviour only. It never
// fabricates model calls, latency, or grounding events.
//
// Usage: node scripts/seed-demo.mjs [baseUrl] [--reset]
// Passwords: DEMO_ADMIN_PASSWORD and DEMO_LEARNER_PASSWORD from the environment, else generated and printed once.
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { cyberText } from "./fixtures/cyber-text.mjs";
import { policySections } from "./fixtures/policy-text.mjs";

const { defaultConfig } = await import(new URL("../src/lib/config/schema.ts", import.meta.url).href);
const { applyEvidence, emptyMastery } = await import(new URL("../src/lib/learner-model/mastery.ts", import.meta.url).href);
const { applyRewards, emptyGamification } = await import(new URL("../src/lib/gamification/rewards.ts", import.meta.url).href);

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}

const base = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:3000";
const reset = process.argv.includes("--reset");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const config = defaultConfig;

async function rest(path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...admin, ...(init.headers ?? {}) } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function authAdmin(path, init = {}) {
  const response = await fetch(`${url}/auth/v1/admin/${path}`, { ...init, headers: { ...admin, ...(init.headers ?? {}) } });
  const text = await response.text();
  return { ok: response.ok, status: response.status, body: text ? JSON.parse(text) : null };
}

async function findUser(email) {
  for (let page = 1; page <= 5; page += 1) {
    const { body } = await authAdmin(`users?page=${page}&per_page=200`);
    const user = body?.users?.find((item) => item.email === email);
    if (user) return user;
    if (!body?.users?.length) break;
  }
  return null;
}

async function ensureUser(email, password, displayName) {
  const existing = await findUser(email);
  if (existing) {
    await authAdmin(`users/${existing.id}`, { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) });
    return existing.id;
  }
  const created = await authAdmin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: displayName } }) });
  if (!created.ok) throw new Error(`create ${email}: ${JSON.stringify(created.body)}`);
  return created.body.id;
}

async function login(email, password) {
  const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const session = await response.json();
  if (!session.access_token) throw new Error(`login ${email}: ${JSON.stringify(session)}`);
  return { Authorization: `Bearer ${session.access_token}` };
}

async function ingest(auth, title, text) {
  const existing = await rest(`contents?title=eq.${encodeURIComponent(title)}&status=eq.ready&select=id&limit=1`);
  if (existing?.[0]) return existing[0].id;
  const created = await (await fetch(`${base}/api/ingest`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ title, text }) })).json();
  let job = created.job;
  while (job && job.status !== "complete" && job.status !== "failed") {
    job = (await (await fetch(`${base}/api/ingest/${created.content_id}/step`, { method: "POST", headers: auth })).json()).job;
  }
  if (job?.status !== "complete") throw new Error(`ingest ${title} failed`);
  return created.content_id;
}

async function planFor(auth, contentId) {
  const plan = await (await fetch(`${base}/api/journeys`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ content_id: contentId }) })).json();
  if (!plan.journey_id) throw new Error(`plan failed ${JSON.stringify(plan)}`);
  return plan.journey_id;
}

const password = () => randomBytes(12).toString("base64url");

// 1. Panel accounts.
const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? password();
const learnerPassword = process.env.DEMO_LEARNER_PASSWORD ?? password();
const adminEmail = "panel-admin@gamora.demo";
const learnerEmail = "panel-learner@gamora.demo";
const adminId = await ensureUser(adminEmail, adminPassword, "Gamora Admin");
const learnerId = await ensureUser(learnerEmail, learnerPassword, "Panel Learner");
await rest(`profiles?id=eq.${adminId}`, { method: "PATCH", body: JSON.stringify({ role: "admin", display_name: "Gamora Admin", onboarding: { role: "Admin", completed_at: new Date().toISOString() } }) });
await rest(`profiles?id=eq.${learnerId}`, {
  method: "PATCH",
  body: JSON.stringify({ display_name: "Panel Learner", persona: "new_joiner", language_pref: "en", time_budget_min: 15, onboarding: { role: "Student", goal: "Understand the basics", prior: "new", time: "15", language: "en", completed_at: new Date().toISOString() } }),
});
// The panel learner always starts the demo fresh: no sessions, mastery, evidence, or XP.
for (const table of ["sessions", "mastery", "evidence_events", "gamification"]) {
  await rest(`${table}?learner_id=eq.${learnerId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
console.log("panel accounts ready (panel learner progress reset)");

// 2. Shared demo sources and cached journeys.
const adminAuth = await login(adminEmail, adminPassword);
const bankId = await ingest(adminAuth, "Customer Due Diligence and Fraud Response (demo)", policySections.map(([heading, body]) => `${heading}\n${body}`).join("\n\n"));
const cyberId = await ingest(adminAuth, "Workplace Cyber Safety Basics (demo)", cyberText);
for (const id of [bankId, cyberId]) await rest(`contents?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ shared: true }) });
console.log("demo sources ingested and shared");

// 3. Synthetic cohort.
const demoProfiles = await rest("profiles?is_demo=eq.true&select=id");
if (reset && demoProfiles.length) {
  for (const profile of demoProfiles) await authAdmin(`users/${profile.id}`, { method: "DELETE" });
  console.log(`removed ${demoProfiles.length} demo learners`);
}
if (!reset && demoProfiles.length >= 20) {
  console.log("demo cohort already present (use --reset to rebuild)");
} else {
  // A template journey planned once through the real planner, copied for each demo learner.
  const templateJourney = (await rest(`journeys?learner_id=eq.${adminId}&content_id=eq.${bankId}&status=eq.ready&select=id&limit=1`))[0]?.id ?? (await planFor(adminAuth, bankId));
  const missions = await rest(`missions?journey_id=eq.${templateJourney}&select=idx,title,story,concept_ids,activities,unlock_rule&order=idx.asc`);
  const personas = ["new_joiner", "busy_rm", "expert", "low_bandwidth"];
  const rng = (() => {
    let seed = 42;
    return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  })();
  const now = Date.now();

  for (let index = 0; index < 20; index += 1) {
    const number = String(index + 1).padStart(2, "0");
    const persona = personas[index % 4];
    const language = index % 3 === 0 ? "roman_ur" : "en";
    const id = await ensureUser(`demo-${number}@gamora.demo`, password(), `Demo Learner ${number}`);
    await rest(`profiles?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ is_demo: true, display_name: `Demo Learner ${number}`, persona, language_pref: language, onboarding: { demo: true } }) });
    const journey = (await rest("journeys?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ content_id: bankId, learner_id: id, title: "Branch Day (demo)", language, persona, status: "ready", plan: { story_theme: "Synthetic demo journey", planner: "demo" } }) }))[0].id;
    const inserted = await rest("missions?select=id,idx,concept_ids,activities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(missions.map((mission) => ({ ...mission, journey_id: journey }))) });
    inserted.sort((a, b) => a.idx - b.idx);

    // Skill and drop-off vary by learner. Experts start stronger, learners short on time drop off more.
    const skill = persona === "expert" ? 0.8 : persona === "new_joiner" ? 0.45 : 0.6;
    const stamina = persona === "busy_rm" ? 0.55 : 0.85;
    const userHash = createHash("sha256").update(`gamora:${id}`).digest("hex").slice(0, 32);
    let day = now - (14 - Math.floor(rng() * 5)) * 86_400_000;
    let game = emptyGamification;
    const mastery = new Map();
    const evidenceRows = [];
    const eventRows = [];

    for (const mission of inserted) {
      const abandons = rng() > stamina + (mission.idx === 0 ? 0.1 : 0);
      const started = day + Math.floor(rng() * 6 * 3_600_000);
      const session = (await rest("sessions?select=id", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ learner_id: id, journey_id: journey, mission_id: mission.id, language, persona, mode: "text", started_at: new Date(started).toISOString(), state: { demo: true } }) }))[0].id;
      let at = started;
      let errorsInRow = 0;
      let learnedBoost = 0;
      for (const [position, activity] of mission.activities.entries()) {
        // Drop-off: some learners leave part way through a mission.
        if (abandons && position >= Math.max(1, Math.floor(mission.activities.length / 2))) break;
        at += 45_000 + Math.floor(rng() * 90_000);
        const hints = rng() < 0.25 ? 1 : 0;
        const p = Math.min(0.95, skill + learnedBoost - hints * 0.05);
        const correct = rng() < p;
        const signals =
          activity.type === "reflection"
            ? [{ signal: rng() < 0.7 ? "calibrated" : "overconfident", strength: rng() < 0.7 ? 0.3 : -0.3 }]
            : correct
              ? [{ signal: "correct", strength: hints ? 0.6 : 1 }, ...(activity.type === "scenario" || activity.type === "roleplay" ? [{ signal: "transfer", strength: 1 }] : [])]
              : rng() < 0.5
                ? [{ signal: "partial", strength: 0.4 }]
                : [{ signal: "wrong", strength: -1 }];
        if (hints) signals.push({ signal: "hint_used", strength: -0.3 });
        const before = mastery.get(activity.concept_id) ?? emptyMastery;
        const after = applyEvidence(before, signals, config, at);
        mastery.set(activity.concept_id, after);
        for (const signal of signals) evidenceRows.push({ session_id: session, learner_id: id, concept_id: activity.concept_id, signal: signal.signal, value: signal.strength, weight: config.mastery.evidence_weights[signal.signal] ?? 0.5, created_at: new Date(at).toISOString() });
        eventRows.push({ request_id: randomUUID(), user_hash: userHash, type: "evidence.recorded", payload: { demo: true, concept_id: activity.concept_id, delta: after.mastery - before.mastery }, created_at: new Date(at).toISOString() });
        game = applyRewards(game, { signals, activityType: activity.type }, config, new Date(at)).row;
        errorsInRow = correct ? 0 : errorsInRow + 1;
        if (errorsInRow >= 2) {
          // The policy would lower difficulty here, which makes the next item easier.
          learnedBoost += 0.15;
          errorsInRow = 0;
          eventRows.push({ request_id: randomUUID(), user_hash: userHash, type: "adapt.decision", payload: { demo: true, reasons: ["lower_difficulty"] }, created_at: new Date(at + 1_000).toISOString() });
        } else if (correct && rng() < 0.3) {
          eventRows.push({ request_id: randomUUID(), user_hash: userHash, type: "adapt.decision", payload: { demo: true, reasons: ["raise_difficulty"] }, created_at: new Date(at + 1_000).toISOString() });
        }
        learnedBoost += 0.03;
      }
      if (abandons) {
        await rest(`sessions?id=eq.${session}`, { method: "PATCH", body: JSON.stringify({ ended_at: new Date(at + 30_000).toISOString() }) });
        break;
      }
      const completedAt = new Date(at + 30_000).toISOString();
      await rest(`sessions?id=eq.${session}`, { method: "PATCH", body: JSON.stringify({ ended_at: completedAt, completed_at: completedAt }) });
      game = applyRewards(game, { signals: [], missionCompleted: true }, config, new Date(at)).row;
      const avg = mission.concept_ids.reduce((sum, conceptId) => sum + (mastery.get(conceptId)?.mastery ?? 0), 0) / Math.max(1, mission.concept_ids.length);
      if (avg < config.mastery.unlock_threshold && rng() < 0.5) break;
      day += (1 + Math.floor(rng() * 2)) * 86_400_000;
    }
    if (evidenceRows.length) await rest("evidence_events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(evidenceRows) });
    if (eventRows.length) await rest("events", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(eventRows) });
    if (mastery.size) {
      await rest("mastery?on_conflict=learner_id,concept_id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([...mastery.entries()].map(([conceptId, row]) => ({ learner_id: id, concept_id: conceptId, ...row }))),
      });
    }
    await rest("gamification?on_conflict=learner_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ learner_id: id, ...game }) });
    process.stdout.write(".");
  }
  console.log("\n20 demo learners seeded (is_demo = true)");
}

// 4. Cached demo journeys for the panel learner, so the demo survives an LLM outage.
const learnerAuth = await login(learnerEmail, learnerPassword);
for (const contentId of [bankId, cyberId]) {
  const existing = await rest(`journeys?learner_id=eq.${learnerId}&content_id=eq.${contentId}&status=eq.ready&select=id&limit=1`);
  if (!existing?.[0]) await planFor(learnerAuth, contentId);
}
console.log("panel learner journeys ready");
if (!process.env.DEMO_ADMIN_PASSWORD) console.log(`\nADMIN   ${adminEmail} / ${adminPassword}\nLEARNER ${learnerEmail} / ${learnerPassword}\nStore these now. Set DEMO_ADMIN_PASSWORD and DEMO_LEARNER_PASSWORD to keep them stable on reruns.`);
