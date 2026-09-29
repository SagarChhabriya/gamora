"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { cx } from "@/components/ui";
import { assistantSuggestions } from "@/lib/assistant/suggestions";
import { authFetch } from "@/lib/auth/client";

type Message = { role: "user" | "assistant"; text: string; links?: Array<{ label: string; href: string }>; error?: boolean };

/** Help assistant tab, bottom right. Kept in memory only: closing the tab forgets the chat. */
export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function ask(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    const history = messages.filter((item) => !item.error).map(({ role, text: body }) => ({ role, text: body }));
    setMessages((list) => [...list, { role: "user", text: message }]);
    setDraft("");
    setBusy(true);
    try {
      const response = await authFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history }),
      });
      const payload = (await response.json().catch(() => ({}))) as { reply?: string; links?: Message["links"]; error?: string };
      if (!response.ok || !payload.reply) {
        const text = response.status === 429 ? "You are sending messages quickly. Please wait a minute and try again." : (payload.error ?? `Something went wrong (HTTP ${response.status}).`);
        setMessages((list) => [...list, { role: "assistant", text, error: true }]);
      } else {
        setMessages((list) => [...list, { role: "assistant", text: payload.reply as string, links: payload.links ?? [] }]);
      }
    } catch {
      setMessages((list) => [...list, { role: "assistant", text: "Could not reach Gamora. Check your connection.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(draft);
  };

  return (
    <>
      {open ? (
        <div
          role="dialog"
          aria-label="Gamora help"
          className="fixed inset-x-4 bottom-20 z-50 flex max-h-[min(560px,75vh)] flex-col border border-ink/20 bg-panel shadow-xl sm:inset-x-auto sm:right-4 sm:w-[380px]"
        >
          <header className="flex items-center justify-between border-b border-ink/15 px-4 py-3">
            <div>
              <p className="font-semibold">Gamora help</p>
              <p className="text-xs text-ink/60">About the app and your progress</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close help" className="grid h-9 w-9 place-items-center text-lg text-ink/60 hover:text-accent">
              ×
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm" aria-live="polite">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="leading-6 text-ink/75">Hi! Ask me how Gamora works or about your own progress. For questions about your material, use the Ask box inside a mission.</p>
                <ul className="flex flex-wrap gap-2">
                  {assistantSuggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button type="button" onClick={() => void ask(suggestion)} className="border border-ink/20 bg-paper px-3 py-1.5 text-left text-xs font-medium hover:border-accent">
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {messages.map((message, index) =>
              message.role === "user" ? (
                <p key={index} className="ml-auto w-fit max-w-[85%] bg-ink px-3 py-2 text-paper">
                  {message.text}
                </p>
              ) : (
                <div key={index} className={cx("max-w-[92%] border-l-4 bg-paper px-3 py-2", message.error ? "border-danger" : "border-good")}>
                  <p className="whitespace-pre-line leading-6">{message.text}</p>
                  {message.links?.length ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {message.links.map((link) => (
                        <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className="inline-flex min-h-9 items-center bg-ink px-3 text-xs font-semibold text-paper hover:bg-accent">
                          {link.label} →
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            )}
            {busy ? (
              <p className="flex items-center gap-2 text-xs text-ink/60" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Thinking...
              </p>
            ) : null}
            <div ref={end} />
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-ink/15 p-3">
            <label htmlFor="assistant-input" className="sr-only">
              Ask Gamora help
            </label>
            <input
              id="assistant-input"
              ref={input}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={600}
              placeholder="Ask about Gamora..."
              className="min-w-0 flex-1 border border-ink/25 bg-paper px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button type="submit" disabled={busy || !draft.trim()} className="bg-ink px-4 text-sm font-semibold text-paper hover:bg-accent disabled:opacity-50">
              Send
            </button>
          </form>
        </div>
      ) : null}
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close Gamora help" : "Open Gamora help"}
        data-tour="assistant"
        className="fixed bottom-4 right-4 z-50 grid h-13 w-13 place-items-center rounded-full bg-ink text-paper shadow-lg hover:bg-accent"
      >
        {open ? (
          <span aria-hidden="true" className="text-2xl leading-none">
            ×
          </span>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.4A8 8 0 1 1 21 12z" />
            <path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 2-2.3 3.2M12 16.5h.01" />
          </svg>
        )}
      </button>
    </>
  );
}
