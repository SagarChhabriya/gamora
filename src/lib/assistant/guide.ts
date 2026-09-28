import type { AppConfig } from "@/lib/config/schema";
import { personaLabels, personas } from "@/lib/config/schema";
import { badgeCatalog, XP_PER_LEVEL } from "@/lib/gamification/rewards";

/**
 * What the help assistant knows about Gamora. Numbers come from the live config, so the answers
 * match what the app actually does. Keep this in step with the product when features change.
 */
export function appGuide(config: AppConfig) {
  const xp = config.mechanics.xp;
  const pct = (value: number) => `${Math.round(value * 100)}%`;
  const sites = config.content.url_domains.length ? config.content.url_domains.join(", ") : "any public website";
  return `GAMORA APP GUIDE
What it is: Gamora turns your own learning material into a short, game-like journey. It teaches from your material only and cites it. There are no quizzes; it estimates what you know from how you answer.

Adding material (Studio, top menu): paste text, use a URL, or upload a PDF, DOCX, TXT or Markdown file up to ${config.content.max_upload_mb} MB. URL sources work only from supported sites: ${sites}. Sites like Medium or LinkedIn block automated readers; copy the text and use Paste text instead. If a site refuses, the error shows its HTTP code. Gamora splits the material, finds the key concepts and draws a concept map: click a concept to see what to learn before it and what it unlocks. Then press Build my journey. Uploading the same text again reuses the existing map. You can remove your own sources in Studio.

Journeys and missions: a journey is a set of missions shown on the journey map. Each mission starts with a short lesson (key idea, sticky notes, a flow diagram when there is a process, and an example). Press "Got it, check my understanding" to move on to practice activities: open questions, decisions, spot the slip, put in order, role-play, teach a friend, quick flashbacks and a confidence check-in. The next mission unlocks when the previous one is finished and its concepts reach ${pct(config.mastery.unlock_threshold)} mastery. If it stays locked, use Practice round or Practise again on the finished mission. Progress is saved after every answer; reloading the page brings the whole conversation back.

Help while learning: "I would like a hint" gives a hint. Hints never cost XP but count a little less as evidence. "Ask anything about your material" inside a mission answers questions about the material itself, with sources, and says so when the material does not cover something. "Why this changed" notes explain each adaptation.

Mastery: each concept has a mastery estimate. A concept counts as mastered at ${pct(config.mastery.mastered_threshold)}. Mastery fades slowly over time (${pct(config.mastery.decay_per_day)} a day), so revisiting keeps it fresh.

Adaptation: Gamora raises the challenge after answers that are right without hints, and adds a worked example and guided choices after two misses in a row. It switches to Roman Urdu when you write in Roman Urdu.

XP, levels, streaks, badges: correct answer ${xp.correct} XP, partial ${xp.partial} XP, fixing your own answer ${xp.self_corrected} XP, teaching a concept back ${xp.teach_back} XP, finishing a mission ${xp.mission_complete} XP. Lessons and clicks give no XP. Every ${XP_PER_LEVEL} XP is a new level. A streak counts days you learn; missing ${config.mechanics.streak_grace_days} day keeps it. Finished missions get 1 to 3 stars from mastery. Badges: ${Object.values(badgeCatalog)
    .map((badge) => `${badge.name} (${badge.description.replace(/\.$/, "")})`)
    .join("; ")}.

Learner types: ${personas.map((id) => personaLabels[id]).join(", ")}. Set in your profile or switch inside a mission; the next activity adapts.

Language and voice: English or Roman Urdu, switchable inside a mission. Technical terms stay in English. "Speak" answers by voice. "Listen" reads a message aloud; "Read replies aloud" reads new replies automatically. On phones, tap Listen or the read aloud switch once so the browser allows sound. Text only mode turns voice off for slow connections.

Accessibility: the High contrast button is in the top bar and is remembered on this device.

Account and privacy: the profile icon at the top right has Update my profile, Sign out and Delete my data. Delete my data permanently removes your account, journeys, progress and settings. Audio is never stored. Your sources are private to you; items marked Gamora library are shared by the Gamora team.`;
}

