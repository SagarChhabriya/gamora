"use client";

import { authFetch } from "@/lib/auth/client";
import type { TurnEvent, TurnRequest } from "@/lib/tutor/engine";

/** Sends a tutor turn and calls onEvent for each streamed NDJSON event. */
export async function streamTurn(body: TurnRequest, onEvent: (event: TurnEvent) => void) {
  const response = await authFetch("/api/tutor/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    onEvent({ type: "error", message: payload.error ?? "Could not reach the tutor" });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line) as TurnEvent);
      } catch {
        // Ignore a malformed line rather than breaking the turn.
      }
    }
  }
  if (buffer.trim()) {
    try {
      onEvent(JSON.parse(buffer) as TurnEvent);
    } catch {
      // Ignore.
    }
  }
}
