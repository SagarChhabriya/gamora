// M7 exit check: analytics, CSV export, config change applied on the next learner turn, rollback.
// Usage: DEMO_ADMIN_PASSWORD=... DEMO_LEARNER_PASSWORD=... node scripts/m7-check.mjs [baseUrl]
try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}
const base = process.argv.find((arg) => arg.startsWith("http")) ?? "http://localhost:3000";

async function login(email, password) {
  const session = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) })).json();
  if (!session.access_token) throw new Error(`login failed for ${email}`);
  return { Authorization: `Bearer ${session.access_token}` };
}

const adminAuth = await login("panel-admin@gamora.demo", process.env.DEMO_ADMIN_PASSWORD);
const learnerAuth = await login("panel-learner@gamora.demo", process.env.DEMO_LEARNER_PASSWORD);

const analytics = await (await fetch(`${base}/api/admin/analytics?cohort=all`, { headers: adminAuth })).json();
const d = analytics.dashboard;
console.log(`analytics: ${d.overview.active_learners} active, completion ${Math.round(d.overview.completion_rate * 100)}%, gain +${Math.round(d.overview.avg_mastery_gain * 100)}, heatmap ${d.heatmap.rows.length}x${d.heatmap.concepts.length}, friction top: ${d.friction[0]?.concept}`);
const csv = await (await fetch(`${base}/api/admin/export?table=mastery&cohort=demo`, { headers: adminAuth })).text();
console.log(`csv mastery: ${csv.split("\n").length - 2} rows, header: ${csv.split("\n")[0]}`);
const forbidden = await fetch(`${base}/api/admin/analytics`, { headers: learnerAuth });
console.log(`learner calling admin analytics -> ${forbidden.status} (expect 403)`);

const current = await (await fetch(`${base}/api/admin/config`, { headers: adminAuth })).json();
const next = structuredClone(current.active);
next.difficulty.min = 4;
next.difficulty.max = 4;
next.tone.persona_name = "Zara";
const saved = await (await fetch(`${base}/api/admin/config`, { method: "POST", headers: { ...adminAuth, "Content-Type": "application/json" }, body: JSON.stringify({ config: next, note: "M7 check: lock difficulty at 4" }) })).json();
console.log(`saved config v${saved.version}: ${saved.diff.map((change) => change.path).join(", ")}`);
const invalid = await fetch(`${base}/api/admin/config`, { method: "POST", headers: { ...adminAuth, "Content-Type": "application/json" }, body: JSON.stringify({ config: { ...next, difficulty: { ...next.difficulty, max: 9 } } }) });
console.log(`invalid config -> ${invalid.status} (expect 422)`);

await new Promise((resolve) => setTimeout(resolve, 5_500));
const journeys = (await (await fetch(`${base}/api/journeys`, { headers: learnerAuth })).json()).journeys;
const journey = await (await fetch(`${base}/api/journeys/${journeys[0].id}`, { headers: learnerAuth })).json();
const missionId = journey.missions[0].id;
const response = await fetch(`${base}/api/tutor/turn`, { method: "POST", headers: { ...learnerAuth, "Content-Type": "application/json" }, body: JSON.stringify({ mission_id: missionId, action: "set_persona", persona: "new_joiner" }) });
const events = (await response.text()).split("\n").filter(Boolean).map((line) => JSON.parse(line));
const activity = events.find((event) => event.type === "activity")?.activity;
const state = events.find((event) => event.type === "adaptation")?.state;
console.log(`next learner turn after config change: difficulty ${state?.difficulty} (expect 4), activity level ${activity?.difficulty ?? "unchanged"}`);

const rolled = await (await fetch(`${base}/api/admin/config`, { method: "POST", headers: { ...adminAuth, "Content-Type": "application/json" }, body: JSON.stringify({ config: null, rollback_to: current.active_version || saved.version - 1 }) })).json();
console.log(rolled.version ? `rolled back as v${rolled.version}` : `rollback: ${JSON.stringify(rolled)}`);
