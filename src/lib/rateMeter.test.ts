import { describe, expect, it } from "vitest";
import { RateMeter } from "./rateMeter";

describe("RateMeter", () => {
  it("reports 0 until there is enough data", () => {
    const meter = new RateMeter();
    expect(meter.rate(0)).toBe(0);
    meter.add(4, 0);
    expect(meter.rate(0)).toBe(0);
  });

  it("measures batches arriving at a steady pace", () => {
    const meter = new RateMeter();
    for (let time = 0; time <= 1000; time += 20) {
      meter.add(4, time);
    }
    expect(meter.rate(1000)).toBeCloseTo(200);
  });

  it("drops to 0 when samples stop arriving", () => {
    const meter = new RateMeter();
    meter.add(4, 0);
    meter.add(4, 20);
    expect(meter.rate(5000)).toBe(0);
  });

  it("ignores empty batches", () => {
    const meter = new RateMeter();
    meter.add(0, 0);
    meter.add(0, 100);
    expect(meter.rate(100)).toBe(0);
  });

  it("forgets everything when cleared", () => {
    const meter = new RateMeter();
    meter.add(4, 0);
    meter.add(4, 20);
    meter.clear();
    expect(meter.rate(20)).toBe(0);
  });
});
