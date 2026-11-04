import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  averageQuaternion,
  buildCalibration,
  CALIBRATION_STEPS,
  channelRms,
  dominantChannel,
  emptyCapture,
  evaluateStep,
  peakWindowRms,
  runCalibrationStep,
  stepHasEnoughData,
  summarizeStep,
  type CalibrationStep,
  type StepCapture,
  type StepCaptures,
} from "./calibration";
import type { Frame } from "./frames";

const PLACEMENT = { arm: "left", lineToward: "elbow" } as const;
const WRIST_PLACEMENT = { arm: "left", lineToward: "wrist" } as const;

function constantEmg(amplitudes: number[], samples = 2000): StepCapture {
  const capture = emptyCapture();
  for (let index = 0; index < samples; index++) {
    capture.emg.push(amplitudes.map((value) => (index % 2 ? value : -value)));
  }
  return capture;
}

function channelActive(channel: number): number[] {
  return Array.from({ length: 8 }, (_, index) => (index === channel ? 40 : 4));
}

function validCaptures(): StepCaptures {
  return {
    rest: constantEmg(new Array(8).fill(2)),
    fist: constantEmg(new Array(8).fill(40)),
    waveIn: constantEmg(channelActive(2)),
    waveOut: constantEmg(channelActive(6)),
    hang: { ...constantEmg(new Array(8).fill(2)), accelerometerX: [-1, -1] },
    forward: {
      ...constantEmg(new Array(8).fill(2)),
      accelerometerX: [0.1, -0.1],
      orientation: [[1, 0, 0, 0]],
    },
  };
}

describe("signal statistics", () => {
  it("computes the RMS of each channel", () => {
    const rms = channelRms(constantEmg([3, 4, 0, 0, 0, 0, 0, 0], 10).emg);
    expect(rms[0]).toBeCloseTo(3);
    expect(rms[1]).toBeCloseTo(4);
    expect(rms[2]).toBe(0);
  });

  it("finds the strongest window rather than the overall RMS", () => {
    const samples = [
      ...constantEmg(new Array(8).fill(1), 40).emg,
      ...constantEmg(new Array(8).fill(30), 40).emg,
    ];
    expect(peakWindowRms(samples, 40)[0]).toBeCloseTo(30);
  });

  it("finds the most active channel", () => {
    expect(dominantChannel(channelActive(5))).toBe(5);
  });

  it("averages quaternions, treating q and -q as the same rotation", () => {
    const average = averageQuaternion([
      [1, 0, 0, 0],
      [-1, 0, 0, 0],
    ]);
    expect(average).toEqual([1, 0, 0, 0]);
  });
});

describe("evaluateStep", () => {
  it("accepts every step of a good session", () => {
    const captures = validCaptures();
    for (const step of CALIBRATION_STEPS) {
      expect(
        evaluateStep(step.id, captures[step.id]!, captures, PLACEMENT),
      ).toBeNull();
    }
  });

  it("flags a fist that barely rises above the resting noise", () => {
    const captures = validCaptures();
    const fist = constantEmg(new Array(8).fill(3));
    expect(evaluateStep("fist", fist, captures, PLACEMENT)).toBe("weakSignal");
  });

  it("flags wave out peaking on the same channel as wave in", () => {
    const captures = validCaptures();
    const waveOut = constantEmg(channelActive(2));
    expect(evaluateStep("waveOut", waveOut, captures, PLACEMENT)).toBe(
      "wavesNotDistinct",
    );
  });

  it("flags an arm that isn't hanging", () => {
    const hang = { ...emptyCapture(), accelerometerX: [0.1, 0.1] };
    expect(evaluateStep("hang", hang, {}, PLACEMENT)).toBe("armNotHanging");
  });

  it("uses gravity to check the stated direction of the LED line", () => {
    const measured = { ...emptyCapture(), accelerometerX: [-0.97, -0.97] };
    expect(evaluateStep("hang", measured, {}, PLACEMENT)).toBeNull();
    expect(evaluateStep("hang", measured, {}, WRIST_PLACEMENT)).toBe(
      "lineMismatch",
    );

    const flipped = { ...emptyCapture(), accelerometerX: [0.97, 0.97] };
    expect(evaluateStep("hang", flipped, {}, WRIST_PLACEMENT)).toBeNull();
    expect(evaluateStep("hang", flipped, {}, PLACEMENT)).toBe("lineMismatch");
  });

  it("flags an arm that isn't level", () => {
    const forward = { ...emptyCapture(), accelerometerX: [0.9, 0.9] };
    expect(evaluateStep("forward", forward, {}, PLACEMENT)).toBe("armMoved");
  });
});

describe("summarizeStep", () => {
  const captures = validCaptures();

  it("reports the level of the signal steps", () => {
    const result = summarizeStep("fist", captures.fist!);
    expect(result.kind).toBe("level");
    expect(result.kind === "level" && result.value).toBeCloseTo(40);
  });

  it("reports the strongest channel of the wrist gestures", () => {
    expect(summarizeStep("waveOut", captures.waveOut!)).toEqual({
      kind: "channel",
      channel: 6,
    });
  });

  it("reports the gravity along the band for the posture steps", () => {
    expect(summarizeStep("hang", captures.hang!)).toEqual({
      kind: "gravity",
      value: -1,
    });
  });
});

describe("stepHasEnoughData", () => {
  const step = CALIBRATION_STEPS[0];

  it("accepts a complete capture", () => {
    expect(stepHasEnoughData(step, constantEmg([], 1000))).toBe(true);
  });

  it("rejects a capture with too few samples", () => {
    expect(stepHasEnoughData(step, constantEmg([], 10))).toBe(false);
  });
});

describe("buildCalibration", () => {
  it("summarizes a good session without warnings", () => {
    const { calibration, warnings } = buildCalibration(
      validCaptures(),
      PLACEMENT,
      "2026-11-04T20:00:00Z",
    );
    expect(warnings).toEqual([]);
    expect(calibration.placement).toEqual(PLACEMENT);
    expect(calibration.noiseFloor[0]).toBeCloseTo(2);
    expect(calibration.maxActivation[0]).toBeCloseTo(40);
    expect(calibration.waveInChannel).toBe(2);
    expect(calibration.waveOutChannel).toBe(6);
    expect(calibration.hangingAccelerometerX).toBeCloseTo(-1);
    expect(calibration.referenceOrientation).toEqual([1, 0, 0, 0]);
  });

  it("collects the warnings of the accepted steps", () => {
    const { warnings } = buildCalibration(
      { ...validCaptures(), waveOut: constantEmg(channelActive(2)) },
      PLACEMENT,
      "",
    );
    expect(warnings).toEqual(["wavesNotDistinct"]);
  });
});

describe("runCalibrationStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const frame: Frame = {
    emgChannels: 8,
    emgSamples: 1,
    emg: new Int8Array(8).fill(1),
    imuSamples: 0,
    imu: new Float32Array(0),
  };

  const repeated: CalibrationStep = {
    id: "fist",
    repetitions: 3,
    prepareSeconds: 2,
    captureSeconds: 3,
    relaxSeconds: 1,
  };

  function frameSource() {
    const listeners = new Set<(frame: Frame) => void>();
    return {
      subscribe: (listener: (frame: Frame) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      emit: () => listeners.forEach((listener) => listener(frame)),
      active: () => listeners.size,
    };
  }

  it("captures only during the capture phases of every repetition", async () => {
    const source = frameSource();
    const phases: string[] = [];
    const result = runCalibrationStep(
      repeated,
      source.subscribe,
      new AbortController().signal,
      (progress) => {
        phases.push(`${progress.phase}${progress.repetition}`);
        source.emit();
      },
    );
    await vi.advanceTimersByTimeAsync(2000 + 3 * 3000 + 2 * 1000);
    const capture = await result;

    // One frame for each second of capture, over three repetitions.
    expect(capture.emg).toHaveLength(9);
    expect(source.active()).toBe(0);
    expect(phases.filter((phase) => phase === "prepare1")).toHaveLength(2);
    expect(phases).toContain("relax2");
    expect(phases).toContain("capture3");
    expect(phases).not.toContain("relax1");
  });

  it("stops listening when aborted", async () => {
    const source = frameSource();
    const controller = new AbortController();
    const result = runCalibrationStep(
      repeated,
      source.subscribe,
      controller.signal,
      () => {},
    );
    const rejected = expect(result).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(2500);
    expect(source.active()).toBe(1);
    controller.abort(new Error("cancelled"));
    await rejected;
    expect(source.active()).toBe(0);
  });
});
