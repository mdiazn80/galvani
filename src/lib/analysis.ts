const ANALYSIS_VERSION = 1;
const HEADER_LENGTH = 8;
const METRICS_PER_CHANNEL = 4;
const BYTES_PER_FLOAT = 4;

export interface Analysis {
  channels: number;
  bins: number;
  sampleRate: number;
  rms: Float32Array;
  mav: Float32Array;
  peak: Float32Array;
  zeroCrossingRate: Float32Array;
  /** Amplitude spectrum of each channel in turn. */
  spectra: Float32Array;
}

/**
 * Decodes a binary frame built by `Analyzer` in src-tauri/src/myo/dsp.rs. The views over
 * `buffer` rely on a little-endian host, which every platform Tauri desktop supports is.
 */
export function decodeAnalysis(buffer: ArrayBuffer): Analysis {
  if (buffer.byteLength < HEADER_LENGTH) {
    throw new Error(`Analysis frame is too short: ${buffer.byteLength} bytes`);
  }
  const header = new DataView(buffer);
  const version = header.getUint8(0);
  if (version !== ANALYSIS_VERSION) {
    throw new Error(`Unsupported analysis version: ${version}`);
  }
  const channels = header.getUint8(1);
  const bins = header.getUint16(2, true);
  const sampleRate = header.getFloat32(4, true);
  const metricsLength = channels * METRICS_PER_CHANNEL;
  const spectraLength = channels * bins;
  const expected =
    HEADER_LENGTH + (metricsLength + spectraLength) * BYTES_PER_FLOAT;
  if (buffer.byteLength !== expected) {
    throw new Error(
      `Analysis frame has ${buffer.byteLength} bytes, expected ${expected}`,
    );
  }

  const metrics = new Float32Array(buffer, HEADER_LENGTH, metricsLength);
  const pick = (offset: number) =>
    Float32Array.from({ length: channels }, (_, channel) => {
      return metrics[channel * METRICS_PER_CHANNEL + offset];
    });

  return {
    channels,
    bins,
    sampleRate,
    rms: pick(0),
    mav: pick(1),
    peak: pick(2),
    zeroCrossingRate: pick(3),
    spectra: new Float32Array(
      buffer,
      HEADER_LENGTH + metricsLength * BYTES_PER_FLOAT,
      spectraLength,
    ),
  };
}
