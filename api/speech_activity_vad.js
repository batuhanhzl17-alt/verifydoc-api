import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 16000;
const WINDOW_SIZE = 512;
const MODEL_PATH = fileURLToPath(new URL("../models/silero_vad.onnx", import.meta.url));

const drainSegments = (vad, output) => {
  while (!vad.isEmpty()) {
    const segment = vad.front();
    const startSample = Math.max(0, Number(segment?.start) || 0);
    const sampleLength = segment?.samples?.length || 0;
    if (sampleLength > 0) {
      output.push({
        startSeconds: startSample / SAMPLE_RATE,
        endSeconds: (startSample + sampleLength) / SAMPLE_RATE,
      });
    }
    vad.pop();
  }
};

const mergeSpeechSegments = (segments, durationSeconds) => {
  const sorted = segments
    .map((segment) => ({
      startSeconds: Math.max(0, Math.min(durationSeconds, segment.startSeconds)),
      endSeconds: Math.max(0, Math.min(durationSeconds, segment.endSeconds)),
    }))
    .filter((segment) => segment.endSeconds > segment.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);
  const merged = [];
  for (const segment of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && segment.startSeconds - previous.endSeconds <= 0.20) {
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged.map((segment) => ({
    startSeconds: Number(segment.startSeconds.toFixed(3)),
    endSeconds: Number(segment.endSeconds.toFixed(3)),
    durationSeconds: Number((segment.endSeconds - segment.startSeconds).toFixed(3)),
  }));
};

/** Detect speech-like voice activity in mono s16le PCM without uploading audio. */
export async function analyzeSpeechActivity(pcm) {
  const byteLength = Math.floor((pcm?.length || 0) / 2) * 2;
  const sampleCount = byteLength / 2;
  const durationSeconds = sampleCount / SAMPLE_RATE;
  if (sampleCount < WINDOW_SIZE) {
    return {
      available: false,
      method: "silero-vad-sherpa-onnx-node-v1",
      speechSegmentCount: 0,
      segments: [],
      reason: "Konuşma etkinliği taraması için yeterli ses örneği yok.",
      affectsRiskScore: false,
    };
  }

  let vad;
  try {
    const sherpa = await import("sherpa-onnx-node");
    const Vad = sherpa.Vad || sherpa.default?.Vad;
    if (typeof Vad !== "function") throw new Error("Sherpa ONNX VAD sınıfı yüklenemedi.");
    vad = new Vad({
      sileroVad: {
        model: MODEL_PATH,
        threshold: 0.5,
        minSilenceDuration: 0.20,
        minSpeechDuration: 0.15,
        maxSpeechDuration: 20,
        windowSize: WINDOW_SIZE,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
      provider: "cpu",
      debug: false,
    }, 30);

    const pending = new Float32Array(WINDOW_SIZE);
    const rawSegments = [];
    for (let start = 0; start + WINDOW_SIZE <= sampleCount; start += WINDOW_SIZE) {
      for (let index = 0; index < WINDOW_SIZE; index++) {
        pending[index] = pcm.readInt16LE((start + index) * 2) / 32768;
      }
      vad.acceptWaveform(pending);
      drainSegments(vad, rawSegments);
    }
    vad.flush();
    drainSegments(vad, rawSegments);

    const segments = mergeSpeechSegments(rawSegments, durationSeconds);
    const speechDurationSeconds = segments.reduce((sum, segment) => sum + segment.durationSeconds, 0);
    return {
      available: true,
      method: "silero-vad-sherpa-onnx-node-v1",
      model: "Silero VAD via sherpa-onnx-node",
      sampleRate: SAMPLE_RATE,
      windowSamples: WINDOW_SIZE,
      durationSeconds: Number(durationSeconds.toFixed(3)),
      speechSegmentCount: segments.length,
      speechDurationSeconds: Number(speechDurationSeconds.toFixed(3)),
      speechRatio: Number((speechDurationSeconds / Math.max(durationSeconds, 1e-9)).toFixed(4)),
      segments: segments.slice(0, 50),
      affectsRiskScore: false,
      note: "Bu model konuşma benzeri ses etkinliğini işaretler; konuşmanın sonradan eklendiğini, kime ait olduğunu veya sesin değiştirilip değiştirilmediğini belirlemez.",
    };
  } catch (error) {
    return {
      available: false,
      method: "silero-vad-sherpa-onnx-node-v1",
      speechSegmentCount: null,
      segments: [],
      reason: String(error?.message || error).slice(0, 240),
      affectsRiskScore: false,
    };
  }
}
