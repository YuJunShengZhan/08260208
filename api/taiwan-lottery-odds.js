const TEAM_ALIASES = {
  '中信兄弟': '中信兄弟',
  '兄弟': '中信兄弟',
  'CTBC Brothers': '中信兄弟',
  '統一7-ELEVEn獅': '統一7-ELEVEn獅',
  '統一7-ELEVEN獅': '統一7-ELEVEn獅',
  '統一獅': '統一7-ELEVEn獅',
  'Uni-Lions': '統一7-ELEVEn獅',
  '樂天桃猿': '樂天桃猿',
  'Rakuten Monkeys': '樂天桃猿',
  '富邦悍將': '富邦悍將',
  'Fubon Guardians': '富邦悍將',
  '味全龍': '味全龍',
  'Wei Chuan Dragons': '味全龍',
  '台鋼雄鷹': '台鋼雄鷹',
  'TSG Hawks': '台鋼雄鷹'
};

const https = require('https');

function fetchText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers,
      timeout: 12000,
      rejectUnauthorized: false
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', reject);
  });
}

function normalizeTeam(text) {
  const raw = String(text || '').replace(/\s+/g, ' ');
  for (const [alias, team] of Object.entries(TEAM_ALIASES)) {
    if (raw.includes(alias)) return team;
  }
  return '';
}

function cleanText(raw) {
  return String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOddsNear(text, teamA, teamB) {
  const idxA = text.indexOf(teamA);
  const idxB = text.indexOf(teamB);
  if (idxA < 0 || idxB < 0) return null;
  const start = Math.max(0, Math.min(idxA, idxB) - 260);
  const end = Math.min(text.length, Math.max(idxA, idxB) + 520);
  const chunk = text.slice(start, end);
  const odds = Array.from(chunk.matchAll(/(?<!\d)([1-9]\d?\.\d{2})(?!\d)/g)).map((m) => m[1]);
  if (odds.length < 2) return null;
  return {
    away: teamA,
    home: teamB,
    awayOdds: odds[0],
    homeOdds: odds[1],
    raw: chunk.slice(0, 240)
  };
}

function parseOfficialOdds(raw) {
  const text = cleanText(raw);
  const teams = Object.values(TEAM_ALIASES).filter((team, index, arr) => arr.indexOf(team) === index);
  const matches = [];
  const seen = new Set();

  for (let i = 0; i < teams.length; i += 1) {
    for (let j = 0; j < teams.length; j += 1) {
      if (i === j) continue;
      const teamA = teams[i];
      const teamB = teams[j];
      const found = extractOddsNear(text, teamA, teamB);
      if (!found) continue;
      const key = [normalizeTeam(found.away), normalizeTeam(found.home)].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(found);
    }
  }

  return matches;
}

module.exports = async (req, res) => {
  const urls = [
    'https://www.sportslottery.com.tw/',
    'https://www.sportslottery.com.tw/zh-tw/sports-betting/baseball'
  ];

  const attempts = [];
  for (const url of urls) {
    try {
      const raw = await fetchText(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8'
      });
      const matches = parseOfficialOdds(raw);
      if (matches.length) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
          ok: true,
          source: '台灣運彩官網',
          url,
          matches,
          fetchedAt: new Date().toISOString()
        });
        return;
      }
      attempts.push(`${url}: no CPBL odds found`);
    } catch (error) {
      attempts.push(`${url}: ${error?.message || String(error)}`);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    source: '台灣運彩官網',
    matches: [],
    attempts,
    fetchedAt: new Date().toISOString()
  });
};
