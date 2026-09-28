import { defaultConfig, parseConfig, type AppConfig } from "@/lib/config/schema";
import { supabaseRequest } from "@/lib/supabase/server";

let cached: { at: number; value: { version: number; config: AppConfig } } | null = null;
const TTL_MS = 5_000;

/** The active admin config. Short in-memory cache so a save shows up on the next turn. */
export async function getActiveConfig(): Promise<{ version: number; config: AppConfig }> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const rows = await supabaseRequest<Array<{ version: number; config: unknown }>>(
      "configs?is_active=eq.true&select=version,config&order=version.desc&limit=1",
    );
    const row = rows?.[0];
    const value = row ? { version: row.version, config: parseConfig(row.config) } : { version: 0, config: defaultConfig };
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return { version: 0, config: defaultConfig };
  }
}

export function clearConfigCache() {
  cached = null;
}
