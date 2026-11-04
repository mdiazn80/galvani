/** Rise above the lowest recent level that counts as charging, to ignore small jitter. */
const MIN_RISE_PERCENT = 2;

export const LOW_BATTERY_PERCENT = 15;

export interface BatteryTrend {
  previous: number;
  /** Lowest level since the battery last dropped. */
  lowest: number;
  /**
   * Whether it appears to be charging. The Myo reports only its level, so this is inferred
   * from the level rising, and it can't tell at a full battery.
   */
  charging: boolean;
}

export function startBatteryTrend(level: number): BatteryTrend {
  return { previous: level, lowest: level, charging: false };
}

export function updateBatteryTrend(
  trend: BatteryTrend,
  level: number,
): BatteryTrend {
  const lowest = level < trend.previous ? level : trend.lowest;
  return {
    previous: level,
    lowest,
    charging: level - lowest >= MIN_RISE_PERCENT,
  };
}
