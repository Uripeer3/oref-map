import {
  collectAlertsForRange,
  getTodayIsrael,
  jsonResponse,
  parseBooleanParam,
  parseDateRange,
  parseStateFilter,
  parseTypeFilter,
} from './_stats-history.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const includeGreen = parseBooleanParam(url.searchParams.get('includeGreen'));
  const polygonCountOnly = parseBooleanParam(
    url.searchParams.get('polygonCountOnly') || url.searchParams.get('countOnly')
  );
  const dateRange = parseDateRange(url);
  if (!dateRange.ok) {
    return jsonResponse({ error: dateRange.error }, 400);
  }

  const typeFilter = parseTypeFilter(url);
  const stateFilterResult = parseStateFilter(url);
  if (stateFilterResult.invalid.length > 0) {
    return jsonResponse(
      {
        error: `Bad Request: invalid state filter(s): ${stateFilterResult.invalid.join(', ')}`,
      },
      400
    );
  }
  const stateFilter = stateFilterResult.set;

  const todayIsrael = getTodayIsrael();
  if (dateRange.toDate > todayIsrael) {
    return jsonResponse(
      { error: `Bad Request: to must be <= ${todayIsrael}` },
      400
    );
  }

  // Local dev without R2 binding: proxy to production.
  if (!context.env.HISTORY_BUCKET) {
    return fetch(`https://oref-map.org/api/polygon-counts${url.search}`);
  }

  const { entries, scannedEntries } = await collectAlertsForRange(context, {
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    includeGreen,
    typeFilter,
    stateFilter,
    origin: url.origin,
  });

  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry.location, (counts.get(entry.location) || 0) + 1);
  }

  const result = Array.from(counts.entries())
    .map(([polygon, count]) => ({ polygon, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.polygon.localeCompare(b.polygon, 'he');
    });

  const cacheControl =
    dateRange.toDate < todayIsrael ? 'public, max-age=3600' : 'public, max-age=60';

  const responseBody = {
    from: dateRange.fromDate,
    to: dateRange.toDate,
    includeGreen,
    polygonCountOnly,
    filters: {
      types: typeFilter ? Array.from(typeFilter) : [],
      states: stateFilter ? Array.from(stateFilter) : [],
    },
    totalAlerts: entries.length,
    uniquePolygons: result.length,
    scannedEntries,
  };

  if (!polygonCountOnly) {
    responseBody.counts = result;
  }

  return jsonResponse(responseBody, 200, cacheControl);
}
