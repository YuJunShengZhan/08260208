function sendJson(response, status, payload, cache = false) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache
    ? 'private, max-age=60, s-maxage=300, stale-while-revalidate=900'
    : 'no-store');
  response.status(status).json(payload);
}

function parseCloudinaryUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'cloudinary:') return null;
    return {
      cloudName: decodeURIComponent(url.hostname || ''),
      apiKey: decodeURIComponent(url.username || ''),
      apiSecret: decodeURIComponent(url.password || '')
    };
  } catch (_) {
    return null;
  }
}

function cleanCloudName(value) {
  const clean = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{2,80}$/.test(clean) ? clean : '';
}

function metric(value) {
  const source = value && typeof value === 'object' ? value : {};
  const usage = Number(source.usage ?? source.used ?? 0);
  const limit = Number(source.limit ?? 0);
  const usedPercent = Number(source.used_percent ?? (limit > 0 ? usage / limit * 100 : 0));
  return {
    usage: Number.isFinite(usage) ? usage : 0,
    limit: Number.isFinite(limit) ? limit : 0,
    usedPercent: Number.isFinite(usedPercent) ? usedPercent : 0,
    creditsUsage: Number(source.credits_usage) || 0
  };
}

module.exports = async function cloudinaryUsage(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const fromUrl = parseCloudinaryUrl(process.env.CLOUDINARY_URL);
  const requestedCloud = Array.isArray(request.query?.cloudName)
    ? request.query.cloudName[0]
    : request.query?.cloudName;
  const cloudName = cleanCloudName(
    process.env.CLOUDINARY_CLOUD_NAME || fromUrl?.cloudName || requestedCloud
  );
  const apiKey = String(process.env.CLOUDINARY_API_KEY || fromUrl?.apiKey || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || fromUrl?.apiSecret || '').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    sendJson(response, 503, {
      configured: false,
      error: 'Cloudinary Usage API 尚未設定'
    });
    return;
  }

  try {
    const authorization = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const upstream = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/usage`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${authorization}`
      }
    });
    let data = null;
    try { data = await upstream.json(); } catch (_) {}
    if (!upstream.ok) {
      sendJson(response, upstream.status === 401 ? 502 : upstream.status, {
        configured: true,
        error: data?.error?.message || `Cloudinary HTTP ${upstream.status}`
      });
      return;
    }

    sendJson(response, 200, {
      configured: true,
      cloudName,
      plan: String(data?.plan || ''),
      lastUpdated: String(data?.last_updated || ''),
      credits: metric(data?.credits),
      storage: metric(data?.storage),
      bandwidth: metric(data?.bandwidth),
      transformations: metric(data?.transformations),
      resources: Number(data?.resources) || 0,
      derivedResources: Number(data?.derived_resources) || 0,
      rateLimit: {
        limit: Number(upstream.headers.get('x-featureratelimit-limit')) || 0,
        remaining: Number(upstream.headers.get('x-featureratelimit-remaining')) || 0,
        resetAt: upstream.headers.get('x-featureratelimit-reset') || ''
      }
    }, true);
  } catch (error) {
    sendJson(response, 502, {
      configured: true,
      error: error?.message || 'Cloudinary 用量讀取失敗'
    });
  }
};
