"use client";

import dynamic from "next/dynamic";
import type { EChartsOption } from "echarts";
import type { Point } from "@/lib/data";
import { formatDate, formatNumber } from "@/lib/data";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

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
  domain?: [number, number];
  type?: "line" | "scatter";
};

export default function Chart({ points, color = "#88c0d0", height = 300, mini = false, area = true, unit = "", step = false, comparison, eventDates = [], domain, type = "line" }: Props) {
  const visible = points.filter((p) => Number.isFinite(p.value));
  const secondary = comparison ? new Map(comparison.points.filter((p) => Number.isFinite(p.value)).map((p) => [p.date, p])) : null;
  const dates = visible.map((p) => p.date);
  const marks = eventDates.map((date) => dates.find((d) => d >= date)).filter((date): date is string => Boolean(date)).map((date) => ({ xAxis: date }));
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
        const rows = items as Array<{ dataIndex: number; value: number; marker: string; seriesName: string }>;
        const index = rows[0]?.dataIndex ?? 0;
        const p = visible[index];
        if (!p) return "";
        return `<div style="min-width:145px;text-align:right"><b>${formatDate(p.date)}</b><div style="color:#90a4ae;font-size:11px;direction:ltr;text-align:right">${p.date}</div>${rows.map((row) => {
          const sourcePoint = row.seriesName === comparison?.name ? secondary?.get(p.date) : p;
          const originalDate = sourcePoint?.sourceDate;
          const sourceLabel = originalDate && originalDate !== p.date
            ? `<div style="color:#90a4ae;font-size:11px">تاریخ مشاهده اصلی: ${formatDate(originalDate)}</div>` : "";
          return `<div style="margin-top:7px">${row.marker} ${escapeHtml(row.seriesName)}: <b>${formatNumber(row.value, 2)}</b> ${escapeHtml(unit)}${sourceLabel}</div>`;
        }).join("")}${p.symbol ? `<div style="margin-top:7px;color:#e2ae69">${escapeHtml(p.symbol)}</div>` : ""}</div>`;
      },
    },
    xAxis: { type: "category", show: !mini, boundaryGap: type === "scatter", data: dates, axisLine: { lineStyle: { color: "#344857" } }, axisTick: { show: false }, axisLabel: { color: "#8197a3", fontFamily: "Vazirmatn", formatter: (date: string) => { try { return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)); } catch { return date; } }, interval: "auto", hideOverlap: true, margin: 14 }, splitLine: { show: false } },
    yAxis: { type: "value", min: domain?.[0], max: domain?.[1], scale: !domain, show: !mini, axisLabel: { color: "#8197a3", fontFamily: "Vazirmatn", formatter: (v: number) => Math.abs(v) >= 1e6 ? `${formatNumber(v / 1e6, 1)}م` : Math.abs(v) >= 1e3 ? `${formatNumber(v / 1e3, 0)}ه` : formatNumber(v, 1) }, splitLine: { lineStyle: { color: "#263b49", type: "dashed" } } },
    series: [
      { name: "مقدار", type, data: visible.map((p) => p.value), smooth: type === "line" && !step ? 0.18 : undefined, step: step ? "end" : undefined, showSymbol: type === "scatter" ? true : false, symbol: "circle", symbolSize: type === "scatter" ? 8 : 4, lineStyle: { color, width: type === "scatter" ? 0 : mini ? 2 : 2.6 }, itemStyle: { color }, areaStyle: type === "line" && area ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${color}39` }, { offset: 1, color: `${color}00` }] } } : undefined, markLine: mini || type === "scatter" || !marks.length ? undefined : { silent: true, symbol: ["none", "none"], label: { show: false }, lineStyle: { color: "#d3a260", type: "dashed", opacity: 0.65 }, data: marks } },
      ...(comparison ? [{ name: comparison.name, type: "line" as const, data: dates.map((d) => secondary?.get(d)?.value ?? null), smooth: comparison.step ? false : 0.18, step: comparison.step ? "end" as const : undefined, showSymbol: false, lineStyle: { color: comparison.color, width: 2 }, itemStyle: { color: comparison.color } }] : []),
    ],
  };
  if (!visible.length) return <div className={mini ? "chart-placeholder" : "chart-empty"} style={{ height }} role="status">{mini ? "" : "داده کافی برای این نمودار وجود ندارد."}</div>;
  return <div role={mini ? undefined : "img"} aria-label={mini ? undefined : `نمودار ${unit}؛ ${formatDate(visible[0].date)} تا ${formatDate(visible.at(-1)!.date)}`}><ReactECharts option={option} notMerge lazyUpdate style={{ height, width: "100%" }} /></div>;
}
