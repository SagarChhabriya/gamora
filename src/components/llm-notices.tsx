"use client";

import { useEffect, useState } from "react";

export type NoticeMessage = { kind: "busy" | "backup" | "unavailable"; text: string };

const KEY = "gamora.notices";
const EVENT = "gamora:notices";

/**
 * Shows why something was slow or simpler than usual. Kept for one page change in session storage,
 * so a notice from building a journey still appears on the journey page it opens.
 */
export function showNotices(list: NoticeMessage[] | undefined) {
  if (!list?.length || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be blocked; the event below still shows it on this page.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: list }));
}

export function LlmNotices() {
  const [notices, setNotices] = useState<NoticeMessage[]>([]);

  useEffect(() => {
    const take = (list: NoticeMessage[]) => {
      setNotices((current) => [...current.filter((item) => !list.some((next) => next.kind === item.kind)), ...list]);
      try {
        window.sessionStorage.removeItem(KEY);
      } catch {
        // Ignore.
      }
    };
    try {
      const saved = window.sessionStorage.getItem(KEY);
      if (saved) take(JSON.parse(saved) as NoticeMessage[]);
    } catch {
      // Ignore unreadable storage.
    }
    const onNotice = (event: Event) => take((event as CustomEvent<NoticeMessage[]>).detail);
    window.addEventListener(EVENT, onNotice);
    return () => window.removeEventListener(EVENT, onNotice);
  }, []);

  useEffect(() => {
    if (!notices.length) return;
    const timer = window.setTimeout(() => setNotices([]), 12_000);
    return () => window.clearTimeout(timer);
  }, [notices]);

  if (!notices.length) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-20 left-4 right-4 z-50 space-y-2 sm:right-auto sm:w-96 lg:bottom-4">
      {notices.map((notice) => (
        <div key={notice.kind} className="flex items-start gap-3 border border-[#c98a2b] bg-paper px-4 py-3 text-sm shadow-lg">
          <span aria-hidden="true" className="mt-0.5 font-semibold text-[#9a6a1c]">
            {notice.kind === "unavailable" ? "!" : "⏳"}
          </span>
          <p className="flex-1 leading-6">{notice.text}</p>
          <button type="button" onClick={() => setNotices((current) => current.filter((item) => item.kind !== notice.kind))} className="min-h-8 px-1 text-xs font-semibold text-ink/60 hover:text-accent" aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
