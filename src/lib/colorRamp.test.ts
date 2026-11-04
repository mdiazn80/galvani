import { describe, expect, it } from "vitest";
import { rampCss, rampRgb } from "./colorRamp";

describe("color ramp", () => {
  it("goes from light to dark on a light surface", () => {
    expect(rampRgb(0, false)).toEqual([0xcd, 0xe2, 0xfb]);
    expect(rampRgb(1, false)).toEqual([0x0d, 0x36, 0x6b]);
  });

  it("reverses on a dark surface, so that zero still recedes", () => {
    expect(rampRgb(0, true)).toEqual([0x0d, 0x36, 0x6b]);
    expect(rampRgb(1, true)).toEqual([0xcd, 0xe2, 0xfb]);
  });

  it("clamps values outside the range", () => {
    expect(rampRgb(-1, false)).toEqual(rampRgb(0, false));
    expect(rampRgb(2, false)).toEqual(rampRgb(1, false));
  });

  it("formats colors for CSS", () => {
    expect(rampCss(0, false)).toBe("rgb(205 226 251)");
  });
});
