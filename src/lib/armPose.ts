import type { LineDirection } from "./calibration";
import {
  conjugate,
  cross,
  dot,
  multiply,
  normalize,
  rotate,
  type Quaternion,
  type Vector3,
} from "./quaternion";

/**
 * Turns raw Myo orientations into the pose of the arm, as seen from behind it.
 *
 * The result uses view axes: X points where the arm pointed at the zero posture, Y points
 * up and Z points to the user's right. The Myo's orientation maps the band's axes to a
 * world whose Z is vertical and whose heading is arbitrary, and the band can sit at any
 * rotation around the forearm. So movement is measured in the world and then expressed
 * relative to the zero posture, which doesn't depend on either of those.
 */

const MIN_HORIZONTAL_LENGTH = 0.2;

/** Direction along the band's X axis that points to the hand. */
export function wristAlongX(lineToward: LineDirection): 1 | -1 {
  // Measured: with the LED line toward the elbow, X reads -1 g with the arm hanging down.
  // An accelerometer at rest reads upward, so -X points up and +X points to the hand.
  return lineToward === "elbow" ? 1 : -1;
}

/**
 * Whether world +Z is up, from the direction of the acceleration in the world. Averaging
 * and keeping only the sign tolerates the arm moving while it is measured.
 */
export function estimateUpSign(
  orientations: readonly Quaternion[],
  accelerations: readonly Vector3[],
): 1 | -1 {
  let total = 0;
  orientations.forEach((orientation, index) => {
    total += rotate(orientation, accelerations[index])[2];
  });
  return total < 0 ? -1 : 1;
}

function quaternionFromRows(x: Vector3, y: Vector3, z: Vector3): Quaternion {
  const trace = x[0] + y[1] + z[2];
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return [s / 4, (z[1] - y[2]) / s, (x[2] - z[0]) / s, (y[0] - x[1]) / s];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    return [(z[1] - y[2]) / s, s / 4, (x[1] + y[0]) / s, (x[2] + z[0]) / s];
  }
  if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    return [(x[2] - z[0]) / s, (x[1] + y[0]) / s, s / 4, (y[2] + z[1]) / s];
  }
  const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
  return [(y[0] - x[1]) / s, (x[2] + z[0]) / s, (y[2] + z[1]) / s, s / 4];
}

/** Returns a function that maps a raw orientation to the arm pose in view axes. */
export function createArmPose(
  zero: Quaternion,
  wrist: 1 | -1,
  upSign: 1 | -1,
): (orientation: Quaternion) => Quaternion {
  const up: Vector3 = [0, 0, upSign];
  const pointing = rotate(zero, [wrist, 0, 0]);
  const horizontal: Vector3 = [pointing[0], pointing[1], 0];
  // With the arm vertical at the zero posture there is no heading to use, so any will do.
  const forward: Vector3 =
    Math.hypot(horizontal[0], horizontal[1]) < MIN_HORIZONTAL_LENGTH
      ? [1, 0, 0]
      : normalize(horizontal);
  const right = cross(forward, up);

  const worldToView = quaternionFromRows(forward, up, right);
  const viewToWorld = conjugate(worldToView);
  const zeroInverse = conjugate(zero);

  return (orientation) =>
    multiply(
      multiply(worldToView, multiply(orientation, zeroInverse)),
      viewToWorld,
    );
}

const DEGREES = 180 / Math.PI;

export interface ArmAngles {
  /** Turning around the forearm, positive when the top moves to the user's right. */
  roll: number;
  /** Positive with the arm raised. */
  pitch: number;
  /** Positive with the arm turned to the user's right. */
  yaw: number;
}

/** Reads an arm pose in view axes as angles, in degrees. */
export function armAngles(pose: Quaternion): ArmAngles {
  const forward = rotate(pose, [1, 0, 0]);
  const top = rotate(pose, [0, 1, 0]);
  const flatRight = cross(forward, [0, 1, 0]);

  let roll = 0;
  // Roll is undefined with the arm pointing straight up or down.
  if (Math.hypot(...flatRight) > 1e-3) {
    const right = normalize(flatRight);
    const flatTop = cross(right, forward);
    roll = Math.atan2(dot(top, right), dot(top, flatTop)) * DEGREES;
  }

  return {
    roll,
    pitch: Math.asin(Math.max(-1, Math.min(1, forward[1]))) * DEGREES,
    yaw: Math.atan2(forward[2], forward[0]) * DEGREES,
  };
}
