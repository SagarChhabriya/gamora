import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Tells the learner, in the moment, why things are slow. The router reports what happened on a
 * request (the AI service is busy, a backup model answered, or nothing answered) and the route
 * serving that request passes it on: as a streamed event, or as a notice in its JSON reply.
 */
export type LlmNotice = "busy" | "backup" | "unavailable";

export const noticeText: Record<LlmNotice, string> = {
  busy: "The AI service is busy right now, so this may take a little longer.",
  backup: "Our main AI model is at its limit, so a backup model answered. Replies may be slower.",
  unavailable: "The AI service did not answer in time, so Gamora used a simpler built-in version for this part.",
};

type Listener = { seen: Set<LlmNotice>; notify?: (notice: LlmNotice) => void };

const store = new AsyncLocalStorage<Listener>();

/** Runs work while collecting notices. Each kind is reported once per request. */
export async function withLlmNotices<T>(work: () => Promise<T>, notify?: (notice: LlmNotice) => void): Promise<{ result: T; notices: LlmNotice[] }> {
  const listener: Listener = { seen: new Set(), notify };
  const result = await store.run(listener, work);
  return { result, notices: [...listener.seen] };
}

/** Called by the router. Does nothing outside a request that listens. */
export function reportLlm(notice: LlmNotice) {
  const listener = store.getStore();
  if (!listener || listener.seen.has(notice)) return;
  listener.seen.add(notice);
  listener.notify?.(notice);
}

/** Notices as learners read them. "Unavailable" already implies "busy", so that one is dropped. */
export function noticeMessages(notices: LlmNotice[]) {
  const shown = notices.includes("unavailable") ? notices.filter((notice) => notice !== "busy") : notices;
  return shown.map((notice) => ({ kind: notice, text: noticeText[notice] }));
}
