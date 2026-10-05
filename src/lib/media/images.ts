import type { AppConfig } from "@/lib/config/schema";
import { hashKey, kvDel, kvGet, kvSet } from "@/lib/llm/cache";
import { generateImage } from "@/lib/media/gemini-media";
import { planImage } from "@/lib/media/pricing";
import { logEvent } from "@/lib/observability/events";
import { supabaseRequest } from "@/lib/supabase/server";

const BUCKET = "media";
/** Bump to redraw every image after a style change; old files stay until cleaned up. */
const STYLE_VERSION = "v1";
const STYLE =
  "Flat vector editorial illustration for a learning app, warm limited palette of deep teal, saffron and off-white, soft shapes, calm and friendly. People, when shown, are Pakistani. Absolutely no text, letters, numbers, labels, charts or logos anywhere in the image.";

export type TopicForImage = { id: string; content_id: string; name: string; summary: string };

/**
 * The image prompt for a topic. It describes a scene, never facts: an illustration cannot invent a
 * figure or a rule because it carries no text. The topic text is source material, so it is quoted
 * as the subject, trimmed, and stripped of anything that looks like markup.
 */
export function topicImagePrompt(topic: Pick<TopicForImage, "name" | "summary">) {
  const clean = (value: string, max: number) => value.replace(/[<>{}`"]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
  return `${STYLE}\nScene: an everyday moment that makes this idea easy to picture. Idea: "${clean(topic.name, 90)}". What it means: "${clean(topic.summary, 280)}".`;
}

/** Same topic, same tier, same style: same key, so every learner of a source shares one image. */
export function topicImageKey(topic: Pick<TopicForImage, "id" | "content_id">, tier: string) {
  return `img:${STYLE_VERSION}:${tier}:${hashKey(topic.content_id, topic.id)}`;
}

function storageHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new Error("Supabase server configuration is missing");
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function upload(path: string, bytes: Buffer, mimeType: string) {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { ...storageHeaders(), "Content-Type": mimeType, "x-upsert": "true" },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) throw new Error(`Storage upload failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}

/** Short-lived links for private images. Learners never get a permanent public URL. */
export async function signedImageUrls(paths: string[], expiresIn = 3_600): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    headers: { ...storageHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn, paths }),
  });
  if (!response.ok) return new Map();
  const rows = (await response.json()) as Array<{ path?: string; signedURL?: string; error?: string | null }>;
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1`;
  return new Map(rows.filter((row) => row.path && row.signedURL && !row.error).map((row) => [row.path!, `${base}${row.signedURL}`]));
}

/** List-price spend on images since the first of this month (UTC). */
export async function imageSpendThisMonth(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const rows = (await supabaseRequest<Array<{ cost_usd: number }>>(`media_assets?created_at=gte.${start}&select=cost_usd`)) ?? [];
  return rows.reduce((sum, row) => sum + Number(row.cost_usd), 0);
}

type Context = { requestId: string; userHash?: string };
export type TopicImage = { path: string; alt: string };

/**
 * Images for a list of topics: stored ones are reused, missing ones are made when the cost
 * evaluator allows it (tier, monthly budget, per-source cap). Generation stops at the first
 * budget or cap refusal, and any failure leaves that topic without an image: panels then keep
 * their drawn views. Returns the images found or made, by topic id.
 */
export async function illustrateTopics(topics: TopicForImage[], config: AppConfig, context: Context): Promise<Map<string, TopicImage>> {
  const result = new Map<string, TopicImage>();
  if (!config.media.images || !topics.length) return result;
  const tier = config.media.image_tier;
  const keys = topics.map((topic) => topicImageKey(topic, tier));
  const stored = (await supabaseRequest<Array<{ key: string; storage_path: string }>>(`media_assets?key=in.(${keys.map((key) => `"${key}"`).join(",")})&select=key,storage_path`)) ?? [];
  const byKey = new Map(stored.map((row) => [row.key, row.storage_path]));
  let spend = await imageSpendThisMonth();
  const perSource = new Map<string, number>();

  // Plan first, one topic at a time, so the budget and per-source cap count every planned image.
  const jobs: Array<{ topic: TopicForImage; key: string; model: string; cost: number }> = [];
  for (const [index, topic] of topics.entries()) {
    const key = keys[index];
    const existing = byKey.get(key);
    if (existing) {
      result.set(topic.id, { path: existing, alt: `Illustration: ${topic.name}` });
      continue;
    }
    if (!perSource.has(topic.content_id)) {
      const rows = (await supabaseRequest<Array<{ key: string }>>(`media_assets?content_id=eq.${topic.content_id}&select=key`)) ?? [];
      perSource.set(topic.content_id, rows.length);
    }
    const plan = planImage({
      tier,
      cached: false,
      monthSpendUsd: spend,
      monthlyBudgetUsd: config.media.monthly_budget_usd,
      sourceImages: perSource.get(topic.content_id) ?? 0,
      maxPerSource: config.media.max_images_per_source,
    });
    if (!plan.generate) {
      await logEvent({ request_id: context.requestId, user_hash: context.userHash, type: "media.image_skipped", payload: { reason: plan.reason, content_id: topic.content_id, month_spend_usd: Number(spend.toFixed(4)) } });
      break;
    }
    spend += plan.estimatedCostUsd;
    perSource.set(topic.content_id, (perSource.get(topic.content_id) ?? 0) + 1);
    jobs.push({ topic, key, model: plan.model, cost: plan.estimatedCostUsd });
  }

  // Then generate three at a time, which keeps a six-panel storyboard well inside one function run.
  let stop = false;
  for (let start = 0; start < jobs.length && !stop; start += 3) {
    await Promise.all(
      jobs.slice(start, start + 3).map(async ({ topic, key, model, cost }) => {
        // Two learners opening the same new source at once should not pay for the same image twice.
        const lock = `lock:${key}`;
        if (await kvGet(lock)) return;
        await kvSet(lock, 1, 90);
        const started = Date.now();
        try {
          const image = await generateImage({ prompt: topicImagePrompt(topic), model });
          const extension = image.mimeType.includes("jpeg") ? "jpg" : image.mimeType.includes("webp") ? "webp" : "png";
          const path = `topics/${topic.content_id}/${key.split(":").pop()}-${tier}.${extension}`;
          await upload(path, image.bytes, image.mimeType);
          await supabaseRequest("media_assets", {
            method: "POST",
            headers: { Prefer: "return=minimal,resolution=ignore-duplicates" },
            body: JSON.stringify({ key, content_id: topic.content_id, concept_id: topic.id, model, storage_path: path, mime_type: image.mimeType, bytes: image.bytes.length, cost_usd: cost }),
          });
          result.set(topic.id, { path, alt: `Illustration: ${topic.name}` });
          await logEvent({
            request_id: context.requestId,
            user_hash: context.userHash,
            type: "media.image",
            provider: "gemini",
            latency_ms: Date.now() - started,
            tokens_out: image.outputTokens,
            payload: { model, tier, cost_usd: cost, content_id: topic.content_id, bytes: image.bytes.length },
          });
        } catch (error) {
          const reason = String((error as Error).message ?? error);
          await logEvent({ request_id: context.requestId, user_hash: context.userHash, type: "media.image", ok: false, provider: "gemini", latency_ms: Date.now() - started, payload: { model, tier, reason: reason.slice(0, 160) } });
          // Billing off or quota gone: the next batch would fail the same way.
          if (/(429|403|400)/.test(reason)) stop = true;
        } finally {
          await kvDel(lock);
        }
      }),
    );
  }
  return result;
}
