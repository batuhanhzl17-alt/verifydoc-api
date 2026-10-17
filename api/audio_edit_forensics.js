const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mad = (values, center = median(values)) => median(values.map((value) => Math.abs(value - center)));

/**
 * Finds abrupt local changes in a decoded mono signed-16 PCM stream.
 * This is an audio-edit review signal; it cannot identify the source of a sound
 * or prove that a segment was added, especially after mixing/re-encoding.
 */
export function analyzeAudioBoundaryChanges(pcm, sampleRate = 16000) {
  const frameSeconds = 0.10;
  const hopSeconds = 0.05;
  const frameSamples = Math.max(1, Math.round(frameSeconds * sampleRate));
  const hopSamples = Math.max(1, Math.round(hopSeconds * sampleRate));
  const sampleCount = Math.floor(pcm.length / 2);
  const alphaLow = Math.exp((-2 * Math.PI * 350) / sampleRate);
  const alphaMid = Math.exp((-2 * Math.PI * 1500) / sampleRate);
  const frames = [];
  let lowState = 0;
  let midState = 0;
  // Filter once, then use prefix sums so overlapping 100 ms windows stay cheap.
  const prefix = {
    total: new Float64Array(sampleCount + 1),
    low: new Float64Array(sampleCount + 1),
    mid: new Float64Array(sampleCount + 1),
    high: new Float64Array(sampleCount + 1),
    crossings: new Uint32Array(sampleCount + 1),
  };
  let previousSample = 0;
  for (let index = 0; index < sampleCount; index++) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    lowState = alphaLow * lowState + (1 - alphaLow) * sample;
    midState = alphaMid * midState + (1 - alphaMid) * sample;
    const low = lowState;
    const mid = midState - lowState;
    const high = sample - midState;
    prefix.total[index + 1] = prefix.total[index] + sample * sample;
    prefix.low[index + 1] = prefix.low[index] + low * low;
    prefix.mid[index + 1] = prefix.mid[index] + mid * mid;
    prefix.high[index + 1] = prefix.high[index] + high * high;
    prefix.crossings[index + 1] = prefix.crossings[index] + (index > 0 && ((sample >= 0) !== (previousSample >= 0)) ? 1 : 0);
    previousSample = sample;
  }

  for (let start = 0; start + frameSamples <= sampleCount; start += hopSamples) {
    const end = start + frameSamples;
    const n = end - start;
    const energy = (key) => prefix[key][end] - prefix[key][start];
    const rms = Math.sqrt(energy("total") / n);
    const lowEnergy = energy("low");
    const midEnergy = energy("mid");
    const highEnergy = energy("high");
    const crossings = prefix.crossings[end] - prefix.crossings[start];
    frames.push({
      timestampSeconds: start / sampleRate,
      rmsDb: 20 * Math.log10(Math.max(rms, 1e-8)),
      lowMidDb: 10 * Math.log10((midEnergy + 1e-12) / (lowEnergy + 1e-12)),
      highMidDb: 10 * Math.log10((highEnergy + 1e-12) / (midEnergy + 1e-12)),
      zeroCrossingRate: crossings / n,
    });
  }

  const baseline = { available: false, candidateCount: 0, candidates: [] };
  if (frames.length < 12) {
    return {
      ...baseline,
      method: "pcm-audio-local-change-point-v1",
      frameSeconds,
      hopSeconds,
      frameCount: frames.length,
      reason: "Yerel ses değişimlerini güvenilir karşılaştırmak için yeterli süre yok (en az 0,6 sn gerekir).",
      affectsRiskScore: false,
    };
  }

  const changes = [];
  // Compare robust 200 ms neighborhoods while leaving a small guard band around
  // the candidate boundary. This suppresses individual syllables/transients.
  const sideFrames = 4;
  const guardFrames = 1;
  for (let index = sideFrames + guardFrames; index < frames.length - sideFrames - guardFrames; index++) {
    const left = frames.slice(index - guardFrames - sideFrames, index - guardFrames);
    const right = frames.slice(index + guardFrames, index + guardFrames + sideFrames);
    const delta = (key) => Math.abs(median(right.map((item) => item[key])) - median(left.map((item) => item[key])));
    changes.push({
      timestampSeconds: frames[index].timestampSeconds,
      rmsDeltaDb: delta("rmsDb"),
      lowMidDeltaDb: delta("lowMidDb"),
      highMidDeltaDb: delta("highMidDb"),
      zeroCrossingDelta: delta("zeroCrossingRate"),
      previousRmsDb: median(left.map((item) => item.rmsDb)),
      nextRmsDb: median(right.map((item) => item.rmsDb)),
    });
  }

  const limits = {};
  for (const [key, floor] of [["rmsDeltaDb", 6], ["lowMidDeltaDb", 6], ["highMidDeltaDb", 7], ["zeroCrossingDelta", 0.10]]) {
    const values = changes.map((item) => item[key]);
    const center = median(values);
    limits[key] = Math.max(floor, center + 5 * mad(values, center));
  }

  const candidates = [];
  for (const item of changes) {
    if (Math.max(item.previousRmsDb, item.nextRmsDb) < -52) continue;
    const flags = [];
    if (item.rmsDeltaDb >= limits.rmsDeltaDb) flags.push("loudness");
    if (item.lowMidDeltaDb >= limits.lowMidDeltaDb) flags.push("low-mid-balance");
    if (item.highMidDeltaDb >= limits.highMidDeltaDb) flags.push("mid-high-balance");
    if (item.zeroCrossingDelta >= limits.zeroCrossingDelta) flags.push("zero-crossing-rate");
    // Require a strong single change or two corroborating acoustic changes.
    const strongSingle = item.rmsDeltaDb >= Math.max(12, limits.rmsDeltaDb * 1.7)
      || item.lowMidDeltaDb >= Math.max(12, limits.lowMidDeltaDb * 1.7)
      || item.highMidDeltaDb >= Math.max(14, limits.highMidDeltaDb * 1.7);
    if (flags.length < 2 && !strongSingle) continue;
    const normalized = [
      item.rmsDeltaDb / limits.rmsDeltaDb,
      item.lowMidDeltaDb / limits.lowMidDeltaDb,
      item.highMidDeltaDb / limits.highMidDeltaDb,
      item.zeroCrossingDelta / limits.zeroCrossingDelta,
    ].sort((a, b) => b - a);
    candidates.push({
      ...Object.fromEntries(Object.entries(item).map(([key, value]) => [key, Number(value.toFixed(4))])),
      score: Number(((normalized[0] + normalized[1]) / 2).toFixed(2)),
      signals: flags,
    });
  }

  // Merge adjacent detections into one timestamped boundary candidate.
  candidates.sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const merged = [];
  for (const item of candidates) {
    const previous = merged[merged.length - 1];
    if (previous && item.timestampSeconds - previous.toSeconds <= 0.20) {
      previous.toSeconds = item.timestampSeconds;
      if (item.score > previous.score) {
        const toSeconds = previous.toSeconds;
        Object.assign(previous, item, { fromSeconds: previous.fromSeconds, toSeconds });
      }
      previous.signals = [...new Set([...previous.signals, ...item.signals])];
    } else {
      merged.push({ ...item, fromSeconds: item.timestampSeconds, toSeconds: item.timestampSeconds });
    }
  }

  return {
    available: true,
    method: "pcm-audio-local-change-point-v1",
    frameSeconds,
    hopSeconds,
    comparisonSideSeconds: Number((sideFrames * hopSeconds).toFixed(2)),
    frameCount: frames.length,
    thresholds: Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, Number(value.toFixed(3))])),
    candidateCount: merged.length,
    candidates: merged
      .map((item) => ({ ...item, timestampSeconds: Number(item.timestampSeconds.toFixed(3)), fromSeconds: Number(item.fromSeconds.toFixed(3)), toSeconds: Number(item.toSeconds.toFixed(3)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    affectsRiskScore: false,
    note: "Kısa aralıklı ses seviyesi ve bant dengesi değişimlerini zamanlar. Ekleme/kesme kanıtı değildir; konuşma, ortam, mikrofon, karıştırma ve yeniden kodlama da değişim üretebilir veya izleri azaltabilir.",
  };
}
