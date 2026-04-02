const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

// Keep classification aligned with CLAUDE.md and client behavior.
export function classifyTitle(title) {
  const t = normalizeTitle(title);

  if (
    t.includes('\u05d4\u05d0\u05d9\u05e8\u05d5\u05e2 \u05d4\u05e1\u05ea\u05d9\u05d9\u05dd') ||
    (t.includes('\u05e0\u05d9\u05ea\u05df \u05dc\u05e6\u05d0\u05ea') &&
      !t.includes('\u05dc\u05d4\u05d9\u05e9\u05d0\u05e8 \u05d1\u05e7\u05e8\u05d1\u05ea\u05d5')) ||
    t.includes('\u05d4\u05d7\u05e9\u05e9 \u05d4\u05d5\u05e1\u05e8') ||
    t.includes('\u05d9\u05db\u05d5\u05dc\u05d9\u05dd \u05dc\u05e6\u05d0\u05ea') ||
    t.includes('\u05d0\u05d9\u05e0\u05dd \u05e6\u05e8\u05d9\u05db\u05d9\u05dd \u05dc\u05e9\u05d4\u05d5\u05ea') ||
    t.includes('\u05e1\u05d9\u05d5\u05dd \u05e9\u05d4\u05d9\u05d9\u05d4 \u05d1\u05e1\u05de\u05d9\u05db\u05d5\u05ea') ||
    t === '\u05e2\u05d3\u05db\u05d5\u05df'
  ) {
    return 'green';
  }

  if (
    t ===
      '\u05d1\u05d3\u05e7\u05d5\u05ea \u05d4\u05e7\u05e8\u05d5\u05d1\u05d5\u05ea \u05e6\u05e4\u05d5\u05d9\u05d5\u05ea \u05dc\u05d4\u05ea\u05e7\u05d1\u05dc \u05d4\u05ea\u05e8\u05e2\u05d5\u05ea \u05d1\u05d0\u05d6\u05d5\u05e8\u05da' ||
    t.includes('\u05dc\u05e9\u05e4\u05e8 \u05d0\u05ea \u05d4\u05de\u05d9\u05e7\u05d5\u05dd \u05dc\u05de\u05d9\u05d2\u05d5\u05df \u05d4\u05de\u05d9\u05d8\u05d1\u05d9') ||
    t === '\u05d9\u05e9 \u05dc\u05e9\u05d4\u05d5\u05ea \u05d1\u05e1\u05de\u05d9\u05db\u05d5\u05ea \u05dc\u05de\u05e8\u05d7\u05d1 \u05d4\u05de\u05d5\u05d2\u05df' ||
    t.includes('\u05dc\u05d4\u05d9\u05e9\u05d0\u05e8 \u05d1\u05e7\u05e8\u05d1\u05ea\u05d5')
  ) {
    return 'yellow';
  }

  if (t === '\u05d7\u05d3\u05d9\u05e8\u05ea \u05db\u05dc\u05d9 \u05d8\u05d9\u05e1 \u05e2\u05d5\u05d9\u05df') {
    return 'purple';
  }

  return 'red';
}

export function normalizeAlertDate(rawAlertDate) {
  return String(rawAlertDate || '').replace(' ', 'T').trim();
}

export function parseHourMinute(alertDate) {
  const ts = normalizeAlertDate(alertDate);
  if (ts.length < 16) return null;
  const hour = Number(ts.slice(11, 13));
  const minute = Number(ts.slice(14, 16));
  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return { hour, minute };
}

export function addDays(dateStr, days) {
  if (!DATE_RE.test(dateStr)) return '';
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Match R2 partitioning: entries from 23:xx are stored under next day's key.
export function r2DateKey(alertDate) {
  const ts = normalizeAlertDate(alertDate);
  if (ts.length < 13 || !DATE_RE.test(ts.slice(0, 10))) return '';
  const baseDate = ts.slice(0, 10);
  const hour = Number(ts.slice(11, 13));
  if (Number.isNaN(hour)) return '';
  return hour >= 23 ? addDays(baseDate, 1) : baseDate;
}

