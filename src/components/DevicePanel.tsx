import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/session";
import { BatteryMeter } from "./BatteryMeter";

const LAST_KNOWN_FIRMWARE = "1.5.1970";
const VISIBLE_ID_LENGTH = 8;

function formatSerial(serial: number[]): string {
  return serial
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":")
    .toUpperCase();
}

function DeviceSearch() {
  const { t } = useTranslation();
  const status = useSessionStore((state) => state.status);
  const scanning = useSessionStore((state) => state.scanning);
  const devices = useSessionStore((state) => state.devices);
  const scan = useSessionStore((state) => state.scan);
  const connectDevice = useSessionStore((state) => state.connectDevice);
  const connectSimulated = useSessionStore((state) => state.connectSimulated);
  const busy = scanning || status === "connecting";

  return (
    <>
      <button
        type="button"
        className="button button-primary"
        disabled={busy}
        onClick={() => void scan()}
      >
        {scanning ? t("device.scanning") : t("device.scan")}
      </button>

      {devices?.length === 0 && <p className="hint">{t("device.noDevices")}</p>}

      {devices && devices.length > 0 && (
        <ul className="device-list">
          {devices.map((device) => (
            <li key={device.id}>
              <div>
                <div>{device.name}</div>
                <div className="hint numeric">
                  {device.id.slice(0, VISIBLE_ID_LENGTH)}
                  {device.rssi !== null &&
                    ` · ${t("device.rssiValue", { value: device.rssi })}`}
                </div>
              </div>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void connectDevice(device)}
              >
                {t("device.connect")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {status === "connecting" && (
        <p className="hint">{t("device.connecting")}</p>
      )}

      <button
        type="button"
        className="button"
        disabled={busy}
        onClick={() => void connectSimulated()}
      >
        {t("device.connectSimulated")}
      </button>
    </>
  );
}

function DeviceDetailsList() {
  const { t } = useTranslation();
  const details = useSessionStore((state) => state.details);
  const battery = useSessionStore((state) => state.battery);
  const charging = useSessionStore(
    (state) => state.batteryTrend?.charging ?? false,
  );
  const rssi = useSessionStore((state) => state.rssi);
  const disconnect = useSessionStore((state) => state.disconnect);

  if (!details) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => void disconnect()}
      >
        {t("device.disconnect")}
      </button>
      <dl className="details">
        <dt>{t("device.name")}</dt>
        <dd>{details.name}</dd>
        <dt>{t("device.serial")}</dt>
        <dd className="numeric">{formatSerial(details.info.serialNumber)}</dd>
        <dt>{t("device.model")}</dt>
        <dd>{t(`device.sku.${details.info.sku}`)}</dd>
        <dt>{t("device.firmware")}</dt>
        <dd className="numeric">
          {details.firmware.major}.{details.firmware.minor}.
          {details.firmware.patch}
        </dd>
        <dt>{t("device.hardware")}</dt>
        <dd>{t(`device.hardwareRev.${details.firmware.hardwareRev}`)}</dd>
        <dt>{t("device.battery")}</dt>
        <dd>
          {battery !== null && (
            <BatteryMeter level={battery} charging={charging} />
          )}
        </dd>
        <dt>{t("device.rssi")}</dt>
        <dd className="numeric">
          {rssi === null
            ? t("classifier.none")
            : t("device.rssiValue", { value: rssi })}
        </dd>
      </dl>
      {details.firmwareOutdated && (
        <p className="message" role="status">
          {t("device.outdatedFirmware", { version: LAST_KNOWN_FIRMWARE })}
        </p>
      )}
    </>
  );
}

export function DevicePanel() {
  const { t } = useTranslation();
  const status = useSessionStore((state) => state.status);
  const source = useSessionStore((state) => state.source);
  const errorCode = useSessionStore((state) => state.errorCode);
  const inSession = status === "connected" || status === "reconnecting";

  return (
    <section className="card">
      <header className="card-header">
        <h2>{t("device.title")}</h2>
        <span className={`status status-${status}`}>
          {source === "playback" && status === "connected"
            ? t("playback.status")
            : t(`device.status.${status}`)}
        </span>
      </header>

      {inSession ? <DeviceDetailsList /> : <DeviceSearch />}

      {errorCode && (
        <p className="message" role="alert">
          {t(`errors.${errorCode}`)}
        </p>
      )}
    </section>
  );
}
