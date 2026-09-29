/**
 * Which device voice reads Gamora aloud. Learners are mostly in Pakistan, so a Pakistani English
 * voice comes first, then other South Asian English voices (Indian English is the one most browsers
 * and phones ship, and the closest accent), and only then any English voice. Urdu-script voices are
 * not used: Gamora's text is English or Roman Urdu in the Latin alphabet, which they read badly.
 * Among equal candidates, natural or neural voices are preferred over robotic ones.
 */
export type VoiceLike = { lang: string; name: string; localService?: boolean };

const southAsian = /\b(pakistan|urdu|india|hindi|bangla|bangladesh|sri lanka)\b/i;
const natural = /natural|neural|online|premium|enhanced|google/i;

function rank(voice: VoiceLike) {
  const lang = voice.lang.replace("_", "-").toLowerCase();
  if (!lang.startsWith("en")) return -1;
  let score = 0;
  if (lang === "en-pk") score = 400;
  else if (southAsian.test(voice.name) || lang === "en-in") score = 300;
  else if (["en-lk", "en-bd", "en-np"].includes(lang)) score = 250;
  else if (lang === "en-gb") score = 100;
  else score = 50;
  if (natural.test(voice.name)) score += 20;
  return score;
}

export function pickVoice<T extends VoiceLike>(voices: T[]): T | undefined {
  return voices
    .map((voice) => ({ voice, score: rank(voice) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.voice;
}

/** True when the chosen voice has a South Asian accent, so the page can say when it does not. */
export function isSouthAsian(voice: VoiceLike | undefined) {
  return Boolean(voice) && rank(voice as VoiceLike) >= 250;
}
