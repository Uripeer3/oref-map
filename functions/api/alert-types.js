import {
  collectAlertsForRange,
  getTodayIsrael,
  jsonResponse,
  parseBooleanParam,
  parseDateRange,
  parseStateFilter,
} from './_stats-history.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const includeGreen = parseBooleanParam(url.searchParams.get('includeGreen'));
  const dateRange = parseDateRange(url);
  if (!dateRange.ok) {
    return jsonResponse({ error: dateRange.error }, 400);
  }

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
  const effectiveIncludeGreen =
    includeGreen || (stateFilter ? stateFilter.has('green') : false);

  const todayIsrael = getTodayIsrael();
  if (dateRange.toDate > todayIsrael) {
    return jsonResponse(
      { error: `Bad Request: to must be <= ${todayIsrael}` },
      400
    );
  }

  let entries;
  let scannedEntries;
  try {
    const collected = await collectAlertsForRange(context, {
      fromDate: dateRange.fromDate,
      toDate: dateRange.toDate,
      includeGreen: effectiveIncludeGreen,
      stateFilter,
      origin: url.origin,
    });
    entries = collected.entries;
    scannedEntries = collected.scannedEntries;
  } catch (error) {
    return jsonResponse(
      {
        error: `Stats backend unavailable: ${error?.message || error}`,
      },
      503
    );
  }

  const byType = new Map();
  const byState = new Map();

  for (const entry of entries) {
    let typeRecord = byType.get(entry.title);
    if (!typeRecord) {
      typeRecord = {
        title: entry.title,
        state: entry.state,
        alerts: 0,
        polygons: new Set(),
      };
      byType.set(entry.title, typeRecord);
    }

    typeRecord.alerts++;
    typeRecord.polygons.add(entry.location);

    byState.set(entry.state, (byState.get(entry.state) || 0) + 1);
  }

  const types = Array.from(byType.values())
    .map((record) => ({
      title: record.title,
      state: record.state,
      alerts: record.alerts,
      uniquePolygons: record.polygons.size,
    }))
    .sort((a, b) => {
      if (b.alerts !== a.alerts) return b.alerts - a.alerts;
      return a.title.localeCompare(b.title, 'he');
    });

  const stateCounts = Array.from(byState.entries())
    .map(([state, alerts]) => ({ state, alerts }))
    .sort((a, b) => b.alerts - a.alerts);

  const cacheControl =
    dateRange.toDate < todayIsrael ? 'public, max-age=3600' : 'public, max-age=60';

  return jsonResponse(
    {
      from: dateRange.fromDate,
      to: dateRange.toDate,
      includeGreen: effectiveIncludeGreen,
      filters: {
        states: stateFilter ? Array.from(stateFilter) : [],
      },
      totalAlerts: entries.length,
      totalTypes: types.length,
      scannedEntries,
      stateCounts,
      types,
    },
    200,
    cacheControl
  );
}
