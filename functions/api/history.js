const TARGET = 'https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json';

const OREF_HEADERS = {
  'Referer': 'https://www.oref.org.il/',
  'X-Requested-With': 'XMLHttpRequest',
};

export async function onRequestGet() {
  const resp = await fetch(TARGET, { headers: OREF_HEADERS });
  const body = await resp.arrayBuffer();
  return new Response(body, {
    status: resp.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}