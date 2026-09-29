# How Gamora calculates mastery

This page explains, step by step, how Gamora turns a learner's answers into a mastery score, and how that score unlocks missions. Every number here comes from the live settings (admin config version 4) and was checked by running the real code. The code lives in `src/lib/learner-model/mastery.ts` (the formula) and `src/lib/tutor/evaluate.ts` (what each answer counts as).

## The idea in one paragraph

Gamora never gives a test. Instead, every time you answer something, it asks: *what does this answer show about what you understand?* A clean correct answer shows a lot. Needing a hint shows a bit less. Using an idea in a new situation shows more. Fixing your own mistake shows real learning. Each of these is a piece of **evidence**, and each piece nudges your **mastery** of that topic up or down. Mastery is a number from 0% to 100% per topic.

## Step 1: an answer becomes evidence signals

| What happened | Signal | Strength |
|---|---|---|
| Right (80% or more of the expected points) on the first try | `correct` | 1.0 (0.6 if you used a hint) |
| Partly right (40% to 79%) | `partial` | equal to how right it was, e.g. 0.6 |
| Wrong (under 40%) | `wrong` | -1.0 |
| Right after being wrong once | `self_corrected` | 0.6 |
| Right in a decision, role-play, crossroads or capstone case | `transfer` (extra) | 1.0 |
| Explained the idea back to a "friend" well | `teach_back` (extra) | 1.0 |
| Remembered an earlier idea in a flashback | `recall_success` / `recall_fail` | 1.0 / -1.0 |
| Used one or two hints | `hint_used` (extra) | -0.3 per hint, at most two |
| Confidence rating matched your real mastery | `calibrated` | 0.3 |
| Confidence rating much higher than your real mastery | `overconfident` | -0.3 |

How "right" is decided: choices (decisions, spot the slip, put in order) are marked by code, exactly. Open answers are marked by the AI against the list of points a good answer contains, taken from your material, and it is told to be generous with wording and strict on facts.

## Step 2: each signal moves mastery

Each signal has a **weight** (how much that kind of evidence matters) set by the admin:

| Signal | Weight |
|---|---|
| correct | 1.0 |
| transfer (new situation) | 1.2 |
| teach_back | 1.2 |
| recall_success | 1.1 |
| partial | 0.8 |
| recall_fail | 0.8 |
| wrong | 0.6 |
| self_corrected | 0.6 |
| calibrated / overconfident | 0.3 |
| hint_used | 0.2 |

The change for one signal is:

```
change = weight x strength x step          (step = 0.35)
```

Two adjustments keep it fair:

- **Gains get smaller as you improve.** A positive change is multiplied by `(1 - mastery x 0.5)`. At 0% you get the full gain; at 60% you get 70% of it. This stops one lucky answer from jumping straight to "mastered".
- **Losses get smaller as the estimate becomes sure of you.** A negative change is multiplied by `(1 - confidence x 0.5)`. One slip after several good answers costs less than a slip at the very start.

Mastery always stays between 0% and 100%.

**Confidence** is how sure Gamora is about the estimate itself (not the learner's confidence). It grows with the amount of evidence: `confidence = 1 - 1 / (1 + evidence x 0.35)`.

## Step 3: mastery fades without practice

Mastery fades by 2% of its value each day since you last showed it, calculated when it is read:

```
mastery today = mastery x e^(-0.02 x days)
```

So 64% becomes about 58% after 5 days and about 35% after 30 days. Practising the topic again (a flashback question, a practice round) brings it back up.

## Step 4: from topic mastery to unlocking missions

- **Mission mastery** is the average mastery of the topics in that mission.
- **The next mission unlocks** when the previous mission is finished **and** its mission mastery is at least **50%**. If it is not there yet, the learner gets a practice round.
- **A topic is "mastered"** at **80%**.
- **Stars** for a finished mission: 3 at 80% or more, 2 at 50% or more, else 1.
- **Labels** on the journey map: new (0%), emerging (under 25%), developing (25% to 49%), solid (50% to 79%), mastered (80% and up).

## Worked examples (real output of the code)

| What the learner did on one topic | Mastery after each answer |
|---|---|
| Three clean correct answers | 35.0% → 63.9% (unlocks) → 87.7% (mastered) |
| Correct, then partly right (60%) | 35.0% → 48.9% (just under unlock; one more good answer does it) |
| Two answers that were each 70% right | 19.6% → 37.3% |
| One correct decision in a scenario (correct plus transfer) | 69.7% in one step |
| Correct, but with one hint | 18.9% |
| Wrong, then fixed it on the second try | 0% → 12.6% |
| Correct, correct, then wrong | 35.0% → 63.9% → 47.2% |
| Two correct, then 30 days without practice | 63.9% → 35.1% |

Here is the first example worked by hand:

1. First correct answer: `1.0 x 1.0 x 0.35 = 0.35`, mastery is 0 so the full gain applies: **35%**.
2. Second: `0.35 x (1 - 0.35 x 0.5) = 0.35 x 0.825 = 0.289`, so 35% + 28.9% = **63.9%**, above the 50% unlock.
3. Third: `0.35 x (1 - 0.639 x 0.5) = 0.35 x 0.68 = 0.238`, so **87.7%**, above the 80% mastered line.

## Why it was changed (September 2026)

The first version used a step of 0.25, a partial answer always counted as strength 0.4 with weight 0.5, a wrong answer weighed 1.0, and missions unlocked at 60%. With those values two correct answers reached only 46%, a partly right answer added about 5 points, and most missions give a topic only one or two scored questions. Production data showed 34 finished missions stuck below the line. The new values keep the same formula and the same explainability, and let two clean answers unlock the next mission.

## How to explain it in one breath

> "Every answer counts as evidence. A correct answer adds about a third of the way to full mastery, less as you get closer, and more if you apply the idea to a new situation. Hints and mistakes take a little away. Two clean answers unlock the next mission; three master the topic. It fades slowly if you stop practising. No tests, and every number can be traced to the answers behind it."

## Where to change it

Admins can change every number above without a deploy: **Admin → Configuration → Mastery thresholds** (unlock at, mastered at, fading per day, evidence step size) and the evidence weights in the raw JSON view. Each save is a new version with a note, and rollback is one click.
