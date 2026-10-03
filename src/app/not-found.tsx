import Link from "next/link";

export default function NotFound() {
  return <main className="legal-page not-found"><span className="eyebrow">صفحه پیدا نشد · ۴۰۴</span><h1>این نشانی در کتابخانه ما نیست.</h1><p>به صفحه پژوهش برگردید و از فهرست سری‌ها مسیر دیگری انتخاب کنید.</p><Link className="outline-button" href="/">بازگشت به اکونوتس</Link></main>;
}
