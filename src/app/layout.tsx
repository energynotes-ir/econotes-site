import type { Metadata } from "next";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./globals.css";
import "./enterprise.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://econotes.ir"),
  title: { default: "اکونوتس | میز پژوهش اقتصاد و بازار", template: "%s | اکونوتس" },
  description: "داشبورد پژوهشی اقتصاد کلان و بازارهای مالی ایران؛ داده‌های منبع‌دار، سنجش ریسک و آزمایش سناریو.",
  applicationName: "EcoNotes",
  openGraph: { type: "website", locale: "fa_IR", siteName: "اکونوتس", title: "اکونوتس | میز پژوهش اقتصاد و بازار", description: "داده‌های منبع‌دار و ابزارهای تحلیل اقتصاد ایران." },
  twitter: { card: "summary", title: "اکونوتس | میز پژوهش اقتصاد و بازار", description: "داده‌های منبع‌دار و ابزارهای تحلیل اقتصاد ایران." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body suppressHydrationWarning>{children}</body></html>;
}
