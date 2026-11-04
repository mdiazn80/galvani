import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type uPlot from "uplot";
import { HeatCanvas, RampLegend, type HeatMatrix } from "../charts/HeatCanvas";
import {
  chartAxisStyle,
  LiveChart,
  readChartColors,
} from "../charts/LiveChart";
import {
  ANALYSIS_HISTORY_LENGTH,
  ANALYSIS_HISTORY_SECONDS,
  ANALYSIS_RATE_HZ,
  rmsHistory,
  spectrumHistory,
  SPECTRUM_BINS,
  useAnalysisVersion,
  useLatestAnalysis,
} from "../lib/stream";
import { EMG_CHANNELS, EMG_RATE_HZ } from "../lib/types";
import { useProfileStore } from "../stores/profile";

const BIN_HZ = EMG_RATE_HZ / ((SPECTRUM_BINS - 1) * 2);
const UNCALIBRATED_RMS_MAX = 64;
const MIN_SPECTRUM_MAX = 1;

function createSpectrumReader(channel: number) {
  const frequencies = Float32Array.from(
    { length: SPECTRUM_BINS },
    (_, bin) => bin * BIN_HZ,
  );
  const values = new Float32Array(SPECTRUM_BINS);
  const single = new Float32Array(1);
  let lastWritten = -1;
  return (): uPlot.AlignedData | null => {
    if (spectrumHistory.totalWritten === lastWritten) {
      return null;
    }
    lastWritten = spectrumHistory.totalWritten;
    for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
      const copied = spectrumHistory.copyLatest(
        channel * SPECTRUM_BINS + bin,
        1,
        single,
      );
      values[bin] = copied ? single[0] : 0;
    }
    return [frequencies, values];
  };
}

function SpectrumChart({ channel }: { channel: number }) {
  const { t, i18n } = useTranslation();

  const createOptions = useCallback((): Omit<
    uPlot.Options,
    "width" | "height"
  > => {
    const colors = readChartColors();
    const axis = chartAxisStyle(colors);
    return {
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false, range: () => [0, EMG_RATE_HZ / 2] },
        y: {
          range: (_, __, max) => [0, Math.max(max * 1.1, MIN_SPECTRUM_MAX)],
        },
      },
      axes: [
        { ...axis, label: i18n.t("spectrum.frequencyAxis") },
        { ...axis, size: 56, label: i18n.t("spectrum.amplitudeAxis") },
      ],
      series: [
        {
          label: i18n.t("spectrum.frequency"),
          value: (_, value) =>
            value === null ? "—" : `${value.toFixed(1)} Hz`,
        },
        {
          label: i18n.t("spectrum.amplitude"),
          stroke: colors.series(0),
          width: 1.5,
          points: { show: false },
          value: (_, value) => (value === null ? "—" : value.toFixed(2)),
        },
      ],
    };
    // Rebuilding on a language change updates the labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n, i18n.language]);

  const read = useMemo(() => createSpectrumReader(channel), [channel]);

  return (
    <section className="card fill">
      <h2>
        {t("spectrum.title", {
          channel: t("oscilloscope.channel", { number: channel + 1 }),
        })}
      </h2>
      <div className="chart-area">
        <LiveChart createOptions={createOptions} read={read} />
      </div>
    </section>
  );
}

/** Puts `count` values from the end of a history at the right edge of a matrix row. */
function copyRowFromHistory(
  history: typeof rmsHistory,
  channel: number,
  target: Float32Array,
  rowStart: number,
  scratch: Float32Array,
) {
  const copied = history.copyLatest(channel, ANALYSIS_HISTORY_LENGTH, scratch);
  const offset = ANALYSIS_HISTORY_LENGTH - copied;
  target.fill(0, rowStart, rowStart + offset);
  target.set(scratch.subarray(0, copied), rowStart + offset);
}

function useHeatMatrix(
  rows: number,
  build: (values: Float32Array, scratch: Float32Array) => number,
): HeatMatrix {
  const version = useAnalysisVersion();

  return useMemo(() => {
    const values = new Float32Array(ANALYSIS_HISTORY_LENGTH * rows);
    const scratch = new Float32Array(ANALYSIS_HISTORY_LENGTH);
    const max = build(values, scratch);
    return { columns: ANALYSIS_HISTORY_LENGTH, rows, values, max };
    // The version says when the external history has changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, rows, build]);
}

function secondsAgo(column: number): string {
  return ((ANALYSIS_HISTORY_LENGTH - 1 - column) / ANALYSIS_RATE_HZ).toFixed(1);
}

function RmsHeatmap() {
  const { t } = useTranslation();
  const calibration = useProfileStore((state) => state.calibration);
  const scaleMax = calibration
    ? Math.max(...calibration.maxActivation)
    : UNCALIBRATED_RMS_MAX;

  const build = useCallback(
    (values: Float32Array, scratch: Float32Array) => {
      for (let channel = 0; channel < EMG_CHANNELS; channel++) {
        copyRowFromHistory(
          rmsHistory,
          channel,
          values,
          channel * ANALYSIS_HISTORY_LENGTH,
          scratch,
        );
      }
      return scaleMax;
    },
    [scaleMax],
  );
  const matrix = useHeatMatrix(EMG_CHANNELS, build);

  return (
    <section className="card heat-card">
      <h2>{t("spectrum.heatmapTitle")}</h2>
      <div className="heat-frame">
        <div className="heat-rows hint">
          {Array.from({ length: EMG_CHANNELS }, (_, channel) => (
            <span key={channel}>
              {t("oscilloscope.channel", { number: channel + 1 })}
            </span>
          ))}
        </div>
        <div className="heat-plot">
          <HeatCanvas
            matrix={matrix}
            label={t("spectrum.heatmapTitle")}
            describeCell={(column, row, value) =>
              t("spectrum.heatmapCell", {
                channel: t("oscilloscope.channel", { number: row + 1 }),
                seconds: secondsAgo(column),
                value: value.toFixed(1),
              })
            }
          />
          <div className="heat-time hint">
            <span>
              {t("spectrum.secondsAgo", { seconds: ANALYSIS_HISTORY_SECONDS })}
            </span>
            <span>{t("spectrum.now")}</span>
          </div>
        </div>
      </div>
      <RampLegend min="0" max={`${scaleMax.toFixed(0)} RMS`} />
    </section>
  );
}

function Spectrogram({ channel }: { channel: number }) {
  const { t } = useTranslation();

  const build = useCallback(
    (values: Float32Array, scratch: Float32Array) => {
      let max = MIN_SPECTRUM_MAX;
      for (let bin = 0; bin < SPECTRUM_BINS; bin++) {
        // The highest frequency goes in the top row.
        const rowStart = (SPECTRUM_BINS - 1 - bin) * ANALYSIS_HISTORY_LENGTH;
        copyRowFromHistory(
          spectrumHistory,
          channel * SPECTRUM_BINS + bin,
          values,
          rowStart,
          scratch,
        );
        for (let column = 0; column < ANALYSIS_HISTORY_LENGTH; column++) {
          max = Math.max(max, values[rowStart + column]);
        }
      }
      return max;
    },
    [channel],
  );
  const matrix = useHeatMatrix(SPECTRUM_BINS, build);

  return (
    <section className="card heat-card">
      <h2>
        {t("spectrum.spectrogramTitle", {
          channel: t("oscilloscope.channel", { number: channel + 1 }),
        })}
      </h2>
      <div className="heat-frame">
        <div className="heat-rows hint">
          <span>{EMG_RATE_HZ / 2} Hz</span>
          <span>{EMG_RATE_HZ / 4} Hz</span>
          <span>0 Hz</span>
        </div>
        <div className="heat-plot">
          <HeatCanvas
            matrix={matrix}
            label={t("spectrum.spectrogramTitle", {
              channel: t("oscilloscope.channel", { number: channel + 1 }),
            })}
            describeCell={(column, row, value) =>
              t("spectrum.spectrogramCell", {
                frequency: ((SPECTRUM_BINS - 1 - row) * BIN_HZ).toFixed(1),
                seconds: secondsAgo(column),
                value: value.toFixed(2),
              })
            }
          />
          <div className="heat-time hint">
            <span>
              {t("spectrum.secondsAgo", { seconds: ANALYSIS_HISTORY_SECONDS })}
            </span>
            <span>{t("spectrum.now")}</span>
          </div>
        </div>
      </div>
      <RampLegend min="0" max={matrix.max.toFixed(1)} />
    </section>
  );
}

export function SpectrumView() {
  const { t } = useTranslation();
  const analysis = useLatestAnalysis();
  const [channel, setChannel] = useState(0);

  if (!analysis) {
    return <p className="view-empty">{t("views.empty")}</p>;
  }

  return (
    <div className="view-grid spectrum-view">
      <div className="view-toolbar">
        <label className="field-inline">
          {t("calibration.channel")}
          <select
            value={channel}
            onChange={(event) => setChannel(Number(event.target.value))}
          >
            {Array.from({ length: EMG_CHANNELS }, (_, index) => (
              <option key={index} value={index}>
                {t("oscilloscope.channel", { number: index + 1 })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <SpectrumChart channel={channel} />
      <Spectrogram channel={channel} />
      <RmsHeatmap />
    </div>
  );
}
