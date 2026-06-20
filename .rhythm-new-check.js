function rgBuildChartFromAudioBeatGrid(buffer){
  const sr = buffer.sampleRate;
  const durationMs = Math.round(buffer.duration * 1000);
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const frameSize = Math.max(768, Math.round(sr * .024));
  const hop = Math.max(320, Math.round(sr * .012));
  const hopMs = hop / sr * 1000;
  const frames = [];

  for(let pos=0; pos + frameSize < ch0.length; pos += hop){
    let energy = 0;
    let attack = 0;
    let abs = 0;
    let previous = ch1 ? (ch0[pos] + ch1[pos]) * .5 : ch0[pos];
    for(let i=0; i<frameSize; i++){
      const sample = ch1 ? (ch0[pos+i] + ch1[pos+i]) * .5 : ch0[pos+i];
      const delta = sample - previous;
      energy += sample * sample;
      attack += delta * delta;
      abs += Math.abs(sample);
      previous = sample;
    }
    frames.push({
      time:(pos + frameSize * .5) / sr * 1000,
      energy:Math.sqrt(energy / frameSize),
      attack:Math.sqrt(attack / frameSize),
      amp:abs / frameSize
    });
  }
  if(frames.length < 80) return [];

  const energyScale = rgPercentile(frames.map(f=>f.energy), .9) || 1;
  const attackScale = rgPercentile(frames.map(f=>f.attack), .9) || 1;
  const ampScale = rgPercentile(frames.map(f=>f.amp), .9) || 1;
  const raw = frames.map((frame, i) => {
    const p1 = frames[Math.max(0, i - 1)];
    const p3 = frames[Math.max(0, i - 3)];
    const energyRise = Math.max(0, frame.energy - p3.energy) / energyScale;
    const attackRise = Math.max(0, frame.attack - p1.attack) / attackScale;
    const ampRise = Math.max(0, frame.amp - p3.amp) / ampScale;
    return energyRise * 1.7 + attackRise * .9 + ampRise * 1.15;
  });
  const smooth = raw.map((value, i) => (
    (raw[i-2] || 0) + (raw[i-1] || 0) * 2 + value * 3 +
    (raw[i+1] || 0) * 2 + (raw[i+2] || 0)
  ) / 9);

  // Remove the changing loudness floor so a quiet verse and loud chorus are both playable.
  const baselineRadius = Math.max(10, Math.round(260 / hopMs));
  const novelty = smooth.map((value, i) => {
    let sum = 0;
    let count = 0;
    const from = Math.max(0, i - baselineRadius);
    const to = Math.min(smooth.length - 1, i + Math.round(baselineRadius * .35));
    for(let j=from; j<=to; j++){
      sum += smooth[j];
      count++;
    }
    return Math.max(0, value - (sum / Math.max(1, count)) * .72);
  });

  // Autocorrelation finds the repeating pulse. The prior only breaks common half/double-tempo ties.
  const minLag = Math.max(2, Math.round((60000 / 175) / hopMs));
  const maxLag = Math.max(minLag + 1, Math.round((60000 / 68) / hopMs));
  const tempoScores = [];
  for(let lag=minLag; lag<=maxLag; lag++){
    let cross = 0;
    let left = 0;
    let right = 0;
    for(let i=lag; i<novelty.length; i++){
      const a = novelty[i];
      const b = novelty[i-lag];
      cross += a * b;
      left += a * a;
      right += b * b;
    }
    const bpm = 60000 / (lag * hopMs);
    const normalized = cross / Math.sqrt(Math.max(1e-9, left * right));
    const tempoPrior = bpm >= 82 && bpm <= 152 ? 1 : .94;
    tempoScores.push({ lag, bpm, score:normalized * tempoPrior });
  }
  tempoScores.sort((a,b)=>b.score-a.score);
  let beatLag = tempoScores[0]?.lag || Math.round(500 / hopMs);
  const bestBpm = 60000 / (beatLag * hopMs);
  if(bestBpm > 150){
    const halfTempo = tempoScores.find(item => Math.abs(item.lag - beatLag * 2) <= 1);
    if(halfTempo && halfTempo.score >= tempoScores[0].score * .91) beatLag = halfTempo.lag;
  }
  const beatMs = beatLag * hopMs;

  // Find where beat one starts by testing every possible phase against nearby attacks.
  const phaseWindow = Math.max(1, Math.round(54 / hopMs));
  let beatPhase = 0;
  let phaseScore = -1;
  for(let phase=0; phase<beatLag; phase++){
    let score = 0;
    for(let i=phase; i<novelty.length; i+=beatLag){
      let local = 0;
      for(let d=-phaseWindow; d<=phaseWindow; d++) local = Math.max(local, novelty[i+d] || 0);
      score += local;
    }
    if(score > phaseScore){
      phaseScore = score;
      beatPhase = phase;
    }
  }

  const strongLevel = rgPercentile(novelty, .82) || 0;
  const normalLevel = rgPercentile(novelty, .64) || strongLevel * .55;
  const candidates = [];
  for(let i=2; i<novelty.length-2; i++){
    const strength = novelty[i];
    if(strength < normalLevel || strength < novelty[i-1] || strength < novelty[i+1]) continue;
    const nearestHalfBeat = beatPhase + Math.round((i - beatPhase) / (beatLag / 2)) * (beatLag / 2);
    const gridDistanceMs = Math.abs(i - nearestHalfBeat) * hopMs;
    const onGrid = gridDistanceMs <= Math.min(105, beatMs * .19);
    if(!onGrid && strength < strongLevel * 1.12) continue;
    const alignment = onGrid ? 1 - gridDistanceMs / Math.max(106, beatMs * .2) : .54;
    candidates.push({
      index:i,
      time:frames[i].time,
      strength,
      score:strength * (1 + alignment * .58),
      attack:frames[i].attack
    });
  }

  const durationSec = buffer.duration || 90;
  const target = rgClamp(Math.round(durationSec * 1.72), 52, 250);
  const minGap = Math.max(105, Math.min(155, beatMs * .24));
  const picked = [];
  for(const candidate of candidates.sort((a,b)=>b.score-a.score)){
    if(picked.length >= target) break;
    if(candidate.time < 950 || candidate.time > durationMs - 1200) continue;
    if(picked.some(note => Math.abs(note.time - candidate.time) < minGap)) continue;
    picked.push(candidate);
  }
  picked.sort((a,b)=>a.time-b.time);

  const peakRef = rgPercentile(picked.map(p=>p.strength), .9) || strongLevel || 1;
  const attackMid = rgPercentile(frames.map(f=>f.attack), .62);
  let lastLane = -1;
  const chart = picked.map((candidate, index) => {
    const direction = candidate.attack >= attackMid ? 1 : -1;
    let lane = (index + (direction > 0 ? Math.floor(index / 3) : 3)) % RG_LANES;
    if(lane === lastLane) lane = (lane + 1 + (index % 2)) % RG_LANES;
    lastLane = lane;
    return {
      // Frame centres represent the audible attack; a tiny compensation removes analysis-window delay.
      t:Math.max(0, candidate.time - 18),
      lane,
      intensity:rgClamp(.72 + candidate.strength / (peakRef * 2.25), .68, 1.18)
    };
  });
  return rgNormalizeChart(chart, durationMs);
}