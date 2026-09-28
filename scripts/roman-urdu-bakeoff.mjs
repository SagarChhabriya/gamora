// Roman Urdu model bake-off (ADR-002). Runs every prompt against each candidate model and writes
// a side-by-side Markdown sheet for manual scoring (1 to 5 on fluency, spelling convention, English
// banking terms kept, tone).
// Usage: node scripts/roman-urdu-bakeoff.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be set.
}

const prompts = JSON.parse(readFileSync("tests/eval/roman-urdu/prompts.json", "utf8"));
const styleGuide = readFileSync("src/lib/llm/prompts/roman-urdu.ts", "utf8").match(/`([^`]+)`/)[1];

const candidates = [
  { provider: "groq", model: process.env.LLM_GROQ_FAST_MODEL ?? "openai/gpt-oss-20b" },
  { provider: "groq", model: process.env.LLM_GROQ_REASONING_MODEL ?? "openai/gpt-oss-120b" },
  { provider: "gemini", model: process.env.LLM_GEMINI_FAST_MODEL ?? "gemini-3.1-flash-lite" },
  { provider: "gemini", model: process.env.LLM_GEMINI_REASONING_MODEL ?? "gemini-3.5-flash-lite" },
];

async function call({ provider, model }, prompt) {
  const system = `You are a warm, concise learning guide for bank staff. Do not use em dashes.\n${styleGuide}`;
  const started = Date.now();
  if (provider === "groq") {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        reasoning_effort: "low",
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    const data = await response.json();
    return { text: data.choices?.[0]?.message?.content ?? `ERROR ${response.status}`, ms: Date.now() - started };
  }
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 600 },
      }),
    },
  );
  const data = await response.json();
  return { text: data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ?? `ERROR ${response.status}`, ms: Date.now() - started };
}

const rows = [];
for (const item of prompts) {
  const outputs = await Promise.all(candidates.map((candidate) => call(candidate, item.prompt).catch((error) => ({ text: `ERROR ${error.message}`, ms: 0 }))));
  rows.push({ item, outputs });
  console.log(`${item.id} done: ${outputs.map((output) => `${output.ms}ms`).join(" / ")}`);
}

const date = new Date().toISOString().slice(0, 10);
let md = `# Roman Urdu bake-off, ${date}\n\nScore each cell 1 to 5: fluency, spelling convention, English banking terms kept, tone. Record totals in ADR-002.\n\n`;
for (const { item, outputs } of rows) {
  md += `## ${item.id} (${item.kind})\n\n> ${item.prompt}\n\n`;
  outputs.forEach((output, index) => {
    const candidate = candidates[index];
    md += `**${candidate.provider} / ${candidate.model}** (${output.ms} ms), score: __\n\n${output.text.trim()}\n\n`;
  });
}
const latency = candidates.map((candidate, index) => {
  const values = rows.map((row) => row.outputs[index].ms).sort((a, b) => a - b);
  return `| ${candidate.provider} / ${candidate.model} | ${values[Math.floor(values.length / 2)]} ms | ${rows.filter((row) => row.outputs[index].text.startsWith("ERROR")).length} |`;
});
md += `## Latency summary\n\n| Model | p50 | Errors |\n|---|---|---|\n${latency.join("\n")}\n`;
mkdirSync("tests/eval/roman-urdu/results", { recursive: true });
writeFileSync(`tests/eval/roman-urdu/results/${date}.md`, md);
console.log(`wrote tests/eval/roman-urdu/results/${date}.md`);
