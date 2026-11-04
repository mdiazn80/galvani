const FRAME_VERSION = 1;
const HEADER_LENGTH = 8;
const IMU_FIELDS = 10;
const BYTES_PER_FLOAT = 4;

export interface Frame {
  emgChannels: number;
  emgSamples: number;
  /** Values ordered by sample and then channel. */
  emg: Int8Array;
  imuSamples: number;
  /** Orientation (w, x, y, z), accelerometer and gyroscope for each sample. */
  imu: Float32Array;
}

/**
 * Decodes a binary frame built by `FrameBuilder` in src-tauri/src/myo/device.rs. The
 * returned arrays are views over `buffer`. The IMU view relies on a little-endian host,
 * which every platform that Tauri desktop supports is.
 */
export function decodeFrame(buffer: ArrayBuffer): Frame {
  if (buffer.byteLength < HEADER_LENGTH) {
    throw new Error(`Frame is too short: ${buffer.byteLength} bytes`);
  }

  const header = new DataView(buffer);
  const version = header.getUint8(0);
  if (version !== FRAME_VERSION) {
    throw new Error(`Unsupported frame version: ${version}`);
  }

  const emgChannels = header.getUint8(1);
  const emgSamples = header.getUint16(2, true);
  const imuSamples = header.getUint16(4, true);
  const emgLength = emgChannels * emgSamples;
  const imuStart =
    Math.ceil((HEADER_LENGTH + emgLength) / BYTES_PER_FLOAT) * BYTES_PER_FLOAT;
  const imuLength = imuSamples * IMU_FIELDS;
  const expectedLength = imuStart + imuLength * BYTES_PER_FLOAT;

  if (buffer.byteLength !== expectedLength) {
    throw new Error(
      `Frame has ${buffer.byteLength} bytes, expected ${expectedLength}`,
    );
  }

  return {
    emgChannels,
    emgSamples,
    emg: new Int8Array(buffer, HEADER_LENGTH, emgLength),
    imuSamples,
    imu: new Float32Array(buffer, imuStart, imuLength),
  };
}
