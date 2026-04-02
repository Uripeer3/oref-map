# Stats SQL Hybrid Setup

This project now supports a hybrid stats architecture:

- Raw day-history remains in R2 (`oref-history`)
- Statistics endpoints use D1 (`stats_alerts`, `stats_coverage`) when a day is marked `complete`
- Uncovered days automatically fall back to R2 JSONL reads

## 1. Create / Prepare D1

```bash
npx --yes wrangler d1 create oref-stats
npx --yes wrangler d1 execute oref-stats --file ingestion/sql/0001_stats_schema.sql --remote
```

For local dev:

```bash
npx --yes wrangler d1 execute oref-stats --file ingestion/sql/0001_stats_schema.sql --local
```

## 2. Generate Backfill SQL

From local backfill files (`tmp/backfill-compare/*.new.jsonl`):

```bash
uv run tools/backfill_stats_sql.py --output tmp/stats-backfill.sql
```

Or directly from R2:

```bash
uv run tools/backfill_stats_sql.py \
  --bucket oref-history \
  --remote-r2 \
  --output tmp/stats-backfill.sql
```

## 3. Load Backfill into D1

```bash
npx --yes wrangler d1 execute oref-stats --file tmp/stats-backfill.sql --remote
```

For local:

```bash
npx --yes wrangler d1 execute oref-stats --file tmp/stats-backfill.sql --local
```

## 4. Runtime Bindings

Bind `STATS_DB` in both:

- Pages Functions (for `/api/polygon-counts`, `/api/alert-types`, `/api/polygon-histogram`)
- Ingestion Worker (to mirror new ingested events into D1 as `partial`)

The stats APIs require:

- `STATS_DB` for SQL reads
- `HISTORY_BUCKET` fallback for uncovered dates

## 5. Local Dev

Run Pages dev with both bindings:

```bash
npx --yes wrangler pages dev web --ip 0.0.0.0 --r2 HISTORY_BUCKET --d1 STATS_DB=oref-stats
```

