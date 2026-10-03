"use client";

import { useCallback, useEffect, useState } from "react";
import { groups, palette, shortTitles, sources, type Series } from "./data";
import { apiUrl, staticDataMode } from "./api";

type Bundle = { series: { id: string; title: string; description: string; group_id: string; unit: string; frequency: Series["frequency"]; source_id: string; last_checked_at: string; parent_id?: string }; points: Series["points"] };

export function useSeries() {
  const [series, setSeries] = useState<Series[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(apiUrl("dashboard-data?limit=20000"), { signal: controller.signal });
        if (!response.ok) throw new Error("catalog");
        const { items, static_snapshot_at } = await response.json() as { items: Bundle[]; static_snapshot_at?: string };
        if (controller.signal.aborted) return;
        const available = items.flatMap(({ series: meta, points: rawPoints }, index) => {
          const points = rawPoints.filter((p) => Number.isFinite(p.value));
          if (!points.length || !(meta.group_id in groups)) return [];
          const id = meta.id === "usd-free-wallex" ? "usd-free" : meta.id;
          return [{ id, title: meta.title, shortTitle: shortTitles[id] ?? meta.title,
            group: meta.group_id as Series["group"], unit: meta.unit, frequency: meta.frequency,
            source: sources[meta.source_id] ?? (meta.source_id.startsWith("cbi-tsd") ? "بانک مرکزی · TSD" : meta.source_id),
            description: meta.description, color: palette[index % palette.length], points,
            parent: meta.parent_id, retrievedAt: meta.last_checked_at, isDemo: false } satisfies Series];
        });
        if (!available.length) throw new Error("empty");
        setSeries(available);
        setSnapshotAt(static_snapshot_at ?? null);
        setMissing([]);
        setError("");
      } catch {
        if (!controller.signal.aborted) setError("دریافت داده کامل نشد. اتصال را بررسی کنید و دوباره تلاش کنید؛ داده ذخیره‌شده حفظ شده است.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const interval = staticDataMode ? undefined : setInterval(refresh, 300_000);
    return () => { controller.abort(); if (interval) clearInterval(interval); };
  }, [version, refresh]);
  return { series, loading, error, missing, refresh, snapshotAt };
}
