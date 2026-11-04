import type uPlot from "uplot";

/**
 * Assigns each marker the first lane where its label won't touch the previous one. Labels
 * extend to the left of their marker, so that new events at the right edge aren't cut off.
 * Markers must be sorted by position. When no lane has room, the emptiest one is used.
 */
export function assignLanes(
  positions: readonly number[],
  widths: readonly number[],
  laneCount: number,
): number[] {
  const laneEnds = new Array<number>(laneCount).fill(-Infinity);
  return positions.map((position, index) => {
    let lane = laneEnds.findIndex((end) => end <= position - widths[index]);
    if (lane === -1) {
      lane = laneEnds.indexOf(Math.min(...laneEnds));
    }
    laneEnds[lane] = position;
    return lane;
  });
}

export interface EventMarker {
  /** Position on the chart's X axis. */
  x: number;
  label: string;
}

interface Style {
  line: string;
  text: string;
}

const LANES = 3;
const FONT_SIZE = 11;
const LANE_HEIGHT = 14;
const LABEL_GAP = 6;

/** Draws a vertical line and a label for each marker inside the plot area. */
export function drawEventMarkers(
  chart: uPlot,
  markers: readonly EventMarker[],
  style: Style,
) {
  const { ctx } = chart;
  const { left, top, width, height } = chart.bbox;
  const scale = window.devicePixelRatio || 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.font = `${FONT_SIZE * scale}px -apple-system, BlinkMacSystemFont, sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "right";

  const positions = markers.map((marker) =>
    chart.valToPos(marker.x, "x", true),
  );
  const widths = markers.map(
    (marker) => ctx.measureText(marker.label).width + LABEL_GAP * 2 * scale,
  );
  const lanes = assignLanes(positions, widths, LANES);

  markers.forEach((marker, index) => {
    const x = positions[index];
    ctx.strokeStyle = style.line;
    ctx.lineWidth = scale;
    ctx.setLineDash([3 * scale, 3 * scale]);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + height);
    ctx.stroke();

    ctx.fillStyle = style.text;
    ctx.fillText(
      marker.label,
      x - LABEL_GAP * scale,
      top + (lanes[index] * LANE_HEIGHT + 2) * scale,
    );
  });
  ctx.restore();
}
