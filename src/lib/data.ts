export type Frequency = "daily" | "weekly" | "monthly" | "quarterly";
export type Group = "markets" | "metals" | "currency" | "rates" | "money" | "prices";
export type Point = { date: string; value: number; symbol?: string; sourceDate?: string };
export type Series = {
  id: string; title: string; shortTitle: string; group: Group; unit: string;
  frequency: Frequency; source: string; description: string; color: string;
  points: Point[]; parent?: string; isDemo?: boolean; retrievedAt?: string;
};
export const groups: Record<Group, string> = {
  markets: "شاخص‌های بورس", metals: "فلزات گران‌بها", currency: "ارز",
  rates: "نرخ‌های بهره", money: "پول و نقدینگی", prices: "قیمت‌ها و تورم",
};
export const palette = ["#88c0d0", "#81a1c1", "#ebcb8b", "#a3be8c", "#b48ead", "#d08770", "#8fbcbb", "#bf616a"];
export const featuredIds = ["tedpix", "equal", "usd-free", "gold", "gold-world", "yield", "liquidity", "base-money", "cpi-mom-cbi", "cpi-yoy-cbi", "usd-official-remittance-cbi", "omo-repo"];
export const riskIds = ["tedpix", "equal", "usd-free", "gold", "gold-world"];
export const shortTitles: Record<string, string> = {
  tedpix: "شاخص کل", equal: "شاخص هم‌وزن", "usd-free": "دلار آزاد · تتر",
  gold: "طلای ۱۸ عیار", "gold-world": "انس جهانی طلا", yield: "بازده اخزا",
  "yield-history": "بازده تاریخی اخزا و سخاب", liquidity: "نقدینگی", money: "پول", quasi: "شبه‌پول",
  "base-money": "پایه پولی", "cpi-ir-cbi": "شاخص قیمت ایران", "cpi-mom-cbi": "تورم ماهانه ایران",
  "cpi-yoy-cbi": "تورم نقطه‌ای ایران", "usd-official": "حواله دلار · فروش ETS",
  "usd-official-buy": "حواله دلار · خرید ETS", "usd-official-remittance-cbi": "حواله دلار · ماهانه",
  "usd-real": "شاخص دلار حقیقی", "omo-repo": "عملیات بازار باز · ریپو",
  "cpi-us": "شاخص قیمت آمریکا", "cpi-us-mom": "تورم ماهانه آمریکا", "cpi-us-yoy": "تورم نقطه‌ای آمریکا",
};
export const sources: Record<string, string> = {
  tsetmc: "TSETMC", "wallex-usdt": "والکس · USDT/TMN",
  "tgju-metals": "TGJU", "cbi-cpi-release": "بانک مرکزی · گزارش تورم",
  "cbi-ets": "بانک مرکزی · ETS", "ifb-ytm": "فرابورس · YTM",
  "ifb-ytm-history": "TSETMC · بازده محاسبه‌شده", "oecd-us-cpi": "OECD · CPI آمریکا",
  "mefa-monetary": "وزارت اقتصاد · بازنشر داده‌های بانک مرکزی",
  "derived-real-fx": "EcoNotes · والکس، CBI و OECD", "ibena-omo": "ایبنا · عملیات بازار باز",
};
export const last = (s: Series) => s.points.at(-1)?.value ?? NaN;
export const change = (s: Series) => {
  const previous = s.points.at(-2)?.value;
  return previous && s.points.length > 1 ? (last(s) / previous - 1) * 100 : NaN;
};
export const formatNumber = (n: number, digits = 0) => Number.isFinite(n)
  ? new Intl.NumberFormat("fa-IR", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n) : "—";
export const formatDate = (date: string) => new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
export const frequencyLabel = (frequency: Frequency) => ({ daily: "روزانه", weekly: "هفتگی", monthly: "ماهانه", quarterly: "فصلی" })[frequency];
export function periodPoints(points: Point[], months: number | null): Point[] {
  if (months === null || !points.length) return points;
  const cutoff = new Date(`${points.at(-1)!.date}T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return points.filter((point) => point.date >= cutoff.toISOString().slice(0, 10));
}
function csvCell(value: string | number) {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function csvRows(rows: (string | number)[][]): string {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([csvRows(rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = `econotes-${name}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
