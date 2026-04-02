CREATE TABLE IF NOT EXISTS stats_alerts (
  rid TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  alert_ts TEXT NOT NULL,
  alert_day TEXT NOT NULL,
  alert_hour INTEGER NOT NULL,
  alert_minute INTEGER NOT NULL,
  location TEXT NOT NULL,
  title TEXT NOT NULL,
  title_norm TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('red', 'purple', 'yellow', 'green')),
  inserted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_stats_alerts_alert_ts ON stats_alerts (alert_ts);
CREATE INDEX IF NOT EXISTS idx_stats_alerts_date_key ON stats_alerts (date_key);
CREATE INDEX IF NOT EXISTS idx_stats_alerts_location_ts ON stats_alerts (location, alert_ts);
CREATE INDEX IF NOT EXISTS idx_stats_alerts_state_ts ON stats_alerts (state, alert_ts);
CREATE INDEX IF NOT EXISTS idx_stats_alerts_title_norm_ts ON stats_alerts (title_norm, alert_ts);

CREATE TABLE IF NOT EXISTS stats_coverage (
  date_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('partial', 'complete')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

