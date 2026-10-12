import marimo

__generated_with = "0.25.1"
app = marimo.App(width="full")


@app.cell
def _():
    import json
    import sys
    from pathlib import Path

    import marimo as mo
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd

    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from ml_pipeline import guard

    snapshot_path = root / "public/data/api/v1/dashboard-data.json"
    profile_path = root / "ml_pipeline/data_profile.json"
    payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
    data_profile = json.loads(profile_path.read_text(encoding="utf-8"))
    raw_by_id = {entry["series"]["id"]: entry for entry in payload["items"]}

    target_entry = raw_by_id["tedpix"]
    target_points = sorted(target_entry["points"], key=lambda point: point["date"])
    target_dates = pd.to_datetime([point["date"] for point in target_points])
    target_values = pd.Series([point["value"] for point in target_points], dtype="float64")
    candidate = pd.DataFrame({
        "observed_on": target_dates,
        "tedpix_forward_5s_return_pct": np.log(target_values.shift(-5) / target_values) * 100,
    })

    daily_returns_by_id = {}
    inventory_rows = []
    for entry in payload["items"]:
        series = entry["series"]
        points = sorted(entry["points"], key=lambda point: point["date"])
        inventory_rows.append({
            "id": series["id"],
            "series": series["title"],
            "frequency": series["frequency"],
            "n": len(points),
            "first_date": points[0]["date"] if points else None,
            "last_date": points[-1]["date"] if points else None,
            "unit": series["unit"],
            "source_id": series["source_id"],
        })
        if series["frequency"] != "daily" or not points:
            continue
        values = pd.Series([point["value"] for point in points], dtype="float64")
        dates = pd.to_datetime([point["date"] for point in points])
        returns = np.log(values / values.shift(1)) * 100
        return_frame = pd.DataFrame({"observed_on": dates, f"{series['id']}_return_pct": returns})
        daily_returns_by_id[series["id"]] = return_frame
        if series["id"] != "tedpix":
            candidate = candidate.merge(return_frame, on="observed_on", how="left", validate="one_to_one")

    inventory = pd.DataFrame(inventory_rows).sort_values(["frequency", "id"]).reset_index(drop=True)
    daily_returns = pd.concat(
        [
            frame.set_index("observed_on")
            for frame in daily_returns_by_id.values()
        ],
        axis=1,
        join="outer",
    ).sort_index()
    inventory_by_id = inventory.set_index("id")

    horizon_rows = []
    for horizon in (1, 5, 20):
        forward = np.log(target_values.shift(-horizon) / target_values) * 100
        values = forward[np.isfinite(forward)]
        horizon_rows.append({
            "unit": f"{horizon} Tehran market sessions",
            "n": int(values.size),
            "mean_pct": float(values.mean()),
            "median_pct": float(values.median()),
            "std_pct": float(values.std(ddof=1)),
            "q05_pct": float(values.quantile(0.05)),
            "q95_pct": float(values.quantile(0.95)),
            "positive_share_pct": float((values > 0).mean() * 100),
        })
    horizon_stats = pd.DataFrame(horizon_rows)

    month_frame = pd.DataFrame({"date": target_dates, "value": target_values})
    month_frame["month"] = month_frame["date"].dt.to_period("M")
    month_ends = month_frame.groupby("month", sort=True).tail(1).sort_values("date")
    monthly_values = month_ends["value"].reset_index(drop=True)
    monthly_horizon_rows = []
    for horizon in (1, 3, 6, 12):
        forward = np.log(monthly_values.shift(-horizon) / monthly_values) * 100
        values = forward[np.isfinite(forward)]
        monthly_horizon_rows.append({
            "unit": f"{horizon} calendar months",
            "n": int(values.size),
            "mean_pct": float(values.mean()),
            "median_pct": float(values.median()),
            "std_pct": float(values.std(ddof=1)),
            "q05_pct": float(values.quantile(0.05)),
            "q95_pct": float(values.quantile(0.95)),
            "positive_share_pct": float((values > 0).mean() * 100),
        })
    monthly_horizon_stats = pd.DataFrame(monthly_horizon_rows)

    horizon_inventory = pd.concat(
        [
            horizon_stats.assign(
                target="TEDPIX close-to-close log return",
                horizon_family="Tehran market sessions",
            ),
            monthly_horizon_stats.assign(
                target="TEDPIX month-end to month-end log return",
                horizon_family="Calendar months",
            ),
        ],
        ignore_index=True,
    )
    horizon_inventory.to_csv(
        root / "ml_pipeline/horizon_sample_inventory.csv",
        index=False,
        float_format="%.6f",
    )

    return (
        candidate,
        daily_returns,
        data_profile,
        guard,
        horizon_stats,
        inventory,
        inventory_by_id,
        mo,
        monthly_horizon_stats,
        np,
        raw_by_id,
        root,
        plt,
        pd,
        target_dates,
        target_points,
        target_values,
    )


@app.cell
def _(data_profile, horizon_stats, inventory, mo, monthly_horizon_stats):
    profile_traits = data_profile["traits"]
    mo.md(
        f"""
        # بررسی داده و تعریف‌های کاندید

        این مرحله فقط پروفایل و آمار توصیفی است؛ هیچ مدل، ضریب رگرسیون یا پیش‌بینی برازش نشده است.
        پروفایل پنل کاندید هدف پنج‌جلسه‌ای **{profile_traits['n_rows']:,} ردیف** و
        {profile_traits['n_features']} ستون عددی شامل هدف و متغیرهای هم‌تاریخ کاندید دارد؛ هیچ‌کدام هنوز ورودی تأییدشده مدل نیستند.

        در این پنل، سهم سطرهای کاملاً تکراری **{data_profile['duplicates']['exact_row_frac']:.1%}** و
        موارد نشت خودکار **{len(data_profile['leakage_suspects'])}** است. این بررسی خودکار نبود نشت زمانی
        را ثابت نمی‌کند؛ اطلاعات انتشار و تاریخچه نسخه‌های آمار کلان باید جداگانه کنترل شوند.

        ## کاندید بازده شاخص کل

        بازده لگاریتمی آینده از مقدار شاخص کل در تاریخ مبدا تا مشاهده بعدی در افق مشخص محاسبه شده است.
        جدول افق‌های ماهانه از آخرین مشاهده واقعی شاخص در هر ماه استفاده می‌کند؛ هیچ تاریخ یا مقداری درون‌یابی نشده است.
        """
    )
    mo.vstack([
        mo.md("### افق‌های کوتاه · تعداد جلسه معاملاتی تهران"),
        mo.ui.table(horizon_stats, selection=None),
        mo.md("### افق‌های میان‌مدت · ماه تقویمی"),
        mo.ui.table(monthly_horizon_stats, selection=None),
        mo.md(
            f"### کتابخانهٔ ورودی\n{len(inventory):,} سری منبع‌دار بررسی شد. "
            "جدول قابل بازتولید افق‌ها: `ml_pipeline/horizon_sample_inventory.csv`."
        ),
    ])
    return


@app.cell
def _(candidate, guard, mo, root):
    eda_paths = guard.eda_figures(
        candidate,
        target="tedpix_forward_5s_return_pct",
        time_col="observed_on",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            ## پروفایل بازده‌های روزانه

            ستون‌های متغیر محرک در این شکل فقط تغییرات مشاهده‌شده در همان تاریخ‌اند و ورودی تأییدشده مدل نیستند.
            همبستگی‌ها توصیفی‌اند؛ برای استفاده پیش‌بین باید تاریخ دسترسی واقعی، وقفه‌ها و پنجره ارزیابی تأیید شوند.
            """
        ),
        *[
            mo.image(
                str(path),
                alt=path.stem,
                width="100%",
                caption=f"خروجی guard.eda_figures · {path.name}",
            )
            for path in eda_paths
        ],
    ])
    return


@app.cell
def _(guard, inventory, mo, plt, root):
    _frequency_counts = inventory.groupby("frequency", sort=True)["id"].count().sort_values()
    _figure, _axis = plt.subplots(figsize=(8, 3.8))
    _axis.barh(_frequency_counts.index.astype(str), _frequency_counts.values, color="#4c9f91")
    _axis.set_xlabel("Number of series")
    _axis.set_title("Series inventory by native frequency")
    _axis.grid(axis="x", alpha=0.2)
    _frequency_path = guard.fig(
        1,
        "native_frequency_inventory",
        _figure,
        f"{len(inventory)} source series are split across {len(_frequency_counts)} native frequencies; "
        "monthly and quarterly variables remain observations at their own dates, not daily rows.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** تعداد سری‌ها در هر تواتر را نشان می‌دهد. داده ماهانه، فصلی و هفتگی را در همان تواتر
            نگه می‌داریم تا نمایش پله‌ای با مشاهده تازه اشتباه نشود.
            """
        ),
        mo.image(str(_frequency_path), alt="Series inventory by native frequency", width="100%"),
    ])
    return


@app.cell
def _(guard, mo, np, plt, raw_by_id, root):
    _focus_ids = ["tedpix", "equal", "usd-free", "gold", "gold-world", "yield-history"]
    _figure, _axes = plt.subplots(len(_focus_ids), 1, figsize=(12, 12), sharex=False)
    for _axis, _series_id in zip(_axes, _focus_ids):
        _points = sorted(raw_by_id[_series_id]["points"], key=lambda point: point["date"])
        _values = np.asarray([point["value"] for point in _points], dtype=float)
        _dates = np.asarray([np.datetime64(point["date"]) for point in _points])
        _normalized = _values / _values[0] * 100
        _axis.plot(_dates, _normalized, linewidth=1.15, color="#326f81")
        _axis.set_title(f"{_series_id}: own first observation = 100", loc="left", fontsize=9)
        _axis.set_ylabel("Index")
        _axis.grid(alpha=0.2)
    _axes[-1].set_xlabel("Observed date")
    _figure.suptitle("Native observations; separate panel per series", y=1.002)
    _figure.tight_layout()
    _path = guard.fig(
        2,
        "native_observation_paths",
        _figure,
        "Each series is normalized from its own first available observation and stays in a separate panel; "
        "different starts and native observation dates make this a trend inspection, not a common-base performance comparison.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** هر سری در پنل مستقل از نخستین مشاهده خودش به ۱۰۰ شاخص شده است؛ شروع‌ها یکسان نیستند،
            پس این نمودار برای دیدن شکست‌ها و روندهاست و مقایسه بازده یک دوره مشترک نیست.
            """
        ),
        mo.image(str(_path), alt="Native observation paths", width="100%"),
    ])
    return


@app.cell
def _(daily_returns, guard, mo, np, plt, root):
    _return_ids = ["tedpix", "equal", "usd-free", "gold", "gold-world", "yield-history"]
    _figure, _axes = plt.subplots(2, 3, figsize=(12, 7))
    for _axis, _series_id in zip(_axes.flat, _return_ids):
        _column = f"{_series_id}_return_pct"
        _values = daily_returns[_column].replace([np.inf, -np.inf], np.nan).dropna()
        _axis.hist(_values, bins=45, color="#4c9f91", alpha=0.86)
        _axis.axvline(_values.median(), color="#c07a43", linestyle="--", linewidth=1)
        _axis.set_title(f"{_series_id} · n={len(_values):,}", fontsize=9)
        _axis.set_xlabel("Log return (%)")
        _axis.grid(axis="y", alpha=0.2)
    _figure.suptitle("Distribution of native one-observation log returns", y=1.01)
    _figure.tight_layout()
    _path = guard.fig(
        2,
        "daily_return_distributions",
        _figure,
        "Daily series have different coverage and holiday calendars; the histograms use only each series' own consecutive observations "
        "and are not synchronized daily returns for estimation.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** توزیع تغییرات لگاریتمی بین دو مشاهده واقعی متوالی هر سری را نشان می‌دهد.
            تعداد نمونه و تقویم‌ها متفاوت است؛ بنابراین این‌ها هنوز بازده‌های هم‌زمان‌شده برای برآورد نیستند.
            """
        ),
        mo.image(str(_path), alt="Daily return distributions", width="100%"),
    ])
    return


@app.cell
def _(candidate, guard, mo, np, pd, plt, root):
    _columns = [
        "tedpix_forward_5s_return_pct",
        "equal_return_pct",
        "usd-free_return_pct",
        "gold_return_pct",
        "gold-world_return_pct",
        "yield-history_return_pct",
    ]
    _labels = ["TEDPIX forward 5 sessions", "Equal-weight", "Free FX USDT", "Iran 18k gold", "Global gold", "Bond yield history"]
    _corr_frame = candidate[_columns].replace([np.inf, -np.inf], np.nan)
    _correlation = _corr_frame.corr(min_periods=50)
    _counts = _corr_frame.notna().astype("int64").T.dot(_corr_frame.notna().astype("int64"))
    _figure, _axis = plt.subplots(figsize=(8, 6))
    _image = _axis.imshow(_correlation.to_numpy(), vmin=-1, vmax=1, cmap="coolwarm")
    _axis.set_xticks(range(len(_columns)), _labels, rotation=40, ha="right")
    _axis.set_yticks(range(len(_columns)), _labels)
    for _row in range(len(_columns)):
        for _col in range(len(_columns)):
            _value = _correlation.iloc[_row, _col]
            _n = int(_counts.iloc[_row, _col])
            _text = "n/a" if pd.isna(_value) else f"{_value:.2f}\n(n={_n})"
            _axis.text(_col, _row, _text, ha="center", va="center", fontsize=7, color="#111")
    _axis.set_title("Exact-date exploratory correlation · no daily filling")
    _figure.colorbar(_image, ax=_axis, label="Pearson correlation")
    _figure.tight_layout()
    _path = guard.fig(
        2,
        "exact_date_return_correlations",
        _figure,
        "The matrix pairs only exact observed dates and prints pair counts; it is exploratory and does not correct release timing, "
        "horizon overlap, or multiple testing.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** هر خانه فقط تاریخ‌های دقیقاً مشترک را استفاده می‌کند و تعداد زوج‌ها را نشان می‌دهد؛
            مقدارها با تکرار روزانه ساخته نشده‌اند. بازده هدف پنج‌جلسه‌ای هم‌پوشان است و این همبستگی، آزمون پیش‌بینی نیست.
            """
        ),
        mo.image(str(_path), alt="Exact-date exploratory correlation", width="100%"),
    ])
    return


@app.cell
def _(guard, mo, pd, plt, raw_by_id, root):
    import matplotlib.dates as mdates

    _macro_ids = ["cpi-mom-cbi", "cpi-yoy-cbi", "liquidity", "base-money", "omo-repo"]
    _labels = {
        "cpi-mom-cbi": "Iran CPI monthly rate",
        "cpi-yoy-cbi": "Iran CPI year-over-year rate",
        "liquidity": "Liquidity · quarterly",
        "base-money": "Monetary base · quarterly",
        "omo-repo": "OMO repo · weekly",
    }
    _figure, _axes = plt.subplots(len(_macro_ids), 1, figsize=(12, 12), sharex=False)
    for _axis, _series_id in zip(_axes, _macro_ids):
        _points = sorted(raw_by_id[_series_id]["points"], key=lambda point: point["date"])
        _dates = pd.to_datetime([point["date"] for point in _points])
        _values = [point["value"] for point in _points]
        _unit = raw_by_id[_series_id]["series"]["unit"]
        _axis.plot(_dates, _values, marker=".", linewidth=1.05, markersize=3, color="#326f81")
        _scale_note = " · log scale" if _series_id in {"liquidity", "base-money"} else ""
        _axis.set_title(f"{_labels[_series_id]} · n={len(_points)} · {_unit}{_scale_note}", loc="left", fontsize=9)
        if _series_id in {"liquidity", "base-money"}:
            _axis.set_yscale("log")
        _locator = mdates.AutoDateLocator(minticks=4, maxticks=7)
        _axis.xaxis.set_major_locator(_locator)
        _axis.xaxis.set_major_formatter(mdates.ConciseDateFormatter(_locator))
        _axis.grid(alpha=0.2)
    _axes[-1].set_xlabel("Original observation date")
    _figure.suptitle("Macro and policy series at their native frequencies", y=1.003)
    _figure.tight_layout()
    _path = guard.fig(
        2,
        "native_frequency_macro_series",
        _figure,
        "CPI, liquidity, base money, and OMO use separate panels and original dates; no forward-filled points or common unit scale are used.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** تورم، نقدینگی، پایه پولی و OMO با تاریخ و تواتر منبع اصلی نمایش داده شده‌اند.
            چون واحدها متفاوت‌اند، هر سری محور مستقل دارد و هیچ ماه یا فصلِ منتشرنشده‌ای پر نشده است.
            """
        ),
        mo.image(str(_path), alt="Native-frequency macro series", width="100%"),
    ])
    return


@app.cell
def _(guard, mo, pd, plt, raw_by_id, root):
    _series_ids = [
        "tedpix",
        "usd-free",
        "usd-official",
        "usd-official-remittance-cbi",
        "cpi-mom-cbi",
        "cpi-yoy-cbi",
        "liquidity",
        "base-money",
        "omo-repo",
        "yield-history",
    ]
    _timestamp_basis = {
        "tedpix": "TSETMC fetch time",
        "usd-free": "Wallex import time",
        "usd-official": "CBI ETS import time",
        "usd-official-remittance-cbi": "CBI monthly import time",
        "cpi-mom-cbi": "source release date",
        "cpi-yoy-cbi": "source release date",
        "liquidity": "MEFA import time",
        "base-money": "MEFA import time",
        "omo-repo": "IBENA article publication time",
        "yield-history": "IFB/TSETMC update time",
    }
    _audit_rows = []
    for _series_id in _series_ids:
        _series = raw_by_id[_series_id]["series"]
        _points = sorted(raw_by_id[_series_id]["points"], key=lambda point: point["date"])
        _timestamps = sorted({point.get("published_at") for point in _points if point.get("published_at")})
        _audit_rows.append({
            "series_id": _series_id,
            "native_frequency": _series["frequency"],
            "observations": len(_points),
            "distinct_stored_timestamps": len(_timestamps),
            "latest_observation": _points[-1]["date"] if _points else None,
            "latest_stored_timestamp": _points[-1].get("published_at") if _points else None,
            "verified_field_semantics": _timestamp_basis[_series_id],
        })
    _audit_table = pd.DataFrame(_audit_rows)
    _figure, _axis = plt.subplots(figsize=(10, 5))
    _audit_sorted = _audit_table.sort_values("distinct_stored_timestamps")
    _axis.barh(
        _audit_sorted["series_id"],
        _audit_sorted["distinct_stored_timestamps"],
        color="#4c9f91",
    )
    _axis.set_xlabel("Distinct values recorded in published_at")
    _axis.set_title("Stored timestamp variation by series (not release-count coverage)")
    _axis.grid(axis="x", alpha=0.2)
    _path = guard.fig(
        2,
        "stored_timestamp_semantics",
        _figure,
        "Most historical market, FX, monthly CBI, and MEFA rows carry one or two batch timestamps; only the explicit CBI release and OMO article paths preserve source publication dates. "
        "The published_at field therefore cannot be treated as a universal real-time availability timestamp.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** این نمودار تعداد زمان‌های متفاوت ذخیره‌شده در فیلد published_at را می‌شمارد؛
            آن را تعداد تاریخ انتشار تفسیر نمی‌کنیم. بررسی importها نشان داد برای تتر، شاخص بورس، MEFA و
            بخشی از سری‌های CBI این فیلد زمان دریافت دسته‌ای است؛ CPI headline و مقاله‌های OMO تاریخ انتشار منبع دارند.
            بنابراین تاریخچهٔ فعلی اجازهٔ ادعای بک‌تست واقعاً زنده را نمی‌دهد.
            """
        ),
        mo.ui.table(_audit_table, selection=None, show_column_summaries=False),
        mo.image(str(_path), alt="Stored timestamp semantics by series", width="100%"),
    ])
    return


@app.cell
def _(candidate, guard, mo, plt, root):
    _coverage = candidate.notna().sum().drop(labels=["observed_on"]).sort_values()
    _figure, _axis = plt.subplots(figsize=(10, 4.6))
    _axis.barh(_coverage.index, _coverage.values, color="#4c9f91")
    _axis.set_xlabel("Non-missing observations on TEDPIX dates")
    _axis.set_title("Exact-date coverage of the short-horizon candidate panel")
    _axis.grid(axis="x", alpha=0.2)
    _path = guard.fig(
        2,
        "exact_date_predictor_coverage",
        _figure,
        "Exact-date counts show which daily series can be aligned without filling; official FX and the current yield snapshot are too sparse "
        "for this daily panel, while historical coverage still requires release-time and source-quality review.",
        state_dir=root / "ml_pipeline",
    )
    mo.vstack([
        mo.md(
            """
            **شرح شکل:** تعداد تغییرهای واقعی هر متغیر را در تاریخ‌های شاخص کل نشان می‌دهد. نرخ ETS فعلی و بازده زنده
            برای پنل روزانه بسیار کوتاه‌اند؛ آرشیو بازده اوراق نیز تعریف متفاوتی از YTM رسمی دارد.
            """
        ),
        mo.image(str(_path), alt="Exact-date predictor coverage", width="100%"),
    ])
    return


if __name__ == "__main__":
    app.run()
