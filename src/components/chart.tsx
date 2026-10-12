"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import type { EChartsOption, EChartsType, Payload } from "echarts";
import { alignEventAnnotations, type EventAnnotation } from "@/lib/analytics";
import type { Point } from "@/lib/data";
import { formatDate, formatNumber } from "@/lib/data";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });
const chartGroups = new Map<string, Set<EChartsType>>();
const synchronizingCharts = new WeakSet<EChartsType>();

type Props = {
  points: Point[];
  color?: string;
  height?: number;
  mini?: boolean;
  area?: boolean;
  unit?: string;
  step?: boolean;
  comparison?: { points: Point[]; name: string; color: string; step?: boolean };
  eventDates?: string[];
  events?: EventAnnotation[];
  domain?: [number, number];
  type?: "line" | "scatter";
  sharedDates?: string[];
  syncGroup?: string;
};

export default function Chart({ points, color = "#88c0d0", height = 300, mini = false, area = true, unit = "", step = false, comparison, eventDates = [], events = [], domain, type = "line", sharedDates, syncGroup }: Props) {
  const chartRef = useRef<EChartsType | null>(null);
  const visible = points.filter((p) => Number.isFinite(p.value));
  const primary = new Map(visible.map((point) => [point.date, point]));
  const secondary = comparison ? new Map(comparison.points.filter((p) => Number.isFinite(p.value)).map((p) => [p.date, p])) : null;
  const dates = sharedDates ?? [...new Set([...points, ...(comparison?.points ?? [])].map((point) => point.date))].sort();
  const marks = eventDates.map((date) => dates.find((d) => d >= date)).filter((date): date is string => Boolean(date)).map((date) => ({ xAxis: date }));
  const eventMarks = alignEventAnnotations(events, dates).map((event) => ({
    name: `${event.title} · ${formatDate(event.date)} · ${event.category}`,
    xAxis: event.chartDate,
    lineStyle: { color: "#ebcb8b", type: "dotted" as const, width: 1.5, opacity: 0.85 },
  }));
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const option: EChartsOption = {
    animation: false,
    grid: mini ? { left: 1, right: 1, top: 3, bottom: 1 } : { left: 68, right: 22, top: 24, bottom: 76 },
    dataZoom: mini ? undefined : [
      { type: "inside", filterMode: "none", zoomOnMouseWheel: false, moveOnMouseWheel: false },
      { type: "slider", height: 18, bottom: 7, borderColor: "#434c5e", backgroundColor: "#2e3440", fillerColor: "#88c0d026", handleStyle: { color: "#88c0d0" }, textStyle: { color: "#d8dee9", fontFamily: "Vazirmatn" }, labelFormatter: (value: unknown) => { const index = Number(value); return dates[index] ? formatDate(dates[index]) : ""; } },
    ],
    tooltip: mini ? { show: false } : {
      trigger: "axis", confine: true, backgroundColor: "#2e3440", borderColor: "#4c566a", textStyle: { color: "#eceff4", fontFamily: "Vazirmatn", fontSize: 12 },
      axisPointer: { type: "cross", lineStyle: { color: "#a9bbb9", type: "dashed" } },
      formatter: (items: unknown) => {
        const rows = items as Array<{ dataIndex: number; marker: string; seriesName: string }>;
        const index = rows[0]?.dataIndex;
        const date = index === undefined ? undefined : dates[index];
        if (!date) return "";
        const p = primary.get(date);
        const comparisonPoint = secondary?.get(date);
        const values = [
          p ? { point: p, name: "مقدار", color, marker: rows.find((row) => row.seriesName === "مقدار")?.marker ?? "" } : null,
          comparisonPoint && comparison ? { point: comparisonPoint, name: comparison.name, color: comparison.color, marker: rows.find((row) => row.seriesName === comparison.name)?.marker ?? "" } : null,
        ].filter((row): row is NonNullable<typeof row> => row !== null);
        if (!values.length) return "";
        return `<div style="min-width:145px;text-align:right"><b>${formatDate(date)}</b><div style="color:#90a4ae;font-size:11px;direction:ltr;text-align:right">${date}</div>${values.map(({ point, name, marker }) => {
          const sourcePoint = point;
          const originalDate = sourcePoint?.sourceDate;
          const sourceLabel = originalDate && originalDate !== date
            ? `<div style="color:#90a4ae;font-size:11px">تاریخ مشاهده اصلی: ${formatDate(originalDate)}</div>` : "";
          return `<div style="margin-top:7px">${marker} ${escapeHtml(name)}: <b>${formatNumber(point.value, 2)}</b> ${escapeHtml(unit)}${sourceLabel}</div>`;
        }).join("")}${p?.symbol ? `<div style="margin-top:7px;color:#e2ae69">${escapeHtml(p.symbol)}</div>` : ""}</div>`;
      },
    },
    xAxis: { type: "category", show: !mini, boundaryGap: type === "scatter", data: dates, axisLine: { lineStyle: { color: "#344857" } }, axisTick: { show: false }, axisLabel: { color: "#8197a3", fontFamily: "Vazirmatn", formatter: (date: string) => { try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); } catch { return date; } }, interval: "auto", hideOverlap: true, margin: 14 }, splitLine: { show: false } },
    yAxis: { type: "value", min: domain?.[0], max: domain?.[1], scale: !domain, show: !mini, axisLabel: { color: "#8197a3", fontFamily: "Vazirmatn", formatter: (v: number) => Math.abs(v) >= 1e6 ? `${formatNumber(v / 1e6, 1)}م` : Math.abs(v) >= 1e3 ? `${formatNumber(v / 1e3, 0)}ه` : formatNumber(v, 1) }, splitLine: { lineStyle: { color: "#263b49", type: "dashed" } } },
    series: [
      { name: "مقدار", type, data: dates.map((date) => primary.get(date)?.value ?? null), smooth: type === "line" && !step ? 0.18 : undefined, step: step ? "end" : undefined, showSymbol: type === "scatter" ? true : false, symbol: "circle", symbolSize: type === "scatter" ? 8 : 4, lineStyle: { color, width: type === "scatter" ? 0 : mini ? 2 : 2.6 }, itemStyle: { color }, areaStyle: type === "line" && area ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}39` }, { offset: 1, color: `${color}00` }] } } : undefined, markLine: mini || type === "scatter" || (!marks.length && !eventMarks.length) ? undefined : { silent: false, tooltip: { show: true, trigger: "item" }, symbol: ["none", "none"], label: { show: false }, lineStyle: { color: "#d3a260", type: "dashed", opacity: 0.65 }, data: [...marks, ...eventMarks] } },
      ...(comparison ? [{ name: comparison.name, type: "line" as const, data: dates.map((date) => secondary?.get(date)?.value ?? null), smooth: comparison.step ? false : 0.18, step: comparison.step ? "end" as const : undefined, showSymbol: false, lineStyle: { color: comparison.color, width: 2 }, itemStyle: { color: comparison.color } }] : []),
    ],
  };
  useEffect(() => {
    const instance = chartRef.current;
    if (!syncGroup || !instance) return;
    const group = chartGroups.get(syncGroup) ?? new Set<EChartsType>();
    group.add(instance);
    chartGroups.set(syncGroup, group);
    return () => {
      group.delete(instance);
      if (!group.size) chartGroups.delete(syncGroup);
    };
  }, [syncGroup]);
  if (!visible.length) return <div className={mini ? "chart-placeholder" : "chart-empty"} style={{ height }} role="status">{mini ? "" : "داده کافی برای این نمودار وجود ندارد."}</div>;
  const onChartReady = syncGroup ? (instance: EChartsType) => {
    chartRef.current = instance;
    const group = chartGroups.get(syncGroup) ?? new Set<EChartsType>();
    group.add(instance);
    chartGroups.set(syncGroup, group);
  } : undefined;
  const syncEvent = (kind: "datazoom" | "updateAxisPointer", value: unknown) => {
    const source = chartRef.current;
    if (!syncGroup || !source || synchronizingCharts.has(source)) return;
    const peers = chartGroups.get(syncGroup);
    if (!peers) return;
    const event = value as {
      start?: number;
      end?: number;
      startValue?: string | number;
      endValue?: string | number;
      dataIndex?: number;
      currTrigger?: string;
      batch?: Array<{ start?: number; end?: number; startValue?: string | number; endValue?: string | number }>;
      axesInfo?: Array<{ axisDim?: string; value?: string | number; seriesDataIndices?: Array<{ dataIndex?: number }> }>;
    };
    let action: Payload;
    if (kind === "datazoom") {
      const range = event.batch?.[0] ?? event;
      if (typeof range.start !== "number" || typeof range.end !== "number") return;
      action = { type: "dataZoom", start: range.start, end: range.end, escapeConnect: true };
    } else {
      const axis = event.axesInfo?.find((item) => item.axisDim === "x") ?? event.axesInfo?.[0];
      const axisIndex = axis?.seriesDataIndices?.[0]?.dataIndex;
      const valueIndex = axis?.value === undefined ? -1 : dates.indexOf(String(axis.value));
      const dataIndex = axisIndex ?? (valueIndex >= 0 ? valueIndex : event.dataIndex);
      if (event.currTrigger === "leave") {
        action = { type: "updateAxisPointer", currTrigger: "leave", escapeConnect: true };
      } else if (typeof dataIndex === "number" && dataIndex >= 0) {
        action = { type: "updateAxisPointer", seriesIndex: 0, dataIndex, currTrigger: "mousemove", escapeConnect: true };
      } else return;
    }
    for (const peer of peers) {
      if (peer === source || peer.isDisposed()) continue;
      synchronizingCharts.add(peer);
      peer.dispatchAction(action);
      synchronizingCharts.delete(peer);
    }
  };
  const onEvents = syncGroup ? {
    datazoom: (event: unknown) => syncEvent("datazoom", event),
    updateAxisPointer: (event: unknown) => syncEvent("updateAxisPointer", event),
  } : undefined;
  return <div role={mini ? undefined : "img"} aria-label={mini ? undefined : `نمودار ${unit}؛ ${formatDate(dates[0])} تا ${formatDate(dates.at(-1)!)}`}><ReactECharts option={option} notMerge lazyUpdate onChartReady={onChartReady} onEvents={onEvents} style={{ height, width: "100%" }} /></div>;
}
