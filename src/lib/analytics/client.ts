"use client";

import { authFetch } from "@/lib/auth/client";

export type FilterState = { from: string; to: string; persona: string; language: string; content_id: string; cohort: string; reveal: string };

export const emptyFilters: FilterState = { from: "", to: "", persona: "", language: "", content_id: "", cohort: "all", reveal: "0" };

export function filterQuery(filters: FilterState) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
  return params.toString();
}

/** Downloads a CSV through the authenticated API. */
export async function downloadCsv(table: string, filters: FilterState) {
  const response = await authFetch(`/api/admin/export?table=${table}&${filterQuery(filters)}`);
  if (!response.ok) throw new Error("Export failed");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `gamora-${table}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
