/**
 * The guided tour: the whole pipeline from adding material to finishing a mission. Each step names
 * the page it belongs to and the element it points at (a data-tour attribute). A step whose element
 * is not on screen, for example a journey step before any journey exists, is shown as a plain card.
 */
export type TourPage = "home" | "studio" | "journey" | "mission" | "any";

export type TourStep = { id: string; page: TourPage; target?: string; title: string; body: string };

export const tourSteps: TourStep[] = [
  {
    id: "welcome",
    page: "any",
    title: "Welcome to Gamora",
    body: "Gamora turns your own material into a short learning journey: a map of the topics, an illustrated preview, then missions that teach and check each idea. This tour walks the whole path in about two minutes.",
  },
  { id: "journeys", page: "home", target: "journeys", title: "Your journeys", body: "Every journey you build appears here with its progress. Open one to carry on where you left off." },
  { id: "add", page: "home", target: "add-material", title: "Step 1: add material", body: "Everything starts with a source: your notes, a chapter, an article or a PDF. Studio is where you add it." },
  {
    id: "source",
    page: "studio",
    target: "source-form",
    title: "Paste, link or upload",
    body: "Give it a title, then paste text, use a link from a supported site, or upload a PDF, Word or text file. Long material is grouped into a limited number of topics; you can change that limit in Learning preferences.",
  },
  {
    id: "build-map",
    page: "studio",
    target: "build-map",
    title: "Step 2: build the content map",
    body: "Gamora reads the material, splits it into passages, finds the teachable ideas, groups them into topics and works out the order to learn them in. Every topic stays linked to the passages it came from.",
  },
  {
    id: "sources",
    page: "studio",
    target: "sources",
    title: "Your sources",
    body: "Inspect opens the map of a source. Re-group applies a new topic limit to a source you added earlier. Build journey plans the missions.",
  },
  {
    id: "route",
    page: "studio",
    target: "sources",
    title: "Step 3: build a journey and pick a route",
    body: "When you build a journey you choose how to go through it: Narrative (one continuing story), Scenarios (situations to act in), Quick scan (a light pass over every topic) or Focus (one topic at a time).",
  },
  {
    id: "storyboard",
    page: "journey",
    target: "storyboard",
    title: "Step 4: watch the storyboard",
    body: "A short illustrated preview of the whole journey, one panel per topic. Every panel shows a quote from your material. The missions that follow keep the same people and setting.",
  },
  {
    id: "missions",
    page: "journey",
    target: "missions",
    title: "Step 5: the missions",
    body: "Missions open one after another. The next one unlocks when you finish this one and show enough understanding of its topics. The last mission is a capstone case that brings several topics together.",
  },
  {
    id: "mastery",
    page: "journey",
    target: "mastery",
    title: "What you have shown",
    body: "Gamora estimates what you know from how you answer, fix mistakes and remember, never from a test. Each topic fills up as you go.",
  },
  {
    id: "mission",
    page: "mission",
    target: "mission",
    title: "Step 6: learn, then practise",
    body: "Each topic starts with a short lesson. Use View as to see it as notes, a flow, a chart or another diagram. Then practise with questions, decisions, role-plays and more, and answer by typing or speaking.",
  },
  {
    id: "tuning",
    page: "mission",
    target: "tuning",
    title: "Tuning adapts to you",
    body: "Tuning shows the challenge level, the support you get and the pace, measured from your answers. When something changes, a note in the conversation says why.",
  },
  {
    id: "ask",
    page: "mission",
    target: "ask",
    title: "Ask about your material",
    body: "Ask anything about the material. Answers come only from your source, with the passages cited, and Gamora says so when the material does not cover it.",
  },
  {
    id: "help",
    page: "any",
    target: "assistant",
    title: "Help is always here",
    body: "The help button answers questions about using Gamora and about your own progress.",
  },
  {
    id: "account",
    page: "any",
    target: "account",
    title: "Your preferences",
    body: "The profile menu holds Learning preferences (topics per source, language, session time), the intro chat, and Delete my data. You can take this tour again from here any time.",
  },
];

export function pageOf(pathname: string): TourPage {
  if (pathname === "/") return "home";
  if (pathname.startsWith("/studio")) return "studio";
  if (/^\/journey\/[^/]+\/mission\//.test(pathname)) return "mission";
  if (/^\/journey\/[^/]+\/?$/.test(pathname)) return "journey";
  return "any";
}

export const tourKey = "gamora.tour";
