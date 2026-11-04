import { useRef, useState, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  addStep,
  DEFAULT_PATTERN,
  MAX_DURATION_MS,
  MAX_STEPS,
  MAX_STRENGTH,
  MIN_DURATION_MS,
  patternDuration,
  removeStep,
  updateStep,
  type VibrationStep,
} from "../lib/vibration";
import { useSessionStore } from "../stores/session";

/** The timeline grows to fit longer patterns, but never shows less than this. */
const MIN_TIMELINE_MS = 2000;

type DragKind = "duration" | "strength";

export function VibrationEditor() {
  const { t } = useTranslation();
  const connected = useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
  const playPattern = useSessionStore((state) => state.playPattern);
  const [steps, setSteps] = useState<VibrationStep[]>(DEFAULT_PATTERN);
  const timelineRef = useRef<HTMLDivElement>(null);
  const total = patternDuration(steps);
  const timelineMs = Math.max(total, MIN_TIMELINE_MS);

  const startDrag = (
    event: PointerEvent<HTMLElement>,
    index: number,
    kind: DragKind,
  ) => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const bounds = timeline.getBoundingClientRect();
    const startX = event.clientX;
    const startDuration = steps[index].durationMs;
    const msPerPixel = timelineMs / bounds.width;

    const onMove = (move: globalThis.PointerEvent) => {
      if (kind === "duration") {
        const durationMs = startDuration + (move.clientX - startX) * msPerPixel;
        setSteps((current) => updateStep(current, index, { durationMs }));
      } else {
        const fraction = 1 - (move.clientY - bounds.top) / bounds.height;
        setSteps((current) =>
          updateStep(current, index, { strength: fraction * MAX_STRENGTH }),
        );
      }
    };
    const onEnd = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onEnd);
      target.removeEventListener("pointercancel", onEnd);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onEnd);
    target.addEventListener("pointercancel", onEnd);
  };

  return (
    <div className="vibration-editor">
      <div className="toolbar">
        <h3 className="subheading">{t("control.patternTitle")}</h3>
        <span className="hint numeric">
          {t("control.patternTotal", { value: total })}
        </span>
      </div>

      <div
        className="vibration-timeline"
        ref={timelineRef}
        role="img"
        aria-label={t("control.patternTitle")}
      >
        {steps.map((step, index) => (
          <div
            key={index}
            className="vibration-step"
            style={{ width: `${(step.durationMs / timelineMs) * 100}%` }}
          >
            <div
              className="vibration-bar"
              style={{ height: `${(step.strength / MAX_STRENGTH) * 100}%` }}
            />
            <div
              className="vibration-handle-strength"
              style={{ bottom: `${(step.strength / MAX_STRENGTH) * 100}%` }}
              onPointerDown={(event) => startDrag(event, index, "strength")}
            />
            <div
              className="vibration-handle-duration"
              onPointerDown={(event) => startDrag(event, index, "duration")}
            />
          </div>
        ))}
      </div>
      <p className="hint">{t("control.patternHint")}</p>

      <table className="pattern-table">
        <thead>
          <tr>
            <th scope="col">{t("control.step")}</th>
            <th scope="col">{t("control.duration")}</th>
            <th scope="col">{t("control.strength")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={index}>
              <th scope="row" className="numeric">
                {index + 1}
              </th>
              <td>
                <input
                  type="number"
                  className="numeric"
                  min={MIN_DURATION_MS}
                  max={MAX_DURATION_MS}
                  step={10}
                  value={step.durationMs}
                  aria-label={t("control.duration")}
                  onChange={(event) =>
                    setSteps(
                      updateStep(steps, index, {
                        durationMs: Number(event.target.value),
                      }),
                    )
                  }
                />
              </td>
              <td>
                <input
                  type="number"
                  className="numeric"
                  min={0}
                  max={MAX_STRENGTH}
                  value={step.strength}
                  aria-label={t("control.strength")}
                  onChange={(event) =>
                    setSteps(
                      updateStep(steps, index, {
                        strength: Number(event.target.value),
                      }),
                    )
                  }
                />
              </td>
              <td>
                <button
                  type="button"
                  className="button button-small"
                  disabled={steps.length <= 1}
                  onClick={() => setSteps(removeStep(steps, index))}
                >
                  {t("control.removeStep")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dialog-actions">
        <button
          type="button"
          className="button"
          disabled={steps.length >= MAX_STEPS}
          onClick={() => setSteps(addStep(steps))}
        >
          {t("control.addStep")}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!connected}
          onClick={() => void playPattern(steps)}
        >
          {t("control.playPattern")}
        </button>
      </div>
    </div>
  );
}
