import Link from "next/link";

export default function NotFound() {
  return <main className="legal-page not-found"><span className="eyebrow">خطای ۴۰۴</span><h1>صفحه پیدا نشد</h1><p>نشانی واردشده معتبر نیست یا صفحه جابه‌جا شده است.</p><Link className="outline-button" href="/">رفتن به نمای کلی بازار</Link></main>;
}
