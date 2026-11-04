import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatBytes, formatDuration } from "../lib/format";
import {
  useRecordingsStore,
  type RecordingSummary,
} from "../stores/recordings";
import { useSessionStore } from "../stores/session";

function RecorderCard() {
  const { t } = useTranslation();
  const canRecord = useSessionStore(
    (state) =>
      state.source === "device" &&
      (state.status === "connected" || state.status === "reconnecting"),
  );
  const activeSince = useRecordingsStore((state) => state.activeSince);
  const start = useRecordingsStore((state) => state.start);
  const stop = useRecordingsStore((state) => state.stop);
  const addMark = useRecordingsStore((state) => state.addMark);
  const failed = useRecordingsStore((state) => state.failed);
  const [label, setLabel] = useState("");
  const [mark, setMark] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (activeSince === null) {
      return;
    }
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [activeSince]);

  return (
    <section className="card">
      <h2>{t("recordings.recorderTitle")}</h2>
      {activeSince === null ? (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void start(label.trim());
          }}
        >
          <input
            type="text"
            value={label}
            placeholder={t("recordings.labelPlaceholder")}
            aria-label={t("recordings.labelPlaceholder")}
            onChange={(event) => setLabel(event.target.value)}
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={!canRecord}
          >
            {t("recordings.start")}
          </button>
        </form>
      ) : (
        <>
          <div className="recording-now">
            <span className="numeric">
              {t("recordings.recordingFor", {
                time: formatDuration(Math.max(now - activeSince, 0)),
              })}
            </span>
            <button
              type="button"
              className="button"
              onClick={() => void stop()}
            >
              {t("recordings.stop")}
            </button>
          </div>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const text = mark.trim();
              if (text) {
                void addMark(text);
                setMark("");
              }
            }}
          >
            <input
              type="text"
              value={mark}
              placeholder={t("recordings.markPlaceholder")}
              aria-label={t("recordings.markPlaceholder")}
              onChange={(event) => setMark(event.target.value)}
            />
            <button type="submit" className="button">
              {t("recordings.addMark")}
            </button>
          </form>
        </>
      )}
      {!canRecord && activeSince === null && (
        <p className="hint">{t("recordings.needsDevice")}</p>
      )}
      {failed && (
        <p className="message" role="alert">
          {t("errors.recordingFailed")}
        </p>
      )}
      <p className="hint">{t("recordings.backgroundHint")}</p>
    </section>
  );
}

function RecordingRow({ recording }: { recording: RecordingSummary }) {
  const { t, i18n } = useTranslation();
  const remove = useRecordingsStore((state) => state.remove);
  const exportJson = useRecordingsStore((state) => state.exportJson);
  const openRecording = useSessionStore((state) => state.openRecording);
  const idle = useSessionStore((state) => state.status === "disconnected");
  const [confirming, setConfirming] = useState(false);
  const durationSeconds = recording.durationMs / 1000;
  const rate = durationSeconds > 0 ? recording.emgSamples / durationSeconds : 0;

  return (
    <tr>
      <td className="recording-name">
        {recording.label || t("recordings.untitled")}
        <div className="hint">{recording.device.name}</div>
      </td>
      <td>{new Date(recording.startedAtMs).toLocaleString(i18n.language)}</td>
      <td className="numeric">{formatDuration(recording.durationMs)}</td>
      <td className="numeric">
        {t("rates.value", { rate: rate.toFixed(0) })}
        {recording.lostEmgFraction !== null && (
          <div className="hint">
            {t("recordings.lost", {
              value: (recording.lostEmgFraction * 100).toFixed(1),
            })}
          </div>
        )}
      </td>
      <td className="numeric">{formatBytes(recording.sizeBytes)}</td>
      <td>
        <div className="button-row row-actions">
          <button
            type="button"
            className="button button-small"
            disabled={!idle}
            onClick={() => void openRecording(recording.id)}
          >
            {t("recordings.play")}
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => void revealItemInDir(recording.path)}
          >
            {t("recordings.reveal")}
          </button>
          <button
            type="button"
            className="button button-small"
            onClick={() => {
              void exportJson(recording.id).then((path) => {
                if (path) {
                  void revealItemInDir(path);
                }
              });
            }}
          >
            {t("recordings.exportJson")}
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="button button-small"
                onClick={() => setConfirming(false)}
              >
                {t("calibration.cancel")}
              </button>
              <button
                type="button"
                className="button button-small button-primary"
                onClick={() => void remove(recording.id)}
              >
                {t("recordings.confirmDelete")}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="button button-small"
              onClick={() => setConfirming(true)}
            >
              {t("recordings.delete")}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function RecordingsView() {
  const { t } = useTranslation();
  const recordings = useRecordingsStore((state) => state.recordings);
  const refresh = useRecordingsStore((state) => state.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="view-grid recordings-view">
      <RecorderCard />
      <section className="card">
        <h2>{t("recordings.listTitle")}</h2>
        {recordings.length === 0 ? (
          <p className="hint">{t("recordings.empty")}</p>
        ) : (
          <table className="metrics-table recordings-table">
            <thead>
              <tr>
                <th scope="col">{t("recordings.name")}</th>
                <th scope="col">{t("recordings.date")}</th>
                <th scope="col">{t("recordings.duration")}</th>
                <th scope="col">{t("recordings.emgRate")}</th>
                <th scope="col">{t("recordings.size")}</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {recordings.map((recording) => (
                <RecordingRow key={recording.id} recording={recording} />
              ))}
            </tbody>
          </table>
        )}
        <p className="hint">{t("recordings.statsHint")}</p>
        <p className="hint">{t("privacyNotice")}</p>
      </section>
    </div>
  );
}
