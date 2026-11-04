/** Mirrors `VibrationStep` in src-tauri/src/myo/protocol.rs. */
export interface VibrationStep {
  durationMs: number;
  strength: number;
}

export const MAX_STEPS = 6;
export const MIN_DURATION_MS = 50;
export const MAX_DURATION_MS = 2000;
export const MAX_STRENGTH = 255;
const DURATION_GRID_MS = 10;

export const DEFAULT_PATTERN: VibrationStep[] = [
  { durationMs: 200, strength: 255 },
  { durationMs: 150, strength: 0 },
  { durationMs: 200, strength: 255 },
];

export function clampStep(step: VibrationStep): VibrationStep {
  const snapped = Math.round(step.durationMs / DURATION_GRID_MS);
  return {
    durationMs: Math.max(
      MIN_DURATION_MS,
      Math.min(MAX_DURATION_MS, snapped * DURATION_GRID_MS),
    ),
    strength: Math.max(0, Math.min(MAX_STRENGTH, Math.round(step.strength))),
  };
}

export function patternDuration(steps: readonly VibrationStep[]): number {
  return steps.reduce((total, step) => total + step.durationMs, 0);
}

export function addStep(steps: readonly VibrationStep[]): VibrationStep[] {
  if (steps.length >= MAX_STEPS) {
    return [...steps];
  }
  return [...steps, { durationMs: 200, strength: MAX_STRENGTH }];
}

export function removeStep(
  steps: readonly VibrationStep[],
  index: number,
): VibrationStep[] {
  return steps.length <= 1
    ? [...steps]
    : steps.filter((_, stepIndex) => stepIndex !== index);
}

export function updateStep(
  steps: readonly VibrationStep[],
  index: number,
  change: Partial<VibrationStep>,
): VibrationStep[] {
  return steps.map((step, stepIndex) =>
    stepIndex === index ? clampStep({ ...step, ...change }) : step,
  );
}
