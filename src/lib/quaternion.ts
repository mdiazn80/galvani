/** Quaternion in `w, x, y, z` order. */
export type Quaternion = readonly [number, number, number, number];
export type Vector3 = readonly [number, number, number];

export const IDENTITY: Quaternion = [1, 0, 0, 0];

export function conjugate([w, x, y, z]: Quaternion): Quaternion {
  return [w, -x, -y, -z];
}

export function multiply(a: Quaternion, b: Quaternion): Quaternion {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export function rotate(q: Quaternion, [x, y, z]: Vector3): Vector3 {
  const rotated = multiply(multiply(q, [0, x, y, z]), conjugate(q));
  return [rotated[1], rotated[2], rotated[3]];
}

export function dot(a: Vector3, b: Vector3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize(vector: Vector3): Vector3 {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
