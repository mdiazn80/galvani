import { describe, expect, it } from "vitest";
import { normalizeActivation } from "./activation";
import type { Calibration } from "./calibration";

function calibration(noise: number, max: number): Calibration {
  return {
    noiseFloor: [noise],
    maxActivation: [max],
  } as unknown as Calibration;
}

describe("normalizeActivation", () => {
  it("maps rest to 0 and the calibrated fist to 1", () => {
    const calibrated = calibration(5, 45);
    expect(normalizeActivation([5], calibrated)).toEqual([0]);
    expect(normalizeActivation([25], calibrated)).toEqual([0.5]);
    expect(normalizeActivation([45], calibrated)).toEqual([1]);
  });

  it("clamps values outside the calibrated range", () => {
    const calibrated = calibration(5, 45);
    expect(normalizeActivation([1], calibrated)).toEqual([0]);
    expect(normalizeActivation([90], calibrated)).toEqual([1]);
  });

  it("copes with a channel whose fist was no stronger than its rest", () => {
    expect(normalizeActivation([10], calibration(8, 8))).toEqual([0]);
  });

  it("uses a fixed scale without a calibration", () => {
    expect(normalizeActivation([32], null)).toEqual([0.5]);
  });
});
