"""Export the public SQLite-backed API responses for a static site build."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from api.app.main import bond_history, bond_snapshot, dashboard_data, get_series


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n",
        encoding="utf-8",
    )


def export_static_data(output_dir: Path) -> dict[str, int | str]:
    api_dir = output_dir / "api" / "v1"
    if api_dir.exists():
        shutil.rmtree(api_dir)
    api_dir.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    dashboard = dashboard_data(limit=20_000)
    dashboard["static_snapshot_at"] = generated_at
    write_json(api_dir / "dashboard-data.json", dashboard)

    snapshot = bond_snapshot()
    write_json(api_dir / "bonds.json", snapshot)
    write_json(api_dir / "series" / "yield.json", get_series("yield", limit=1_000))
    write_json(api_dir / "series" / "yield-history.json", get_series("yield-history", limit=5_000))

    instrument_ids = {
        str(bond["instrument_id"])
        for bond in [*snapshot["bonds"], *snapshot["historical_bonds"]]
        if str(bond["instrument_id"]).isascii() and str(bond["instrument_id"]).isdigit()
    }
    for instrument_id in sorted(instrument_ids):
        try:
            history = bond_history(instrument_id, limit=5_000)
        except HTTPException as error:
            if error.status_code != 404:
                raise
            continue
        write_json(api_dir / "bonds" / instrument_id / "history.json", history)

    summary = {
        "generated_at": generated_at,
        "series": len(dashboard["items"]),
        "points": sum(len(item["points"]) for item in dashboard["items"]),
        "bonds": len(instrument_ids),
    }
    write_json(output_dir / "snapshot.json", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "public" / "data",
        help="Generated public data directory (default: public/data)",
    )
    args = parser.parse_args()
    summary = export_static_data(args.output.resolve())
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
