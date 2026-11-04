import { useTranslation } from "react-i18next";
import { LOW_BATTERY_PERCENT } from "../lib/battery";

interface Props {
  level: number;
  charging: boolean;
}

export function BatteryMeter({ level, charging }: Props) {
  const { t } = useTranslation();
  const low = level <= LOW_BATTERY_PERCENT;

  return (
    <div className="battery">
      <div className="battery-row">
        <div
          className="battery-meter"
          role="meter"
          aria-label={t("device.battery")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={level}
        >
          <div
            className={low ? "battery-fill battery-fill-low" : "battery-fill"}
            style={{ width: `${level}%` }}
          />
        </div>
        <span className="numeric">{level}%</span>
      </div>
      {low && <span className="battery-note">{t("device.batteryLow")}</span>}
      {charging && (
        <span className="battery-note" title={t("device.batteryChargingHint")}>
          {t("device.batteryCharging")}
        </span>
      )}
    </div>
  );
}
