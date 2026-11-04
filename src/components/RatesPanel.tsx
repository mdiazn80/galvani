import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { emgRate, imuRate } from "../lib/stream";

const REFRESH_INTERVAL_MS = 500;

export function RatesPanel() {
  const { t } = useTranslation();
  const [rates, setRates] = useState({ emg: 0, imu: 0 });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = performance.now();
      setRates({ emg: emgRate.rate(now), imu: imuRate.rate(now) });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="card">
      <header className="card-header">
        <h2>{t("rates.title")}</h2>
      </header>
      <dl className="details">
        <dt>{t("rates.emg")}</dt>
        <dd className="numeric">
          {t("rates.value", { rate: rates.emg.toFixed(0) })}
        </dd>
        <dt>{t("rates.imu")}</dt>
        <dd className="numeric">
          {t("rates.value", { rate: rates.imu.toFixed(0) })}
        </dd>
      </dl>
    </section>
  );
}
