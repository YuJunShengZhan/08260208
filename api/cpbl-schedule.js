const https = require('https');
const CPBL_HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

const TEAM_ALIASES = {
  '中信兄弟': '中信兄弟',
  '兄弟': '中信兄弟',
  'CTBC Brothers': '中信兄弟',
  'Brothers': '中信兄弟',
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

const FIELDS = ['天母', '大巨蛋', '樂天桃園', '桃園', '澄清湖', '洲際', '新莊', '亞太主', '台南亞太', '亞太副', '園區', '斗六', '嘉義市', '花蓮'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function todayYmdInTaipei() {
  const dt = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToLines(raw) {
  return decodeHtml(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeTeam(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw || /二軍/.test(raw)) return '';
  const compact = raw.replace(/[\s\-‐‑–—_]+/g, '').toLowerCase();
  for (const [alias, team] of Object.entries(TEAM_ALIASES)) {
    const key = alias.replace(/[\s\-‐‑–—_]+/g, '').toLowerCase();
    if (compact.includes(key)) return team;
  }
  return '';
}

function normalizeGameTime(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  let hour = Number(match[1]);
  if (hour >= 0 && hour <= 4) hour += 16;
  return `${pad(hour)}:${match[2]}`;
}

function isLikelyStartTimeScore(leftRaw, rightRaw, segmentText = '') {
  const left = Number(leftRaw);
  const right = Number(rightRaw);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const text = String(segmentText || '');
  const notStarted = /未開始|時間待公佈|時間未定|vs/i.test(text) && !/進行中|已結束|比賽結束|結束/.test(text);
  if (notStarted) return true;
  if (/^0\d$/.test(String(leftRaw)) && /^\d{2}$/.test(String(rightRaw)) && right <= 59) return true;
  return left >= 0 && left <= 4 && right >= 24 && right <= 59;
}

function parseStatus(lines, hasScore) {
  const text = lines.join(' ');
  if (/取消/.test(text)) return '取消';
  if (/延賽/.test(text)) return '延賽';
  if (/保留/.test(text)) return '保留';
  if (/已結束|比賽結束|結束/.test(text)) return '已結束';
  if (/進行中|比賽中|暫停/.test(text)) return '進行中';
  return hasScore ? '進行中' : '未開始';
}

function isDateHeader(line) {
  return /^\d{1,2}\/\d{1,2}\s+週[一二三四五六日]$/.test(line) || /^\d{1,2}月\d{1,2}日/.test(line);
}

function dateHeaderMatches(line, ymd) {
  const [, , mm, dd] = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  if (!mm || !dd) return false;
  const m = Number(mm);
  const d = Number(dd);
  return line.startsWith(`${m}/${d} `) || line.includes(`${m}月${d}日`);
}

function getDateBlock(lines, ymd) {
  const start = lines.findIndex((line) => dateHeaderMatches(line, ymd));
  if (start < 0) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isDateHeader(lines[i])) {
      end = i;
      break;
    }
    if (lines[i] === '賽程列表' || lines[i] === '社群連結') {
      end = i;
      break;
    }
  }
  return lines.slice(start, end);
}

function parseGameSegment(seg, ymd) {
  const teams = [];
  for (const line of seg) {
    const team = normalizeTeam(line);
    if (team && !teams.includes(team)) teams.push(team);
  }
  if (teams.length < 2) return null;

  let no = '';
  for (let i = 0; i < seg.length; i += 1) {
    if (seg[i] === 'GAME' && /^\d+$/.test(seg[i + 1] || '')) {
      no = seg[i + 1];
      break;
    }
    const match = seg[i].match(/^GAME\s*(\d+)$/i);
    if (match) {
      no = match[1];
      break;
    }
  }
  if (!no) return null;

  let awayScore = null;
  let homeScore = null;
  const segmentText = seg.join(' ');
  for (let i = 0; i < seg.length - 2; i += 1) {
    if (/^\d+$/.test(seg[i]) && seg[i + 1] === ':' && /^\d+$/.test(seg[i + 2])) {
      if (!isLikelyStartTimeScore(seg[i], seg[i + 2], segmentText)) {
        awayScore = Number(seg[i]);
        homeScore = Number(seg[i + 2]);
        break;
      }
    }
    const inline = seg[i].match(/^(\d+)\s*[:：]\s*(\d+)$/);
    if (inline) {
      if (!isLikelyStartTimeScore(inline[1], inline[2], segmentText)) {
        awayScore = Number(inline[1]);
        homeScore = Number(inline[2]);
        break;
      }
    }
  }

  const field = seg.find((line) => FIELDS.includes(line)) || '';
  const time = normalizeGameTime(seg.find((line) => /^\d{1,2}:\d{2}$/.test(line)) || '');
  const status = parseStatus(seg, awayScore !== null && homeScore !== null);

  return {
    id: `${ymd}-A-${no}`,
    date: ymd,
    no,
    away: teams[0],
    home: teams[1],
    field,
    time,
    status,
    awayScore,
    homeScore,
    final: /已結束|比賽結束|結束/.test(status),
    started: /進行中|已結束|比賽結束|結束/.test(status) || (awayScore !== null && homeScore !== null),
    source: 'Vercel 官方賽程 API'
  };
}

function parseSchedule(raw, ymd) {
  const block = getDateBlock(htmlToLines(raw), ymd);
  const games = [];
  for (let i = 0; i < block.length; i += 1) {
    if (block[i] !== '一軍例行賽') continue;
    let j = i + 1;
    while (j < block.length && block[j] !== '一軍例行賽' && block[j] !== '二軍例行賽') j += 1;
    const game = parseGameSegment(block.slice(i, j), ymd);
    if (game) games.push(game);
    i = j - 1;
  }
  return games.sort((a, b) => Number(a.no) - Number(b.no));
}

async function fetchText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      agent: CPBL_HTTPS_AGENT,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity' }
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`upstream HTTP ${response.statusCode}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

async function refineFromDetail(game) {
  if (!game || (!game.final && game.awayScore === null && game.homeScore === null)) return game;
  try {
    const raw = await fetchText(`https://stats.cpbl.com.tw/schedule/2026-A-${encodeURIComponent(game.no)}`);
    const title = decodeHtml((raw.match(/<title>(.*?)<\/title>/i) || [])[1] || '');
    const description = decodeHtml((raw.match(/<meta name="description" content="(.*?)"/i) || [])[1] || '');
    const detailText = `${title} ${description} ${raw}`;
    const detailFinal = /勝投|敗投|MVP|已結束|比賽結束/.test(detailText);
    const match = title.match(/(.+?)\s+(\d+)\s*[:：]\s*(\d+)\s+(.+?)\s*\|/);
    const away = normalizeTeam(match?.[1] || '');
    const home = normalizeTeam(match?.[4] || '');
    if (detailFinal && match && away && home && !isLikelyStartTimeScore(match[2], match[3], title)) {
      game.away = away;
      game.home = home;
      game.awayScore = Number(match[2]);
      game.homeScore = Number(match[3]);
    }
    if (detailFinal) {
      game.status = '已結束';
      game.final = true;
      game.started = true;
    }
  } catch (_error) {
    // Keep schedule-list data if the detail page is temporarily unavailable.
  }
  return game;
}

async function refineGames(games) {
  return Promise.all(games.map((game) => refineFromDetail(game)));
}

module.exports = async (req, res) => {
  const ymd = String(req.query?.date || todayYmdInTaipei());

  try {
    const raw = await fetchText(`https://stats.cpbl.com.tw/schedule?_=${Date.now()}`);
    const games = await refineGames(parseSchedule(raw, ymd));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      date: ymd,
      games,
      source: 'Vercel 官方賽程 API',
      fetchedAt: new Date().toISOString()
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
};
