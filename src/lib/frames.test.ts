import { describe, expect, it } from "vitest";
import { decodeFrame } from "./frames";

function bytes(values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function floatBytes(values: number[]): number[] {
  return Array.from(new Uint8Array(new Float32Array(values).buffer));
}

describe("decodeFrame", () => {
  it("decodes EMG and IMU data laid out as device.rs builds them", () => {
    const imu = [1, 0, 0, 0, 0, 0, 1, 0, 0, 2.5];
    const frame = decodeFrame(
      bytes([
        1,
        8,
        1,
        0,
        1,
        0,
        0,
        0,
        1,
        255,
        2,
        254,
        3,
        253,
        4,
        252,
        ...floatBytes(imu),
      ]),
    );

    expect(frame.emgChannels).toBe(8);
    expect(frame.emgSamples).toBe(1);
    expect(Array.from(frame.emg)).toEqual([1, -1, 2, -2, 3, -3, 4, -4]);
    expect(frame.imuSamples).toBe(1);
    expect(Array.from(frame.imu)).toEqual(imu);
  });

  it("skips the padding that aligns the IMU section", () => {
    const frame = decodeFrame(
      bytes([
        1,
        1,
        9,
        0,
        1,
        0,
        0,
        0,
        ...new Array(9).fill(7),
        0,
        0,
        0,
        ...floatBytes(new Array(10).fill(0.5)),
      ]),
    );

    expect(frame.emg).toHaveLength(9);
    expect(frame.imu[0]).toBe(0.5);
  });

  it("decodes a frame without samples", () => {
    const frame = decodeFrame(bytes([1, 8, 0, 0, 0, 0, 0, 0]));
    expect(frame.emgSamples).toBe(0);
    expect(frame.imuSamples).toBe(0);
  });

  it("rejects malformed frames", () => {
    expect(() => decodeFrame(bytes([1, 8]))).toThrow("too short");
    expect(() => decodeFrame(bytes([2, 8, 0, 0, 0, 0, 0, 0]))).toThrow(
      "version",
    );
    expect(() => decodeFrame(bytes([1, 8, 1, 0, 0, 0, 0, 0, 1]))).toThrow(
      "expected",
    );
  });
});
