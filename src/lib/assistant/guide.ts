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

Adding material (Studio, top menu): write a learning topic or brief (Gamora writes a primer on it, labelled AI-written), paste text, use a URL, or upload a PDF, DOCX, TXT or Markdown file up to ${config.content.max_upload_mb} MB. URL sources work only from supported sites: ${sites}. Sites like Medium or LinkedIn block automated readers; copy the text and use Paste text instead. If a site refuses, the error shows its HTTP code. Gamora splits the material, finds the key ideas and groups them into at most ${config.content.topics_default} topics by default (you can pick your own limit, up to ${config.content.topics_max}, under Learning preferences). Each topic keeps its smaller ideas as key points, so nothing is lost. To apply a new limit to a source you already added, press Re-group on it in Studio: journeys you started keep their missions, new journeys use the new topics, and your progress carries over. Gamora draws a concept map: click a topic to see what to learn before it and what it unlocks. Then press Build my journey and pick a learning route: Narrative (one continuing story, starting with the storyboard), Scenarios (situations to act in), Quick scan (one light check per topic) or Focus (one topic at a time with worked examples). Uploading the same text again reuses the existing map. You can remove your own sources in Studio.

Storyboard: ${config.mechanics.storyboard ? `the journey map offers a short illustrated storyboard, a few scenes per topic, one per idea, before the first mission. Play, pause, go back, narrate aloud or skip to the missions. Every panel shows a quote from your material. Missions then continue with the same people and setting.` : `turned off by the Gamora team.`}

Journeys and missions: a journey has 2 to 10 missions, shown on the journey map as one winding path. Stops turn green as you finish them; locked stops show a lock. Each mission starts with a short lesson: a key idea, 3 to 8 sticky notes with the facts to remember, and an example. The lesson has a View as switcher: notes, flow, and diagram views such as key figure, side by side, sequence, trend bars, share split, loop, guardrails, checkpoints, milestones, overlap, quadrant, cause chain and branch tree. Only views your material has data for are offered, and numbers are always the ones your material states. Press "Got it, check my understanding" to move on. Every question is checked before you see it, so it only asks about what the lesson and your material actually say. Practice activities: open questions, decisions, spot the slip, put in order, role-play, teach a friend, quick flashbacks and a confidence check-in.${config.mechanics.crossroads ? ` Some missions have one Crossroads: a decision whose outcome carries into the next step; there is no going back once you pick a path.` : ``}${config.mechanics.capstone ? ` Most journeys end with a Capstone case: one situation that needs two or more topics at once.` : ``} The next mission unlocks when the previous one is finished and its concepts reach ${pct(config.mastery.unlock_threshold)} mastery. If it stays locked, use Practice round or Practise again on the finished mission. Progress is saved after every answer; reloading the page brings the whole conversation back.

Help while learning: "I would like a hint" gives a hint. Hints never cost XP but count a little less as evidence. "Ask anything about your material" inside a mission answers questions about the material itself, with sources, and says so when the material does not cover something. "Why this changed" notes explain each adaptation, and the Tuning panel (on phones, the Tuning button at the bottom) shows the current challenge level, support, pace and topic. Under each reply you can say whether it was useful.

Mastery: each concept has a mastery estimate, shown on the journey map under "What you have shown so far" and on each mission card. It only moves when you answer a question: lessons and reading do not change it. Right answers raise it, partly right answers raise it in proportion, and wrong answers or failed recalls lower it, but one setback never removes more than half of it. Saying you are very confident after weak answers lowers it slightly. A concept unlocks the next mission at ${pct(config.mastery.unlock_threshold)} and counts as mastered at ${pct(config.mastery.mastered_threshold)}. It fades slowly over time (${pct(config.mastery.decay_per_day)} a day), so revisiting keeps it fresh. If it shows 0%, no question on that concept has been answered yet, or the answers so far were off target: try Practise again.

Reviews and reminders: ${config.engagement.nudges ? `topics you have not practised for ${config.engagement.review_after_days} days, or that are not yet mastered, appear on the home page review card with their mastery then and now. One tap starts a short review round of up to ${config.engagement.review_size} topics. Gamora reminds you in the app at most once every ${config.engagement.cadence_days} days.` : `review reminders are turned off by the Gamora team; you can still use Practise again on any finished mission.`}

Leaderboard: ${config.mechanics.leaderboard ? `turned on. It is on the home page below your journeys and on each journey map above Badges. It ranks learners by total XP, then streak, shows first names only, and always shows your own place.` : `turned off by the Gamora team, so it does not appear. When they turn it on, it shows on the home page and on each journey map.`}

Guided tour: "Take the tour" in the profile menu (and on the home page for new learners) walks the whole path: add material, build the map, build a journey, the storyboard, a mission, Tuning, Ask and preferences.

When the AI is busy: free AI services limit how many requests they take per minute. When that happens Gamora waits briefly or switches to a backup model and shows a short notice saying so; if nothing answers in time it uses a simpler built-in version for that step, labelled "Quoted straight from your source".

Challenge level: each activity shows Challenge 1 to 5. It starts from how familiar you said you are with the material in the intro chat (brand new starts lowest, knowing it well starts at 4), not from your time or connection. It then moves with your answers.

Adaptation: Gamora raises the challenge after answers that are right without hints, and adds a worked example and guided choices after two misses in a row. It switches to Roman Urdu when you write in Roman Urdu.

XP, levels, streaks, badges: correct answer ${xp.correct} XP, partial ${xp.partial} XP, fixing your own answer ${xp.self_corrected} XP, teaching a concept back ${xp.teach_back} XP, finishing a mission ${xp.mission_complete} XP. Lessons and clicks give no XP. Every ${XP_PER_LEVEL} XP is a new level. A streak counts days you learn; missing ${config.mechanics.streak_grace_days} day keeps it. Finished missions get 1 to 3 stars from mastery. Badges: ${Object.values(badgeCatalog)
    .map((badge) => `${badge.name} (${badge.description.replace(/\.$/, "")})`)
    .join("; ")}.

Learner types: ${personas.map((id) => personaLabels[id]).join(", ")}. Set in your profile or switch inside a mission; the next activity adapts.

Language and voice: English or Roman Urdu, switchable inside a mission. Technical terms stay in English. "Speak" answers by voice in English, Urdu or both; Urdu is written back in Roman Urdu. "Listen" reads a message aloud; "Read replies aloud" reads new replies automatically. Hands-free mode (Chrome or Edge) reads each step, then listens: say next, hint, repeat, an option letter, or your answer, and say stop to end it. It pauses after two quiet turns. On phones, tap Listen or the read aloud switch once so the browser allows sound. ${config.voice.engine === "browser" ? "Read-aloud uses the device's own voice: a Pakistani or other South Asian English voice when the device has one (Microsoft Edge has natural English (India) voices)." : "Read-aloud uses a natural cloud voice that speaks Urdu and English; if it is busy, the device's own voice takes over."} The Slow connection learner type keeps messages short but leaves voice on. Text only mode, under Access in a mission, turns all voice off; switch it back off to see Speak and Listen again.

Accessibility: the High contrast button is in the top bar and is remembered on this device.

Account and privacy: the profile icon at the top right has Learning preferences (topics per source, language, session time), Update my profile, Sign out and Delete my data. Delete my data permanently removes your account, journeys, progress and settings. Audio is never stored. Your sources are private to you; items marked Gamora library are shared by the Gamora team.`;
}

