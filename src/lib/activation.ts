import type { Calibration } from "./calibration";

/** Used without a calibration: half of the ADC's range, since RMS rarely gets near full scale. */
const UNCALIBRATED_FULL_SCALE = 64;

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Activation of each channel from 0 to 1, relative to the user's calibration if there is one. */
export function normalizeActivation(
  rms: ArrayLike<number>,
  calibration: Calibration | null,
): number[] {
  return Array.from(rms, (value, channel) => {
    if (!calibration) {
      return clamp(value / UNCALIBRATED_FULL_SCALE);
    }
    const floor = calibration.noiseFloor[channel];
    const range = calibration.maxActivation[channel] - floor;
    return range > 0 ? clamp((value - floor) / range) : 0;
  });
}
