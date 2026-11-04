import type uPlot from "uplot";
import { EMG_CHANNELS } from "../lib/types";

export type EmgLayout = "stacked" | "overlaid";

export interface EmgChartConfig {
  layout: EmgLayout;
  windowSeconds: number;
  scale: number;
  width: number;
  height: number;
  colors: {
    series: string[];
    text: string;
    grid: string;
  };
  labels: {
    channel: (index: number) => string;
    time: string;
    timeAxis: string;
    amplitudeAxis: string;
  };
}

/** Vertical shift applied to a channel so that each one gets its own lane. */
export function channelOffset(
  layout: EmgLayout,
  scale: number,
  channel: number,
): number {
  if (layout === "overlaid") {
    return 0;
  }
  return (EMG_CHANNELS - channel - 0.5) * 2 * scale;
}

function amplitudeRange(layout: EmgLayout, scale: number): [number, number] {
  return layout === "stacked" ? [0, EMG_CHANNELS * 2 * scale] : [-scale, scale];
}

export function buildEmgChartOptions(config: EmgChartConfig): uPlot.Options {
  const { layout, windowSeconds, scale, colors, labels } = config;
  const axisStyle = {
    stroke: colors.text,
    grid: { stroke: colors.grid, width: 1 },
    ticks: { stroke: colors.grid, width: 1 },
    font: "12px -apple-system, BlinkMacSystemFont, sans-serif",
    labelFont: "12px -apple-system, BlinkMacSystemFont, sans-serif",
  };

  const stackedAxis: Partial<uPlot.Axis> =
    layout === "stacked"
      ? {
          splits: () =>
            Array.from({ length: EMG_CHANNELS }, (_, channel) =>
              channelOffset(layout, scale, channel),
            ),
          values: (_, splits) =>
            splits.map((split) =>
              labels.channel(
                EMG_CHANNELS - 1 - Math.floor(split / (2 * scale)),
              ),
            ),
        }
      : {};

  return {
    width: config.width,
    height: config.height,
    pxAlign: false,
    cursor: { drag: { x: false, y: false } },
    scales: {
      x: { time: false, range: () => [-windowSeconds, 0] },
      y: { range: () => amplitudeRange(layout, scale) },
    },
    axes: [
      {
        ...axisStyle,
        label: labels.timeAxis,
      },
      {
        ...axisStyle,
        ...stackedAxis,
        size: 56,
        label: layout === "overlaid" ? labels.amplitudeAxis : undefined,
      },
    ],
    series: [
      {
        label: labels.time,
        value: (_, seconds) =>
          seconds === null ? "—" : `${seconds.toFixed(2)} s`,
      },
      ...colors.series.map((color, channel) => ({
        label: labels.channel(channel),
        stroke: color,
        width: 1.25,
        points: { show: false },
        value: (_: uPlot, value: number | null) =>
          value === null
            ? "—"
            : (value - channelOffset(layout, scale, channel)).toFixed(0),
      })),
    ],
  };
}
