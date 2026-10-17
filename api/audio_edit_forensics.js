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

const summarizeAudioFrames = (frames, startSeconds, endSeconds) => {
  const selected = frames.filter((frame) => frame.timestampSeconds >= startSeconds && frame.timestampSeconds + 0.10 <= endSeconds);
  if (selected.length < 2) return null;
  const medianKey = (key) => median(selected.map((frame) => frame[key]));
  const melBands = selected[0].melBands.map((_, band) => median(selected.map((frame) => frame.melBands[band])));
  return {
    frameCount: selected.length,
    rmsDb: medianKey("rmsDb"),
    lowMidDb: medianKey("lowMidDb"),
    highMidDb: medianKey("highMidDb"),
    zeroCrossingRate: medianKey("zeroCrossingRate"),
    spectralFlatness: medianKey("spectralFlatness"),
    melBands,
  };
};

const compareAudioProfiles = (left, right, bandCount) => {
  if (!left || !right) return null;
  return {
    levelDeltaDb: right.rmsDb - left.rmsDb,
    lowMidDeltaDb: right.lowMidDb - left.lowMidDb,
    highMidDeltaDb: right.highMidDb - left.highMidDb,
    zeroCrossingDelta: right.zeroCrossingRate - left.zeroCrossingRate,
    spectralFlatnessDelta: right.spectralFlatness - left.spectralFlatness,
    melProfileDistance: profileDistance([left], [right], bandCount),
  };
};

/**
 * Finds abrupt local changes in a decoded mono signed-16 PCM stream.
 * This is an audio-edit review signal; it cannot identify the source of a sound
 * or prove that a segment was added, especially after mixing/re-encoding.
 */
export function analyzeAudioBoundaryChanges(pcm, sampleRate = 16000, speechSegments = []) {
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
      speechBoundaryContinuity: {
        available: false,
        boundaryCount: 0,
        boundaries: [],
        reason: "Konuşma sınırlarını karşılaştırmak için yeterli ses süresi yok.",
        affectsRiskScore: false,
      },
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

  // Inspect the acoustic profile immediately before and after each VAD speech
  // edge. This is a review cue only: ordinary speech onset/offset also changes
  // the profile, so it cannot establish that audio was inserted.
  const speechBoundaries = [];
  for (const [segmentIndex, segment] of (Array.isArray(speechSegments) ? speechSegments : []).entries()) {
    for (const edge of ["start", "end"]) {
      const boundarySeconds = Number(segment?.[edge === "start" ? "startSeconds" : "endSeconds"]);
      if (!Number.isFinite(boundarySeconds)) continue;
      let nearest = null;
      for (const item of changes) {
        const distance = Math.abs(item.timestampSeconds - boundarySeconds);
        if (!nearest || distance < nearest.distance) nearest = { item, distance };
      }
      if (!nearest || nearest.distance > hopSeconds) {
        speechBoundaries.push({
          segmentIndex,
          edge,
          timestampSeconds: Number(boundarySeconds.toFixed(3)),
          available: false,
          reason: "Sınırın iki yanında yeterli ses örneği yok.",
        });
        continue;
      }
      const item = nearest.item;
      const signals = [];
      if (item.rmsDeltaDb >= limits.rmsDeltaDb) signals.push("loudness");
      if (item.lowMidDeltaDb >= limits.lowMidDeltaDb) signals.push("low-mid-balance");
      if (item.highMidDeltaDb >= limits.highMidDeltaDb) signals.push("mid-high-balance");
      if (item.zeroCrossingDelta >= limits.zeroCrossingDelta) signals.push("zero-crossing-rate");
      if (item.spectralProfileDistance >= limits.spectralProfileDistance) signals.push("mel-spectrogram-profile");
      if (item.spectralCentroidDeltaHz >= limits.spectralCentroidDeltaHz) signals.push("spectral-centroid");
      const strongSingle = item.rmsDeltaDb >= Math.max(12, limits.rmsDeltaDb * 1.7)
        || item.lowMidDeltaDb >= Math.max(12, limits.lowMidDeltaDb * 1.7)
        || item.highMidDeltaDb >= Math.max(14, limits.highMidDeltaDb * 1.7);
      speechBoundaries.push({
        segmentIndex,
        edge,
        timestampSeconds: Number(boundarySeconds.toFixed(3)),
        comparedAtSeconds: Number(item.timestampSeconds.toFixed(3)),
        available: true,
        profileChangeCandidate: signals.length >= 2 || strongSingle,
        signalCount: signals.length,
        signals,
        rmsDeltaDb: Number(item.rmsDeltaDb.toFixed(2)),
        lowMidDeltaDb: Number(item.lowMidDeltaDb.toFixed(2)),
        highMidDeltaDb: Number(item.highMidDeltaDb.toFixed(2)),
        zeroCrossingDelta: Number(item.zeroCrossingDelta.toFixed(4)),
        spectralCentroidDeltaHz: Number(item.spectralCentroidDeltaHz.toFixed(1)),
        melProfileDistance: Number(item.spectralProfileDistance.toFixed(3)),
      });
    }
  }
  const speechBoundaryContinuity = {
    available: speechBoundaries.some((item) => item.available),
    method: "vad-edge-local-audio-profile-comparison-v1",
    sideWindowSeconds: Number((sideFrames * hopSeconds).toFixed(2)),
    guardBandSeconds: Number((guardFrames * hopSeconds).toFixed(2)),
    boundaryCount: speechBoundaries.filter((item) => item.available).length,
    candidateCount: speechBoundaries.filter((item) => item.available && item.profileChangeCandidate).length,
    boundaries: speechBoundaries,
    affectsRiskScore: false,
    note: "Konuşma segmentlerinin başlangıç ve bitiş çevresindeki ses profili karşılaştırılır. Doğal konuşma başlangıcı/bitişi de fark yaratabilir; aday, sonradan ses ekleme kanıtı değildir.",
  };

  // Compare non-speech room-tone windows before/after each speech segment and
  // measure a short post-speech decay proxy. These are observables, not proof
  // of room identity, reverberation, or inserted audio.
  const speechSegmentContinuity = (Array.isArray(speechSegments) ? speechSegments : []).slice(0, 30).map((segment, segmentIndex) => {
    const startSeconds = Number(segment?.startSeconds);
    const endSeconds = Number(segment?.endSeconds);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return null;
    const beforeWindow = { start: Math.max(0, startSeconds - 0.50), end: startSeconds - 0.10 };
    const afterWindow = { start: endSeconds + 0.10, end: endSeconds + 0.50 };
    const overlapsSpeech = (window) => (Array.isArray(speechSegments) ? speechSegments : []).some((other, otherIndex) => {
      if (otherIndex === segmentIndex) return false;
      const otherStart = Number(other?.startSeconds);
      const otherEnd = Number(other?.endSeconds);
      return Number.isFinite(otherStart) && Number.isFinite(otherEnd) && otherStart < window.end && otherEnd > window.start;
    });
    const beforeRoomTone = !overlapsSpeech(beforeWindow) && beforeWindow.end > beforeWindow.start
      ? summarizeAudioFrames(frames, beforeWindow.start, beforeWindow.end)
      : null;
    const afterRoomTone = !overlapsSpeech(afterWindow) && afterWindow.end > afterWindow.start
      ? summarizeAudioFrames(frames, afterWindow.start, afterWindow.end)
      : null;
    const ambientComparison = compareAudioProfiles(beforeRoomTone, afterRoomTone, melBandCount);
    const secondaryProfileChanges = ambientComparison
      ? [
        Math.abs(ambientComparison.lowMidDeltaDb) >= 8,
        Math.abs(ambientComparison.highMidDeltaDb) >= 8,
        Math.abs(ambientComparison.zeroCrossingDelta) >= 0.12,
        Math.abs(ambientComparison.spectralFlatnessDelta) >= 0.20,
      ].filter(Boolean).length
      : 0;
    const ambientChangeCandidate = Boolean(ambientComparison && (
      (Math.abs(ambientComparison.levelDeltaDb) >= 10 && secondaryProfileChanges >= 1)
      || (ambientComparison.melProfileDistance >= 0.30 && secondaryProfileChanges >= 1)
      || Math.abs(ambientComparison.levelDeltaDb) >= 16
    ));

    const speechBeforeEnd = summarizeAudioFrames(frames, Math.max(startSeconds, endSeconds - 0.30), endSeconds - 0.05);
    const earlyTail = summarizeAudioFrames(frames, endSeconds + 0.05, endSeconds + 0.25);
    const lateTail = summarizeAudioFrames(frames, endSeconds + 0.25, endSeconds + 0.50);
    const tailOverlapsSpeech = (window) => overlapsSpeech(window);
    const reverbTailProxy = speechBeforeEnd && earlyTail && lateTail
      && !tailOverlapsSpeech({ start: endSeconds + 0.05, end: endSeconds + 0.50 })
      ? {
        available: true,
        earlyTailLevelDb: Number(earlyTail.rmsDb.toFixed(2)),
        lateTailLevelDb: Number(lateTail.rmsDb.toFixed(2)),
        speechToEarlyTailDropDb: Number((speechBeforeEnd.rmsDb - earlyTail.rmsDb).toFixed(2)),
        earlyToLateDecayDb: Number((earlyTail.rmsDb - lateTail.rmsDb).toFixed(2)),
        lateTailAbovePreSpeechRoomToneDb: beforeRoomTone
          ? Number((lateTail.rmsDb - beforeRoomTone.rmsDb).toFixed(2))
          : null,
        interpretation: "Kısa konuşma sonrası seviye kuyruğu ölçümüdür; yankı veya ekleme teşhisi değildir.",
      }
      : { available: false, reason: "Konuşma sonrası yeterli ve başka konuşmayla örtüşmeyen örnek yok." };

    return {
      segmentIndex,
      speechStartSeconds: Number(startSeconds.toFixed(3)),
      speechEndSeconds: Number(endSeconds.toFixed(3)),
      ambientComparisonAvailable: Boolean(ambientComparison),
      ambientBeforeSeconds: [Number(beforeWindow.start.toFixed(3)), Number(beforeWindow.end.toFixed(3))],
      ambientAfterSeconds: [Number(afterWindow.start.toFixed(3)), Number(afterWindow.end.toFixed(3))],
      ambientBeforeFrameCount: beforeRoomTone?.frameCount || 0,
      ambientAfterFrameCount: afterRoomTone?.frameCount || 0,
      ambientComparison: ambientComparison ? Object.fromEntries(Object.entries(ambientComparison).map(([key, value]) => [key, Number(value.toFixed(4))])) : null,
      ambientChangeCandidate,
      reverbTailProxy,
      affectsRiskScore: false,
    };
  }).filter(Boolean);
  const speechSegmentContinuityAudit = {
    available: speechSegmentContinuity.length > 0,
    method: "vad-segment-roomtone-profile-and-postspeech-decay-v1",
    segmentCount: speechSegmentContinuity.length,
    ambientChangeCandidateCount: speechSegmentContinuity.filter((item) => item.ambientChangeCandidate).length,
    segments: speechSegmentContinuity,
    affectsRiskScore: false,
    note: "Konuşma segmentlerinin öncesi/sonrasındaki konuşma dışı kısa pencerelerde ses seviyesi, spektral profil ve gürültü dokusu karşılaştırılır. Konuşma sonrası kısa seviye kuyruğu yankı için yalnızca kaba bir göstergedir; ortam, konuşma ve miks değişimleri aynı sinyalleri üretebilir. Sonradan ses ekleme hükmü vermez.",
  };

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
    speechBoundaryContinuity,
    speechSegmentContinuity: speechSegmentContinuityAudit,
    activity: { available: true, method: "adaptive-rms-activity-not-speech-classification", noiseFloorDb: Number(noiseFloorDb.toFixed(2)), activeThresholdDb: Number(activeFloorDb.toFixed(2)), intervalCount: activityIntervals.length, intervals: activityIntervals.slice(0, 30) },
    affectsRiskScore: false,
    note: "Log-Mel profili, spektral merkez, seviye ve etkin aralık değişimleri incelenir. Etkinlik aralıkları konuşma sınıflandırması değildir. Sınır adayı ekleme/kesme kanıtı değildir; konuşma, ortam, mikrofon, miksleme ve yeniden kodlama sinyal üretebilir veya izleri azaltabilir.",
  };
}
