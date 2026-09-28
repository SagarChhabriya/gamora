// M3/M4 end-to-end check through the live API: signup, onboarding, ingest, plan, play one mission.
// Usage: node scripts/m3-check.mjs [baseUrl] [--keep]
import { randomUUID } from "node:crypto";

import { policySections } from "./fixtures/policy-text.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}

const base = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:3000";
const keep = process.argv.includes("--keep");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const email = `m3-check-${randomUUID().slice(0, 8)}@example.com`;
const password = `Check-${randomUUID()}`;
let userId;
let auth;

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300), status: response.status };
  }
}

async function turn(body) {
  const started = Date.now();
  const response = await fetch(`${base}/api/tutor/turn`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const events = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { events, ms: Date.now() - started, status: response.status };
}

/** A plausible learner: answers open questions with the concept name, picks the first option. */
function answerFor(activity, attempt) {
  switch (activity.type) {
    case "scenario":
    case "spot_error":
      return { choice_id: (activity.options ?? activity.steps)[attempt % (activity.options ?? activity.steps).length].id };
    case "ordering":
      return { order: activity.items.map((item) => item.id) };
    case "reflection":
      return { confidence: 4, reply: "I would check the documents more carefully." };
    default:
      return { reply: `${activity.title}: ${activity.sources?.[0]?.excerpt?.slice(0, 200) ?? "I would follow the policy steps."}` };
  }
}

try {
  const session = await json(
    await fetch(`${base}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name: "M3 Check" }),
    }),
  );
  if (!session.access_token) throw new Error(`signup failed ${JSON.stringify(session)}`);
  userId = session.user.id;
  auth = { Authorization: `Bearer ${session.access_token}` };
  console.log(keep ? `account ${email} / ${password}` : "signup ok");

  const onboard = await fetch(`${base}/api/profile`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ persona: "new_joiner", language_pref: "en", time_budget_min: 10, onboarding: { role: "Student", goal: "Handle real situations", prior: "new", time: "10", language: "en" } }),
  });
  console.log(`onboarding ${onboard.status}`);

  const text = policySections.slice(1, 9).map(([heading, body]) => `${heading}\n${body}`).join("\n\n");
  const started = Date.now();
  const created = await json(
    await fetch(`${base}/api/ingest`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ title: "Northwind CDD basics", text }) }),
  );
  let job = created.job;
  while (job && job.status !== "complete" && job.status !== "failed") {
    job = (await json(await fetch(`${base}/api/ingest/${created.content_id}/step`, { method: "POST", headers: auth }))).job;
  }
  console.log(`ingest ${job?.status} in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const planStarted = Date.now();
  const plan = await json(
    await fetch(`${base}/api/journeys`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ content_id: created.content_id }) }),
  );
  if (!plan.journey_id) throw new Error(`plan failed ${JSON.stringify(plan)}`);
  const journey = await json(await fetch(`${base}/api/journeys/${plan.journey_id}`, { headers: auth }));
  console.log(`journey (${plan.planner}) in ${((Date.now() - planStarted) / 1000).toFixed(1)} s: "${journey.journey.title}"`);
  for (const mission of journey.missions) console.log(`  M${mission.idx + 1} [${mission.status}] ${mission.title} / ${mission.activity_types.join(", ")}`);

  const mission = journey.missions[0];
  let result = await turn({ mission_id: mission.id, action: "start" });
  let activity = result.events.find((event) => event.type === "activity")?.activity;
  console.log(`start ${result.ms} ms -> ${activity?.type} "${activity?.title}" (${activity?.grounded})`);

  // Ask an out-of-scope question to prove the abstain path.
  const ask = await turn({ mission_id: mission.id, action: "ask", question: "What is the current mortgage interest rate for home loans?" });
  const answer = ask.events.find((event) => event.type === "answer");
  console.log(`ask (out of scope) ${ask.ms} ms -> abstained=${answer?.abstained}: ${answer?.text?.slice(0, 100)}`);

  let guard = 0;
  let attempt = 0;
  let complete = null;
  while (activity && guard < 20) {
    guard += 1;
    if (activity.type === "roleplay") {
      for (let index = 0; index < 3; index += 1) {
        result = await turn({ mission_id: mission.id, action: "answer", reply: "I would politely verify your identity with your original ID card first, then continue." });
        const character = result.events.find((event) => event.type === "character");
        if (character) console.log(`    ${character.name}: ${character.text.slice(0, 90)}`);
        if (result.events.some((event) => event.type === "feedback")) break;
      }
    } else {
      result = await turn({ mission_id: mission.id, action: "answer", ...answerFor(activity, attempt), response_ms: 20_000 });
    }
    const feedback = result.events.find((event) => event.type === "feedback");
    const reasons = result.events.filter((event) => event.type === "adaptation").flatMap((event) => event.reasons);
    const mastery = result.events.find((event) => event.type === "mastery");
    const xp = result.events.find((event) => event.type === "xp");
    const error = result.events.find((event) => event.type === "error");
    console.log(
      `  answer ${activity.type} ${result.ms} ms -> ${error ? `ERROR ${error.message}` : `correctness ${feedback?.correctness}`}${mastery ? ` mastery ${mastery.concepts[0].mastery.toFixed(2)}` : ""}${xp ? ` +${xp.gained}xp` : ""}${reasons.length ? ` WHY: ${reasons.map((reason) => reason.code).join(",")}` : ""}`,
    );
    if (error) break;
    const next = result.events.find((event) => event.type === "activity")?.activity;
    complete = result.events.find((event) => event.type === "mission_complete")?.summary ?? null;
    if (feedback && !feedback.done && !next) {
      attempt += 1;
      continue;
    }
    attempt = 0;
    if (next) console.log(`  next -> ${next.type} "${next.title}" L${next.difficulty} (${next.grounded})`);
    activity = next;
    if (complete) break;
  }
  console.log(complete ? `MISSION COMPLETE: mastery ${complete.mastery.toFixed(2)}, unlocked_next=${complete.unlocked_next}, xp ${complete.xp_earned}` : "mission not completed");
  const after = await json(await fetch(`${base}/api/journeys/${plan.journey_id}`, { headers: auth }));
  console.log(`map after: ${after.missions.map((item) => `M${item.idx + 1}:${item.status}`).join(" ")} / xp ${after.learner.xp} / badges ${after.learner.badges.map((badge) => badge.name).join(", ")}`);
} finally {
  if (userId && !keep) {
    await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, { method: "DELETE", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    console.log("temporary account deleted");
  }
}
