import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  LineDirection,
  Placement,
  PlacementArm,
} from "../lib/calibration";
import { useProfileStore } from "../stores/profile";
import { useSessionStore } from "../stores/session";
import { CalibrationWizard } from "./CalibrationWizard";

const NOT_SET = "";

export function PlacementPanel() {
  const { t, i18n } = useTranslation();
  const placement = useProfileStore((state) => state.placement);
  const calibration = useProfileStore((state) => state.calibration);
  const saveFailed = useProfileStore((state) => state.saveFailed);
  const setPlacement = useProfileStore((state) => state.setPlacement);
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const syncedArm = useSessionStore((state) => state.arm);
  const [wizardOpen, setWizardOpen] = useState(false);

  const update = (change: Partial<Placement>) => {
    void setPlacement({
      arm: "right",
      lineToward: "wrist",
      ...placement,
      ...change,
    });
  };

  const armMismatch =
    placement !== null &&
    (syncedArm === "left" || syncedArm === "right") &&
    syncedArm !== placement.arm;
  const placementChanged =
    placement !== null &&
    calibration !== null &&
    (calibration.placement.arm !== placement.arm ||
      calibration.placement.lineToward !== placement.lineToward);

  return (
    <section className="card">
      <header className="card-header">
        <h2>{t("placement.title")}</h2>
      </header>

      <label className="field">
        {t("placement.arm")}
        <select
          value={placement?.arm ?? NOT_SET}
          onChange={(event) =>
            update({ arm: event.target.value as PlacementArm })
          }
        >
          {placement === null && (
            <option value={NOT_SET}>{t("placement.notSet")}</option>
          )}
          <option value="left">{t("placement.left")}</option>
          <option value="right">{t("placement.right")}</option>
        </select>
      </label>

      <label className="field">
        {t("placement.line")}
        <select
          value={placement?.lineToward ?? NOT_SET}
          onChange={(event) =>
            update({ lineToward: event.target.value as LineDirection })
          }
        >
          {placement === null && (
            <option value={NOT_SET}>{t("placement.notSet")}</option>
          )}
          <option value="wrist">{t("placement.wrist")}</option>
          <option value="elbow">{t("placement.elbow")}</option>
        </select>
      </label>
      <p className="hint">{t("placement.lineHint")}</p>
      <p className="hint">{t("placement.armHint")}</p>

      {armMismatch && (
        <p className="message" role="alert">
          {t("placement.armMismatch", {
            arm: t(`placement.${syncedArm}`),
          })}
        </p>
      )}

      <button
        type="button"
        className="button"
        disabled={!connected || placement === null}
        onClick={() => setWizardOpen(true)}
      >
        {calibration ? t("placement.recalibrate") : t("placement.calibrate")}
      </button>

      <p className="hint">
        {calibration
          ? t("placement.calibratedOn", {
              date: new Date(calibration.calibratedAt).toLocaleString(
                i18n.language,
              ),
            })
          : t("placement.notCalibrated")}
      </p>
      {placementChanged && (
        <p className="message" role="status">
          {t("placement.placementChanged")}
        </p>
      )}
      {saveFailed && (
        <p className="message" role="alert">
          {t("errors.profileNotSaved")}
        </p>
      )}

      {wizardOpen && placement && (
        <CalibrationWizard
          placement={placement}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </section>
  );
}
