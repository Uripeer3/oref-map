import {
  collectAlertsForRange,
  getTodayIsrael,
  jsonResponse,
  parseBooleanParam,
  parseDateRange,
  parseStateFilter,
  parseTypeFilter,
} from './_stats-history.js';
import { parseHourMinute } from '../../shared/alert-state.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const includeGreen = parseBooleanParam(url.searchParams.get('includeGreen'));
  const polygon = String(url.searchParams.get('polygon') || '').trim();
  if (!polygon) {
    return jsonResponse({ error: 'Bad Request: polygon is required' }, 400);
  }

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
      typeFilter,
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

  const hourBuckets = Array(24).fill(0);
  const minuteBuckets = Array(60).fill(0);
  let totalAlerts = 0;
  let maxHourBucket = 0;
  let maxMinuteBucket = 0;

  for (const entry of entries) {
    if (entry.location !== polygon) continue;
    const hm = parseHourMinute(entry.alertDate);
    if (!hm) continue;

    totalAlerts++;
    hourBuckets[hm.hour]++;
    minuteBuckets[hm.minute]++;

    if (hourBuckets[hm.hour] > maxHourBucket) {
      maxHourBucket = hourBuckets[hm.hour];
    }
    if (minuteBuckets[hm.minute] > maxMinuteBucket) {
      maxMinuteBucket = minuteBuckets[hm.minute];
    }
  }

  const cacheControl =
    dateRange.toDate < todayIsrael ? 'public, max-age=3600' : 'public, max-age=60';

  return jsonResponse(
    {
      polygon,
      from: dateRange.fromDate,
      to: dateRange.toDate,
      includeGreen: effectiveIncludeGreen,
      filters: {
        types: typeFilter ? Array.from(typeFilter) : [],
        states: stateFilter ? Array.from(stateFilter) : [],
      },
      totalAlerts,
      scannedEntries,
      maxHourBucket,
      maxMinuteBucket,
      hourBuckets,
      minuteBuckets,
    },
    200,
    cacheControl
  );
}
