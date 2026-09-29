import { describe, expect, it } from "vitest";

import { parseVoiceCommand, shapeOf, spokenStep } from "@/lib/voice/commands";

describe("hands-free commands", () => {
  it("moves past a lesson only on a clear go-ahead, in English or Roman Urdu", () => {
    expect(parseVoiceCommand("Next.", "lesson")).toEqual({ action: "continue" });
    expect(parseVoiceCommand("samajh gaya", "lesson")).toEqual({ action: "continue" });
    expect(parseVoiceCommand("I am thinking about what you said", "lesson")).toEqual({ action: "none" });
  });

  it("control words work on any step, but a sentence is an answer", () => {
    expect(parseVoiceCommand("repeat", "open")).toEqual({ action: "repeat" });
    expect(parseVoiceCommand("dobara", "choice", 3)).toEqual({ action: "repeat" });
    expect(parseVoiceCommand("hint please", "open")).toEqual({ action: "hint" });
    expect(parseVoiceCommand("Stop", "open")).toEqual({ action: "stop" });
    expect(parseVoiceCommand("I would stop the payment and call the bank first", "open")).toEqual({ action: "reply", text: "I would stop the payment and call the bank first" });
  });

  it("picks options by letter, number or ordinal, within range", () => {
    expect(parseVoiceCommand("Option B", "choice", 3)).toEqual({ action: "choose", index: 1 });
    expect(parseVoiceCommand("the third one", "choice", 3)).toEqual({ action: "none" });
    expect(parseVoiceCommand("third", "choice", 3)).toEqual({ action: "choose", index: 2 });
    expect(parseVoiceCommand("doosra", "choice", 3)).toEqual({ action: "choose", index: 1 });
    expect(parseVoiceCommand("step 4", "steps", 5)).toEqual({ action: "choose", index: 3 });
    expect(parseVoiceCommand("option D", "choice", 3)).toEqual({ action: "none" });
  });

  it("reads a confidence number for reflections", () => {
    expect(parseVoiceCommand("four", "reflection")).toEqual({ action: "confidence", value: 4 });
    expect(parseVoiceCommand("I'd say 3", "reflection")).toEqual({ action: "confidence", value: 3 });
  });

  it("leaves ordering to the screen", () => {
    expect(parseVoiceCommand("first the form then the card", "ordering")).toEqual({ action: "none" });
  });
});

describe("what hands-free reads aloud", () => {
  it("reads the options so a choice can be made without the screen", () => {
    const text = spokenStep({ type: "scenario", title: "Decide", display_text: "A call comes in.", prompt: "What do you do?", options: [{ text: "Hang up" }, { text: "Share the code" }] }, "en");
    expect(text).toContain("Option A: Hang up");
    expect(text).toContain("Say the letter of your choice");
  });

  it("tells the learner how to move on from a lesson", () => {
    expect(spokenStep({ type: "lesson", title: "Saving", display_text: "d", prompt: "p", lesson: { key_idea: "Save first.", notes: ["Pay yourself first"] } }, "roman_ur")).toContain("aage");
  });

  it("knows each step's shape", () => {
    expect(shapeOf({ type: "crossroads", options: [1, 2, 3] })).toBe("choice");
    expect(shapeOf({ type: "spot_error", steps: [1] })).toBe("steps");
    expect(shapeOf({ type: "capstone" })).toBe("open");
  });
});
