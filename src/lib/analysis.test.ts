import { describe, expect, it } from "vitest";
import { decodeAnalysis } from "./analysis";

function frame(channels: number, bins: number, values: number[]): ArrayBuffer {
  const buffer = new ArrayBuffer(8 + values.length * 4);
  const view = new DataView(buffer);
  view.setUint8(0, 1);
  view.setUint8(1, channels);
  view.setUint16(2, bins, true);
  view.setFloat32(4, 200, true);
  values.forEach((value, index) => view.setFloat32(8 + index * 4, value, true));
  return buffer;
}

describe("decodeAnalysis", () => {
  it("separates the metrics and spectra as dsp.rs lays them out", () => {
    const analysis = decodeAnalysis(
      frame(2, 3, [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 20, 21, 22]),
    );
    expect(analysis.sampleRate).toBe(200);
    expect(Array.from(analysis.rms)).toEqual([1, 5]);
    expect(Array.from(analysis.mav)).toEqual([2, 6]);
    expect(Array.from(analysis.peak)).toEqual([3, 7]);
    expect(Array.from(analysis.zeroCrossingRate)).toEqual([4, 8]);
    expect(Array.from(analysis.spectra)).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it("rejects malformed frames", () => {
    expect(() => decodeAnalysis(new ArrayBuffer(2))).toThrow("too short");
    expect(() => decodeAnalysis(frame(2, 3, [1]))).toThrow("expected");
    const wrongVersion = frame(1, 0, [0, 0, 0, 0]);
    new DataView(wrongVersion).setUint8(0, 9);
    expect(() => decodeAnalysis(wrongVersion)).toThrow("version");
  });
});
