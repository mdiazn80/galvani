/** Fixed-size history of a multi-channel signal, kept outside reactive state. */
export class MultiChannelRingBuffer {
  private readonly channels: Float32Array[];
  private nextIndex = 0;
  private stored = 0;
  /** Samples written since the last clear, useful for detecting new data. */
  totalWritten = 0;

  constructor(
    channelCount: number,
    private readonly capacity: number,
  ) {
    this.channels = Array.from(
      { length: channelCount },
      () => new Float32Array(capacity),
    );
  }

  get length(): number {
    return this.stored;
  }

  /** Appends samples whose values are ordered by sample and then channel. */
  pushInterleaved(values: ArrayLike<number>): void {
    const channelCount = this.channels.length;
    const sampleCount = Math.floor(values.length / channelCount);
    for (let sample = 0; sample < sampleCount; sample++) {
      for (let channel = 0; channel < channelCount; channel++) {
        this.channels[channel][this.nextIndex] =
          values[sample * channelCount + channel];
      }
      this.nextIndex = (this.nextIndex + 1) % this.capacity;
    }
    this.stored = Math.min(this.stored + sampleCount, this.capacity);
    this.totalWritten += sampleCount;
  }

  /**
   * Copies up to `count` of the latest samples of a channel into the start of `target`,
   * oldest first, and returns how many it copied.
   */
  copyLatest(channel: number, count: number, target: Float32Array): number {
    const copied = Math.min(count, this.stored, target.length);
    const source = this.channels[channel];
    const start = (this.nextIndex - copied + this.capacity) % this.capacity;
    const untilEnd = Math.min(copied, this.capacity - start);
    target.set(source.subarray(start, start + untilEnd));
    target.set(source.subarray(0, copied - untilEnd), untilEnd);
    return copied;
  }

  clear(): void {
    this.nextIndex = 0;
    this.stored = 0;
    this.totalWritten = 0;
  }
}
