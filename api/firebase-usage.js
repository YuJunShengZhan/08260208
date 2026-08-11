const crypto = require('crypto');

function sendJson(response, status, payload, cache = false) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', cache
    ? 'private, max-age=15, s-maxage=30, stale-while-revalidate=60'
    : 'no-store');
  response.status(status).json(payload);
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseServiceAccount() {
  const raw = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
    ''
  ).trim();
  let account = null;
  if (raw) {
    try {
      account = JSON.parse(raw);
    } catch (_) {
      try { account = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); } catch (_) {}
    }
  }
  account = account && typeof account === 'object' ? account : {};
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || account.project_id || '').trim(),
    clientEmail: String(process.env.FIREBASE_CLIENT_EMAIL || account.client_email || '').trim(),
    privateKey: String(process.env.FIREBASE_PRIVATE_KEY || account.private_key || '')
      .replace(/\\n/g, '\n')
      .trim()
  };
}

async function getAccessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now - 30,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(account.privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || `Google OAuth HTTP ${response.status}`);
  }
  return data.access_token;
}

function pointValue(point) {
  const raw = point?.value?.int64Value ?? point?.value?.doubleValue ?? 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

async function readLatestMetric(projectId, token, metricType) {
  const end = new Date();
  const start = new Date(end.getTime() - 4 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    view: 'FULL'
  });
  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error?.message || `Cloud Monitoring HTTP ${response.status}`);
  }
  return (data?.timeSeries || []).reduce((sum, series) => {
    const latest = (series?.points || []).slice().sort((a, b) =>
      String(b?.interval?.endTime || '').localeCompare(String(a?.interval?.endTime || ''))
    )[0];
    return sum + pointValue(latest);
  }, 0);
}

function usageMetric(usage, limit) {
  const safeUsage = Math.max(0, Number(usage) || 0);
  const safeLimit = Math.max(0, Number(limit) || 0);
  return {
    usage: safeUsage,
    limit: safeLimit,
    remaining: safeLimit ? Math.max(0, safeLimit - safeUsage) : 0,
    usedPercent: safeLimit ? safeUsage / safeLimit * 100 : 0
  };
}

const FIREBASE_SPARK_STORAGE_LIMIT = 1024 * 1024 * 1024;
const FIREBASE_SPARK_DOWNLOAD_LIMIT = 10 * 1024 * 1024 * 1024;

function cleanDatabaseUrl(value, projectId) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase();
    const safeHost = host.endsWith('.firebasedatabase.app') || host.endsWith('.firebaseio.com');
    const belongsToProject = host === `${projectId}.firebaseio.com` || host.startsWith(`${projectId}-`);
    if (url.protocol !== 'https:' || !safeHost || !belongsToProject) return '';
    return `${url.origin}/.json`;
  } catch (_) {
    return '';
  }
}

async function readDatabasePayloadSize(databaseUrl) {
  if (!databaseUrl) throw new Error('Firebase Database URL is unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(databaseUrl, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity'
      },
      signal: controller.signal
    });
    const contentLength = Number(upstream.headers.get('content-length'));
    if (upstream.body) await upstream.body.cancel().catch(() => {});
    if (!upstream.ok) throw new Error(`Firebase Database HTTP ${upstream.status}`);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      throw new Error('Firebase Database did not return a payload size');
    }
    return contentLength;
  } finally {
    clearTimeout(timeout);
  }
}

function estimatedUsagePayload(projectId, storageUsage, officialError = '') {
  return {
    configured: true,
    projectId,
    source: 'payload-estimate',
    storage: usageMetric(storageUsage, FIREBASE_SPARK_STORAGE_LIMIT),
    downloads: {
      available: false,
      usage: null,
      limit: FIREBASE_SPARK_DOWNLOAD_LIMIT,
      remaining: null,
      usedPercent: null
    },
    officialError,
    updatedAt: new Date().toISOString()
  };
}

module.exports = async function firebaseUsage(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const account = parseServiceAccount();
  const requestedProject = Array.isArray(request.query?.projectId)
    ? request.query.projectId[0]
    : request.query?.projectId;
  const projectId = account.projectId || (/^[a-z][a-z0-9-]{3,60}$/i.test(String(requestedProject || ''))
    ? String(requestedProject)
    : '');
  const requestedDatabaseUrl = Array.isArray(request.query?.databaseUrl)
    ? request.query.databaseUrl[0]
    : request.query?.databaseUrl;
  const databaseUrl = cleanDatabaseUrl(
    requestedDatabaseUrl || process.env.FIREBASE_DATABASE_URL,
    projectId
  );

  if (!projectId) {
    sendJson(response, 503, { configured: false, error: 'Firebase project is not configured' });
    return;
  }

  let officialError = '';
  const monitoringEnabled = process.env.FIREBASE_MONITORING_ENABLED === 'true';
  if (monitoringEnabled && account.clientEmail && account.privateKey) {
    try {
      const token = await getAccessToken(account);
      const prefix = 'firebasedatabase.googleapis.com/';
      const [storageUsage, storageLimit, downloadUsage, downloadLimit] = await Promise.all([
        readLatestMetric(projectId, token, `${prefix}storage/total_bytes`),
        readLatestMetric(projectId, token, `${prefix}storage/limit`),
        readLatestMetric(projectId, token, `${prefix}network/monthly_sent`),
        readLatestMetric(projectId, token, `${prefix}network/monthly_sent_limit`)
      ]);
      sendJson(response, 200, {
        configured: true,
        projectId,
        source: 'cloud-monitoring',
        storage: usageMetric(storageUsage, storageLimit),
        downloads: { available: true, ...usageMetric(downloadUsage, downloadLimit) },
        updatedAt: new Date().toISOString()
      }, true);
      return;
    } catch (error) {
      officialError = error?.message || 'Firebase official usage is unavailable';
    }
  } else if (!monitoringEnabled) {
    officialError = 'Firebase Monitoring is unavailable on the current plan';
  } else {
    officialError = 'Firebase Monitoring credentials are not configured';
  }

  try {
    const storageUsage = await readDatabasePayloadSize(databaseUrl);
    sendJson(response, 200, estimatedUsagePayload(projectId, storageUsage, officialError), true);
  } catch (error) {
    sendJson(response, 502, {
      configured: true,
      error: error?.message || 'Firebase usage is unavailable',
      officialError
    });
  }
};
