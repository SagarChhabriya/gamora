// Copies LLM keys from .env.local to Vercel production without printing their values.
// Picks up GROQ_API_KEY*, GEMINI_API_KEY*, OPENROUTER_API_KEY* (including contributor keys such as
// GROQ_API_KEY_SUM), the LLM_OPENROUTER_* and speech/guard model settings, and CRON_SECRET.
// Existing Vercel values are replaced.
// Usage: node scripts/sync-llm-keys.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const wanted = /^(GROQ|GEMINI|OPENROUTER)_API_KEY(_[A-Z0-9]+)?$|^LLM_OPENROUTER_(FAST|REASONING)_MODEL$|^LLM_(STT|TTS|GUARD)_MODEL$|^LLM_PROVIDER_CHAIN$|^LLM_KEY_ORDER$|^CRON_SECRET$/;
const entries = readFileSync(".env.local", "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
  .filter((match) => match && wanted.test(match[1]) && match[2].trim())
  .map((match) => [match[1], match[2].trim().replace(/^"|"$/g, "")]);

const run = (args, input) => spawnSync("npx", ["--no-install", "vercel", ...args], { input, encoding: "utf8", shell: process.platform === "win32" });

for (const [name, value] of entries) {
  run(["env", "rm", name, "production", "--yes"]);
  const secret = name.includes("API_KEY") || name === "CRON_SECRET";
  const added = run(["env", "add", name, "production", ...(secret ? ["--type", "secret"] : []), "--value", value, "--yes"]);
  console.log(`${name}: ${added.status === 0 ? "synced" : `failed (${(added.stderr || added.stdout).split("\n").find((line) => /error/i.test(line)) ?? "see vercel output"})`}`);
}
console.log(
  entries.length
    ? "Vercel only reads environment changes on a new deployment. Run: npx vercel --prod (or push a commit, or Redeploy in the Vercel dashboard)."
    : "No LLM keys found in .env.local.",
);
