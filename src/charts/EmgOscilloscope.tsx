import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { timelineLabel } from "../lib/describeEvent";
import { emgBuffer, eventLog } from "../lib/stream";
import { useThemeVersion } from "../lib/useThemeVersion";
import { EMG_CHANNELS, EMG_RATE_HZ } from "../lib/types";
import { useSessionStore } from "../stores/session";
import {
  buildEmgChartOptions,
  channelOffset,
  type EmgLayout,
} from "./emgChartOptions";
import { drawEventMarkers, type EventMarker } from "./eventMarkers";

const WINDOW_OPTIONS = [2, 5, 10];
const SCALE_OPTIONS = [128, 64, 32];
const MIN_PLOT_HEIGHT = 100;

function readThemeColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: Array.from({ length: EMG_CHANNELS }, (_, channel) =>
      token(`--series-${channel + 1}`),
    ),
    text: token("--text-secondary"),
    grid: token("--chart-grid"),
  };
}

export function EmgOscilloscope() {
  const { t, i18n } = useTranslation();
  const connected = useSessionStore((state) => state.status === "connected");
  const paused = useSessionStore((state) => state.paused);
  const [layout, setLayout] = useState<EmgLayout>("stacked");
  const [windowSeconds, setWindowSeconds] = useState(5);
  const [scale, setScale] = useState(64);
  const themeVersion = useThemeVersion();
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const capacity = windowSeconds * EMG_RATE_HZ;
    const time = Float32Array.from(
      { length: capacity },
      (_, index) => (index - capacity + 1) / EMG_RATE_HZ,
    );
    const values = Array.from(
      { length: EMG_CHANNELS },
      () => new Float32Array(capacity),
    );

    let drawnTotal = emgBuffer.totalWritten;
    const eventColors = {
      line: getComputedStyle(document.documentElement)
        .getPropertyValue("--text-secondary")
        .trim(),
      text: getComputedStyle(document.documentElement)
        .getPropertyValue("--text-primary")
        .trim(),
    };

    const chart = new uPlot(
      {
        ...buildEmgChartOptions({
          layout,
          windowSeconds,
          scale,
          width: container.clientWidth,
          height: Math.max(container.clientHeight, MIN_PLOT_HEIGHT),
          colors: readThemeColors(),
          labels: {
            channel: (index) =>
              i18n.t("oscilloscope.channel", { number: index + 1 }),
            time: i18n.t("oscilloscope.time"),
            timeAxis: i18n.t("oscilloscope.timeAxis"),
            amplitudeAxis: i18n.t("oscilloscope.amplitudeAxis"),
          },
        }),
        hooks: {
          // Events are placed by sample count, so they line up exactly with the signal.
          draw: [
            (plot) => {
              const markers: EventMarker[] = [];
              for (const entry of eventLog) {
                const x = (entry.emgIndex - drawnTotal) / EMG_RATE_HZ;
                const label = timelineLabel(entry.event, i18n.t);
                // Events logged before any sample restore the state after a seek in a
                // recording. They didn't happen at that point, so they aren't marked.
                if (
                  label &&
                  entry.emgIndex > 0 &&
                  x >= -windowSeconds &&
                  x <= 0
                ) {
                  markers.push({ x, label });
                }
              }
              // The log is newest first, and lanes are assigned from left to right.
              drawEventMarkers(plot, markers.reverse(), eventColors);
            },
          ],
        },
      },
      [[], ...values.map(() => [])],
      container,
    );

    const draw = () => {
      let count = 0;
      drawnTotal = emgBuffer.totalWritten;
      for (let channel = 0; channel < EMG_CHANNELS; channel++) {
        count = emgBuffer.copyLatest(channel, capacity, values[channel]);
        const offset = channelOffset(layout, scale, channel);
        for (let index = 0; index < count; index++) {
          values[channel][index] += offset;
        }
      }
      chart.setData([
        time.subarray(capacity - count),
        ...values.map((channel) => channel.subarray(0, count)),
      ]);
    };

    let lastDrawn = -1;
    let animationFrame = requestAnimationFrame(function loop() {
      const hasNewData = emgBuffer.totalWritten !== lastDrawn;
      // A paused chart still needs its first draw after being rebuilt.
      if (hasNewData && (!pausedRef.current || lastDrawn === -1)) {
        lastDrawn = emgBuffer.totalWritten;
        draw();
      }
      animationFrame = requestAnimationFrame(loop);
    });

    // The legend wraps depending on the width, so the plot takes whatever height it leaves.
    const fitToContainer = () => {
      const legend = chart.root.querySelector<HTMLElement>(".u-legend");
      chart.setSize({
        width: container.clientWidth,
        height: Math.max(
          container.clientHeight - (legend?.offsetHeight ?? 0),
          MIN_PLOT_HEIGHT,
        ),
      });
    };
    fitToContainer();

    const resizeObserver = new ResizeObserver(fitToContainer);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      chart.destroy();
    };
  }, [layout, windowSeconds, scale, themeVersion, i18n, i18n.language]);

  return (
    <section className="card fill">
      <header className="toolbar">
        <h2>{t("oscilloscope.title")}</h2>
        <div className="toolbar-controls">
          <label>
            {t("oscilloscope.layout")}
            <select
              value={layout}
              onChange={(event) => setLayout(event.target.value as EmgLayout)}
            >
              <option value="stacked">{t("oscilloscope.stacked")}</option>
              <option value="overlaid">{t("oscilloscope.overlaid")}</option>
            </select>
          </label>
          <label>
            {t("oscilloscope.window")}
            <select
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(Number(event.target.value))}
            >
              {WINDOW_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {t("oscilloscope.windowValue", { seconds })}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("oscilloscope.scale")}
            <select
              value={scale}
              onChange={(event) => setScale(Number(event.target.value))}
            >
              {SCALE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t("oscilloscope.scaleValue", { value })}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      <div className="chart-area">
        <div className="chart" ref={containerRef} />
        {!connected && <p className="chart-empty">{t("oscilloscope.empty")}</p>}
      </div>
    </section>
  );
}
