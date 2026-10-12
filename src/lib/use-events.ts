"use client";

import { useEffect, useState } from "react";
import type { EventAnnotation } from "./analytics";
import { apiUrl } from "./api";

export type MacroEvent = EventAnnotation & { endsOn: string | null };

type EventPayload = {
  items: Array<{
    id: number | string;
    title: string;
    starts_on: string;
    ends_on?: string | null;
    source_url?: string | null;
    event_type: string;
    status: string;
  }>;
};

export function useEvents() {
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(apiUrl("events"), { signal: controller.signal });
        if (!response.ok) throw new Error("events");
        const payload = await response.json() as EventPayload;
        const items = Array.isArray(payload.items) ? payload.items : [];
        const published = items.filter((item) =>
          item.status === "published" &&
          typeof item.title === "string" &&
          typeof item.starts_on === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.starts_on) &&
          typeof item.event_type === "string",
        );
        if (controller.signal.aborted) return;
        setEvents(published.map((item) => ({
          id: item.id,
          title: item.title,
          date: item.starts_on,
          endsOn: item.ends_on ?? null,
          category: item.event_type,
          source: item.source_url ?? null,
        })));
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("فهرست رویدادهای منتشرشده دریافت نشد؛ خط‌های رویداد در نمودار نمایش داده نمی‌شوند.");
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  return { events, error };
}
