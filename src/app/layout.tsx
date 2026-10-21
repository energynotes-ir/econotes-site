import type { Metadata } from "next";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./globals.css";
import "./enterprise.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://econotes.ir"),
  title: { default: "اکونوتس | اقتصاد کلان و بازارهای ایران", template: "%s | اکونوتس" },
  description: "ارز، طلا، اوراق، بورس و شاخص‌های اقتصاد ایران را دنبال و مقایسه کنید.",
  applicationName: "EcoNotes",
  openGraph: { type: "website", locale: "fa_IR", siteName: "اکونوتس", title: "اکونوتس | اقتصاد کلان و بازارهای ایران", description: "ارز، طلا، اوراق، بورس و شاخص‌های اقتصاد ایران را دنبال و مقایسه کنید." },
  twitter: { card: "summary", title: "اکونوتس | اقتصاد کلان و بازارهای ایران", description: "ارز، طلا، اوراق، بورس و شاخص‌های اقتصاد ایران را دنبال و مقایسه کنید." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body suppressHydrationWarning>{children}</body></html>;
}
