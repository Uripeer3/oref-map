const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

// Keep classification aligned with CLAUDE.md and client behavior.
export function classifyTitle(title) {
  const t = normalizeTitle(title);

  if (
    t.includes('האירוע הסתיים') ||
    (t.includes('ניתן לצאת') &&
      !t.includes('להישאר בקרבתו')) ||
    t.includes('החשש הוסר') ||
    t.includes('יכולים לצאת') ||
    t.includes('אינם צריכים לשהות') ||
    t.includes('סיום שהייה בסמיכות') ||
    t === 'עדכון'
  ) {
    return 'green';
  }

  if (
    t ===
      'בדקות הקרובות צפויות להתקבל התרעות באזורך' ||
    t.includes('לשפר את המיקום למיגון המיטבי') ||
    t === 'יש לשהות בסמיכות למרחב המוגן' ||
    t.includes('להישאר בקרבתו')
  ) {
    return 'yellow';
  }

  if (t === 'חדירת כלי טיס עוין') {
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

