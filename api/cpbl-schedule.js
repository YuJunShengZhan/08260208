const TEAM_ALIASES = {
  '中信兄弟':'中信兄弟',
  '兄弟':'中信兄弟',
  'CTBC Brothers':'中信兄弟',
  '統一7-ELEVEn獅':'統一7-ELEVEn獅',
  '統一7-ELEVEN獅':'統一7-ELEVEn獅',
  '統一獅':'統一7-ELEVEn獅',
  'Uni-Lions':'統一7-ELEVEn獅',
  '樂天桃猿':'樂天桃猿',
  'Rakuten Monkeys':'樂天桃猿',
  '富邦悍將':'富邦悍將',
  'Fubon Guardians':'富邦悍將',
  '味全龍':'味全龍',
  'Wei Chuan Dragons':'味全龍',
  '台鋼雄鷹':'台鋼雄鷹',
  'TSG Hawks':'台鋼雄鷹'
};

const FIELDS = ['天母','大巨蛋','樂天桃園','桃園','澄清湖','洲際','新莊','亞太主','台南亞太','斗六','嘉義市','花蓮'];
const STATUS_WORDS = ['已結束','進行中','比賽中','未開始','延賽','取消','保留'];

function pad(n){
  return String(n).padStart(2, '0');
}

function todayYmdInTaipei(){
  const dt = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function htmlToLines(raw){
  return String(raw || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n+/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function normalizeTeam(line){
  for(const [alias, team] of Object.entries(TEAM_ALIASES)){
    if(line.includes(alias)) return team;
  }
  return '';
}

function parseSchedule(raw, ymd){
  const lines = htmlToLines(raw);
  const [, monthStr, dayStr] = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/) || [];
  const month = Number(monthStr);
  const day = Number(dayStr);
  const dateHeaderReg = new RegExp(`^${month}/${day}\\s+週[一二三四五六日]$`);
  const anyDateHeaderReg = /^\d{1,2}\/\d{1,2}\s+週[一二三四五六日]$/;

  let start = lines.findIndex(line => dateHeaderReg.test(line));
  if(start < 0) return [];

  let end = lines.length;
  for(let i = start + 1; i < lines.length; i++){
    if(anyDateHeaderReg.test(lines[i])){
      end = i;
      break;
    }
  }

  let block = lines.slice(start, end);
  const minorIdx = block.findIndex(line => line === '二軍例行賽');
  if(minorIdx >= 0) block = block.slice(0, minorIdx);

  const games = [];
  for(let i = 0; i < block.length; i++){
    if(block[i] !== '一軍例行賽') continue;
    let j = i + 1;
    while(j < block.length && block[j] !== '一軍例行賽' && block[j] !== '二軍例行賽') j++;
    const seg = block.slice(i, j);

    const teams = [];
    for(const line of seg){
      const team = normalizeTeam(line);
      if(team && !teams.includes(team)) teams.push(team);
    }

    let no = '';
    for(let k = 0; k < seg.length; k++){
      if(seg[k] === 'GAME' && /^\d+$/.test(seg[k + 1] || '')){
        no = seg[k + 1];
        break;
      }
      const m = seg[k].match(/^GAME\s*(\d+)$/);
      if(m){
        no = m[1];
        break;
      }
    }

    let awayScore = null;
    let homeScore = null;
    for(let k = 0; k < seg.length - 2; k++){
      if(/^\d+$/.test(seg[k]) && seg[k + 1] === ':' && /^\d+$/.test(seg[k + 2])){
        awayScore = Number(seg[k]);
        homeScore = Number(seg[k + 2]);
        break;
      }
    }

    const field = seg.find(line => FIELDS.includes(line)) || '';
    const status = seg.find(line => STATUS_WORDS.includes(line)) || '未開始';

    if(teams.length >= 2 && no){
      games.push({
        id: `${ymd}-A-${no}`,
        date: ymd,
        no,
        away: teams[0],
        home: teams[1],
        field,
        time: '',
        status,
        awayScore,
        homeScore,
        source: 'Vercel 官方賽程 API'
      });
    }

    i = j - 1;
  }

  return games.sort((a, b) => Number(a.no) - Number(b.no));
}

module.exports = async (req, res) => {
  const ymd = String(req.query?.date || todayYmdInTaipei());
  try{
    const upstream = await fetch(`https://stats.cpbl.com.tw/schedule?_=${Date.now()}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if(!upstream.ok){
      throw new Error(`upstream HTTP ${upstream.status}`);
    }
    const raw = await upstream.text();
    const games = parseSchedule(raw, ymd);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      date: ymd,
      games,
      source: 'Vercel 官方賽程 API',
      fetchedAt: new Date().toISOString()
    });
  }catch(error){
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({
      ok: false,
      error: error?.message || String(error)
    });
  }
};
