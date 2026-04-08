import {
  classifyTitle,
  normalizeAlertDate,
  normalizeTitle,
} from '../../shared/alert-state.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_STATES = new Set(['red', 'purple', 'yellow', 'green']);
const COVERAGE_COMPLETE = 'complete';

const OREF_HEADERS = {
  Referer: 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

export { classifyTitle, normalizeTitle };

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
    values.push(...parseCsv(raw).map((v) => v.toLowerCase()));
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

function normalizeLocationName(rawLocation) {
  return String(rawLocation || '')
    .trim()
    .replace(/״/g, "''")
    .replace(/׳/g, "'");
}

function normalizeHistoryEntry(entry) {
  const alertDate = normalizeAlertDate(entry.alertDate);
  const location = normalizeLocationName(entry.data || entry.location);
  const title = normalizeTitle(entry.category_desc || entry.title);

  if (!alertDate || !location || !title) return null;

  const hasRid =
    entry.rid !== undefined && entry.rid !== null && entry.rid !== '';
  const ridKey = hasRid ? String(entry.rid) : `${alertDate}|${location}|${title}`;

  return {
    alertDate,
    location,
    title,
    state: String(entry.state || classifyTitle(title)),
    ridKey,
    hasRid,
  };
}

function buildInClause(values) {
  if (!values || values.length === 0) return null;
  return values.map(() => '?').join(', ');
}

async function getSqlCoveredDateKeys(db, dateKeys) {
  if (!db || dateKeys.length === 0) return new Set();
  const inClause = buildInClause(dateKeys);
  if (!inClause) return new Set();

  try {
    const query = db.prepare(
      `SELECT date_key, status FROM stats_coverage WHERE date_key IN (${inClause})`
    );
    const result = await query.bind(...dateKeys).all();
    const rows = result?.results || [];
    const complete = new Set();
    for (const row of rows) {
      const key = String(row.date_key || '');
      const status = String(row.status || '').toLowerCase();
      if (key && status === COVERAGE_COMPLETE) {
        complete.add(key);
      }
    }
    return complete;
  } catch (error) {
    console.warn(`stats SQL coverage lookup failed: ${error?.message || error}`);
    return new Set();
  }
}

function normalizeSqlRow(row) {
  const normalized = normalizeHistoryEntry({
    alertDate: row.alert_ts,
    data: row.location,
    title: row.title,
    state: row.state,
    rid: row.rid,
  });
  return normalized;
}

async function collectFromSql(db, options) {
  const { rangeStart, rangeEnd, includeGreen, typeFilter, stateFilter, coveredDateKeys } = options;
  if (!db || coveredDateKeys.length === 0) {
    return { entries: [], ok: true };
  }

  const conditions = ['alert_ts >= ?', 'alert_ts <= ?'];
  const params = [rangeStart, rangeEnd];

  const dateInClause = buildInClause(coveredDateKeys);
  if (dateInClause) {
    conditions.push(`date_key IN (${dateInClause})`);
    params.push(...coveredDateKeys);
  }

  if (!includeGreen) {
    conditions.push("state <> 'green'");
  }

  if (stateFilter && stateFilter.size > 0) {
    const stateList = Array.from(stateFilter);
    const stateInClause = buildInClause(stateList);
    conditions.push(`state IN (${stateInClause})`);
    params.push(...stateList);
  }

  if (typeFilter && typeFilter.size > 0) {
    const typeList = Array.from(typeFilter);
    const typeInClause = buildInClause(typeList);
    conditions.push(`title_norm IN (${typeInClause})`);
    params.push(...typeList);
  }

  const query = `
    SELECT rid, alert_ts, location, title, state
    FROM stats_alerts
    WHERE ${conditions.join(' AND ')}
    ORDER BY alert_ts ASC
  `;

  try {
    const result = await db.prepare(query).bind(...params).all();
    const rows = result?.results || [];
    const entries = [];
    for (const row of rows) {
      const normalized = normalizeSqlRow(row);
      if (normalized) entries.push(normalized);
    }
    return { entries, ok: true };
  } catch (error) {
    console.warn(`stats SQL query failed: ${error?.message || error}`);
    return { entries: [], ok: false };
  }
}

async function collectFromR2(historyBucket, dateKeys) {
  if (!historyBucket || dateKeys.length === 0) {
    return { entries: [] };
  }

  const rawEntries = [];

  for (const dateKey of dateKeys) {
    const object = await historyBucket.get(`${dateKey}.jsonl`);
    if (!object) continue;

    const dayEntries = parseJsonl(await object.text());
    rawEntries.push(...dayEntries);
  }

  return { entries: rawEntries };
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
  const seenSemanticWithRid = new Set();
  const seenSemanticWithoutRid = new Set();
  let scannedEntries = 0;

  function accumulate(rawEntry) {
    scannedEntries++;
    const entry = normalizeHistoryEntry(rawEntry);
    if (!entry) return;
    if (entry.alertDate < rangeStart || entry.alertDate > rangeEnd) return;
    const semanticKey = `${entry.alertDate}|${entry.location}|${entry.title}`;

    if (entry.hasRid) {
      if (seenRid.has(entry.ridKey)) return;
      seenRid.add(entry.ridKey);
      seenSemanticWithRid.add(semanticKey);
    } else {
      // /api2/history entries usually lack rid; dedupe them both among themselves
      // and against rid-backed rows already collected from SQL/R2.
      if (seenSemanticWithoutRid.has(semanticKey)) return;
      if (seenSemanticWithRid.has(semanticKey)) return;
      seenSemanticWithoutRid.add(semanticKey);
    }

    if (!includeGreen && entry.state === 'green') return;
    if (typeFilter && !typeFilter.has(entry.title)) return;
    if (stateFilter && !stateFilter.has(entry.state)) return;

    entries.push(entry);
  }

  const db = context?.env?.STATS_DB;
  const historyBucket = context?.env?.HISTORY_BUCKET;

  let coveredDateKeys = [];
  let uncoveredDateKeys = dateKeys;

  if (db) {
    const coveredSet = await getSqlCoveredDateKeys(db, dateKeys);
    coveredDateKeys = dateKeys.filter((key) => coveredSet.has(key));
    uncoveredDateKeys = dateKeys.filter((key) => !coveredSet.has(key));

    const sqlCollected = await collectFromSql(db, {
      rangeStart,
      rangeEnd,
      includeGreen,
      typeFilter,
      stateFilter,
      coveredDateKeys,
    });
    if (!sqlCollected.ok) {
      uncoveredDateKeys = dateKeys;
      coveredDateKeys = [];
    } else {
      for (const entry of sqlCollected.entries) {
        accumulate(entry);
      }
    }
  }

  if (uncoveredDateKeys.length > 0) {
    if (!historyBucket) {
      throw new Error(
        `Missing HISTORY_BUCKET binding for uncovered date(s): ${uncoveredDateKeys.join(', ')}`
      );
    }
    const r2Collected = await collectFromR2(historyBucket, uncoveredDateKeys);
    for (const entry of r2Collected.entries) {
      accumulate(entry);
    }
  } else if (!db && !historyBucket) {
    throw new Error('Missing stats storage bindings: STATS_DB and HISTORY_BUCKET are both unavailable');
  }

  // CLAUDE.md principle: complete recent history is mandatory.
  // If the range touches today, supplement persisted data with recent History API
  // events to bridge ingestion lag.
  if (origin && fromDate <= todayIsrael && toDate >= todayIsrael) {
    const recentHistory = await fetchRecentHistoryEntries(origin);
    for (const entry of recentHistory) {
      accumulate(entry);
    }
  }

  return { entries, scannedEntries, todayIsrael };
}
