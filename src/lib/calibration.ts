import type { Frame } from "./frames";
import { EMG_CHANNELS, EMG_RATE_HZ } from "./types";

export type PlacementArm = "left" | "right";
export type LineDirection = "wrist" | "elbow";

export interface Placement {
  arm: PlacementArm;
  lineToward: LineDirection;
}

/** Mirrors `Calibration` in src-tauri/src/profile.rs. */
export interface Calibration {
  placement: Placement;
  calibratedAt: string;
  noiseFloor: number[];
  maxActivation: number[];
  waveInActivation: number[];
  waveOutActivation: number[];
  waveInChannel: number;
  waveOutChannel: number;
  hangingAccelerometerX: number;
  referenceOrientation: number[];
}

export interface Profile {
  placement: Placement | null;
  calibration: Calibration | null;
}

export type CalibrationStepId =
  "rest" | "fist" | "waveIn" | "waveOut" | "hang" | "forward";

export interface CalibrationStep {
  id: CalibrationStepId;
  repetitions: number;
  prepareSeconds: number;
  captureSeconds: number;
  /** Pause between repetitions. */
  relaxSeconds: number;
}

export const CALIBRATION_STEPS: readonly CalibrationStep[] = [
  {
    id: "rest",
    repetitions: 1,
    prepareSeconds: 3,
    captureSeconds: 5,
    relaxSeconds: 0,
  },
  {
    id: "fist",
    repetitions: 3,
    prepareSeconds: 3,
    captureSeconds: 3,
    relaxSeconds: 3,
  },
  {
    id: "waveIn",
    repetitions: 1,
    prepareSeconds: 3,
    captureSeconds: 3,
    relaxSeconds: 0,
  },
  {
    id: "waveOut",
    repetitions: 1,
    prepareSeconds: 3,
    captureSeconds: 3,
    relaxSeconds: 0,
  },
  {
    id: "hang",
    repetitions: 1,
    prepareSeconds: 3,
    captureSeconds: 3,
    relaxSeconds: 0,
  },
  {
    id: "forward",
    repetitions: 1,
    prepareSeconds: 3,
    captureSeconds: 3,
    relaxSeconds: 0,
  },
];

export type CalibrationWarning =
  | "weakSignal"
  | "wavesNotDistinct"
  | "armNotHanging"
  | "lineMismatch"
  | "armMoved";

/** Samples of one step: one array per EMG sample, and IMU fields per IMU sample. */
export interface StepCapture {
  emg: number[][];
  orientation: number[][];
  accelerometerX: number[];
}

export type StepCaptures = Partial<Record<CalibrationStepId, StepCapture>>;

export function emptyCapture(): StepCapture {
  return { emg: [], orientation: [], accelerometerX: [] };
}

export function addFrameToCapture(capture: StepCapture, frame: Frame): void {
  for (let sample = 0; sample < frame.emgSamples; sample++) {
    const start = sample * frame.emgChannels;
    capture.emg.push(
      Array.from(frame.emg.subarray(start, start + frame.emgChannels)),
    );
  }
  for (let sample = 0; sample < frame.imuSamples; sample++) {
    const start = sample * 10;
    capture.orientation.push(Array.from(frame.imu.subarray(start, start + 4)));
    capture.accelerometerX.push(frame.imu[start + 4]);
  }
}

/** Root mean square of each channel. */
export function channelRms(samples: number[][]): number[] {
  const sums = new Array<number>(EMG_CHANNELS).fill(0);
  for (const sample of samples) {
    sample.forEach((value, channel) => {
      sums[channel] += value * value;
    });
  }
  return sums.map((sum) => Math.sqrt(sum / Math.max(samples.length, 1)));
}

/** Highest RMS of each channel over consecutive windows of `windowSize` samples. */
export function peakWindowRms(
  samples: number[][],
  windowSize: number,
): number[] {
  const peak = new Array<number>(EMG_CHANNELS).fill(0);
  for (
    let start = 0;
    start + windowSize <= samples.length;
    start += windowSize
  ) {
    channelRms(samples.slice(start, start + windowSize)).forEach(
      (rms, channel) => {
        peak[channel] = Math.max(peak[channel], rms);
      },
    );
  }
  return peak;
}

export function dominantChannel(activation: number[]): number {
  return activation.indexOf(Math.max(...activation));
}

/**
 * Normalized mean of unit quaternions. `q` and `-q` are the same rotation, so each one
 * is first aligned with the first sample.
 */
export function averageQuaternion(samples: number[][]): number[] {
  const total = [0, 0, 0, 0];
  for (const sample of samples) {
    const dot = sample.reduce(
      (sum, value, index) => sum + value * samples[0][index],
      0,
    );
    const sign = dot < 0 ? -1 : 1;
    sample.forEach((value, index) => {
      total[index] += sign * value;
    });
  }
  const norm = Math.hypot(...total);
  return norm === 0 ? [1, 0, 0, 0] : total.map((value) => value / norm);
}

function mean(values: number[]): number {
  return (
    values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  );
}

// These thresholds are starting estimates, to be tuned with real sessions.
const SHORT_WINDOW_SAMPLES = 40;
const MIN_SIGNAL_TO_NOISE = 3;
const MIN_HANGING_GRAVITY_G = 0.7;
const MAX_FORWARD_ALONG_X_G = 0.5;
const MIN_CAPTURED_FRACTION = 0.5;

/**
 * Sign of the X acceleration with the arm hanging down and the LED line toward the elbow.
 * Measured on a real Myo (-0.97 g). Flipping the armband reverses the X axis, so the line
 * toward the wrist gives the opposite sign.
 */
const HANGING_X_SIGN_WITH_LINE_TOWARD_ELBOW = -1;

/** False when too little data arrived, for example if the signal was interrupted. */
export function stepHasEnoughData(
  step: CalibrationStep,
  capture: StepCapture,
): boolean {
  const expected = step.captureSeconds * step.repetitions * EMG_RATE_HZ;
  return capture.emg.length >= expected * MIN_CAPTURED_FRACTION;
}

function maxActivationOf(capture: StepCapture): number[] {
  return peakWindowRms(capture.emg, SHORT_WINDOW_SAMPLES);
}

/**
 * Checks one step against the steps accepted before it. Steps always run in order, so
 * what each check needs is available when it runs.
 */
export function evaluateStep(
  id: CalibrationStepId,
  capture: StepCapture,
  accepted: StepCaptures,
  placement: Placement,
): CalibrationWarning | null {
  switch (id) {
    case "rest":
      return null;
    case "fist": {
      const noise = channelRms(accepted.rest?.emg ?? []);
      const weak = maxActivationOf(capture).some(
        (activation, channel) =>
          activation < noise[channel] * MIN_SIGNAL_TO_NOISE,
      );
      return weak ? "weakSignal" : null;
    }
    case "waveIn":
      return null;
    case "waveOut": {
      const waveIn = dominantChannel(channelRms(accepted.waveIn?.emg ?? []));
      const waveOut = dominantChannel(channelRms(capture.emg));
      return waveIn === waveOut ? "wavesNotDistinct" : null;
    }
    case "hang": {
      const gravity = mean(capture.accelerometerX);
      if (Math.abs(gravity) < MIN_HANGING_GRAVITY_G) {
        return "armNotHanging";
      }
      const expectedSign =
        placement.lineToward === "elbow"
          ? HANGING_X_SIGN_WITH_LINE_TOWARD_ELBOW
          : -HANGING_X_SIGN_WITH_LINE_TOWARD_ELBOW;
      return Math.sign(gravity) === expectedSign ? null : "lineMismatch";
    }
    case "forward":
      return Math.abs(mean(capture.accelerometerX)) > MAX_FORWARD_ALONG_X_G
        ? "armMoved"
        : null;
  }
}

/** The most useful number of a step to show the user when reviewing it. */
export type StepResult =
  | { kind: "level"; value: number }
  | { kind: "channel"; channel: number }
  | { kind: "gravity"; value: number };

export function summarizeStep(
  id: CalibrationStepId,
  capture: StepCapture,
): StepResult {
  switch (id) {
    case "rest":
      return { kind: "level", value: mean(channelRms(capture.emg)) };
    case "fist":
      return { kind: "level", value: mean(maxActivationOf(capture)) };
    case "waveIn":
    case "waveOut":
      return {
        kind: "channel",
        channel: dominantChannel(channelRms(capture.emg)),
      };
    case "hang":
    case "forward":
      return { kind: "gravity", value: mean(capture.accelerometerX) };
  }
}

export function buildCalibration(
  captures: StepCaptures,
  placement: Placement,
  calibratedAt: string,
): { calibration: Calibration; warnings: CalibrationWarning[] } {
  const capture = (id: CalibrationStepId) => captures[id] ?? emptyCapture();
  const waveInActivation = channelRms(capture("waveIn").emg);
  const waveOutActivation = channelRms(capture("waveOut").emg);

  const warnings = CALIBRATION_STEPS.map((step) =>
    evaluateStep(step.id, capture(step.id), captures, placement),
  ).filter((warning) => warning !== null);

  return {
    calibration: {
      placement,
      calibratedAt,
      noiseFloor: channelRms(capture("rest").emg),
      maxActivation: maxActivationOf(capture("fist")),
      waveInActivation,
      waveOutActivation,
      waveInChannel: dominantChannel(waveInActivation),
      waveOutChannel: dominantChannel(waveOutActivation),
      hangingAccelerometerX: mean(capture("hang").accelerometerX),
      referenceOrientation: averageQuaternion(capture("forward").orientation),
    },
    warnings,
  };
}

export interface StepProgress {
  phase: "prepare" | "capture" | "relax";
  repetition: number;
  secondsLeft: number;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function countDown(
  seconds: number,
  signal: AbortSignal,
  onSecond: (secondsLeft: number) => void,
): Promise<void> {
  for (let secondsLeft = seconds; secondsLeft > 0; secondsLeft--) {
    onSecond(secondsLeft);
    await wait(1000, signal);
  }
}

/**
 * Runs one step, capturing the frames that arrive during its capture phases. Aborting
 * `signal` rejects the returned promise.
 */
export async function runCalibrationStep(
  step: CalibrationStep,
  subscribe: (listener: (frame: Frame) => void) => () => void,
  signal: AbortSignal,
  onProgress: (progress: StepProgress) => void,
): Promise<StepCapture> {
  const capture = emptyCapture();

  for (let repetition = 1; repetition <= step.repetitions; repetition++) {
    const report = (phase: StepProgress["phase"]) => (secondsLeft: number) =>
      onProgress({ phase, repetition, secondsLeft });

    if (repetition === 1) {
      await countDown(step.prepareSeconds, signal, report("prepare"));
    } else {
      await countDown(step.relaxSeconds, signal, report("relax"));
    }

    const unsubscribe = subscribe((frame) => addFrameToCapture(capture, frame));
    try {
      await countDown(step.captureSeconds, signal, report("capture"));
    } finally {
      unsubscribe();
    }
  }
  return capture;
}
