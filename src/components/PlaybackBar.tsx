import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "../lib/format";
import { useSessionStore } from "../stores/session";

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const REFRESH_INTERVAL_MS = 200;

interface PlaybackStatus {
  positionMs: number;
  durationMs: number;
  playing: boolean;
  speed: number;
}

/** Transport controls, shown above the views while a recording plays. */
export function PlaybackBar() {
  const { t } = useTranslation();
  const disconnect = useSessionStore((state) => state.disconnect);
  const prepareForSeek = useSessionStore((state) => state.prepareForSeek);
  const [status, setStatus] = useState<PlaybackStatus | null>(null);
  const draggingRef = useRef(false);
  const [dragValue, setDragValue] = useState<number | null>(null);

  useEffect(() => {
    const refresh = () => {
      void invoke<PlaybackStatus>("playback_status")
        .then(setStatus)
        .catch(() => {});
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (!status) {
    return null;
  }

  const seek = (positionMs: number) => {
    prepareForSeek();
    void invoke("playback_seek", { positionMs });
  };

  return (
    <div className="playback-bar card">
      <button
        type="button"
        className="button button-primary"
        onClick={() =>
          void invoke("playback_set_playing", { playing: !status.playing })
        }
      >
        {status.playing ? t("playback.pause") : t("playback.play")}
      </button>
      <span className="numeric hint">
        {formatDuration(dragValue ?? status.positionMs)} /{" "}
        {formatDuration(status.durationMs)}
      </span>
      <input
        type="range"
        className="playback-seek"
        aria-label={t("playback.position")}
        min={0}
        max={status.durationMs}
        step={100}
        value={dragValue ?? status.positionMs}
        onPointerDown={() => {
          draggingRef.current = true;
        }}
        onChange={(event) => setDragValue(Number(event.target.value))}
        onPointerUp={(event) => {
          draggingRef.current = false;
          setDragValue(null);
          seek(Number(event.currentTarget.value));
        }}
        onKeyUp={(event) => {
          setDragValue(null);
          seek(Number(event.currentTarget.value));
        }}
      />
      <label className="field-inline">
        {t("playback.speed")}
        <select
          value={status.speed}
          onChange={(event) =>
            void invoke("playback_set_speed", {
              speed: Number(event.target.value),
            })
          }
        >
          {SPEEDS.map((speed) => (
            <option key={speed} value={speed}>
              {speed}×
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button"
        onClick={() => void disconnect()}
      >
        {t("playback.close")}
      </button>
    </div>
  );
}
