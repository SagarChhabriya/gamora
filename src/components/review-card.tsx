"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, Meter } from "@/components/ui";
import { authFetch } from "@/lib/auth/client";

type Topic = { concept_id: string; name: string; mastery_now: number; mastery_then: number; days_since: number; reason: "weak" | "fading" };
type Payload = {
  enabled: boolean;
  due_count: number;
  streak: number;
  streak_at_risk: boolean;
  days_away: number | null;
  review_minutes: number;
  review: { journey_id: string; journey_title: string; mission_id: string; mission_title: string; language: "en" | "roman_ur"; topics: Topic[] } | null;
  nudge: { id: string; message: string } | null;
};

const record = (action: "review_started" | "dismissed", nudgeId?: string) =>
  void authFetch("/api/engagement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, nudge_id: nudgeId }) }).catch(() => undefined);

/**
 * Spaced review on the home page: topics that are fading, how far each has slipped since it was
 * practised, and one tap into a short review round. Shows the stored nudge text when there is one.
 */
export function ReviewCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    void authFetch("/api/engagement")
      .then(async (response) => (response.ok ? setData((await response.json()) as Payload) : null))
      .catch(() => undefined);
  }, []);

  if (hidden || !data?.enabled || (!data.review && !data.streak_at_risk)) return null;
  const review = data.review;
  const ur = review?.language === "roman_ur";
  const href = review ? `/journey/${review.journey_id}/mission/${review.mission_id}?review=1` : null;
  const welcome = data.days_away && data.days_away >= 2 ? (ur ? `${data.days_away} din baad wapsi par khush aamdeed.` : `Good to see you again after ${data.days_away} days.`) : null;

  return (
    <section aria-label="Review" className="border-2 border-accent bg-paper p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
            {data.streak_at_risk ? `🔥 ${data.streak}-day streak at risk` : ur ? "Review ka waqt" : "Time for a quick review"}
          </p>
          <h2 className="mt-2 text-xl font-semibold leading-7">
            {data.nudge?.message ??
              (review
                ? ur
                  ? `"${review.journey_title}" ke kuch topics yaad se nikal rahe hain.`
                  : `Some topics from "${review.journey_title}" are fading.`
                : ur
                  ? "Aaj ek chhota sa review streak bacha lega."
                  : "A short review today keeps your streak going.")}
          </h2>
          {welcome ? <p className="mt-1 text-sm text-ink/65">{welcome}</p> : null}
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setHidden(true);
            record("dismissed", data.nudge?.id);
          }}
          aria-label="Hide review for now"
        >
          Later
        </Button>
      </div>

      {review ? (
        <>
          <ul className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Topics to review">
            {review.topics.map((topic) => (
              <li key={topic.concept_id} className="border border-ink/15 bg-panel p-3">
                <p className="text-sm font-semibold leading-5">{topic.name}</p>
                <p className="mt-1 text-xs text-ink/60">
                  {topic.reason === "weak" ? "Not solid yet" : `Last practised ${topic.days_since} days ago`}: {Math.round(topic.mastery_then * 100)}% → {Math.round(topic.mastery_now * 100)}%
                </p>
                <div className="mt-2">
                  <Meter value={topic.mastery_now} label={`${topic.name} mastery now`} />
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={href!}
              onClick={() => record("review_started", data.nudge?.id)}
              className="inline-flex min-h-11 items-center bg-accent px-5 text-sm font-semibold text-paper hover:bg-ink"
            >
              {ur ? `${data.review_minutes} minute ka review shuru karein` : `Start a ${data.review_minutes}-minute review`}
            </Link>
            <p className="text-xs text-ink/60">
              {ur ? "Mission" : "In"} “{review.mission_title}”. {data.due_count > review.topics.length ? `${data.due_count - review.topics.length} more topics are waiting after this one.` : ""}
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
