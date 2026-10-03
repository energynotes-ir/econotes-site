# انتشار EcoNotes

## مسیر فعلی: GitHub Pages با snapshot استاتیک

نسخه فعلی بدون اجرای دائمی SQL، API یا Docker قابل میزبانی است. رابط سایت هنگام build، JSONهای snapshot را از `public/data/` می‌خواند و همه آن فایل‌ها همراه سایت به‌صورت عمومی منتشر می‌شوند.

### ساخت خروجی

برای ساخت snapshot از پایگاه داده محلی و سپس build استاتیک:

```sh
npm ci
python3 -m pip install -r api/requirements.txt
npm run prepare:static
```

`prepare:static` اجراکنندهٔ `scripts/export_static_data.py` و سپس `next build` با خروجی استاتیک است. سایت نهایی در `out/` ساخته می‌شود. پوشهٔ `public/data/` باید همراه کد به GitHub برسد؛ GitHub Actions پایگاه داده محلی را در اختیار ندارد و snapshot را خودش تولید نمی‌کند.

برای مشاهده محلی خروجی:

```sh
python3 -m http.server 8080 --directory out
```

سپس `http://127.0.0.1:8080` را باز کنید.

### به‌روزرسانی داده

پس از به‌روزرسانی پایگاه داده محلی، `npm run export:static-data` را اجرا کنید، تغییرات `public/data/` را بررسی و همراه کد push کنید. هر push به شاخه `main`، workflow فایل `.github/workflows/deploy-pages.yml` را اجرا می‌کند و خروجی تازه را روی GitHub Pages منتشر می‌کند. snapshot فعلی حدود ۲۵ مگابایت است و شامل سری‌های مجاز برای انتشار عمومی، تاریخچهٔ اوراق و زمان ساخت است.

در نسخه استاتیک داده‌ها لحظه‌ای نیستند؛ تا انتشار snapshot بعدی ثابت می‌مانند. تمام داده‌های `public/data/` برای عموم قابل دریافت‌اند. این مدل برای داده خصوصی، ورود کاربران، پرداخت یا محدودسازی اشتراک مناسب نیست.

### راه‌اندازی GitHub Pages و دامنه

1. کد و پوشهٔ `public/data/` را به مخزن `energynotes-ir/econotes-site` در شاخه `main` بفرستید. در **Settings → Pages**، منبع انتشار را روی **GitHub Actions** قرار دهید و workflow را اجرا کنید.
2. پس از آماده‌شدن صفحه در GitHub Pages، در همان بخش **Custom domain** مقدار `econotes.ir` را وارد و ذخیره کنید. GitHub توصیه می‌کند دامنه را پیش از ساخت رکوردهای DNS در تنظیمات Pages ثبت کنید. در انتشار با GitHub Actions نیازی به فایل `CNAME` در مخزن نیست.
3. در Cloudflare → DNS این رکوردها را ایجاد کنید. همه را **DNS only** (ابر خاکستری) بگذارید؛ این تنظیم با الگوی فعلی EnergyNotes هم‌خوان است.

| نوع | نام | مقصد |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `energynotes-ir.github.io` |

اگر در Cloudflare رکوردهای پیش‌فرض یا متناقضی برای `@` یا `www` وجود داشت، پیش از افزودن موارد بالا آن‌ها را بررسی کنید. پس از انتشار DNS، در GitHub Pages گزینهٔ **Enforce HTTPS** را فعال کنید.

### انتشار دستی

از ریشه پروژه:

```sh
npm run prepare:static
```

خروجی `out/` برای هر میزبان فایل استاتیک قابل استفاده است. برای GitHub Pages، workflow موجود build و انتشار را انجام می‌دهد؛ commit کردن `out/` لازم نیست.

## مرحله بعد: API و پایگاه داده روی سرور

وقتی سرور آماده شد، می‌توان به‌جای snapshot، API و پایگاه SQLite/Docker را اجرا کرد. فایل‌های پایهٔ Docker در ریشه پروژه باقی مانده‌اند:

- `compose.yaml`: وب، API، به‌روزرسان داده و Caddy
- `Dockerfile` و `api/Dockerfile`: ساخت imageهای وب و API
- `.env.deploy.example`: نمونه تنظیم دامنه و مسیر ماندگار داده
- `Caddyfile`: HTTPS و reverse proxy روی سرور

پیش از انتقال به این مسیر، پایگاه دادهٔ مورد استفاده را در فضای ماندگار سرور قرار دهید و تنظیمات DNS را از GitHub Pages به IP سرور تغییر دهید. مسیر استاتیک فعلی نیازی به اجرای این سرویس‌ها ندارد.
