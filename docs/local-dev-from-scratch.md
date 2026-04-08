# Local Dev From Scratch (Windows + PowerShell)

This guide sets up a fully local dev environment for `oref-map` with:

- local Pages Functions
- local D1 (`STATS_DB`)
- local R2 (`HISTORY_BUCKET`)
- local backfill data for stats APIs

It also includes usage for both backfill scripts:

- `tools/backfill_stats_sql.py`
- `tools/backfill_history.py`

## 1. Prerequisites

Install and verify:

```powershell
node -v
npm -v
npx --yes wrangler --version
uv --version
```

Optional but useful for inspection:

```powershell
sqlite3 --version
```

## 2. Create Root `wrangler.toml`

`wrangler pages dev` does not support `--config`, so local Pages dev must use a root `wrangler.toml`.

From repo root:

```powershell
@'
name = "oref-map-local"
compatibility_date = "2026-04-08"

[[d1_databases]]
binding = "STATS_DB"
database_name = "oref-stats"
database_id = "local-dev-id"

[[r2_buckets]]
binding = "HISTORY_BUCKET"
bucket_name = "oref-history"
'@ | Set-Content wrangler.toml
```

## 3. Reset Local State (Recommended)

```powershell
Remove-Item -Recurse -Force .wrangler/state -ErrorAction SilentlyContinue
```

Use one shared state path for all commands:

```powershell
$state = ".wrangler/state"
```

## 4. Install Python Dependencies

```powershell
uv sync
```

## 5. Initialize Local D1 Schema

```powershell
npx --yes wrangler d1 execute STATS_DB --local --persist-to $state --file ingestion/sql/0001_stats_schema.sql
```

## 6. Build and Load Stats SQL Backfill

Generate SQL from local JSONL (`tmp/backfill-compare/*.new.jsonl`):

```powershell
uv run tools/backfill_stats_sql.py --output tmp/stats-backfill.sql
```

Load SQL into local D1:

```powershell
npx --yes wrangler d1 execute STATS_DB --local --persist-to $state --file tmp/stats-backfill.sql
```

Verify:

```powershell
npx --yes wrangler d1 execute STATS_DB --local --persist-to $state --command "select min(date_key), max(date_key), count(*) from stats_coverage;"
npx --yes wrangler d1 execute STATS_DB --local --persist-to $state --command "select count(*) from stats_alerts;"
```

## 7. Seed Local R2 From Local JSONL Files

Important:

- For `wrangler r2 object ...`, use bucket name `oref-history`.
- Do not use binding name `HISTORY_BUCKET` here.

Upload all day files:

```powershell
Get-ChildItem tmp/backfill-compare -Filter *.new.jsonl | ForEach-Object {
  $date = $_.BaseName -replace '\.new$',''
  npx --yes wrangler r2 object put "oref-history/$date.jsonl" --file $_.FullName --local --persist-to $state
}
```

Verify by downloading one object back:

```powershell
$sample = (Get-ChildItem tmp/backfill-compare -Filter *.new.jsonl | Select-Object -First 1).BaseName -replace '\.new$',''
npx --yes wrangler r2 object get "oref-history/$sample.jsonl" --file "tmp/_r2-check-$sample.jsonl" --local --persist-to $state
Get-Item "tmp/_r2-check-$sample.jsonl"
```

## 8. Ensure `locations_polygons.json` Exists

```powershell
if (!(Test-Path web/locations_polygons.json)) {
  Invoke-WebRequest https://oref-map.org/locations_polygons.json -OutFile web/locations_polygons.json
}
```

## 9. Run Local Pages Dev

```powershell
npx --yes wrangler pages dev web --ip 0.0.0.0 --persist-to $state
```

Open:

- `http://127.0.0.1:8788/`
- stats mode: `http://127.0.0.1:8788/?f-stats`

## 10. Smoke Test Stats Endpoints

```powershell
Invoke-RestMethod "http://127.0.0.1:8788/api/alert-types?from=2026-03-12&to=2026-03-13" | ConvertTo-Json -Depth 6
Invoke-RestMethod "http://127.0.0.1:8788/api/polygon-counts?from=2026-03-12&to=2026-03-13" | ConvertTo-Json -Depth 6
```

Expected:

- `totalAlerts` should be greater than 0 for covered dates.

## 11. `backfill_history.py` Script (R2 Backfill Utility)

`tools/backfill_history.py` fetches Oref extended history city-by-city and writes day JSONL files to R2.

Examples:

Remote R2, interactive:

```powershell
uv run tools/backfill_history.py
```

Remote R2, include today merge first:

```powershell
uv run tools/backfill_history.py --today
```

Remote R2, non-interactive overwrite:

```powershell
uv run tools/backfill_history.py --yes
```

Local R2 (for local dev):

```powershell
uv run tools/backfill_history.py --local-r2 --bucket oref-history
```

Local R2, no prompts:

```powershell
uv run tools/backfill_history.py --local-r2 --bucket oref-history --yes
```

Notes:

- The script compares by `rid`.
- It saves comparison files under `tmp/backfill-compare/`.
- `--today` merges today with a cron-aware cutoff to reduce duplicates.

## 12. Troubleshooting

### Error: `Pages does not support custom paths for the Wrangler configuration file`

Cause: using `wrangler pages dev ... --config ...`.

Fix: keep a root `wrangler.toml` and run `wrangler pages dev` without `--config`.

### Error: `Couldn't find a D1 DB with the name or binding ...`

Cause: no D1 binding in active root `wrangler.toml`.

Fix: ensure root `wrangler.toml` includes:

- `[[d1_databases]]`
- `binding = "STATS_DB"`

### Error: `The bucket name "HISTORY_BUCKET" is invalid`

Cause: using binding name with `wrangler r2 object ...`.

Fix: use actual bucket name `oref-history`.

### Warning: `no such table: stats_coverage`

Cause: schema not loaded in the same local namespace used by Pages dev.

Fix:

- run schema command from this guide
- use the same `--persist-to $state` across all D1/R2/pages commands

### API response has `totalAlerts: 0`, `scannedEntries: 0`

Cause: data seeded into a different local Miniflare store.

Fix:

- remove `.wrangler/state`
- reseed D1 and R2 with one consistent `--persist-to` path

### `/api/analytics` returns 500 locally

This is expected unless Cloudflare analytics secrets are configured locally.

### `/api2/history` returns 404 locally

This is expected unless you separately run/configure the `/api2/*` worker path.

