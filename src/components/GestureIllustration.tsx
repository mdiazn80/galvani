import type { CalibrationStepId, Placement } from "../lib/calibration";

export type GestureId = CalibrationStepId | "fingersSpread" | "doubleTap";

const WIDTH = 280;
const HEIGHT = 170;

const WRIST = { x: 150, y: 85 };

/** Armband on the forearm, with the LED line on the side the user stated. */
function Armband({ lineToward }: { lineToward: Placement["lineToward"] }) {
  const lineX = lineToward === "wrist" ? 106 : 70;
  return (
    <g>
      <rect
        x="72"
        y="62"
        width="32"
        height="46"
        rx="5"
        className="gesture-band"
      />
      <path
        d={`M${lineX} 72 V98`}
        className="gesture-led"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
      />
    </g>
  );
}

function Forearm() {
  return (
    <path
      d={`M20 85 H${WRIST.x}`}
      className="gesture-limb"
      strokeWidth="30"
      strokeLinecap="round"
      fill="none"
    />
  );
}

/** Side view of an open hand, palm down, pointing away from the forearm. */
function OpenHand() {
  return (
    <g fill="none" strokeLinecap="round" className="gesture-limb">
      <path d="M150 85 H184" strokeWidth="26" />
      <path d="M190 76 H238" strokeWidth="7" />
      <path d="M192 84 H246" strokeWidth="7" />
      <path d="M192 92 H242" strokeWidth="7" />
      <path d="M170 98 L204 108" strokeWidth="8" />
    </g>
  );
}

function ClosedHand() {
  return (
    <g fill="none" strokeLinecap="round">
      <path d="M150 85 H174" className="gesture-limb" strokeWidth="30" />
      <rect
        x="166"
        y="62"
        width="44"
        height="46"
        rx="16"
        className="gesture-fist"
      />
      <path
        d="M198 73 H211 M198 85 H212 M198 97 H211"
        className="gesture-knuckles"
        strokeWidth="3"
      />
    </g>
  );
}

/** Curved arrow showing the direction of a wrist movement. */
function MotionArrow({ direction }: { direction: "up" | "down" }) {
  const path =
    direction === "down"
      ? "M242 62 Q262 96 232 132 M232 132 L250 128 M232 132 L234 114"
      : "M242 108 Q262 74 232 38 M232 38 L250 42 M232 38 L234 56";
  return (
    <path
      d={path}
      className="gesture-arrow"
      fill="none"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function ForearmScene({
  lineToward,
  children,
}: {
  lineToward: Placement["lineToward"];
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <Forearm />
      <Armband lineToward={lineToward} />
    </>
  );
}

/**
 * Whole-body side view, for the postures. The armband goes on the moving arm, which is
 * drawn from `shoulder` through `elbow` to `hand`.
 */
function BodyPosture({
  shoulder,
  hand,
  elbow,
  lineToward,
}: {
  shoulder: { x: number; y: number };
  hand: { x: number; y: number };
  elbow: { x: number; y: number };
  lineToward: Placement["lineToward"];
}) {
  // The armband sits on the upper forearm, close to the elbow.
  const toward = lineToward === "wrist" ? 0.48 : 0.12;
  const bandX = elbow.x + (hand.x - elbow.x) * 0.3;
  const bandY = elbow.y + (hand.y - elbow.y) * 0.3;
  const ledX = elbow.x + (hand.x - elbow.x) * toward;
  const ledY = elbow.y + (hand.y - elbow.y) * toward;
  const horizontal = Math.abs(hand.x - elbow.x) > Math.abs(hand.y - elbow.y);

  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <circle
        cx="110"
        cy="22"
        r="14"
        className="gesture-limb"
        strokeWidth="6"
      />
      <path d="M110 40 V104" className="gesture-limb" strokeWidth="16" />
      <path
        d="M110 104 L98 160 M110 104 L122 160"
        className="gesture-limb"
        strokeWidth="11"
      />
      <path
        d={`M${shoulder.x} ${shoulder.y} L${elbow.x} ${elbow.y} L${hand.x} ${hand.y}`}
        className="gesture-active"
        strokeWidth="11"
      />
      <path
        d={
          horizontal
            ? `M${bandX} ${bandY - 11} V${bandY + 11}`
            : `M${bandX - 11} ${bandY} H${bandX + 11}`
        }
        className="gesture-band-line"
        strokeWidth="10"
      />
      <path
        d={
          horizontal
            ? `M${ledX} ${ledY - 7} V${ledY + 7}`
            : `M${ledX - 7} ${ledY} H${ledX + 7}`
        }
        className="gesture-led"
        strokeWidth="3"
      />
    </g>
  );
}

function Scene({
  step,
  lineToward,
}: {
  step: GestureId;
  lineToward: Placement["lineToward"];
}) {
  switch (step) {
    case "fingersSpread":
      return (
        <ForearmScene lineToward={lineToward}>
          <g fill="none" strokeLinecap="round" className="gesture-limb">
            <path d="M150 85 H184" strokeWidth="26" />
            <path d="M188 74 L236 52" strokeWidth="7" />
            <path d="M192 82 L250 72" strokeWidth="7" />
            <path d="M192 90 L250 98" strokeWidth="7" />
            <path d="M188 96 L236 118" strokeWidth="7" />
            <path d="M172 98 L194 134" strokeWidth="8" />
          </g>
        </ForearmScene>
      );
    case "doubleTap":
      return (
        <ForearmScene lineToward={lineToward}>
          <OpenHand />
          <g fill="none" strokeLinecap="round" className="gesture-arrow">
            <path d="M256 66 Q266 84 256 102" strokeWidth="4" />
            <path d="M266 58 Q280 84 266 110" strokeWidth="4" />
          </g>
        </ForearmScene>
      );
    case "rest":
      return (
        <ForearmScene lineToward={lineToward}>
          <OpenHand />
          <path d="M10 124 H270" className="gesture-ground" strokeWidth="3" />
        </ForearmScene>
      );
    case "fist":
      return (
        <ForearmScene lineToward={lineToward}>
          <g className="gesture-fade-out">
            <OpenHand />
          </g>
          <g className="gesture-fade-in">
            <ClosedHand />
          </g>
        </ForearmScene>
      );
    case "waveIn":
      return (
        <ForearmScene lineToward={lineToward}>
          <g className="gesture-wave-in">
            <OpenHand />
          </g>
          <MotionArrow direction="down" />
        </ForearmScene>
      );
    case "waveOut":
      return (
        <ForearmScene lineToward={lineToward}>
          <g className="gesture-wave-out">
            <OpenHand />
          </g>
          <MotionArrow direction="up" />
        </ForearmScene>
      );
    case "hang":
      return (
        <BodyPosture
          shoulder={{ x: 128, y: 50 }}
          elbow={{ x: 136, y: 94 }}
          hand={{ x: 140, y: 138 }}
          lineToward={lineToward}
        />
      );
    case "forward":
      return (
        <BodyPosture
          shoulder={{ x: 110, y: 52 }}
          elbow={{ x: 165, y: 52 }}
          hand={{ x: 225, y: 52 }}
          lineToward={lineToward}
        />
      );
  }
}

interface Props {
  step: GestureId;
  placement: Placement;
  label: string;
}

/** Original schematic drawing of a calibration step, mirrored for the left arm. */
export function GestureIllustration({ step, placement, label }: Props) {
  const mirrored = placement.arm === "left";
  return (
    <svg
      className="gesture"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
    >
      <g transform={mirrored ? `translate(${WIDTH} 0) scale(-1 1)` : undefined}>
        <Scene step={step} lineToward={placement.lineToward} />
      </g>
    </svg>
  );
}
