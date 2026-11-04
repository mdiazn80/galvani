import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmgOscilloscope } from "../charts/EmgOscilloscope";
import { PlaybackBar } from "../components/PlaybackBar";
import { useRecordingsStore } from "../stores/recordings";
import { useSessionStore } from "../stores/session";
import { ActivationView } from "./ActivationView";
import { ControlView } from "./ControlView";
import { DataView } from "./DataView";
import { RecordingsView } from "./RecordingsView";
import { SpectrumView } from "./SpectrumView";
import { TrainingView } from "./TrainingView";

// Three.js is large, so it only loads when the view is first opened.
const MotionView = lazy(() =>
  import("./MotionView").then((module) => ({ default: module.MotionView })),
);

const TABS = [
  "emg",
  "activation",
  "spectrum",
  "motion",
  "control",
  "training",
  "data",
  "recordings",
] as const;
type Tab = (typeof TABS)[number];

export function MainTabs() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("emg");
  const inSession = useSessionStore(
    (state) => state.status === "connected" || state.status === "reconnecting",
  );
  const paused = useSessionStore((state) => state.paused);
  const playingBack = useSessionStore(
    (state) => state.source === "playback" && state.status === "connected",
  );
  const recording = useRecordingsStore((state) => state.activeSince !== null);
  const togglePaused = useSessionStore((state) => state.togglePaused);

  return (
    <div className="main-panel">
      {playingBack && <PlaybackBar />}
      <div className="tab-bar">
        <div role="tablist" aria-label={t("views.label")} className="tabs">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={tab === id}
              aria-controls="main-tabpanel"
              className="tab"
              onClick={() => setTab(id)}
            >
              {t(`views.${id}`)}
            </button>
          ))}
        </div>
        <div className="tab-bar-actions">
          {recording && (
            <span className="recording-indicator">
              {t("recordings.recording")}
            </span>
          )}
          <button
            type="button"
            className="button"
            disabled={!inSession}
            onClick={togglePaused}
          >
            {paused ? t("oscilloscope.resume") : t("oscilloscope.pause")}
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        id="main-tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="tab-panel"
      >
        {tab === "emg" && <EmgOscilloscope />}
        {tab === "activation" && <ActivationView />}
        {tab === "spectrum" && <SpectrumView />}
        {tab === "motion" && (
          <Suspense
            fallback={<p className="view-empty">{t("views.loading")}</p>}
          >
            <MotionView />
          </Suspense>
        )}
        {tab === "control" && <ControlView />}
        {tab === "training" && <TrainingView />}
        {tab === "data" && <DataView />}
        {tab === "recordings" && <RecordingsView />}
      </div>
    </div>
  );
}
