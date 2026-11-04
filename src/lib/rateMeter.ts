const WINDOW_MS = 2000;

/** Measures a sample rate over a sliding time window. */
export class RateMeter {
  private entries: { time: number; count: number }[] = [];

  add(count: number, now: number): void {
    if (count > 0) {
      this.entries.push({ time: now, count });
    }
    this.prune(now);
  }

  /** Samples per second, or 0 until there are two arrivals to measure between. */
  rate(now: number): number {
    this.prune(now);
    if (this.entries.length < 2) {
      return 0;
    }
    const elapsed = now - this.entries[0].time;
    if (elapsed <= 0) {
      return 0;
    }
    // The first batch arrived at the start of the span, so it doesn't count towards it.
    const samples = this.entries
      .slice(1)
      .reduce((total, entry) => total + entry.count, 0);
    return (samples * 1000) / elapsed;
  }

  clear(): void {
    this.entries = [];
  }

  private prune(now: number): void {
    const oldest = now - WINDOW_MS;
    const firstKept = this.entries.findIndex((entry) => entry.time >= oldest);
    this.entries = firstKept === -1 ? [] : this.entries.slice(firstKept);
  }
}
