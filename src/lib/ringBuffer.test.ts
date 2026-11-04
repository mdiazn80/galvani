import { describe, expect, it } from "vitest";
import { MultiChannelRingBuffer } from "./ringBuffer";

function latest(
  buffer: MultiChannelRingBuffer,
  channel: number,
  count: number,
) {
  const target = new Float32Array(count);
  const copied = buffer.copyLatest(channel, count, target);
  return Array.from(target.subarray(0, copied));
}

describe("MultiChannelRingBuffer", () => {
  it("separates interleaved channels", () => {
    const buffer = new MultiChannelRingBuffer(2, 4);
    buffer.pushInterleaved([1, 10, 2, 20]);
    expect(latest(buffer, 0, 4)).toEqual([1, 2]);
    expect(latest(buffer, 1, 4)).toEqual([10, 20]);
    expect(buffer.length).toBe(2);
  });

  it("keeps the newest samples in order after wrapping around", () => {
    const buffer = new MultiChannelRingBuffer(1, 3);
    buffer.pushInterleaved([1, 2, 3, 4, 5]);
    expect(latest(buffer, 0, 3)).toEqual([3, 4, 5]);
    expect(latest(buffer, 0, 2)).toEqual([4, 5]);
    expect(buffer.length).toBe(3);
    expect(buffer.totalWritten).toBe(5);
  });

  it("copies across the wrap point when a push ends exactly at capacity", () => {
    const buffer = new MultiChannelRingBuffer(1, 3);
    buffer.pushInterleaved([1, 2, 3]);
    expect(latest(buffer, 0, 3)).toEqual([1, 2, 3]);
  });

  it("forgets everything when cleared", () => {
    const buffer = new MultiChannelRingBuffer(1, 3);
    buffer.pushInterleaved([1, 2]);
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.totalWritten).toBe(0);
    expect(latest(buffer, 0, 3)).toEqual([]);
  });
});
