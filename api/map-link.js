const APP_ORIGIN = 'https://shengzhan-yujun-site.vercel.app';
const GOOGLE_DOMAINS = ['google.com', 'google.com.tw'];
const BROWSER_HEADERS = {
  'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
};

function sendJson(response, status, payload) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', status === 200
    ? 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800'
    : 'no-store');
  response.status(status).json(payload);
}

function isAllowedMapUrl(url) {
  if (!(url instanceof URL) || url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'maps.app.goo.gl' || host === 'maps.google.com') return true;
  if (host === 'goo.gl') return url.pathname.startsWith('/maps');
  return GOOGLE_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function extractInputUrl(value) {
  const text = String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
  const candidates = text.match(/https?:\/\/[^\s<>"']+/gi) || [];
  if (/^https?:\/\//i.test(text)) candidates.unshift(text);
  for (const candidate of [...new Set(candidates)]) {
    const clean = candidate.trim().replace(/[\]\[(){}<>，。；、]+$/gu, '');
    try {
      const url = new URL(clean);
      if (isAllowedMapUrl(url)) return url;
    } catch (_) {}
  }
  return null;
}

function coordinateCandidates(value) {
  const raw = String(value || '');
  return [...new Set([
    raw,
    safeDecode(raw),
    raw.replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&').replace(/&amp;/gi, '&')
  ])];
}

function parseCoordinates(value) {
  const patterns = [
    /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i,
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /[?&](?:q|query|ll|center)=(?:loc:)?(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/i
  ];
  for (const candidate of coordinateCandidates(value)) {
    const longitudeFirst = candidate.match(/!2d(-?\d{1,3}(?:\.\d+)?)!3d(-?\d{1,2}(?:\.\d+)?)/i);
    if (longitudeFirst) {
      const lat = Number(longitudeFirst[2]);
      const lng = Number(longitudeFirst[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (!match) continue;
      const lat = Number(match[1]);
      const lng = Number(match[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
    }
  }
  return null;
}

function extractPlaceToken(value) {
  for (const candidate of coordinateCandidates(value)) {
    try {
      const url = new URL(candidate);
      const queryPlaceId = url.searchParams.get('query_place_id') || url.searchParams.get('place_id') || url.searchParams.get('ftid');
      if (queryPlaceId) return queryPlaceId.trim();
    } catch (_) {}
    const dataMatch = candidate.match(/!1s((?:0x[\da-f]+:0x[\da-f]+)|(?:ChI[A-Za-z0-9_-]+))/i);
    if (dataMatch) return safeDecode(dataMatch[1]);
  }
  return '';
}

function extractHtmlRedirect(html, currentUrl) {
  const source = String(html || '')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
  const patterns = [
    /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"']+)["']/i,
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
    /(?:window\.)?location\.replace\(\s*["']([^"']+)["']\s*\)/i
  ];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    try {
      const next = new URL(match[1].trim(), currentUrl);
      if (isAllowedMapUrl(next) && next.href !== currentUrl.href) return next;
    } catch (_) {}
  }
  const embedded = source.match(/https?:\/\/(?:www\.)?google\.(?:com|com\.tw)\/maps\/[^\s"'<>]+/i);
  if (embedded) {
    try {
      const next = new URL(embedded[0]);
      if (isAllowedMapUrl(next) && next.href !== currentUrl.href) return next;
    } catch (_) {}
  }
  return null;
}

function decodeGoogleString(value) {
  try { return JSON.parse(`"${String(value || '')}"`); }
  catch (_) { return safeDecode(String(value || '')).replace(/\\u0026/gi, '&'); }
}

function parseEmbedEntity(html) {
  const source = String(html || '');
  const match = source.match(/\[\["((?:\\.|[^"\\])*)","((?:\\.|[^"\\])*)",\[(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)\],"((?:\\.|[^"\\])*)"\],"((?:\\.|[^"\\])*)",(\[[^\]]*\])/);
  if (!match) return null;
  const lat = Number(match[3]);
  const lng = Number(match[4]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  let addressParts = [];
  try { addressParts = JSON.parse(match[7]); } catch (_) {}
  return {
    coordinates: { lat, lng },
    query: decodeGoogleString(match[2]).trim(),
    name: decodeGoogleString(match[6]).trim().slice(0, 60),
    address: (Array.isArray(addressParts) ? addressParts : []).filter(Boolean).join(', ').trim().slice(0, 180)
  };
}

function isCoordinateLabel(value) {
  return /^-?\d{1,2}(?:\.\d+)?\s*[,，]\s*-?\d{1,3}(?:\.\d+)?/.test(String(value || '').trim());
}

function parsePlaceName(value, html = '') {
  const candidates = coordinateCandidates(value);
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      const match = url.pathname.match(/\/maps\/place\/([^/]+)/i);
      if (match) {
        const name = safeDecode(match[1]).replace(/\+/g, ' ').trim();
        if (name && !isCoordinateLabel(name)) return name.slice(0, 60);
      }
      const query = url.searchParams.get('query') || url.searchParams.get('q');
      if (query && !parseCoordinates(`?q=${query}`)) return query.replace(/^loc:/i, '').trim().slice(0, 60);
    } catch (_) {}
  }
  const normalizedHtml = String(html || '')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
  const embeddedPlaceMatch = normalizedHtml.match(/\/maps\/place\/([^/?#"'<>\\]+)/i);
  if (embeddedPlaceMatch) {
    const name = safeDecode(embeddedPlaceMatch[1]).replace(/\+/g, ' ').trim();
    if (name && !isCoordinateLabel(name)) return name.slice(0, 60);
  }
  const titleMatch = String(html || '').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || String(html || '').match(/<title>([^<]+)<\/title>/i);
  return safeDecode(titleMatch?.[1] || '').replace(/&amp;/gi, '&').replace(/\s*[-–]\s*Google Maps.*$/i, '').trim().slice(0, 60);
}

async function resolveMapUrl(initialUrl) {
  let current = initialUrl;
  let html = '';
  for (let index = 0; index < 7; index += 1) {
    if (!isAllowedMapUrl(current)) throw new Error('只支援 Google Maps 的分享連結');
    if (parseCoordinates(current.href)) return { url: current, html };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    let result;
    try {
      result = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: BROWSER_HEADERS
      });
    } finally {
      clearTimeout(timeout);
    }
    const location = result.headers.get('location');
    if (location && result.status >= 300 && result.status < 400) {
      const next = new URL(location, current);
      if (!isAllowedMapUrl(next)) throw new Error('分享連結導向了不支援的網站');
      current = next;
      continue;
    }
    html = (await result.text()).slice(0, 400000);
    const htmlRedirect = extractHtmlRedirect(html, current);
    if (htmlRedirect) {
      current = htmlRedirect;
      continue;
    }
    return { url: current, html };
  }
  return { url: current, html };
}

async function fetchEmbedEntity(query, ftid = '') {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return null;
  const embedUrl = new URL('https://maps.google.com/maps');
  embedUrl.searchParams.set('q', cleanQuery);
  embedUrl.searchParams.set('output', 'embed');
  if (ftid) embedUrl.searchParams.set('ftid', ftid);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const result = await fetch(embedUrl, {
      signal: controller.signal,
      headers: BROWSER_HEADERS
    });
    if (!result.ok) return null;
    return parseEmbedEntity((await result.text()).slice(0, 400000));
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function reverseAddress(lat, lng) {
  const params = new URLSearchParams({ format: 'jsonv2', lat: String(lat), lon: String(lng), 'accept-language': 'zh-TW' });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const result = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Referer: APP_ORIGIN,
        'User-Agent': `ShengzhanYujunSite/1.0 (${APP_ORIGIN})`
      }
    });
    if (!result.ok) return null;
    return result.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function mapLink(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const rawValue = Array.isArray(request.query?.url) ? request.query.url[0] : request.query?.url;
  const initialUrl = extractInputUrl(rawValue);
  if (!initialUrl) {
    sendJson(response, 400, { error: '只支援 Google Maps 的分享連結' });
    return;
  }

  try {
    const resolved = await resolveMapUrl(initialUrl);
    const directCoordinates = parseCoordinates(resolved.url.href) || parseCoordinates(resolved.html);
    const placeToken = extractPlaceToken(resolved.url.href) || extractPlaceToken(resolved.html);
    const pathName = parsePlaceName(resolved.url.href, resolved.html);
    const query = resolved.url.searchParams.get('query') || resolved.url.searchParams.get('q') || pathName || (placeToken ? `place_id:${placeToken}` : '');
    const ftid = resolved.url.searchParams.get('ftid') || (/^0x[\da-f]+:0x[\da-f]+$/i.test(placeToken) ? placeToken : '');
    const embedEntity = directCoordinates ? null : await fetchEmbedEntity(query, ftid);
    const coordinates = directCoordinates || embedEntity?.coordinates;
    if (!coordinates) {
      sendJson(response, 422, { error: '連結沒有帶入地點位置，請在 Google Maps 開啟店家後按「分享」再複製連結' });
      return;
    }
    const reverse = await reverseAddress(coordinates.lat, coordinates.lng);
    const name = embedEntity?.name || pathName
      || String(reverse?.name || reverse?.display_name || 'Google Maps 地點').split(',')[0].trim().slice(0, 60);
    const displayName = String(embedEntity?.address || reverse?.display_name || embedEntity?.query || name).trim().slice(0, 180);
    sendJson(response, 200, {
      result: {
        name,
        displayName,
        lat: coordinates.lat,
        lng: coordinates.lng,
        placeId: `google_link_${coordinates.lat.toFixed(6)}_${coordinates.lng.toFixed(6)}`,
        provider: 'google-link'
      }
    });
  } catch (error) {
    sendJson(response, 502, { error: error?.name === 'AbortError' ? '讀取分享連結逾時，請再試一次' : (error?.message || '無法讀取這個分享連結') });
  }
};
