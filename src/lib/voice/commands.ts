/**
 * Hands-free voice commands, in English and Roman Urdu. What the learner says is matched against
 * the step on screen: a lesson waits for "next", a choice waits for an option, an open question
 * takes the words as the answer. Plain rules, so the same words always do the same thing.
 */

export type StepShape = "lesson" | "choice" | "steps" | "ordering" | "reflection" | "open";

export type VoiceCommand =
  | { action: "continue" }
  | { action: "hint" }
  | { action: "repeat" }
  | { action: "stop" }
  | { action: "choose"; index: number }
  | { action: "confidence"; value: number }
  | { action: "reply"; text: string }
  | { action: "none" };

const words = {
  continue: ["next", "continue", "go on", "got it", "carry on", "ready", "done", "aage", "agla", "age chalo", "aagay", "samajh gaya", "samajh gayi", "samajh aa gaya", "theek hai", "chalo"],
  hint: ["hint", "give me a hint", "help", "clue", "madad", "ishara", "hint do", "hint dein"],
  repeat: ["repeat", "again", "say that again", "say it again", "one more time", "dobara", "phir se", "phir say", "dubara"],
  stop: ["stop", "stop listening", "pause", "hands free off", "bas", "ruk jao", "ruko", "band karo"],
};

const ordinals: Array<string[]> = [
  ["a", "one", "1", "first", "option a", "option one", "option 1", "pehla", "pehli", "aik", "ek", "alif"],
  ["b", "two", "2", "second", "option b", "option two", "option 2", "doosra", "dusra", "doosri", "do", "be"],
  ["c", "three", "3", "third", "option c", "option three", "option 3", "teesra", "tisra", "teesri", "teen"],
  ["d", "four", "4", "fourth", "option d", "option four", "option 4", "chautha", "chaar", "char"],
  ["e", "five", "5", "fifth", "option e", "option five", "option 5", "panchwan", "paanch"],
  ["f", "six", "6", "sixth", "option f", "option six", "option 6", "chhata", "chhe"],
];

function clean(text: string) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(please|okay|ok|um|uh|the|step|number|its|it's)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const matches = (said: string, list: string[]) => list.includes(said);

/** Reads what the learner said for the step on screen. */
export function parseVoiceCommand(text: string, shape: StepShape, choices = 0): VoiceCommand {
  const said = clean(text);
  if (!said) return { action: "none" };
  // Short control words work on every step; a longer sentence is an answer, not a command.
  const short = said.split(" ").length <= 4;
  if (short && matches(said, words.stop)) return { action: "stop" };
  if (short && matches(said, words.repeat)) return { action: "repeat" };
  if (short && matches(said, words.hint) && shape !== "lesson") return { action: "hint" };

  if (shape === "lesson") return short && matches(said, words.continue) ? { action: "continue" } : { action: "none" };

  if (shape === "choice" || shape === "steps") {
    const index = ordinals.findIndex((list) => list.includes(said) || list.some((word) => said === `option ${word}` || said === `choice ${word}`));
    return index >= 0 && index < choices ? { action: "choose", index } : { action: "none" };
  }

  if (shape === "reflection") {
    const index = ordinals.slice(0, 5).findIndex((list) => list.includes(said) || said.split(" ").some((word) => /^[1-5]$/.test(word) && list.includes(word)));
    return index >= 0 ? { action: "confidence", value: index + 1 } : { action: "none" };
  }

  if (shape === "ordering") return { action: "none" };

  // Open questions: anything of substance is the answer. A lone control word was handled above.
  return said.split(" ").length >= 2 || said.length >= 6 ? { action: "reply", text: text.trim() } : { action: "none" };
}

/** What to read aloud for a step, including the options, so it can be answered without the screen. */
export function spokenStep(step: {
  type: string;
  title: string;
  display_text: string;
  prompt: string;
  options?: Array<{ text: string }>;
  steps?: Array<{ text: string }>;
  lesson?: { key_idea: string; notes: string[] };
}, language: "en" | "roman_ur") {
  const ur = language === "roman_ur";
  if (step.type === "lesson") {
    return [step.title, step.lesson?.key_idea ?? step.display_text, ...(step.lesson?.notes ?? []), ur ? "Tayyar hon to kahiye: aage." : "Say next when you are ready."].join(". ");
  }
  const letters = "ABCDEF";
  const choices = step.options?.length
    ? step.options.map((option, index) => `Option ${letters[index]}: ${option.text}`)
    : step.steps?.length
      ? step.steps.map((item, index) => `Step ${index + 1}: ${item.text}`)
      : [];
  const how =
    step.options?.length
      ? ur
        ? "Option ka letter boliye, jaise option A."
        : "Say the letter of your choice, like option A."
      : step.steps?.length
        ? ur
          ? "Ghalat step ka number boliye."
          : "Say the number of the step that went wrong."
        : step.type === "reflection"
          ? ur
            ? "Ek se paanch tak number boliye."
            : "Say a number from one to five."
          : step.type === "ordering"
            ? ur
              ? "Is step ke liye screen par tarteeb dein."
              : "This one needs the screen: put the steps in order by tapping."
            : ur
              ? "Apna jawab boliye."
              : "Say your answer.";
  return [step.title, step.display_text, step.prompt, ...choices, how].filter(Boolean).join(". ");
}

/** The shape of a step, for matching what the learner says. */
export function shapeOf(step: { type: string; options?: unknown[]; steps?: unknown[] }): StepShape {
  if (step.type === "lesson") return "lesson";
  if (step.options?.length) return "choice";
  if (step.steps?.length) return "steps";
  if (step.type === "ordering") return "ordering";
  if (step.type === "reflection") return "reflection";
  return "open";
}
