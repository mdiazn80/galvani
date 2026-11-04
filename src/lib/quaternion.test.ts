import { describe, expect, it } from "vitest";
import {
  cross,
  dot,
  IDENTITY,
  multiply,
  normalize,
  rotate,
  type Quaternion,
} from "./quaternion";

const half = Math.SQRT1_2;
/** 90 degrees about each axis. */
const ABOUT_X: Quaternion = [half, half, 0, 0];
const ABOUT_Y: Quaternion = [half, 0, half, 0];
const ABOUT_Z: Quaternion = [half, 0, 0, half];

function expectVector(actual: readonly number[], expected: number[]) {
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index]);
  });
}

describe("quaternions", () => {
  it("treats the identity as neutral", () => {
    expectVector(multiply(ABOUT_X, IDENTITY), [...ABOUT_X]);
    expectVector(multiply(IDENTITY, ABOUT_X), [...ABOUT_X]);
  });

  it("rotates vectors following the right-hand rule", () => {
    expectVector(rotate(ABOUT_Z, [1, 0, 0]), [0, 1, 0]);
    expectVector(rotate(ABOUT_X, [0, 1, 0]), [0, 0, 1]);
    expectVector(rotate(ABOUT_Y, [0, 0, 1]), [1, 0, 0]);
  });

  it("provides the basic vector operations", () => {
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(normalize([3, 0, 4])).toEqual([0.6, 0, 0.8]);
  });
});
