import { describe, expect, it } from "vitest";
import {
  classify,
  evaluate,
  extractFeatures,
  flattenExamples,
  PredictionSmoother,
  type TrainedGesture,
} from "./gestures";

function gesture(name: string, ...repetitions: number[][][]): TrainedGesture {
  return { name, illustration: null, repetitions };
}

/** A repetition of frames around one point, on one feature. */
function around(center: number): number[][] {
  return [[center - 0.1], [center], [center + 0.1]];
}

describe("extractFeatures", () => {
  it("compresses large values", () => {
    const [small, large] = extractFeatures([0, Math.E - 1]);
    expect(small).toBe(0);
    expect(large).toBeCloseTo(1);
  });

  it("keeps one feature per channel", () => {
    expect(extractFeatures(new Float32Array(8))).toHaveLength(8);
  });
});

describe("classify", () => {
  const examples = flattenExamples([
    gesture("low", around(0), around(0.2)),
    gesture("high", around(10), around(10.2)),
  ]);

  it("picks the gesture of the nearest examples", () => {
    expect(classify(examples, [0.1])?.gesture).toBe(0);
    expect(classify(examples, [10.1])?.gesture).toBe(1);
  });

  it("reports how many neighbors agree", () => {
    expect(classify(examples, [0.1])?.confidence).toBe(1);
    const mixed = [
      { gesture: 0, features: [0] },
      { gesture: 0, features: [1] },
      { gesture: 1, features: [2] },
    ];
    expect(classify(mixed, [0], 3)?.confidence).toBeCloseTo(2 / 3);
  });

  it("settles ties with the nearest example", () => {
    const tied = [
      { gesture: 1, features: [1] },
      { gesture: 0, features: [2] },
    ];
    expect(classify(tied, [0], 2)?.gesture).toBe(1);
  });

  it("has no answer without examples", () => {
    expect(classify([], [1])).toBeNull();
  });
});

describe("evaluate", () => {
  it("scores well-separated gestures as perfect", () => {
    const result = evaluate([
      gesture("low", around(0), around(0.2)),
      gesture("high", around(10), around(10.2)),
    ]);
    expect(result?.accuracy).toBe(1);
    expect(result?.confusion).toEqual([
      [6, 0],
      [0, 6],
    ]);
  });

  it("shows confusion between gestures that overlap", () => {
    const result = evaluate([
      gesture("a", around(0), around(100)),
      gesture("b", around(100.5), around(200)),
    ]);
    // The held-out repetition at 100 of "a" looks like "b", and the reverse.
    expect(result?.accuracy).toBeLessThan(1);
    expect(result?.confusion[0][1]).toBeGreaterThan(0);
  });

  it("really holds out each repetition", () => {
    // Each repetition is unique, so it would look perfect if it could see itself.
    const result = evaluate([
      gesture("a", [[0]], [[50]]),
      gesture("b", [[49]], [[1]]),
    ]);
    expect(result?.accuracy).toBe(0);
  });

  it("needs two gestures with two repetitions each", () => {
    expect(evaluate([])).toBeNull();
    expect(evaluate([gesture("a", around(0), around(1))])).toBeNull();
    expect(
      evaluate([gesture("a", around(0), around(1)), gesture("b", around(5))]),
    ).toBeNull();
  });
});

describe("PredictionSmoother", () => {
  it("ignores a brief wrong prediction", () => {
    const smoother = new PredictionSmoother(5);
    [1, 1, 1].forEach((value) => smoother.add(value));
    expect(smoother.add(2)).toBe(1);
  });

  it("follows a lasting change", () => {
    const smoother = new PredictionSmoother(5);
    [1, 1, 1, 2, 2].forEach((value) => smoother.add(value));
    expect(smoother.add(2)).toBe(2);
  });

  it("forgets predictions beyond its size", () => {
    const smoother = new PredictionSmoother(2);
    [1, 1, 2].forEach((value) => smoother.add(value));
    expect(smoother.add(2)).toBe(2);
  });
});
