import { useEffect, useRef, useState, type MouseEvent } from "react";
import { isDarkTheme, rampRgb } from "../lib/colorRamp";
import { useThemeVersion } from "../lib/useThemeVersion";

/** Values indexed by `row * columns + column`. */
export interface HeatMatrix {
  columns: number;
  rows: number;
  values: Float32Array;
  /** Value drawn at the strongest color. */
  max: number;
}

interface Props {
  matrix: HeatMatrix;
  label: string;
  describeCell: (column: number, row: number, value: number) => string;
}

/**
 * Draws a matrix with one canvas pixel per cell, scaled up by the browser. Hovering a cell
 * shows its value below the plot.
 */
export function HeatCanvas({ matrix, label, describeCell }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const themeVersion = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || matrix.columns === 0 || matrix.rows === 0) {
      return;
    }
    canvas.width = matrix.columns;
    canvas.height = matrix.rows;
    const dark = isDarkTheme();
    const image = context.createImageData(matrix.columns, matrix.rows);
    matrix.values.forEach((value, index) => {
      const [red, green, blue] = rampRgb(value / matrix.max, dark);
      image.data[index * 4] = red;
      image.data[index * 4 + 1] = green;
      image.data[index * 4 + 2] = blue;
      image.data[index * 4 + 3] = 255;
    });
    context.putImageData(image, 0, 0);
  }, [matrix, themeVersion]);

  const onMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const column = Math.floor(
      ((event.clientX - bounds.left) / bounds.width) * matrix.columns,
    );
    const row = Math.floor(
      ((event.clientY - bounds.top) / bounds.height) * matrix.rows,
    );
    const value = matrix.values[row * matrix.columns + column];
    setHover(value === undefined ? null : describeCell(column, row, value));
  };

  return (
    <>
      <canvas
        ref={canvasRef}
        className="heat-canvas"
        role="img"
        aria-label={label}
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHover(null)}
      />
      <p className="hint numeric heat-readout">{hover ?? " "}</p>
    </>
  );
}

/** Scale of a heatmap, as a gradient with its end values. */
export function RampLegend({ min, max }: { min: string; max: string }) {
  return (
    <div className="ramp-legend hint numeric">
      <span>{min}</span>
      <span className="ramp-legend-bar" aria-hidden="true" />
      <span>{max}</span>
    </div>
  );
}
