const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATES = new Set(['red', 'purple', 'yellow', 'green']);
const OREF_HEADERS = {
  Referer: 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

export function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

// Keep classification aligned with the client and CLAUDE.md.
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

export function jsonResponse(body, status, cacheControl) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
    },
  });
}

export function parseBooleanParam(rawValue) {
  if (!rawValue) return false;
  const normalized = rawValue.toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isValidDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const probe = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(probe.getTime()) && probe.toISOString().slice(0, 10) === dateStr;
}

export function parseDateRange(url) {
  const fromDate = url.searchParams.get('from') || url.searchParams.get('fromDate');
  const toDate = url.searchParams.get('to') || url.searchParams.get('toDate') || fromDate;

  if (!fromDate || !toDate || !isValidDate(fromDate) || !isValidDate(toDate)) {
    return { ok: false, error: 'Bad Request: use ?from=YYYY-MM-DD&to=YYYY-MM-DD' };
  }

  if (fromDate > toDate) {
    return { ok: false, error: 'Bad Request: from must be <= to' };
  }

  return { ok: true, fromDate, toDate };
}

export function getTodayIsrael() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
  }).format(new Date());
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function listDateKeys(fromDate, toDate) {
  const keys = [];
  let cursor = fromDate;
  while (cursor <= toDate) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}

function parseCsv(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseTypeFilter(url) {
  const values = [];
  const typeParams = url.searchParams.getAll('type');
  const typesParams = url.searchParams.getAll('types');
  for (const raw of [...typeParams, ...typesParams]) {
    values.push(...parseCsv(raw));
  }

  if (values.length === 0) return null;
  return new Set(values.map((value) => normalizeTitle(value)).filter(Boolean));
}

export function parseStateFilter(url) {
  const values = [];
  const stateParams = url.searchParams.getAll('state');
  const statesParams = url.searchParams.getAll('states');
  for (const raw of [...stateParams, ...statesParams]) {
    values.push(...parseCsv(raw.toLowerCase()));
  }

  if (values.length === 0) return { set: null, invalid: [] };

  const set = new Set();
  const invalid = [];
  for (const value of values) {
    if (VALID_STATES.has(value)) set.add(value);
    else invalid.push(value);
  }

  return { set, invalid };
}

function parseJsonl(text) {
  if (!text) return [];
  const out = [];
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const jsonLine = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed;
    try {
      out.push(JSON.parse(jsonLine));
    } catch {
      // Keep serving if a single line is malformed.
    }
  }
  return out;
}

function normalizeHistoryEntry(entry) {
  const alertDate = String(entry.alertDate || '').replace(' ', 'T').trim();
  const location = String(entry.data || '').trim();
  const title = normalizeTitle(entry.category_desc || entry.title);

  if (!alertDate || !location || !title) return null;

  const ridKey =
    entry.rid !== undefined && entry.rid !== null && entry.rid !== ''
      ? String(entry.rid)
      : `${alertDate}|${location}|${title}`;

  return {
    alertDate,
    location,
    title,
    state: classifyTitle(title),
    ridKey,
  };
}

async function fetchRecentHistoryEntries(origin) {
  try {
    // Use the placement-pinned worker path to avoid geo-blocking and keep
    // recent events visible while R2 ingestion catches up.
    const response = await fetch(`${origin}/api2/history`, {
      headers: OREF_HEADERS,
    });
    if (!response.ok) return [];

    const text = (await response.text()).replace(/^\ufeff/, '').trim();
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function collectAlertsForRange(context, options) {
  const { fromDate, toDate, includeGreen, typeFilter, stateFilter, origin } = options;
  const todayIsrael = getTodayIsrael();
  const rangeStart = `${fromDate}T00:00:00`;
  const rangeEnd = `${toDate}T23:59:59`;
  const readThroughDate = addDays(toDate, 1);
  const dateKeys = listDateKeys(fromDate, readThroughDate);

  const entries = [];
  const seenRid = new Set();
  let scannedEntries = 0;

  function accumulate(rawEntry) {
    scannedEntries++;
    const entry = normalizeHistoryEntry(rawEntry);
    if (!entry) return;
    if (entry.alertDate < rangeStart || entry.alertDate > rangeEnd) return;
    if (seenRid.has(entry.ridKey)) return;
    seenRid.add(entry.ridKey);

    if (!includeGreen && entry.state === 'green') return;
    if (typeFilter && !typeFilter.has(entry.title)) return;
    if (stateFilter && !stateFilter.has(entry.state)) return;

    entries.push(entry);
  }

  for (const dateKey of dateKeys) {
    const object = await context.env.HISTORY_BUCKET.get(`${dateKey}.jsonl`);
    if (!object) continue;

    const dayEntries = parseJsonl(await object.text());
    for (const entry of dayEntries) {
      accumulate(entry);
    }
  }

  // CLAUDE.md principle: complete recent history is mandatory.
  // If the range touches today, supplement R2 with recent History API events
  // to bridge ingestion lag.
  if (origin && fromDate <= todayIsrael && toDate >= todayIsrael) {
    const recentHistory = await fetchRecentHistoryEntries(origin);
    for (const entry of recentHistory) {
      accumulate(entry);
    }
  }

  return { entries, scannedEntries, todayIsrael };
}
