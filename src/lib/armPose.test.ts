import { describe, expect, it } from "vitest";
import {
  armAngles,
  createArmPose,
  estimateUpSign,
  wristAlongX,
} from "./armPose";
import { IDENTITY, multiply, rotate, type Quaternion } from "./quaternion";

function aboutAxis(
  axis: [number, number, number],
  degrees: number,
): Quaternion {
  const half = (degrees * Math.PI) / 360;
  const sin = Math.sin(half);
  return [Math.cos(half), axis[0] * sin, axis[1] * sin, axis[2] * sin];
}

function expectVector(actual: readonly number[], expected: number[]) {
  actual.forEach((value, index) => {
    expect(value).toBeCloseTo(expected[index], 5);
  });
}

// World: Z up. The arm first points along world +X, with the band's +X toward the hand.
const WORLD_UP: [number, number, number] = [0, 0, 1];
// Viewed from above, turning to the user's right is clockwise, a negative turn about up.
const TURN_RIGHT_90 = aboutAxis(WORLD_UP, -90);
// With the arm along +X and up along +Z, the user's right is world -Y. Raising the arm
// moves +X toward +Z, a negative turn about +Y.
const RAISE_90 = aboutAxis([0, 1, 0], -90);

describe("createArmPose", () => {
  const pose = createArmPose(IDENTITY, 1, 1);

  it("gives the identity at the zero posture", () => {
    expectVector(pose(IDENTITY), [...IDENTITY]);
  });

  it("raises the arm toward view up", () => {
    expectVector(rotate(pose(RAISE_90), [1, 0, 0]), [0, 1, 0]);
  });

  it("turns the arm toward the user's right", () => {
    expectVector(rotate(pose(TURN_RIGHT_90), [1, 0, 0]), [0, 0, 1]);
  });

  it("doesn't depend on the world heading of the zero posture", () => {
    const heading = aboutAxis(WORLD_UP, 137);
    const headed = createArmPose(heading, 1, 1);
    // The same physical movement, carried out from the other heading.
    const moved = multiply(heading, RAISE_90);
    expectVector(rotate(headed(moved), [1, 0, 0]), [0, 1, 0]);
  });

  it("doesn't depend on how the band is rotated around the forearm", () => {
    const bandRoll = aboutAxis([1, 0, 0], 70);
    const rolled = createArmPose(bandRoll, 1, 1);
    // Raising the arm is a rotation in the world, applied on top of the band's posture.
    const moved = multiply(RAISE_90, bandRoll);
    expectVector(rotate(rolled(moved), [1, 0, 0]), [0, 1, 0]);
  });

  it("uses the hand's end of the band when the band is flipped", () => {
    // The band's -X points to the hand, so the hand points along world -X at zero.
    const flipped = createArmPose(IDENTITY, -1, 1);
    // Raising the hand from -X toward +Z is a positive turn about +Y.
    const moved = aboutAxis([0, 1, 0], 90);
    expectVector(rotate(flipped(moved), [1, 0, 0]), [0, 1, 0]);
  });

  it("copes with a zero posture that has the arm vertical", () => {
    const vertical = aboutAxis([0, 1, 0], -90);
    const result = createArmPose(vertical, 1, 1)(vertical);
    expectVector(result, [...IDENTITY]);
  });
});

describe("armAngles", () => {
  const pose = createArmPose(IDENTITY, 1, 1);

  it("reads zero at the zero posture", () => {
    const angles = armAngles(IDENTITY);
    expect(angles.roll).toBeCloseTo(0);
    expect(angles.pitch).toBeCloseTo(0);
    expect(angles.yaw).toBeCloseTo(0);
  });

  it("reads a raised arm as positive pitch", () => {
    const angles = armAngles(pose(aboutAxis([0, 1, 0], -30)));
    expect(angles.pitch).toBeCloseTo(30);
    expect(angles.yaw).toBeCloseTo(0);
    expect(angles.roll).toBeCloseTo(0);
  });

  it("reads a turn to the right as positive yaw", () => {
    const angles = armAngles(pose(aboutAxis(WORLD_UP, -30)));
    expect(angles.yaw).toBeCloseTo(30);
    expect(angles.pitch).toBeCloseTo(0);
  });

  it("reads a clockwise turn of the forearm as positive roll", () => {
    // Seen from behind the arm, clockwise moves the top toward the user's right.
    const angles = armAngles(pose(aboutAxis([1, 0, 0], 30)));
    expect(angles.roll).toBeCloseTo(30);
    expect(angles.pitch).toBeCloseTo(0);
    expect(angles.yaw).toBeCloseTo(0);
  });

  it("doesn't fail with the arm pointing straight up", () => {
    const angles = armAngles(pose(RAISE_90));
    expect(angles.pitch).toBeCloseTo(90);
    expect(angles.roll).toBe(0);
  });
});

describe("estimateUpSign", () => {
  it("finds up from the acceleration measured in the world", () => {
    expect(estimateUpSign([IDENTITY], [[0, 0, 1]])).toBe(1);
    expect(estimateUpSign([IDENTITY], [[0, 0, -1]])).toBe(-1);
  });

  it("rotates the acceleration into the world first", () => {
    const hanging = aboutAxis([0, 1, 0], 90);
    // Band +X points down in this orientation, so an upward reading is along -X.
    expect(estimateUpSign([hanging], [[-1, 0, 0]])).toBe(1);
  });

  it("defaults to +Z without data", () => {
    expect(estimateUpSign([], [])).toBe(1);
  });
});

describe("wristAlongX", () => {
  it("follows the measured relation with the LED line", () => {
    expect(wristAlongX("elbow")).toBe(1);
    expect(wristAlongX("wrist")).toBe(-1);
  });
});
