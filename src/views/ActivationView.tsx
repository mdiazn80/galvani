import { useTranslation } from "react-i18next";
import { normalizeActivation } from "../lib/activation";
import { isDarkTheme, rampCss } from "../lib/colorRamp";
import { useLatestAnalysis } from "../lib/stream";
import { EMG_CHANNELS } from "../lib/types";
import { useThemeVersion } from "../lib/useThemeVersion";
import { useProfileStore } from "../stores/profile";
import { RampLegend } from "../charts/HeatCanvas";

const SIZE = 300;
const CENTER = SIZE / 2;
const SEGMENT_DEGREES = 360 / EMG_CHANNELS;
const SEGMENT_GAP_DEGREES = 3;

function polar(radius: number, degrees: number) {
  // Zero degrees points up, and angles grow clockwise.
  const radians = ((degrees - 90) * Math.PI) / 180;
  return {
    x: CENTER + radius * Math.cos(radians),
    y: CENTER + radius * Math.sin(radians),
  };
}

function segmentPath(index: number, inner: number, outer: number): string {
  const start = index * SEGMENT_DEGREES - SEGMENT_DEGREES / 2;
  const from = start + SEGMENT_GAP_DEGREES / 2;
  const to = start + SEGMENT_DEGREES - SEGMENT_GAP_DEGREES / 2;
  const a = polar(outer, from);
  const b = polar(outer, to);
  const c = polar(inner, to);
  const d = polar(inner, from);
  return [
    `M${a.x} ${a.y}`,
    `A${outer} ${outer} 0 0 1 ${b.x} ${b.y}`,
    `L${c.x} ${c.y}`,
    `A${inner} ${inner} 0 0 0 ${d.x} ${d.y}`,
    "Z",
  ].join(" ");
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function SpatialMap({
  activation,
  topChannel,
}: {
  activation: number[];
  topChannel: number;
}) {
  const { t } = useTranslation();
  useThemeVersion();
  const dark = isDarkTheme();

  return (
    <svg
      className="activation-figure"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={t("activation.mapTitle")}
    >
      {activation.map((value, channel) => {
        const position = (channel - topChannel + EMG_CHANNELS) % EMG_CHANNELS;
        const label = polar(132, position * SEGMENT_DEGREES);
        const name = t("oscilloscope.channel", { number: channel + 1 });
        return (
          <g key={channel}>
            <path
              d={segmentPath(position, 58, 112)}
              fill={rampCss(value, dark)}
              className="map-segment"
            >
              <title>{`${name}: ${percent(value)}`}</title>
            </path>
            <text
              x={label.x}
              y={label.y}
              className="figure-label"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function RadarChart({
  activation,
  topChannel,
}: {
  activation: number[];
  topChannel: number;
}) {
  const { t } = useTranslation();
  const radius = 108;
  const pointAt = (channel: number, value: number) =>
    polar(
      radius * value,
      ((channel - topChannel + EMG_CHANNELS) % EMG_CHANNELS) * SEGMENT_DEGREES,
    );
  const shape = activation
    .map((value, channel) => {
      const { x, y } = pointAt(channel, value);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="activation-figure"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={t("activation.radarTitle")}
    >
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <polygon
          key={ring}
          className="radar-grid"
          points={activation
            .map((_, channel) => {
              const { x, y } = pointAt(channel, ring);
              return `${x},${y}`;
            })
            .join(" ")}
        />
      ))}
      {activation.map((value, channel) => {
        const end = pointAt(channel, 1);
        const label = pointAt(channel, 1.2);
        const point = pointAt(channel, value);
        const name = t("oscilloscope.channel", { number: channel + 1 });
        return (
          <g key={channel}>
            <line
              x1={CENTER}
              y1={CENTER}
              x2={end.x}
              y2={end.y}
              className="radar-grid"
            />
            <text
              x={label.x}
              y={label.y}
              className="figure-label"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {name}
            </text>
            <circle cx={point.x} cy={point.y} r="4" className="radar-point">
              <title>{`${name}: ${percent(value)}`}</title>
            </circle>
          </g>
        );
      })}
      <polygon className="radar-shape" points={shape} />
    </svg>
  );
}

export function ActivationView() {
  const { t } = useTranslation();
  const analysis = useLatestAnalysis();
  const calibration = useProfileStore((state) => state.calibration);

  if (!analysis) {
    return <p className="view-empty">{t("views.empty")}</p>;
  }

  const activation = normalizeActivation(analysis.rms, calibration);
  const topChannel = calibration?.waveOutChannel ?? 0;

  return (
    <div className="view-grid activation-view">
      <section className="card">
        <h2>{t("activation.mapTitle")}</h2>
        <SpatialMap activation={activation} topChannel={topChannel} />
        <RampLegend min="0%" max="100%" />
        <p className="hint">
          {calibration
            ? t("activation.mapHintCalibrated", {
                channel: t("oscilloscope.channel", {
                  number: topChannel + 1,
                }),
              })
            : t("activation.mapHint")}
        </p>
      </section>

      <section className="card">
        <h2>{t("activation.radarTitle")}</h2>
        <RadarChart activation={activation} topChannel={topChannel} />
        <p className="hint">
          {calibration
            ? t("activation.scaleCalibrated")
            : t("activation.scaleFixed")}
        </p>
      </section>

      <section className="card activation-metrics">
        <h2>{t("activation.metricsTitle")}</h2>
        <table className="metrics-table">
          <thead>
            <tr>
              <th scope="col">{t("calibration.channel")}</th>
              <th scope="col" className="metrics-bar-heading">
                {t("activation.activation")}
              </th>
              <th scope="col">RMS</th>
              <th scope="col">MAV</th>
              <th scope="col">{t("activation.peak")}</th>
              <th scope="col" title={t("activation.zeroCrossingsHint")}>
                {t("activation.zeroCrossings")}
              </th>
            </tr>
          </thead>
          <tbody className="numeric">
            {Array.from({ length: EMG_CHANNELS }, (_, channel) => (
              <tr key={channel}>
                <th scope="row">
                  {t("oscilloscope.channel", { number: channel + 1 })}
                </th>
                <td>
                  <div className="metric-bar">
                    <div
                      className="metric-bar-value"
                      style={{ width: percent(activation[channel]) }}
                    />
                  </div>
                </td>
                <td>{analysis.rms[channel].toFixed(1)}</td>
                <td>{analysis.mav[channel].toFixed(1)}</td>
                <td>{analysis.peak[channel].toFixed(0)}</td>
                <td>{analysis.zeroCrossingRate[channel].toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
