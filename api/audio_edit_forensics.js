const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const mad = (values, center = median(values)) => median(values.map((value) => Math.abs(value - center)));

const percentile = (values, fraction) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
};

const fftTwiddleCache = new Map();
const getFftTwiddles = (fftSize) => {
  if (fftTwiddleCache.has(fftSize)) return fftTwiddleCache.get(fftSize);
  const stages = new Map();
  for (let size = 2; size <= fftSize; size <<= 1) {
    const half = size >> 1;
    const cosine = new Float64Array(half);
    const sine = new Float64Array(half);
    for (let index = 0; index < half; index++) {
      const phase = (-2 * Math.PI * index) / size;
      cosine[index] = Math.cos(phase);
      sine[index] = Math.sin(phase);
    }
    stages.set(size, { cosine, sine });
  }
  fftTwiddleCache.set(fftSize, stages);
  return stages;
};

const fftPowerSpectrum = (pcm, start, frameSamples, fftSize) => {
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  for (let index = 0; index < frameSamples; index++) {
    const sample = pcm.readInt16LE((start + index) * 2) / 32768;
    const hann = frameSamples <= 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (frameSamples - 1));
    real[index] = sample * hann;
  }

  for (let i = 1, j = 0; i < fftSize; i++) {
    let bit = fftSize >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  const twiddles = getFftTwiddles(fftSize);
  for (let size = 2; size <= fftSize; size <<= 1) {
    const half = size >> 1;
    const { cosine, sine } = twiddles.get(size);
    for (let offset = 0; offset < fftSize; offset += size) {
      for (let index = 0; index < half; index++) {
        const even = offset + index;
        const odd = even + half;
        const oddReal = real[odd] * cosine[index] - imag[odd] * sine[index];
        const oddImag = real[odd] * sine[index] + imag[odd] * cosine[index];
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
      }
    }
  }
  return { real, imag };
};

const makeMelBandEdges = (sampleRate, fftSize, bandCount = 24) => {
  const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
  const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);
  const lowMel = hzToMel(80);
  const highMel = hzToMel(sampleRate / 2);
  const edges = [];
  for (let index = 0; index <= bandCount; index++) {
    const hz = melToHz(lowMel + ((highMel - lowMel) * index) / bandCount);
    edges.push(Math.max(1, Math.min(fftSize / 2, Math.round((hz * fftSize) / sampleRate))));
  }
  for (let index = 1; index < edges.length; index++) edges[index] = Math.max(edges[index], edges[index - 1] + 1);
  edges[edges.length - 1] = Math.min(fftSize / 2, edges[edges.length - 1]);
  return edges;
};

const profileDistance = (leftFrames, rightFrames, bandCount) => {
  const left = new Array(bandCount).fill(0);
  const right = new Array(bandCount).fill(0);
  for (const frame of leftFrames) for (let index = 0; index < bandCount; index++) left[index] += frame.melBands[index];
  for (const frame of rightFrames) for (let index = 0; index < bandCount; index++) right[index] += frame.melBands[index];
  const normalize = (values) => {
    const total = values.reduce((sum, value) => sum + value, 0) + 1e-12;
    return values.map((value) => value / total);
  };
  const leftNorm = normalize(left);
  const rightNorm = normalize(right);
  return 0.5 * leftNorm.reduce((sum, value, index) => sum + Math.abs(value - rightNorm[index]), 0);
};

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
  const fftSize = 2048;
  const melBandCount = 24;
  const melEdges = makeMelBandEdges(sampleRate, fftSize, melBandCount);
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
    const { real, imag } = fftPowerSpectrum(pcm, start, frameSamples, fftSize);
    const melBands = new Array(melBandCount).fill(0);
    let spectralMagnitudeTotal = 0;
    let spectralWeightedFrequency = 0;
    let logMagnitudeTotal = 0;
    let magnitudeCount = 0;
    for (let bin = 1; bin < fftSize / 2; bin++) {
      const magnitude = Math.hypot(real[bin], imag[bin]);
      const frequency = (bin * sampleRate) / fftSize;
      spectralMagnitudeTotal += magnitude;
      spectralWeightedFrequency += magnitude * frequency;
      logMagnitudeTotal += Math.log(magnitude + 1e-12);
      magnitudeCount++;
    }
    for (let band = 0; band < melBandCount; band++) {
      for (let bin = melEdges[band]; bin < melEdges[band + 1]; bin++) {
        melBands[band] += real[bin] * real[bin] + imag[bin] * imag[bin];
      }
    }
    const melTotal = melBands.reduce((sum, value) => sum + value, 0) + 1e-12;
    const melProfile = melBands.map((value) => value / melTotal);
    frames.push({
      timestampSeconds: start / sampleRate,
      rmsDb: 20 * Math.log10(Math.max(rms, 1e-8)),
      lowMidDb: 10 * Math.log10((midEnergy + 1e-12) / (lowEnergy + 1e-12)),
      highMidDb: 10 * Math.log10((highEnergy + 1e-12) / (midEnergy + 1e-12)),
      zeroCrossingRate: crossings / n,
      spectralCentroidHz: spectralWeightedFrequency / Math.max(spectralMagnitudeTotal, 1e-12),
      spectralFlatness: Math.exp(logMagnitudeTotal / Math.max(magnitudeCount, 1)) / Math.max(spectralMagnitudeTotal / Math.max(magnitudeCount, 1), 1e-12),
      melBands: melProfile,
    });
  }

  const baseline = { available: false, candidateCount: 0, candidates: [] };
  if (frames.length < 12) {
    return {
      ...baseline,
      method: "pcm-mel-spectrogram-local-change-point-v2",
      frameSeconds,
      hopSeconds,
      frameCount: frames.length,
      spectrogram: { available: false, fftSize, melBandCount },
      activityIntervals: [],
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
      spectralCentroidDeltaHz: delta("spectralCentroidHz"),
      spectralFlatnessDelta: delta("spectralFlatness"),
      spectralProfileDistance: profileDistance(left, right, melBandCount),
      previousRmsDb: median(left.map((item) => item.rmsDb)),
      nextRmsDb: median(right.map((item) => item.rmsDb)),
    });
  }

  const limits = {};
  for (const [key, floor] of [["rmsDeltaDb", 6], ["lowMidDeltaDb", 6], ["highMidDeltaDb", 7], ["zeroCrossingDelta", 0.10], ["spectralProfileDistance", 0.22], ["spectralCentroidDeltaHz", 900]]) {
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
    if (item.spectralProfileDistance >= limits.spectralProfileDistance) flags.push("mel-spectrogram-profile");
    if (item.spectralCentroidDeltaHz >= limits.spectralCentroidDeltaHz) flags.push("spectral-centroid");
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
      item.spectralProfileDistance / limits.spectralProfileDistance,
      item.spectralCentroidDeltaHz / limits.spectralCentroidDeltaHz,
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

  const noiseFloorDb = percentile(frames.map((frame) => frame.rmsDb), 0.20);
  const activeFloorDb = Math.max(-52, noiseFloorDb + 8);
  const activityFrames = frames.map((frame) => ({ ...frame, active: frame.rmsDb >= activeFloorDb }));
  const activityIntervals = [];
  let activeStart = null;
  let lastActive = null;
  for (const frame of activityFrames) {
    if (frame.active) {
      if (activeStart === null) activeStart = frame.timestampSeconds;
      lastActive = frame.timestampSeconds + frameSeconds;
    } else if (activeStart !== null && frame.timestampSeconds - lastActive > 0.15) {
      if (lastActive - activeStart >= 0.20) activityIntervals.push({ startSeconds: Number(activeStart.toFixed(3)), endSeconds: Number(lastActive.toFixed(3)), durationSeconds: Number((lastActive - activeStart).toFixed(3)) });
      activeStart = null;
      lastActive = null;
    }
  }
  if (activeStart !== null && lastActive - activeStart >= 0.20) activityIntervals.push({ startSeconds: Number(activeStart.toFixed(3)), endSeconds: Number(lastActive.toFixed(3)), durationSeconds: Number((lastActive - activeStart).toFixed(3)) });

  const topChangePoints = changes.map((item) => {
    const ratios = [
      item.rmsDeltaDb / limits.rmsDeltaDb,
      item.lowMidDeltaDb / limits.lowMidDeltaDb,
      item.highMidDeltaDb / limits.highMidDeltaDb,
      item.zeroCrossingDelta / limits.zeroCrossingDelta,
      item.spectralProfileDistance / limits.spectralProfileDistance,
      item.spectralCentroidDeltaHz / limits.spectralCentroidDeltaHz,
    ].sort((a, b) => b - a);
    return {
      timestampSeconds: Number(item.timestampSeconds.toFixed(3)),
      score: Number(((ratios[0] + ratios[1]) / 2).toFixed(2)),
      rmsDeltaDb: Number(item.rmsDeltaDb.toFixed(2)),
      lowMidDeltaDb: Number(item.lowMidDeltaDb.toFixed(2)),
      highMidDeltaDb: Number(item.highMidDeltaDb.toFixed(2)),
      zeroCrossingDelta: Number(item.zeroCrossingDelta.toFixed(4)),
      spectralProfileDistance: Number(item.spectralProfileDistance.toFixed(3)),
      spectralCentroidDeltaHz: Number(item.spectralCentroidDeltaHz.toFixed(1)),
    };
  }).sort((a, b) => b.score - a.score).slice(0, 12);

  return {
    available: true,
    method: "pcm-mel-spectrogram-local-change-point-v2",
    frameSeconds,
    hopSeconds,
    comparisonSideSeconds: Number((sideFrames * hopSeconds).toFixed(2)),
    frameCount: frames.length,
    spectrogram: { available: true, transform: "hann-windowed-real-fft-log-mel-profile", fftSize, melBandCount, frequencyRangeHz: [80, sampleRate / 2] },
    thresholds: Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, Number(value.toFixed(3))])),
    candidateCount: merged.length,
    candidates: merged
      .map((item) => ({ ...item, timestampSeconds: Number(item.timestampSeconds.toFixed(3)), fromSeconds: Number(item.fromSeconds.toFixed(3)), toSeconds: Number(item.toSeconds.toFixed(3)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20),
    topChangePoints,
    activity: { available: true, method: "adaptive-rms-activity-not-speech-classification", noiseFloorDb: Number(noiseFloorDb.toFixed(2)), activeThresholdDb: Number(activeFloorDb.toFixed(2)), intervalCount: activityIntervals.length, intervals: activityIntervals.slice(0, 30) },
    affectsRiskScore: false,
    note: "Log-Mel profili, spektral merkez, seviye ve etkin aralık değişimleri incelenir. Etkinlik aralıkları konuşma sınıflandırması değildir. Sınır adayı ekleme/kesme kanıtı değildir; konuşma, ortam, mikrofon, miksleme ve yeniden kodlama sinyal üretebilir veya izleri azaltabilir.",
  };
}
