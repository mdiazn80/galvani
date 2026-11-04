import { describe, expect, it } from "vitest";
import { startBatteryTrend, updateBatteryTrend } from "./battery";

function run(levels: number[]) {
  const [first, ...rest] = levels;
  return rest.reduce(updateBatteryTrend, startBatteryTrend(first));
}

describe("battery trend", () => {
  it("doesn't assume charging at the start", () => {
    expect(startBatteryTrend(50).charging).toBe(false);
  });

  it("stays false while the level is steady or falling", () => {
    expect(run([50, 50, 49, 48]).charging).toBe(false);
  });

  it("ignores a rise of a single point", () => {
    expect(run([50, 51]).charging).toBe(false);
  });

  it("detects a sustained rise", () => {
    expect(run([50, 51, 52]).charging).toBe(true);
  });

  it("stays true while the level holds after rising", () => {
    expect(run([50, 52, 52]).charging).toBe(true);
  });

  it("stops as soon as the level drops", () => {
    expect(run([50, 52, 51]).charging).toBe(false);
  });

  it("measures the rise from the latest drop", () => {
    expect(run([50, 52, 40, 41]).charging).toBe(false);
    expect(run([50, 52, 40, 42]).charging).toBe(true);
  });
});
