import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GestureIllustration,
  type GestureId,
} from "../components/GestureIllustration";
import { VibrationEditor } from "../components/VibrationEditor";
import type { Pose } from "../lib/types";
import { useProfileStore } from "../stores/profile";
import {
  useSessionStore,
  type ClassifierModeSetting,
  type EmgModeSetting,
  type ImuModeSetting,
  type SleepModeSetting,
} from "../stores/session";

const DEFAULT_PLACEMENT = { arm: "right", lineToward: "elbow" } as const;

function gestureForPose(pose: Pose | null): GestureId | null {
  return pose === null || pose === "unknown" ? null : pose;
}

function GesturesCard() {
  const { t } = useTranslation();
  const pose = useSessionStore((state) => state.pose);
  const arm = useSessionStore((state) => state.arm);
  const xDirection = useSessionStore((state) => state.xDirection);
  const locked = useSessionStore((state) => state.locked);
  const tapCount = useSessionStore((state) => state.tapCount);
  const syncFailed = useSessionStore((state) => state.syncFailed);
  const placement = useProfileStore((state) => state.placement);
  const none = t("classifier.none");
  const gesture = gestureForPose(pose);
  const label = pose ? t(`classifier.poses.${pose}`) : none;

  return (
    <section className="card">
      <h2>{t("control.gesturesTitle")}</h2>
      <div className="pose-display">
        {gesture ? (
          <GestureIllustration
            step={gesture}
            placement={placement ?? DEFAULT_PLACEMENT}
            label={label}
          />
        ) : (
          <div className="pose-empty" />
        )}
        <strong className="pose-name">{label}</strong>
      </div>
      <dl className="details">
        <dt>{t("classifier.arm")}</dt>
        <dd>{arm ? t(`classifier.arms.${arm}`) : none}</dd>
        <dt>{t("control.xDirection")}</dt>
        <dd>{xDirection ? t(`control.directions.${xDirection}`) : none}</dd>
        <dt>{t("classifier.lock")}</dt>
        <dd>
          {locked === null
            ? none
            : locked
              ? t("classifier.locked")
              : t("classifier.unlocked")}
        </dd>
        <dt>{t("data.tap")}</dt>
        <dd>
          {/* Changing the key restarts the animation on every tap. */}
          <span key={tapCount} className={tapCount > 0 ? "tap-pulse" : ""}>
            {tapCount}
          </span>
        </dd>
      </dl>
      {syncFailed && (
        <p className="message" role="status">
          {t("control.syncFailed")}
        </p>
      )}
      {arm === null && <p className="hint">{t("control.syncHint")}</p>}
    </section>
  );
}

function VibrationCard() {
  const { t } = useTranslation();
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const vibrate = useSessionStore((state) => state.vibrate);

  return (
    <section className="card control-wide">
      <h2>{t("control.vibrationTitle")}</h2>
      <div className="button-row">
        {(["short", "medium", "long"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="button"
            disabled={!connected}
            onClick={() => void vibrate(kind)}
          >
            {t(`control.vibrations.${kind}`)}
          </button>
        ))}
      </div>
      <VibrationEditor />
    </section>
  );
}

function ModesCard() {
  const { t } = useTranslation();
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const modes = useSessionStore((state) => state.modes);
  const setModes = useSessionStore((state) => state.setModes);

  return (
    <section className="card">
      <h2>{t("control.modesTitle")}</h2>
      <label className="field">
        EMG
        <select
          disabled={!connected}
          value={modes.emg}
          onChange={(event) =>
            void setModes({
              ...modes,
              emg: event.target.value as EmgModeSetting,
            })
          }
        >
          <option value="none">{t("control.modes.off")}</option>
          <option value="filtered">{t("control.modes.filtered")}</option>
          <option value="raw">{t("control.modes.raw")}</option>
        </select>
      </label>
      <label className="field">
        IMU
        <select
          disabled={!connected}
          value={modes.imu}
          onChange={(event) =>
            void setModes({
              ...modes,
              imu: event.target.value as ImuModeSetting,
            })
          }
        >
          <option value="none">{t("control.modes.off")}</option>
          <option value="data">{t("control.modes.data")}</option>
          <option value="events">{t("control.modes.events")}</option>
          <option value="all">{t("control.modes.all")}</option>
          <option value="raw">{t("control.modes.rawData")}</option>
        </select>
      </label>
      <label className="field">
        {t("control.classifier")}
        <select
          disabled={!connected}
          value={modes.classifier}
          onChange={(event) =>
            void setModes({
              ...modes,
              classifier: event.target.value as ClassifierModeSetting,
            })
          }
        >
          <option value="enabled">{t("control.modes.on")}</option>
          <option value="disabled">{t("control.modes.off")}</option>
        </select>
      </label>
      <p className="hint">{t("control.modesHint")}</p>
    </section>
  );
}

function DeviceCard() {
  const { t } = useTranslation();
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const sleepMode = useSessionStore((state) => state.sleepMode);
  const unlock = useSessionStore((state) => state.unlock);
  const setSleepMode = useSessionStore((state) => state.setSleepMode);
  const deepSleep = useSessionStore((state) => state.deepSleep);
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="card">
      <h2>{t("control.deviceTitle")}</h2>
      <div className="button-row">
        <button
          type="button"
          className="button"
          disabled={!connected}
          onClick={() => void unlock("lock")}
        >
          {t("control.lock")}
        </button>
        <button
          type="button"
          className="button"
          disabled={!connected}
          onClick={() => void unlock("timed")}
        >
          {t("control.unlockTimed")}
        </button>
        <button
          type="button"
          className="button"
          disabled={!connected}
          onClick={() => void unlock("hold")}
        >
          {t("control.unlockHold")}
        </button>
      </div>
      <label className="field">
        {t("control.sleepMode")}
        <select
          disabled={!connected}
          value={sleepMode}
          onChange={(event) =>
            void setSleepMode(event.target.value as SleepModeSetting)
          }
        >
          <option value="neverSleep">{t("control.sleep.never")}</option>
          <option value="normal">{t("control.sleep.normal")}</option>
        </select>
      </label>
      {sleepMode === "normal" && (
        <p className="message" role="status">
          {t("control.sleepWarning")}
        </p>
      )}
      <button
        type="button"
        className="button"
        disabled={!connected}
        onClick={() => setConfirming(true)}
      >
        {t("control.deepSleep")}
      </button>

      {confirming && (
        <div className="dialog-backdrop">
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deep-sleep-title"
          >
            <h2 id="deep-sleep-title">{t("control.deepSleepTitle")}</h2>
            <p>{t("control.deepSleepWarning")}</p>
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => setConfirming(false)}
              >
                {t("calibration.cancel")}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setConfirming(false);
                  void deepSleep();
                }}
              >
                {t("control.deepSleepConfirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
}

function LedsCard() {
  const { t } = useTranslation();
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const setLeds = useSessionStore((state) => state.setLeds);
  const [logo, setLogo] = useState("#ff5a1f");
  const [line, setLine] = useState("#3987e5");

  return (
    <section className="card">
      <h2>{t("control.ledsTitle")}</h2>
      <p className="hint">{t("control.ledsHint")}</p>
      <label className="field">
        {t("control.ledLogo")}
        <input
          type="color"
          value={logo}
          onChange={(event) => setLogo(event.target.value)}
        />
      </label>
      <label className="field">
        {t("control.ledLine")}
        <input
          type="color"
          value={line}
          onChange={(event) => setLine(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="button"
        disabled={!connected}
        onClick={() => void setLeds(hexToRgb(logo), hexToRgb(line))}
      >
        {t("control.ledsApply")}
      </button>
    </section>
  );
}

export function ControlView() {
  const { t } = useTranslation();
  const inSession = useSessionStore(
    (state) => state.status === "connected" || state.status === "reconnecting",
  );

  if (!inSession) {
    return <p className="view-empty">{t("views.empty")}</p>;
  }

  return (
    <div className="view-grid control-view">
      <GesturesCard />
      <div className="control-column">
        <ModesCard />
        <DeviceCard />
        <LedsCard />
      </div>
      <VibrationCard />
    </div>
  );
}
