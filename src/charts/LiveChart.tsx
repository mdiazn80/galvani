import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { useThemeVersion } from "../lib/useThemeVersion";
import { useSessionStore } from "../stores/session";

const MIN_PLOT_HEIGHT = 80;

export function readChartColors() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    series: (index: number) => token(`--series-${index + 1}`),
    text: token("--text-secondary"),
    grid: token("--chart-grid"),
  };
}

export function chartAxisStyle(colors: ReturnType<typeof readChartColors>) {
  return {
    stroke: colors.text,
    grid: { stroke: colors.grid, width: 1 },
    ticks: { stroke: colors.grid, width: 1 },
    font: "12px -apple-system, BlinkMacSystemFont, sans-serif",
    labelFont: "12px -apple-system, BlinkMacSystemFont, sans-serif",
  };
}

interface Props {
  /** Must be stable between renders unless the chart has to be rebuilt. */
  createOptions: () => Omit<uPlot.Options, "width" | "height">;
  /** Must be stable between renders. Returns `null` when there is nothing new to draw. */
  read: () => uPlot.AlignedData | null;
}

/** A uPlot chart that redraws on animation frames, outside React's rendering. */
export function LiveChart({ createOptions, read }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paused = useSessionStore((state) => state.paused);
  const pausedRef = useRef(paused);
  const themeVersion = useThemeVersion();

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const chart = new uPlot(
      {
        ...createOptions(),
        width: container.clientWidth,
        height: Math.max(container.clientHeight, MIN_PLOT_HEIGHT),
      },
      undefined,
      container,
    );

    const fit = () => {
      const legend = chart.root.querySelector<HTMLElement>(".u-legend");
      chart.setSize({
        width: container.clientWidth,
        height: Math.max(
          container.clientHeight - (legend?.offsetHeight ?? 0),
          MIN_PLOT_HEIGHT,
        ),
      });
    };
    fit();
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);

    let drawn = false;
    let animationFrame = requestAnimationFrame(function loop() {
      // A paused chart still needs its first draw after being rebuilt.
      if (!pausedRef.current || !drawn) {
        const data = read();
        if (data) {
          chart.setData(data);
          drawn = true;
        }
      }
      animationFrame = requestAnimationFrame(loop);
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      chart.destroy();
    };
  }, [createOptions, read, themeVersion]);

  return <div className="chart live-chart" ref={containerRef} />;
}
