import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import type uPlot from "uplot";
import {
  chartAxisStyle,
  LiveChart,
  readChartColors,
} from "../charts/LiveChart";
import {
  armAngles,
  createArmPose,
  estimateUpSign,
  wristAlongX,
} from "../lib/armPose";
import type { LineDirection } from "../lib/calibration";
import {
  IDENTITY,
  rotate,
  type Quaternion,
  type Vector3,
} from "../lib/quaternion";
import { imuBuffer } from "../lib/stream";
import { IMU_FIELDS, IMU_RATE_HZ } from "../lib/types";
import { useThemeVersion } from "../lib/useThemeVersion";
import { useProfileStore } from "../stores/profile";
import { useSessionStore } from "../stores/session";

const CHART_SECONDS = 10;
const CHART_SAMPLES = CHART_SECONDS * IMU_RATE_HZ;
const TRAIL_SAMPLES = 300;
const ARM_LENGTH = 3;
const SPHERE_RADIUS = 2.1;

function useZeroOrientation(): Quaternion {
  const zeroOverride = useSessionStore((state) => state.zeroOverride);
  const calibrated = useProfileStore(
    (state) => state.calibration?.referenceOrientation,
  );
  if (zeroOverride) {
    return zeroOverride;
  }
  return calibrated ? (calibrated as unknown as Quaternion) : IDENTITY;
}

function latestOrientation(): Quaternion | null {
  const value = new Float32Array(1);
  const parts: number[] = [];
  for (let field = 0; field < 4; field++) {
    if (imuBuffer.copyLatest(field, 1, value) === 0) {
      return null;
    }
    parts.push(value[0]);
  }
  return parts as unknown as Quaternion;
}

const UP_ESTIMATE_SAMPLES = 25;
const UP_ESTIMATE_INTERVAL_MS = 500;
let upSign: 1 | -1 = 1;
let upEstimatedAt = -Infinity;

/** Whether world +Z is up, from recent IMU samples. It changes rarely, so it is cached. */
function currentUpSign(): 1 | -1 {
  const now = performance.now();
  if (now - upEstimatedAt < UP_ESTIMATE_INTERVAL_MS) {
    return upSign;
  }
  const fields = Array.from(
    { length: 7 },
    () => new Float32Array(UP_ESTIMATE_SAMPLES),
  );
  let count = 0;
  fields.forEach((field, index) => {
    count = imuBuffer.copyLatest(index, UP_ESTIMATE_SAMPLES, field);
  });
  if (count > 0) {
    const orientations: Quaternion[] = [];
    const accelerations: Vector3[] = [];
    for (let sample = 0; sample < count; sample++) {
      orientations.push([
        fields[0][sample],
        fields[1][sample],
        fields[2][sample],
        fields[3][sample],
      ]);
      accelerations.push([
        fields[4][sample],
        fields[5][sample],
        fields[6][sample],
      ]);
    }
    upSign = estimateUpSign(orientations, accelerations);
    upEstimatedAt = now;
  }
  return upSign;
}

function themeColor(name: string): THREE.Color {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return new THREE.Color(value);
}

/** Builds a schematic forearm along X, with the hand at the wrist end. */
function buildArm(): THREE.Group {
  const arm = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({
    color: themeColor("--text-secondary"),
    roughness: 0.8,
  });
  const forearm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.42, ARM_LENGTH, 32),
    skin,
  );
  forearm.rotation.z = Math.PI / 2;
  arm.add(forearm);

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.2, 0.55), skin);
  hand.position.x = ARM_LENGTH / 2 + 0.35;
  arm.add(hand);
  return arm;
}

/** Builds the armband around the forearm, with its LED line on the stated side. */
function buildBand(lineToward: LineDirection): THREE.Group {
  const band = new THREE.Group();
  const bandX = -ARM_LENGTH / 4;
  const pod = new THREE.MeshStandardMaterial({
    color: themeColor("--ink"),
    roughness: 0.4,
  });
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.26), pod);
    mesh.position.set(bandX, Math.cos(angle) * 0.46, Math.sin(angle) * 0.46);
    mesh.rotation.x = angle;
    band.add(mesh);
  }
  const led = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.04, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x3987e5 }),
  );
  const towardWrist = lineToward === "wrist" ? 1 : -1;
  led.position.set(bandX + towardWrist * 0.19, 0.555, 0);
  band.add(led);
  return band;
}

function Motion3D({ lineToward }: { lineToward: LineDirection }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const zero = useZeroOrientation();
  const zeroRef = useRef(zero);
  const paused = useSessionStore((state) => state.paused);
  const pausedRef = useRef(paused);
  const themeVersion = useThemeVersion();

  useEffect(() => {
    zeroRef.current = zero;
    pausedRef.current = paused;
  }, [zero, paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    // From behind the arm, so that the user's left and right match the screen's.
    camera.position.set(-6.4, 2.4, 1.4);
    camera.lookAt(0.4, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(3, 5, 4);
    scene.add(light);

    const body = new THREE.Group();
    body.add(buildArm(), buildBand(lineToward));
    const wrist = wristAlongX(lineToward);
    scene.add(body);

    const sphere = new THREE.LineSegments(
      new THREE.WireframeGeometry(
        new THREE.SphereGeometry(SPHERE_RADIUS, 16, 12),
      ),
      new THREE.LineBasicMaterial({
        color: themeColor("--chart-grid"),
      }),
    );
    scene.add(sphere);

    const trailGeometry = new THREE.BufferGeometry();
    const trailPositions = new Float32Array(TRAIL_SAMPLES * 3);
    trailGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trailPositions, 3),
    );
    const trail = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({ color: themeColor("--accent") }),
    );
    scene.add(trail);

    const fit = () => {
      const { clientWidth: width, clientHeight: height } = container;
      renderer.setSize(width, height);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    fit();
    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);

    const history = Array.from(
      { length: 4 },
      () => new Float32Array(TRAIL_SAMPLES),
    );

    let animationFrame = requestAnimationFrame(function loop() {
      animationFrame = requestAnimationFrame(loop);
      if (pausedRef.current) {
        renderer.render(scene, camera);
        return;
      }
      let count = 0;
      for (let field = 0; field < 4; field++) {
        count = imuBuffer.copyLatest(field, TRAIL_SAMPLES, history[field]);
      }
      const armPose = createArmPose(zeroRef.current, wrist, currentUpSign());
      for (let index = 0; index < count; index++) {
        const pose = armPose([
          history[0][index],
          history[1][index],
          history[2][index],
          history[3][index],
        ]);
        trailPositions.set(rotate(pose, [SPHERE_RADIUS, 0, 0]), index * 3);
        if (index === count - 1) {
          body.quaternion.set(pose[1], pose[2], pose[3], pose[0]);
        }
      }
      trailGeometry.setDrawRange(0, count);
      trailGeometry.attributes.position.needsUpdate = true;
      renderer.render(scene, camera);
    });

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.dispose();
      trailGeometry.dispose();
      renderer.domElement.remove();
    };
  }, [lineToward, themeVersion]);

  return <div className="motion-scene" ref={containerRef} />;
}

type SeriesKind = "orientation" | "accelerometer" | "gyroscope";

const SERIES_LABELS: Record<SeriesKind, string[]> = {
  orientation: ["motion.roll", "motion.pitch", "motion.yaw"],
  accelerometer: ["X", "Y", "Z", "motion.magnitude"],
  gyroscope: ["X", "Y", "Z", "motion.magnitude"],
};

const UNITS: Record<SeriesKind, string> = {
  orientation: "°",
  accelerometer: "g",
  gyroscope: "°/s",
};

function createImuReader(
  kind: SeriesKind,
  seriesCount: number,
  zero: Quaternion,
  lineToward: LineDirection,
) {
  const time = Float32Array.from(
    { length: CHART_SAMPLES },
    (_, index) => (index - CHART_SAMPLES + 1) / IMU_RATE_HZ,
  );
  const raw = Array.from(
    { length: IMU_FIELDS },
    () => new Float32Array(CHART_SAMPLES),
  );
  const output = Array.from(
    { length: seriesCount },
    () => new Float32Array(CHART_SAMPLES),
  );
  let lastWritten = -1;

  return (): uPlot.AlignedData | null => {
    if (imuBuffer.totalWritten === lastWritten) {
      return null;
    }
    lastWritten = imuBuffer.totalWritten;
    let count = 0;
    for (let field = 0; field < IMU_FIELDS; field++) {
      count = imuBuffer.copyLatest(field, CHART_SAMPLES, raw[field]);
    }
    const armPose = createArmPose(
      zero,
      wristAlongX(lineToward),
      currentUpSign(),
    );
    for (let index = 0; index < count; index++) {
      if (kind === "orientation") {
        const angles = armAngles(
          armPose([raw[0][index], raw[1][index], raw[2][index], raw[3][index]]),
        );
        output[0][index] = angles.roll;
        output[1][index] = angles.pitch;
        output[2][index] = angles.yaw;
      } else {
        const start = kind === "accelerometer" ? 4 : 7;
        const [x, y, z] = [
          raw[start][index],
          raw[start + 1][index],
          raw[start + 2][index],
        ];
        output[0][index] = x;
        output[1][index] = y;
        output[2][index] = z;
        output[3][index] = Math.hypot(x, y, z);
      }
    }
    return [
      time.subarray(CHART_SAMPLES - count),
      ...output.map((series) => series.subarray(0, count)),
    ];
  };
}

function ImuChart({
  kind,
  lineToward,
}: {
  kind: SeriesKind;
  lineToward: LineDirection;
}) {
  const { t, i18n } = useTranslation();
  const zero = useZeroOrientation();
  const labels = SERIES_LABELS[kind];

  const createOptions = useCallback((): Omit<
    uPlot.Options,
    "width" | "height"
  > => {
    const colors = readChartColors();
    const axis = chartAxisStyle(colors);
    const unit = UNITS[kind];
    return {
      pxAlign: false,
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false, range: () => [-CHART_SECONDS, 0] },
        ...(kind === "orientation"
          ? { y: { range: (): uPlot.Range.MinMax => [-180, 180] } }
          : {}),
      },
      axes: [{ ...axis }, { ...axis, size: 52 }],
      series: [
        {
          label: i18n.t("oscilloscope.time"),
          value: (_, value) => (value === null ? "—" : `${value.toFixed(2)} s`),
        },
        ...labels.map((label, index) => ({
          label: label.startsWith("motion.") ? i18n.t(label) : label,
          stroke: colors.series(index),
          width: 1.5,
          points: { show: false },
          value: (_: uPlot, value: number | null) =>
            value === null ? "—" : `${value.toFixed(1)} ${unit}`,
        })),
      ],
    };
    // Rebuilding on a language change updates the labels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, labels, i18n, i18n.language]);

  const read = useMemo(
    () => createImuReader(kind, labels.length, zero, lineToward),
    [kind, labels.length, zero, lineToward],
  );

  return (
    <section className="card motion-chart">
      <h2>{t(`motion.${kind}`)}</h2>
      <div className="chart-area">
        <LiveChart createOptions={createOptions} read={read} />
      </div>
    </section>
  );
}

function EulerReadout({ lineToward }: { lineToward: LineDirection }) {
  const { t } = useTranslation();
  const zero = useZeroOrientation();
  const [angles, setAngles] = useState(() => ({ roll: 0, pitch: 0, yaw: 0 }));
  const paused = useSessionStore((state) => state.paused);

  useEffect(() => {
    if (paused) {
      return;
    }
    const timer = setInterval(() => {
      const orientation = latestOrientation();
      if (orientation) {
        const armPose = createArmPose(
          zero,
          wristAlongX(lineToward),
          currentUpSign(),
        );
        setAngles(armAngles(armPose(orientation)));
      }
    }, 100);
    return () => clearInterval(timer);
  }, [zero, paused, lineToward]);

  return (
    <dl className="euler">
      {(["roll", "pitch", "yaw"] as const).map((axis) => (
        <div key={axis}>
          <dt>{t(`motion.${axis}`)}</dt>
          <dd className="numeric">{angles[axis].toFixed(0)}°</dd>
        </div>
      ))}
    </dl>
  );
}

export function MotionView() {
  const { t } = useTranslation();
  const lineToward = useProfileStore(
    (state) => state.placement?.lineToward ?? "elbow",
  );
  const hasCalibration = useProfileStore((state) => state.calibration !== null);
  const setZeroOverride = useSessionStore((state) => state.setZeroOverride);
  const inSession = useSessionStore(
    (state) => state.status === "connected" || state.status === "reconnecting",
  );

  if (!inSession) {
    return <p className="view-empty">{t("views.empty")}</p>;
  }

  return (
    <div className="view-grid motion-view">
      <section className="card motion-card">
        <header className="card-header">
          <h2>{t("motion.title")}</h2>
          <button
            type="button"
            className="button"
            onClick={() => {
              const orientation = latestOrientation();
              if (orientation) {
                setZeroOverride(orientation);
              }
            }}
          >
            {t("motion.setZero")}
          </button>
        </header>
        <Motion3D lineToward={lineToward} />
        <EulerReadout lineToward={lineToward} />
        <p className="hint">
          {hasCalibration ? t("motion.hintCalibrated") : t("motion.hint")}
        </p>
      </section>
      <div className="motion-charts">
        <ImuChart kind="orientation" lineToward={lineToward} />
        <ImuChart kind="accelerometer" lineToward={lineToward} />
        <ImuChart kind="gyroscope" lineToward={lineToward} />
      </div>
    </div>
  );
}
