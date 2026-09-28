import type { Raw } from "@/lib/analytics/compute";
import { supabaseRequest } from "@/lib/supabase/server";

async function all<T>(path: string) {
  return (await supabaseRequest<T[]>(path)) ?? [];
}

/** Loads the rows dashboards need. Sized for a pilot cohort; move to SQL views past a few thousand learners. */
export async function loadRaw(): Promise<Raw> {
  const [profiles, sessions, evidence, mastery, journeys, missions, concepts, contents, events] = await Promise.all([
    all<Raw["profiles"][number]>("profiles?select=id,display_name,persona,language_pref,role,is_demo,created_at&limit=2000"),
    all<Raw["sessions"][number]>("sessions?select=id,learner_id,journey_id,mission_id,started_at,ended_at,completed_at,language,persona&order=started_at.desc&limit=5000"),
    all<Raw["evidence"][number]>("evidence_events?select=session_id,learner_id,concept_id,signal,value,created_at&order=created_at.asc&limit=20000"),
    all<Raw["mastery"][number]>("mastery?select=learner_id,concept_id,mastery,confidence,evidence_count&limit=20000"),
    all<Raw["journeys"][number]>("journeys?select=id,learner_id,content_id&limit=5000"),
    all<Raw["missions"][number]>("missions?select=id,journey_id,idx&limit=20000"),
    all<Raw["concepts"][number]>("concepts?select=id,name,content_id&limit=10000"),
    all<Raw["contents"][number]>("contents?select=id,title&order=created_at.desc&limit=500"),
    all<Raw["events"][number]>("events?select=type,ok,latency_ms,tokens_in,tokens_out,provider,payload,user_hash,created_at&order=created_at.desc&limit=8000"),
  ]);
  return { profiles, sessions, evidence, mastery, journeys, missions, concepts, contents, events };
}
