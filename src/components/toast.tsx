"use client";

import { useCallback, useEffect, useState } from "react";

import { cx } from "@/components/ui";

export type ToastMessage = { id: number; text: string; tone: "success" | "info" | "error" };

/** Small announcement in the corner. Screen readers hear it through the live region. */
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((text: string, tone: ToastMessage["tone"] = "success") => setToast({ id: Date.now(), text, tone }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6_000);
    return () => clearTimeout(timer);
  }, [toast]);
  const view = (
    <div aria-live="polite" role="status" className="pointer-events-none fixed bottom-4 right-4 left-4 z-50 flex justify-end sm:left-auto">
      {toast ? (
        <p
          key={toast.id}
          className={cx(
            "animate-rise pointer-events-auto max-w-sm border-l-4 bg-ink px-4 py-3 text-sm text-paper shadow-lg",
            toast.tone === "success" ? "border-good" : toast.tone === "error" ? "border-danger" : "border-accent",
          )}
        >
          {toast.text}
        </p>
      ) : null}
    </div>
  );
  return { show, view };
}
