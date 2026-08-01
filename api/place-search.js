const APP_ORIGIN = 'https://shengzhan-yujun-site.vercel.app';

function sendJson(response, status, payload) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', status === 200
    ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
    : 'no-store');
  response.status(status).json(payload);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        Referer: APP_ORIGIN,
        'User-Agent': `ShengzhanYujunSite/1.0 (${APP_ORIGIN})`
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function cleanText(value, maxLength = 180) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizePhoton(data) {
  return (Array.isArray(data?.features) ? data.features : []).map(feature => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates || [];
    const countryCode = cleanText(properties.countrycode, 4).toUpperCase();
    if (countryCode && countryCode !== 'TW') return null;
    const lat = Number(coordinates[1]);
    const lng = Number(coordinates[0]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const name = cleanText(properties.name || properties.street || properties.city || '搜尋結果', 60);
    const address = [
      properties.name,
      [properties.housenumber, properties.street].filter(Boolean).join(' '),
      properties.district,
      properties.city,
      properties.county,
      properties.state,
      properties.postcode,
      properties.country
    ].map(value => cleanText(value)).filter((value, index, values) => value && values.indexOf(value) === index).join('，');
    return {
      name,
      displayName: address || name,
      lat,
      lng,
      placeId: properties.osm_type && properties.osm_id ? `osm_${properties.osm_type}_${properties.osm_id}` : '',
      provider: 'photon'
    };
  }).filter(Boolean);
}

function normalizeNominatim(data) {
  return (Array.isArray(data) ? data : []).map(item => {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const details = item?.namedetails || {};
    const displayName = cleanText(item?.display_name);
    const name = cleanText(details['name:zh-Hant'] || details['name:zh'] || details.name || item?.name || displayName.split(',')[0] || '搜尋結果', 60);
    return {
      name,
      displayName: displayName || name,
      lat,
      lng,
      placeId: item?.osm_type && item?.osm_id ? `osm_${item.osm_type}_${item.osm_id}` : '',
      provider: 'nominatim'
    };
  }).filter(Boolean);
}

function mergeResults(...groups) {
  const seen = new Set();
  return groups.flat().filter(item => {
    const key = `${Number(item.lat).toFixed(5)},${Number(item.lng).toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

module.exports = async function placeSearch(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const rawQuery = Array.isArray(request.query?.q) ? request.query.q[0] : request.query?.q;
  const query = cleanText(rawQuery, 100);
  if (query.length < 2) {
    sendJson(response, 400, { error: '請至少輸入兩個字' });
    return;
  }

  const photonParams = new URLSearchParams({ q: query, limit: '8', lang: 'zh' });
  const nominatimParams = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: '8',
    addressdetails: '1',
    namedetails: '1',
    'accept-language': 'zh-TW',
    countrycodes: 'tw'
  });

  const [photon, nominatim] = await Promise.allSettled([
    fetchJson(`https://photon.komoot.io/api/?${photonParams}`),
    fetchJson(`https://nominatim.openstreetmap.org/search?${nominatimParams}`)
  ]);

  const results = mergeResults(
    photon.status === 'fulfilled' ? normalizePhoton(photon.value) : [],
    nominatim.status === 'fulfilled' ? normalizeNominatim(nominatim.value) : []
  );

  if (photon.status === 'rejected' && nominatim.status === 'rejected') {
    sendJson(response, 503, { error: '地點搜尋服務暫時無法使用' });
    return;
  }

  sendJson(response, 200, { results });
};
