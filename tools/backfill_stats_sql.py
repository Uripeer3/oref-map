#!/usr/bin/env python
"""
Generate a D1 SQL backfill script for stats tables from day-history JSONL data.

Sources:
1) Local files (default): tmp/backfill-compare/*.new.jsonl
2) R2 bucket objects via Wrangler: --bucket <name> [--local-r2|--remote-r2]

Output:
- SQL file with UPSERT statements for stats_alerts
- Per-day coverage upserts to mark stats_coverage as complete

Usage examples:
    uv run tools/backfill_stats_sql.py
    uv run tools/backfill_stats_sql.py --output tmp/stats-backfill.sql
    uv run tools/backfill_stats_sql.py --bucket oref-history --remote-r2 --output tmp/stats-backfill.sql
"""

import argparse
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DATE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def normalize_title(title: str) -> str:
    return re.sub(r"\s+", " ", str(title or "")).strip()


def classify_title(title: str) -> str:
    t = normalize_title(title)

    if (
        "האירוע הסתיים" in t
        or (
            "ניתן לצאת" in t
            and "להישאר בקרבתו" not in t
        )
        or "החשש הוסר" in t
        or "יכולים לצאת" in t
        or "אינם צריכים לשהות" in t
        or "סיום שהייה בסמיכות" in t
        or t == "עדכון"
    ):
        return "green"

    if (
        t
        == "בדקות הקרובות צפויות להתקבל התרעות באזורך"
        or "לשפר את המיקום למיגון המיטבי"
        in t
        or t == "יש לשהות בסמיכות למרחב המוגן"
        or "להישאר בקרבתו" in t
    ):
        return "yellow"

    if t == "חדירת כלי טיס עוין":
        return "purple"

    return "red"


def normalize_alert_date(raw_alert_date: str) -> str:
    return str(raw_alert_date or "").replace(" ", "T").strip()


def parse_hour_minute(alert_date: str) -> tuple[int, int] | None:
    if len(alert_date) < 16:
        return None
    try:
        hour = int(alert_date[11:13])
        minute = int(alert_date[14:16])
    except ValueError:
        return None
    if hour < 0 or hour > 23 or minute < 0 or minute > 59:
        return None
    return hour, minute


def sql_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def parse_jsonl_text(text: str) -> list[dict]:
    out = []
    for raw_line in text.splitlines():
        line = raw_line.strip().rstrip(",")
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def parse_jsonl_file(path: Path) -> list[dict]:
    return parse_jsonl_text(path.read_text(encoding="utf-8"))


def resolve_wrangler_runner() -> list[str]:
    for candidate in ("npx", "npx.cmd", "npx.exe"):
        path = shutil.which(candidate)
        if path:
            return [path, "--yes", "wrangler"]

    for candidate in ("wrangler", "wrangler.cmd", "wrangler.exe"):
        path = shutil.which(candidate)
        if path:
            return [path]

    raise RuntimeError(
        "Could not find 'npx' or 'wrangler' in PATH. "
        "Install Node.js/Wrangler, then retry."
    )


def wrangler_run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def list_bucket_keys(bucket: str, use_remote: bool, wrangler_runner: list[str]) -> list[str]:
    cmd = [
        *wrangler_runner,
        "r2",
        "object",
        "list",
        bucket,
        "--remote" if use_remote else "--local",
    ]
    result = wrangler_run(cmd)
    if result.returncode != 0:
        raise RuntimeError(f"Bucket list failed:\n{result.stderr}")

    parsed = json.loads(result.stdout or "[]")
    if isinstance(parsed, dict) and isinstance(parsed.get("objects"), list):
        parsed = parsed["objects"]
    if not isinstance(parsed, list):
        parsed = []
    keys = []
    for item in parsed:
        key = str(item.get("key", ""))
        if key.endswith(".jsonl") and re.match(r"^\d{4}-\d{2}-\d{2}\.jsonl$", key):
            keys.append(key)
    return sorted(keys)


def download_bucket_text(
    bucket: str,
    key: str,
    use_remote: bool,
    wrangler_runner: list[str],
) -> str:
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jsonl") as f:
        temp_path = Path(f.name)

    try:
        cmd = [
            *wrangler_runner,
            "r2",
            "object",
            "get",
            f"{bucket}/{key}",
            "--file",
            str(temp_path),
            "--remote" if use_remote else "--local",
        ]
        result = wrangler_run(cmd)
        if result.returncode != 0:
            return ""
        if not temp_path.exists() or temp_path.stat().st_size == 0:
            return ""
        return temp_path.read_text(encoding="utf-8")
    finally:
        temp_path.unlink(missing_ok=True)


def select_input_files(input_dir: Path, date_from: str | None, date_to: str | None) -> list[Path]:
    if not input_dir.exists():
        return []

    preferred = sorted(input_dir.glob("*.new.jsonl"))
    fallback = sorted(input_dir.glob("*.jsonl"))
    files = preferred if preferred else fallback

    selected = []
    for path in files:
        match = DATE_RE.match(path.name)
        if not match:
            continue
        day = match.group(1)
        if date_from and day < date_from:
            continue
        if date_to and day > date_to:
            continue
        selected.append(path)
    return selected


def normalize_entry(raw: dict, date_key: str) -> dict | None:
    alert_date = normalize_alert_date(raw.get("alertDate", ""))
    location = str(raw.get("data", "")).strip()
    title = normalize_title(raw.get("category_desc") or raw.get("title"))
    if not alert_date or not location or not title:
        return None

    hour_minute = parse_hour_minute(alert_date)
    if not hour_minute:
        return None

    rid_raw = raw.get("rid")
    rid = (
        str(rid_raw)
        if rid_raw is not None and rid_raw != ""
        else f"{alert_date}|{location}|{title}"
    )

    return {
        "rid": rid,
        "date_key": date_key,
        "alert_ts": alert_date,
        "alert_day": alert_date[:10],
        "alert_hour": hour_minute[0],
        "alert_minute": hour_minute[1],
        "location": location,
        "title": title,
        "title_norm": normalize_title(title),
        "state": classify_title(title),
    }


def write_row_sql(handle, row: dict, updated_at: str) -> None:
    handle.write(
        "INSERT INTO stats_alerts ("
        "rid, date_key, alert_ts, alert_day, alert_hour, alert_minute, "
        "location, title, title_norm, state, updated_at"
        ") VALUES ("
        f"{sql_quote(row['rid'])}, "
        f"{sql_quote(row['date_key'])}, "
        f"{sql_quote(row['alert_ts'])}, "
        f"{sql_quote(row['alert_day'])}, "
        f"{row['alert_hour']}, "
        f"{row['alert_minute']}, "
        f"{sql_quote(row['location'])}, "
        f"{sql_quote(row['title'])}, "
        f"{sql_quote(row['title_norm'])}, "
        f"{sql_quote(row['state'])}, "
        f"{sql_quote(updated_at)}"
        ") ON CONFLICT(rid) DO UPDATE SET "
        "date_key=excluded.date_key, "
        "alert_ts=excluded.alert_ts, "
        "alert_day=excluded.alert_day, "
        "alert_hour=excluded.alert_hour, "
        "alert_minute=excluded.alert_minute, "
        "location=excluded.location, "
        "title=excluded.title, "
        "title_norm=excluded.title_norm, "
        "state=excluded.state, "
        "updated_at=excluded.updated_at;\n"
    )


def write_coverage_sql(handle, date_key: str, updated_at: str, updated_by: str) -> None:
    handle.write(
        "INSERT INTO stats_coverage (date_key, status, updated_at, updated_by) VALUES ("
        f"{sql_quote(date_key)}, 'complete', {sql_quote(updated_at)}, {sql_quote(updated_by)}"
        ") ON CONFLICT(date_key) DO UPDATE SET "
        "status='complete', "
        "updated_at=excluded.updated_at, "
        "updated_by=excluded.updated_by;\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate D1 SQL backfill file for stats tables.")
    parser.add_argument(
        "--input-dir",
        default="tmp/backfill-compare",
        help="Directory of day JSONL files (default: tmp/backfill-compare).",
    )
    parser.add_argument(
        "--bucket",
        help="Optional R2 bucket to read (uses Wrangler r2 object list/get).",
    )
    parser.add_argument(
        "--local-r2",
        action="store_true",
        help="Read from local Miniflare R2 bucket (default when --bucket is set).",
    )
    parser.add_argument(
        "--remote-r2",
        action="store_true",
        help="Read from remote R2 bucket.",
    )
    parser.add_argument(
        "--from",
        dest="date_from",
        help="Minimum date key (YYYY-MM-DD) to include.",
    )
    parser.add_argument(
        "--to",
        dest="date_to",
        help="Maximum date key (YYYY-MM-DD) to include.",
    )
    parser.add_argument(
        "--output",
        default="tmp/stats-backfill.sql",
        help="Output SQL file path (default: tmp/stats-backfill.sql).",
    )
    parser.add_argument(
        "--updated-by",
        default="backfill",
        help="updated_by value for coverage rows (default: backfill).",
    )
    args = parser.parse_args()

    if args.local_r2 and args.remote_r2:
        raise SystemExit("Choose only one of --local-r2 or --remote-r2.")

    use_remote = args.remote_r2
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    updated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    seen_rids: set[str] = set()
    total_rows = 0
    total_days = 0

    with output_path.open("w", encoding="utf-8", newline="\n") as out:
        out.write("-- Generated by tools/backfill_stats_sql.py\n")
        out.write(f"-- generated_at={updated_at}\n")
        out.write("BEGIN TRANSACTION;\n")

        if args.bucket:
            wrangler_runner = resolve_wrangler_runner()
            mode = "remote" if use_remote else "local"
            print(f"Reading day files from {mode} bucket '{args.bucket}'")
            keys = list_bucket_keys(args.bucket, use_remote, wrangler_runner)
            if args.date_from:
                keys = [k for k in keys if k[:10] >= args.date_from]
            if args.date_to:
                keys = [k for k in keys if k[:10] <= args.date_to]

            for idx, key in enumerate(keys, start=1):
                day = key[:10]
                text = download_bucket_text(args.bucket, key, use_remote, wrangler_runner)
                if not text:
                    continue
                entries = parse_jsonl_text(text)
                day_rows = 0
                for raw in entries:
                    normalized = normalize_entry(raw, day)
                    if not normalized:
                        continue
                    if normalized["rid"] in seen_rids:
                        continue
                    seen_rids.add(normalized["rid"])
                    write_row_sql(out, normalized, updated_at)
                    total_rows += 1
                    day_rows += 1
                write_coverage_sql(out, day, updated_at, args.updated_by)
                total_days += 1
                pct = (idx / len(keys) * 100.0) if keys else 100.0
                print(f"  [{pct:6.2f}% {idx}/{len(keys)}] {day}: {day_rows} rows")
        else:
            input_dir = Path(args.input_dir)
            files = select_input_files(input_dir, args.date_from, args.date_to)
            print(f"Reading day files from {input_dir} ({len(files)} files)")

            for idx, path in enumerate(files, start=1):
                match = DATE_RE.match(path.name)
                if not match:
                    continue
                day = match.group(1)
                entries = parse_jsonl_file(path)
                day_rows = 0
                for raw in entries:
                    normalized = normalize_entry(raw, day)
                    if not normalized:
                        continue
                    if normalized["rid"] in seen_rids:
                        continue
                    seen_rids.add(normalized["rid"])
                    write_row_sql(out, normalized, updated_at)
                    total_rows += 1
                    day_rows += 1
                write_coverage_sql(out, day, updated_at, args.updated_by)
                total_days += 1
                pct = (idx / len(files) * 100.0) if files else 100.0
                print(f"  [{pct:6.2f}% {idx}/{len(files)}] {day}: {day_rows} rows")

        out.write("COMMIT;\n")

    print("\nDone.")
    print(f"  SQL file:    {output_path}")
    print(f"  Day keys:    {total_days}")
    print(f"  Unique rows: {total_rows}")
    print(f"  Updated at:  {updated_at}")


if __name__ == "__main__":
    main()
