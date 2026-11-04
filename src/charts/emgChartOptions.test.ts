import { describe, expect, it } from "vitest";
import { channelOffset } from "./emgChartOptions";

describe("channelOffset", () => {
  it("places channel 1 in the top lane and channel 8 in the bottom one", () => {
    expect(channelOffset("stacked", 10, 0)).toBe(150);
    expect(channelOffset("stacked", 10, 7)).toBe(10);
  });

  it("doesn't shift overlaid channels", () => {
    expect(channelOffset("overlaid", 10, 3)).toBe(0);
  });
});
