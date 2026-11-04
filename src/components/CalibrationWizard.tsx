import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildCalibration,
  CALIBRATION_STEPS,
  evaluateStep,
  runCalibrationStep,
  stepHasEnoughData,
  summarizeStep,
  type Calibration,
  type CalibrationStep,
  type CalibrationWarning,
  type Placement,
  type StepCapture,
  type StepCaptures,
  type StepProgress,
} from "../lib/calibration";
import { subscribeToFrames } from "../lib/stream";
import { useProfileStore } from "../stores/profile";
import { useSessionStore } from "../stores/session";
import { GestureIllustration } from "./GestureIllustration";

type WizardState =
  | { view: "intro" }
  | { view: "ready"; stepIndex: number }
  | { view: "running"; stepIndex: number; progress: StepProgress | null }
  | { view: "review"; stepIndex: number; capture: StepCapture }
  | { view: "failed" }
  | {
      view: "summary";
      calibration: Calibration;
      warnings: CalibrationWarning[];
    };

interface Props {
  placement: Placement;
  onClose: () => void;
}

export function CalibrationWizard({ placement, onClose }: Props) {
  const { t } = useTranslation();
  const setCalibration = useProfileStore((state) => state.setCalibration);
  const connected = useSessionStore((state) => state.status === "connected");
  const [state, setState] = useState<WizardState>({ view: "intro" });
  const [accepted, setAccepted] = useState<StepCaptures>({});
  const abortRef = useRef<AbortController | null>(null);

  const runStep = async (stepIndex: number) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ view: "running", stepIndex, progress: null });
    try {
      const capture = await runCalibrationStep(
        CALIBRATION_STEPS[stepIndex],
        subscribeToFrames,
        controller.signal,
        (progress) => setState({ view: "running", stepIndex, progress }),
      );
      setState({ view: "review", stepIndex, capture });
    } catch {
      // Closing the wizard clears the ref, so only a lost device gets here with it set.
      if (abortRef.current === controller) {
        setState({ view: "failed" });
      }
    }
  };

  const acceptStep = (stepIndex: number, capture: StepCapture) => {
    const nextAccepted = {
      ...accepted,
      [CALIBRATION_STEPS[stepIndex].id]: capture,
    };
    setAccepted(nextAccepted);
    if (stepIndex + 1 < CALIBRATION_STEPS.length) {
      setState({ view: "ready", stepIndex: stepIndex + 1 });
    } else {
      setState({
        view: "summary",
        ...buildCalibration(nextAccepted, placement, new Date().toISOString()),
      });
    }
  };

  const restart = () => {
    setAccepted({});
    setState({ view: "ready", stepIndex: 0 });
  };

  // Losing the device invalidates whatever is being captured.
  useEffect(() => {
    if (!connected) {
      abortRef.current?.abort(new Error("The device disconnected"));
    }
  }, [connected]);

  const cancelRun = () => {
    const controller = abortRef.current;
    abortRef.current = null;
    controller?.abort(new Error("Cancelled"));
  };

  const close = () => {
    cancelRun();
    onClose();
  };

  useEffect(
    () => () => {
      const controller = abortRef.current;
      abortRef.current = null;
      controller?.abort(new Error("Closed"));
    },
    [],
  );

  const stepView =
    state.view === "ready" ||
    state.view === "running" ||
    state.view === "review";

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calibration-title"
      >
        <h2 id="calibration-title">{t("calibration.title")}</h2>

        {state.view === "intro" && (
          <>
            <p>{t("calibration.intro")}</p>
            <p className="hint">{t("calibration.safety")}</p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={close}>
                {t("calibration.cancel")}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={restart}
              >
                {t("calibration.begin")}
              </button>
            </div>
          </>
        )}

        {stepView && (
          <StepHeader
            step={CALIBRATION_STEPS[state.stepIndex]}
            stepIndex={state.stepIndex}
            placement={placement}
          />
        )}

        {state.view === "ready" && (
          <div className="dialog-actions">
            <button type="button" className="button" onClick={close}>
              {t("calibration.cancel")}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!connected}
              onClick={() => void runStep(state.stepIndex)}
            >
              {t("calibration.startStep")}
            </button>
          </div>
        )}

        {state.view === "running" && (
          <>
            <Countdown
              step={CALIBRATION_STEPS[state.stepIndex]}
              progress={state.progress}
            />
            <div className="dialog-actions">
              <button
                type="button"
                className="button"
                onClick={() => {
                  cancelRun();
                  setState({ view: "ready", stepIndex: state.stepIndex });
                }}
              >
                {t("calibration.stopStep")}
              </button>
            </div>
          </>
        )}

        {state.view === "review" && (
          <StepReview
            step={CALIBRATION_STEPS[state.stepIndex]}
            capture={state.capture}
            accepted={accepted}
            placement={placement}
            connected={connected}
            onRepeat={() => void runStep(state.stepIndex)}
            onAccept={() => acceptStep(state.stepIndex, state.capture)}
            onCancel={close}
          />
        )}

        {state.view === "failed" && (
          <>
            <p role="alert">{t("calibration.failed")}</p>
            <div className="dialog-actions">
              <button type="button" className="button" onClick={close}>
                {t("calibration.close")}
              </button>
            </div>
          </>
        )}

        {state.view === "summary" && (
          <>
            <Summary
              calibration={state.calibration}
              warnings={state.warnings}
            />
            <div className="dialog-actions">
              <button type="button" className="button" onClick={close}>
                {t("calibration.discard")}
              </button>
              <button
                type="button"
                className="button"
                disabled={!connected}
                onClick={restart}
              >
                {t("calibration.retry")}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  void setCalibration(state.calibration);
                  close();
                }}
              >
                {t("calibration.save")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StepHeader({
  step,
  stepIndex,
  placement,
}: {
  step: CalibrationStep;
  stepIndex: number;
  placement: Placement;
}) {
  const { t } = useTranslation();
  const title = t(`calibration.steps.${step.id}.title`);
  return (
    <>
      <p className="hint numeric">
        {t("calibration.stepCount", {
          current: stepIndex + 1,
          total: CALIBRATION_STEPS.length,
        })}
      </p>
      <h3 className="step-title">{title}</h3>
      <GestureIllustration step={step.id} placement={placement} label={title} />
      <p>{t(`calibration.steps.${step.id}.instruction`)}</p>
    </>
  );
}

function Countdown({
  step,
  progress,
}: {
  step: CalibrationStep;
  progress: StepProgress | null;
}) {
  const { t } = useTranslation();
  if (!progress) {
    return null;
  }

  const labels = {
    prepare: t("calibration.getReady"),
    capture: t("calibration.hold"),
    relax: t("calibration.relax"),
  };

  return (
    <div className={`countdown countdown-${progress.phase}`} aria-live="polite">
      <span>
        {labels[progress.phase]}
        {step.repetitions > 1 && (
          <span className="hint numeric">
            {" "}
            ·{" "}
            {t("calibration.repetition", {
              current: progress.repetition,
              total: step.repetitions,
            })}
          </span>
        )}
      </span>
      <strong className="numeric">{progress.secondsLeft}</strong>
    </div>
  );
}

function StepReview({
  step,
  capture,
  accepted,
  placement,
  connected,
  onRepeat,
  onAccept,
  onCancel,
}: {
  step: CalibrationStep;
  capture: StepCapture;
  accepted: StepCaptures;
  placement: Placement;
  connected: boolean;
  onRepeat: () => void;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const enough = stepHasEnoughData(step, capture);
  const warning = enough
    ? evaluateStep(step.id, capture, accepted, placement)
    : null;
  const result = summarizeStep(step.id, capture);

  const resultText = {
    level:
      result.kind === "level" &&
      t("calibration.result.level", { value: result.value.toFixed(1) }),
    channel:
      result.kind === "channel" &&
      t("calibration.result.channel", {
        channel: t("oscilloscope.channel", { number: result.channel + 1 }),
      }),
    gravity:
      result.kind === "gravity" &&
      t("calibration.result.gravity", { value: result.value.toFixed(2) }),
  }[result.kind];

  return (
    <>
      {enough ? (
        <p className="result numeric">{resultText}</p>
      ) : (
        <p className="message" role="alert">
          {t("calibration.notEnoughData")}
        </p>
      )}
      {warning && (
        <p className="message" role="status">
          {t(`calibration.warnings.${warning}`)}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          {t("calibration.cancel")}
        </button>
        <button
          type="button"
          className="button"
          disabled={!connected}
          onClick={onRepeat}
        >
          {t("calibration.repeatStep")}
        </button>
        <button
          type="button"
          className="button button-primary"
          disabled={!enough}
          onClick={onAccept}
        >
          {t("calibration.acceptStep")}
        </button>
      </div>
    </>
  );
}

function Summary({
  calibration,
  warnings,
}: {
  calibration: Calibration;
  warnings: CalibrationWarning[];
}) {
  const { t } = useTranslation();
  const channel = (index: number) =>
    t("oscilloscope.channel", { number: index + 1 });

  return (
    <>
      <p>
        {warnings.length === 0
          ? t("calibration.good")
          : t("calibration.review")}
      </p>
      {warnings.map((warning) => (
        <p key={warning} className="message" role="status">
          {t(`calibration.warnings.${warning}`)}
        </p>
      ))}
      <dl className="details">
        <dt>{t("calibration.waveInChannel")}</dt>
        <dd>{channel(calibration.waveInChannel)}</dd>
        <dt>{t("calibration.waveOutChannel")}</dt>
        <dd>{channel(calibration.waveOutChannel)}</dd>
      </dl>
      <table className="results-table">
        <thead>
          <tr>
            <th scope="col">{t("calibration.channel")}</th>
            <th scope="col">{t("calibration.rest")}</th>
            <th scope="col">{t("calibration.max")}</th>
          </tr>
        </thead>
        <tbody>
          {calibration.noiseFloor.map((noise, index) => (
            <tr key={index}>
              <th scope="row">{channel(index)}</th>
              <td className="numeric">{noise.toFixed(1)}</td>
              <td className="numeric">
                {calibration.maxActivation[index].toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
