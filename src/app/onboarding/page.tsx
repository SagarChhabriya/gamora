"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { Button, cx } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";
import type { SessionPayload } from "@/lib/auth/supabase-auth";

type Step = {
  key: "role" | "goal" | "prior" | "time" | "language";
  ask: (name: string) => string;
  chips: Array<{ label: string; value: string }>;
  free?: boolean;
};

const steps: Step[] = [
  {
    key: "role",
    ask: (name) => `Hi ${name}, I am Sagar, your learning guide. What do you do day to day?`,
    chips: [
      { label: "Branch teller", value: "Branch teller" },
      { label: "Relationship manager", value: "Relationship manager" },
      { label: "Operations", value: "Operations officer" },
      { label: "Just joined", value: "New joiner" },
    ],
    free: true,
  },
  {
    key: "goal",
    ask: () => "Nice. What would you like to get better at?",
    chips: [
      { label: "Handle real situations", value: "Handle real customer situations confidently" },
      { label: "Pass an audit", value: "Follow policy correctly for audits" },
      { label: "Learn the basics", value: "Understand the basics" },
    ],
    free: true,
  },
  {
    key: "prior",
    ask: () => "How familiar are you with the material already?",
    chips: [
      { label: "Brand new to it", value: "new" },
      { label: "I know some of it", value: "some" },
      { label: "I know it well", value: "confident" },
    ],
  },
  {
    key: "time",
    ask: () => "How much time do you have today?",
    chips: [
      { label: "5 minutes", value: "5" },
      { label: "15 minutes", value: "15" },
      { label: "30 minutes", value: "30" },
      { label: "Slow connection, keep it light", value: "low" },
    ],
  },
  {
    key: "language",
    ask: () => "Last one. Which language feels natural? Aap Roman Urdu bhi choose kar sakte hain.",
    chips: [
      { label: "English", value: "en" },
      { label: "Roman Urdu", value: "roman_ur" },
    ],
  },
];

type Message = { from: "guide" | "learner"; text: string };

/** Maps the conversation to a persona. Simple, transparent rules. */
function personaFrom(answers: Record<string, string>) {
  if (answers.time === "low") return "low_bandwidth";
  if (answers.prior === "confident") return "expert";
  if (/relationship|rm\b/i.test(answers.role ?? "") || answers.time === "5") return "busy_rm";
  return "new_joiner";
}

function Onboarding({ session }: { session: SessionPayload }) {
  const router = useRouter();
  const name = session.user.display_name ?? session.user.email.split("@")[0];
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Message[]>([{ from: "guide", text: steps[0].ask(name) }]);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Braces matter: newer browsers return a Promise from scrollIntoView, which must not become the cleanup.
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function answer(value: string, label: string) {
    const step = steps[index];
    const nextAnswers = { ...answers, [step.key]: value };
    setAnswers(nextAnswers);
    const nextMessages: Message[] = [...messages, { from: "learner", text: label }];
    if (index + 1 < steps.length) {
      setMessages([...nextMessages, { from: "guide", text: steps[index + 1].ask(name) }]);
      setIndex(index + 1);
      return;
    }
    const persona = personaFrom(nextAnswers);
    const minutes = nextAnswers.time === "low" ? 10 : Number(nextAnswers.time) || 15;
    const language = nextAnswers.language === "roman_ur" ? "roman_ur" : "en";
    setMessages([
      ...nextMessages,
      {
        from: "guide",
        text:
          language === "roman_ur"
            ? "Shukriya! Main aapke liye journey tayyar karti hoon. Short missions, real situations, aur koi test nahi."
            : "Thanks! I will shape your journey around that. Short missions, real situations, and no tests.",
      },
    ]);
    setSaving(true);
    await authFetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        persona,
        language_pref: language,
        time_budget_min: minutes,
        onboarding: {
          role: nextAnswers.role,
          goal: nextAnswers.goal,
          prior: nextAnswers.prior as "new" | "some" | "confident",
          time: nextAnswers.time,
          language,
          completed_at: new Date().toISOString(),
        },
      }),
    });
    setTimeout(() => router.replace("/"), 900);
  }

  function submitFree(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void answer(text.slice(0, 120), text);
  }

  const step = steps[index];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div aria-live="polite" className="space-y-3">
        {messages.map((message, position) => (
          <p
            key={position}
            className={cx(
              "animate-rise max-w-[85%] px-4 py-3 leading-7",
              message.from === "guide" ? "border border-ink/15 bg-panel" : "ml-auto bg-ink text-paper",
            )}
          >
            {message.text}
          </p>
        ))}
      </div>
      {!saving && (
        <div className="space-y-3 pt-2">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick replies">
            {step.chips.map((chip) => (
              <Button key={chip.value} variant="secondary" onClick={() => void answer(chip.value, chip.label)}>
                {chip.label}
              </Button>
            ))}
          </div>
          {step.free ? (
            <form onSubmit={submitFree} className="flex gap-2">
              <label htmlFor="free" className="sr-only">
                Or type your own answer
              </label>
              <input
                id="free"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={120}
                placeholder="Or type your own answer..."
                className="min-w-0 flex-1 border border-ink/25 bg-paper px-4 py-3 outline-none focus:border-accent"
              />
              <Button type="submit">Send</Button>
            </form>
          ) : null}
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

export default function OnboardingPage() {
  return <AppShell>{(session) => <Onboarding session={session} />}</AppShell>;
}
