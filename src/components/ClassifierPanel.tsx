import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/session";

export function ClassifierPanel() {
  const { t } = useTranslation();
  const pose = useSessionStore((state) => state.pose);
  const arm = useSessionStore((state) => state.arm);
  const locked = useSessionStore((state) => state.locked);
  const none = t("classifier.none");

  const lockLabel =
    locked === null
      ? none
      : locked
        ? t("classifier.locked")
        : t("classifier.unlocked");

  return (
    <section className="card">
      <header className="card-header">
        <h2>{t("classifier.title")}</h2>
      </header>
      <dl className="details">
        <dt>{t("classifier.pose")}</dt>
        <dd>{pose ? t(`classifier.poses.${pose}`) : none}</dd>
        <dt>{t("classifier.arm")}</dt>
        <dd>{arm ? t(`classifier.arms.${arm}`) : none}</dd>
        <dt>{t("classifier.lock")}</dt>
        <dd>{lockLabel}</dd>
      </dl>
    </section>
  );
}
