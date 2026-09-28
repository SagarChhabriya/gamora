import { mkdirSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { defaultConfig, type ActivityType } from "@/lib/config/schema";
import { answerQuestion, claimsFromActivity, generateGroundedActivity, verifyClaims } from "@/lib/grounding/verify";
import type { SourceChunk } from "@/lib/tutor/types";

import { policySections } from "../../scripts/fixtures/policy-text.mjs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}
// Evals must not write to the production events table.
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.UPSTASH_REDIS_REST_URL;

const chunks: SourceChunk[] = (policySections as Array<[string, string]>).map(([heading, body], idx) => ({
  id: `00000000-0000-4000-8000-${String(idx).padStart(12, "0")}`,
  idx,
  text: `${heading}. ${body}`,
  ref: "",
}));

function window(center: number) {
  return chunks.slice(Math.max(0, center - 1), center + 2).map((chunk, index) => ({ ...chunk, ref: `S${index + 1}` }));
}

const activityCases: Array<{ type: ActivityType; chunk: number; concept: string }> = [
  { type: "explain_ask", chunk: 1, concept: "Customer identification" },
  { type: "scenario", chunk: 6, concept: "Cash transaction threshold and structuring" },
  { type: "spot_error", chunk: 11, concept: "Responding to a fraud incident" },
  { type: "ordering", chunk: 11, concept: "Fraud response steps" },
  { type: "teach_back", chunk: 4, concept: "Enhanced due diligence" },
  { type: "scenario", chunk: 8, concept: "Recognising impersonation fraud" },
  { type: "explain_ask", chunk: 7, concept: "Suspicious transaction reporting and tipping off" },
  { type: "spot_error", chunk: 10, concept: "Cheque fraud checks" },
  { type: "roleplay", chunk: 9, concept: "Phishing and one time passwords" },
  { type: "explain_ask", chunk: 12, concept: "Record keeping" },
];

const inScope = [
  "How long must identification records be kept?",
  "What is the cash transaction reporting threshold?",
  "Who approves enhanced due diligence?",
  "What should staff do if biometric verification fails twice?",
  "How often are high risk accounts reviewed?",
  "What is tipping off?",
  "What do I do if a customer shared their one time password?",
  "How quickly must a fraud be reported to the fraud risk unit?",
  "When must a teller call the drawer of a cheque?",
  "What proof of address is accepted?",
];

const outOfScope = [
  "What is the current mortgage interest rate?",
  "How do I reset the ATM machine?",
  "What is the bank's share price today?",
  "Which football team won the league this year?",
  "What is the maximum credit card limit for gold customers?",
  "How many vacation days do staff get?",
  "What is the SWIFT code of the bank?",
  "What is the penalty for early loan repayment?",
  "Who is the CEO of the bank?",
  "What is the exchange rate for US dollars?",
];

const results: Record<string, unknown> = {};
// Free tier limits are per minute. Pace the eval like a real learner session.
const pause = () => new Promise((resolve) => setTimeout(resolve, 2_500));

describe("grounding eval", () => {
  it("generated activities stay faithful to the source (independent judge)", async () => {
    let claims = 0;
    let unsupported = 0;
    const perActivity: Array<{ type: string; claims: number; unsupported: number; grounded: string }> = [];
    for (const item of activityCases) {
      const source = window(item.chunk);
      const activity = await generateGroundedActivity({
        type: item.type,
        concept: { id: "eval", name: item.concept, summary: item.concept },
        chunks: source,
        difficulty: 3,
        pace: "normal",
        modality: "open",
        language: "en",
        persona: "new_joiner",
        config: defaultConfig,
      });
      const list = claimsFromActivity(activity);
      // Independent judge: the verifier prompt on the reasoning task, strict.
      const judged = await verifyClaims({ claims: list, chunks: source, strictness: "strict", task: "reasoning" });
      claims += judged.checked;
      unsupported += judged.unsupported.length;
      await pause();
      perActivity.push({ type: item.type, claims: judged.checked, unsupported: judged.unsupported.length, grounded: activity.grounded });
    }
    const rate = claims ? 1 - unsupported / claims : 0;
    results.activities = { claims, unsupported, grounding_rate: rate, unsupported_claim_rate: claims ? unsupported / claims : 0, perActivity };
    console.log(`grounding rate ${(rate * 100).toFixed(1)}% over ${claims} claims (${unsupported} unsupported)`);
    expect(claims).toBeGreaterThan(20);
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });

  it("answers in-scope questions with citations and abstains on out-of-scope ones", async () => {
    let answered = 0;
    let abstained = 0;
    for (const question of inScope) {
      const result = await answerQuestion({ question, chunks: chunks.map((chunk, index) => ({ ...chunk, ref: `S${index + 1}` })), config: defaultConfig, persona: "new_joiner", language: "en", pace: "normal" });
      if (!result.abstained && result.source_chunk_ids.length) answered += 1;
      await pause();
    }
    for (const question of outOfScope) {
      const result = await answerQuestion({ question, chunks: chunks.map((chunk, index) => ({ ...chunk, ref: `S${index + 1}` })), config: defaultConfig, persona: "new_joiner", language: "en", pace: "normal" });
      if (result.abstained) abstained += 1;
      await pause();
    }
    results.questions = { in_scope_answered: answered / inScope.length, out_of_scope_abstained: abstained / outOfScope.length };
    console.log(`in-scope answered with citations ${answered}/${inScope.length}, out-of-scope abstained ${abstained}/${outOfScope.length}`);
    expect(abstained / outOfScope.length).toBeGreaterThanOrEqual(0.95);
    expect(answered / inScope.length).toBeGreaterThanOrEqual(0.8);
  });

  it("writes the eval report", () => {
    mkdirSync("tests/eval/results", { recursive: true });
    const report = { date: new Date().toISOString(), model_fast: process.env.LLM_GROQ_FAST_MODEL, ...results };
    writeFileSync("tests/eval/results/grounding-latest.json", `${JSON.stringify(report, null, 2)}\n`);
    expect(Object.keys(results).length).toBe(2);
  });
});
