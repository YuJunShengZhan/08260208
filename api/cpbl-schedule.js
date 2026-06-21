const STATUS_MAP = {
  SCHEDULED: '未開始',
  START: '進行中',
  PLAYING: '進行中',
  IN_PROGRESS: '進行中',
  FINISHED: '已結束',
  POSTPONED: '延賽',
  CANCELLED: '取消',
  CANCELED: '取消',
  RESERVED: '保留'
};

function pad(value) {
  return String(value).padStart(2, '0');
}

function todayYmdInTaipei() {
  const date = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeTime(value) {
  const match = String(value || '').match(/T(\d{2}):(\d{2})/);
  if (!match || `${match[1]}:${match[2]}` === '00:00') return '';
  return `${match[1]}:${match[2]}`;
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  return STATUS_MAP[status] || '未開始';
}

function normalizeScore(value, status) {
  if (!['進行中', '已結束'].includes(status)) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function normalizeGame(game, ymd) {
  const gameNo = String(game?.GameSno ?? game?.gameSno ?? '').trim();
  const away = String(game?.Visiting?.Team?.Name ?? game?.visiting?.team?.name ?? '').trim();
  const home = String(game?.Home?.Team?.Name ?? game?.home?.team?.name ?? '').trim();
  if (!gameNo || !away || !home) return null;

  const rawStatus = game?.GameStatus ?? game?.gameStatus;
  const status = normalizeStatus(rawStatus);
  const preExeDate = game?.PreExeDate ?? game?.preExeDate ?? '';
  return {
    id: `${ymd}-A-${gameNo}`,
    date: ymd,
    no: gameNo,
    away,
    home,
    field: String(game?.Field?.Abbe ?? game?.field?.abbe ?? '').trim(),
    time: normalizeTime(preExeDate),
    status,
    awayScore: normalizeScore(game?.Visiting?.Score ?? game?.visiting?.score, status),
    homeScore: normalizeScore(game?.Home?.Score ?? game?.home?.score, status),
    source: '中職官方賽程 API'
  };
}

async function fetchMonthlySchedule(year, month) {
  const query = new URLSearchParams({ kindCode: 'A', year: String(year), month: String(month) });
  const upstream = await fetch(`https://stats.cpbl.com.tw/api/proxy/v1/games/schedule?${query}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
  });
  if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`);
  const payload = await upstream.json();
  return payload?.Data?.Games || payload?.data?.games || [];
}

module.exports = async (req, res) => {
  const ymd = String(req.query?.date || todayYmdInTaipei());
  const match = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    res.status(400).json({ ok: false, error: '日期格式錯誤' });
    return;
  }

  try {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const rawGames = await fetchMonthlySchedule(year, month);
    const games = rawGames
      .filter(game => normalizeDate(game?.PreExeDate ?? game?.preExeDate) === ymd)
      .map(game => normalizeGame(game, ymd))
      .filter(Boolean)
      .sort((left, right) => Number(left.no) - Number(right.no));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, date: ymd, games, source: '中職官方賽程 API', fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ ok: false, error: error?.message || String(error) });
  }
};
