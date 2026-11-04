import type { GestureId } from "../components/GestureIllustration";

/** Mirrors `TrainedGesture` in src-tauri/src/profile.rs. */
export interface TrainedGesture {
  name: string;
  /** Known gestures show an illustration while training. */
  illustration: GestureId | null;
  /** Feature vectors of each recorded repetition. */
  repetitions: number[][][];
}

export const REPETITIONS = 5;
export const REPETITION_SECONDS = 3;
const NEIGHBORS = 5;

/**
 * Analysis windows overlap the previous 320 ms, so the first ones of a repetition still
 * include the movement into the gesture. At 10 per second, this skips about 400 ms.
 */
export const SETTLING_FRAMES = 4;
/** Far fewer frames than expected means that the signal was interrupted. */
export const MIN_FRAMES_PER_REPETITION = 15;

/**
 * Features of one analysis frame: the RMS of each channel, compressed with a logarithm so
 * that the pattern across channels counts for more than the raw strength.
 */
export function extractFeatures(rms: ArrayLike<number>): number[] {
  return Array.from(rms, (value) => Math.log1p(value));
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < a.length; index++) {
    const difference = a[index] - b[index];
    total += difference * difference;
  }
  return total;
}

export interface Example {
  gesture: number;
  features: number[];
}

export interface Prediction {
  gesture: number;
  /** Share of the nearest examples that agree, from 0 to 1. */
  confidence: number;
}

/** k-nearest neighbors, with ties going to the gesture of the nearest example. */
export function classify(
  examples: readonly Example[],
  features: readonly number[],
  neighbors = NEIGHBORS,
): Prediction | null {
  if (examples.length === 0) {
    return null;
  }
  const nearest = examples
    .map((example) => ({
      gesture: example.gesture,
      distance: squaredDistance(example.features, features),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, neighbors);

  const votes = new Map<number, number>();
  for (const { gesture } of nearest) {
    votes.set(gesture, (votes.get(gesture) ?? 0) + 1);
  }
  const winner = nearest.reduce(
    (best, { gesture }) =>
      (votes.get(gesture) ?? 0) > (votes.get(best) ?? 0) ? gesture : best,
    nearest[0].gesture,
  );
  return {
    gesture: winner,
    confidence: (votes.get(winner) ?? 0) / nearest.length,
  };
}

export function flattenExamples(
  gestures: readonly TrainedGesture[],
): Example[] {
  return gestures.flatMap((gesture, index) =>
    gesture.repetitions.flatMap((repetition) =>
      repetition.map((features) => ({ gesture: index, features })),
    ),
  );
}

export interface Evaluation {
  /** Indexed by true gesture and then predicted gesture. */
  confusion: number[][];
  accuracy: number;
}

/**
 * Tests each repetition on a classifier trained without it. Frames of one repetition are
 * almost alike, so a random split would look far better than the real performance.
 * Gestures need at least two repetitions to take part.
 */
export function evaluate(
  gestures: readonly TrainedGesture[],
): Evaluation | null {
  const usable = gestures.filter((gesture) => gesture.repetitions.length >= 2);
  if (usable.length < 2 || usable.length !== gestures.length) {
    return null;
  }

  const confusion = usable.map(() => usable.map(() => 0));
  let correct = 0;
  let total = 0;

  usable.forEach((gesture, gestureIndex) => {
    gesture.repetitions.forEach((repetition, heldOut) => {
      const training = usable.map((other, otherIndex) =>
        otherIndex === gestureIndex
          ? {
              ...other,
              repetitions: other.repetitions.filter(
                (_, index) => index !== heldOut,
              ),
            }
          : other,
      );
      const examples = flattenExamples(training);
      for (const features of repetition) {
        const prediction = classify(examples, features);
        if (prediction) {
          confusion[gestureIndex][prediction.gesture]++;
          total++;
          if (prediction.gesture === gestureIndex) {
            correct++;
          }
        }
      }
    });
  });

  return { confusion, accuracy: total > 0 ? correct / total : 0 };
}

/** Steadies live predictions by taking the most frequent of the latest few. */
export class PredictionSmoother {
  private recent: number[] = [];

  constructor(private readonly size = 5) {}

  add(gesture: number): number {
    this.recent.push(gesture);
    if (this.recent.length > this.size) {
      this.recent.shift();
    }
    const counts = new Map<number, number>();
    let best = gesture;
    let bestCount = 0;
    // From newest to oldest, so that a tie goes to the most recent gesture.
    for (let index = this.recent.length - 1; index >= 0; index--) {
      const value = this.recent[index];
      const count = (counts.get(value) ?? 0) + 1;
      counts.set(value, count);
      if (count > bestCount) {
        best = value;
        bestCount = count;
      }
    }
    return best;
  }
}
