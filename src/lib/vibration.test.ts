import { describe, expect, it } from "vitest";
import {
  addStep,
  clampStep,
  DEFAULT_PATTERN,
  MAX_DURATION_MS,
  MAX_STEPS,
  MIN_DURATION_MS,
  patternDuration,
  removeStep,
  updateStep,
} from "./vibration";

describe("vibration patterns", () => {
  it("keeps steps within what the protocol allows", () => {
    expect(clampStep({ durationMs: 1, strength: -5 })).toEqual({
      durationMs: MIN_DURATION_MS,
      strength: 0,
    });
    expect(clampStep({ durationMs: 99999, strength: 999 })).toEqual({
      durationMs: MAX_DURATION_MS,
      strength: 255,
    });
  });

  it("snaps durations and rounds strengths", () => {
    expect(clampStep({ durationMs: 234, strength: 12.6 })).toEqual({
      durationMs: 230,
      strength: 13,
    });
  });

  it("adds steps up to the protocol's limit", () => {
    let steps = DEFAULT_PATTERN;
    for (let added = 0; added < 10; added++) {
      steps = addStep(steps);
    }
    expect(steps).toHaveLength(MAX_STEPS);
  });

  it("always keeps at least one step", () => {
    const one = removeStep(DEFAULT_PATTERN.slice(0, 2), 0);
    expect(one).toEqual([DEFAULT_PATTERN[1]]);
    expect(removeStep(one, 0)).toEqual(one);
  });

  it("updates only the chosen step, and clamps it", () => {
    const steps = updateStep(DEFAULT_PATTERN, 1, { strength: 900 });
    expect(steps[1].strength).toBe(255);
    expect(steps[0]).toEqual(DEFAULT_PATTERN[0]);
  });

  it("adds up the total duration", () => {
    expect(patternDuration(DEFAULT_PATTERN)).toBe(550);
  });
});
