import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  GestureIllustration,
  type GestureId,
} from "../components/GestureIllustration";
import { isDarkTheme, rampCss } from "../lib/colorRamp";
import {
  classify,
  evaluate,
  extractFeatures,
  flattenExamples,
  MIN_FRAMES_PER_REPETITION,
  PredictionSmoother,
  REPETITION_SECONDS,
  REPETITIONS,
  SETTLING_FRAMES,
  type Prediction,
  type TrainedGesture,
} from "../lib/gestures";
import { subscribeToAnalysisFrames } from "../lib/stream";
import { useThemeVersion } from "../lib/useThemeVersion";
import { useGesturesStore } from "../stores/gestures";
import { useProfileStore } from "../stores/profile";
import { useSessionStore } from "../stores/session";

const PREPARE_SECONDS = 3;
const DEFAULT_PLACEMENT = { arm: "right", lineToward: "elbow" } as const;
const DEFAULT_GESTURES: { key: string; illustration: GestureId }[] = [
  { key: "rest", illustration: "rest" },
  { key: "fist", illustration: "fist" },
  { key: "waveIn", illustration: "waveIn" },
  { key: "waveOut", illustration: "waveOut" },
  { key: "fingersSpread", illustration: "fingersSpread" },
];

function useCanStream(): boolean {
  return useSessionStore(
    (state) => state.status === "connected" && state.source === "device",
  );
}

type TrainerState =
  | { view: "ready" }
  | { view: "running"; phase: "prepare" | "hold"; secondsLeft: number }
  | { view: "review"; frames: number[][] };

function GestureTrainer({
  gesture,
  index,
  onClose,
}: {
  gesture: TrainedGesture;
  index: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setRepetitions = useGesturesStore((state) => state.setRepetitions);
  const placement = useProfileStore((state) => state.placement);
  const canStream = useCanStream();
  const [state, setState] = useState<TrainerState>({ view: "ready" });
  const [repetitions, setLocal] = useState<number[][][]>([]);
  const cancelRef = useRef<(() => void) | null>(null);

  const cancel = () => {
    cancelRef.current?.();
    cancelRef.current = null;
  };

  // Losing the signal, or closing, ends any capture in progress.
  useEffect(() => {
    if (!canStream) {
      cancel();
      setStateIfRunning(setState);
    }
  }, [canStream]);
  useEffect(() => cancel, []);

  const run = () => {
    const frames: number[][] = [];
    let secondsLeft = PREPARE_SECONDS;
    let phase: "prepare" | "hold" = "prepare";
    let unsubscribe: (() => void) | null = null;
    setState({ view: "running", phase, secondsLeft });

    const timer = setInterval(() => {
      secondsLeft--;
      if (secondsLeft > 0) {
        setState({ view: "running", phase, secondsLeft });
      } else if (phase === "prepare") {
        phase = "hold";
        secondsLeft = REPETITION_SECONDS;
        unsubscribe = subscribeToAnalysisFrames((analysis) => {
          frames.push(extractFeatures(analysis.rms));
        });
        setState({ view: "running", phase, secondsLeft });
      } else {
        clearInterval(timer);
        unsubscribe?.();
        cancelRef.current = null;
        setState({ view: "review", frames: frames.slice(SETTLING_FRAMES) });
      }
    }, 1000);

    cancelRef.current = () => {
      clearInterval(timer);
      unsubscribe?.();
    };
  };

  const accept = (frames: number[][]) => {
    const next = [...repetitions, frames];
    if (next.length >= REPETITIONS) {
      setRepetitions(index, next);
      onClose();
    } else {
      setLocal(next);
      setState({ view: "ready" });
    }
  };

  const current = repetitions.length + 1;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trainer-title"
      >
        <h2 id="trainer-title">
          {t("training.trainerTitle", { name: gesture.name })}
        </h2>
        <p className="hint numeric">
          {t("calibration.repetition", {
            current,
            total: REPETITIONS,
          })}
        </p>
        {gesture.illustration && (
          <GestureIllustration
            step={gesture.illustration}
            placement={placement ?? DEFAULT_PLACEMENT}
            label={gesture.name}
          />
        )}
        <p>{t("training.instruction", { name: gesture.name })}</p>

        {state.view === "running" && (
          <div
            className={`countdown countdown-${state.phase === "hold" ? "capture" : "prepare"}`}
            aria-live="polite"
          >
            <span>
              {state.phase === "hold"
                ? t("calibration.hold")
                : t("calibration.getReady")}
            </span>
            <strong className="numeric">{state.secondsLeft}</strong>
          </div>
        )}

        {state.view === "review" &&
          (state.frames.length >= MIN_FRAMES_PER_REPETITION ? (
            <p className="result numeric">
              {t("training.captured", { count: state.frames.length })}
            </p>
          ) : (
            <p className="message" role="alert">
              {t("calibration.notEnoughData")}
            </p>
          ))}

        <div className="dialog-actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              cancel();
              onClose();
            }}
          >
            {t("calibration.cancel")}
          </button>
          {state.view === "ready" && (
            <button
              type="button"
              className="button button-primary"
              disabled={!canStream}
              onClick={run}
            >
              {t("calibration.startStep")}
            </button>
          )}
          {state.view === "review" && (
            <>
              <button
                type="button"
                className="button"
                disabled={!canStream}
                onClick={run}
              >
                {t("calibration.repeatStep")}
              </button>
              <button
                type="button"
                className="button button-primary"
                disabled={state.frames.length < MIN_FRAMES_PER_REPETITION}
                onClick={() => accept(state.frames)}
              >
                {t("calibration.acceptStep")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function setStateIfRunning(
  setState: (update: (state: TrainerState) => TrainerState) => void,
) {
  setState((state) => (state.view === "running" ? { view: "ready" } : state));
}

function GesturesCard() {
  const { t } = useTranslation();
  const gestures = useGesturesStore((state) => state.gestures);
  const add = useGesturesStore((state) => state.add);
  const remove = useGesturesStore((state) => state.remove);
  const saveFailed = useGesturesStore((state) => state.saveFailed);
  const canStream = useCanStream();
  const [training, setTraining] = useState<number | null>(null);
  const [name, setName] = useState("");

  return (
    <section className="card">
      <h2>{t("training.gesturesTitle")}</h2>
      {gestures.length === 0 ? (
        <>
          <p className="hint">{t("training.empty")}</p>
          <button
            type="button"
            className="button"
            onClick={() =>
              DEFAULT_GESTURES.forEach(({ key, illustration }) =>
                add(t(`classifier.poses.${key}`), illustration),
              )
            }
          >
            {t("training.addDefaults")}
          </button>
        </>
      ) : (
        <ul className="gesture-list">
          {gestures.map((gesture, index) => (
            <li key={`${gesture.name}-${index}`}>
              <span>{gesture.name}</span>
              <span className="hint numeric">
                {t("training.repetitionCount", {
                  count: gesture.repetitions.length,
                  total: REPETITIONS,
                })}
              </span>
              <div className="button-row">
                <button
                  type="button"
                  className="button button-small"
                  disabled={!canStream}
                  onClick={() => setTraining(index)}
                >
                  {gesture.repetitions.length > 0
                    ? t("training.retrain")
                    : t("training.train")}
                </button>
                <button
                  type="button"
                  className="button button-small"
                  onClick={() => remove(index)}
                >
                  {t("control.removeStep")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (trimmed) {
            add(trimmed, null);
            setName("");
          }
        }}
      >
        <input
          type="text"
          value={name}
          placeholder={t("training.namePlaceholder")}
          aria-label={t("training.namePlaceholder")}
          onChange={(event) => setName(event.target.value)}
        />
        <button type="submit" className="button">
          {t("training.add")}
        </button>
      </form>
      {!canStream && <p className="hint">{t("training.needsDevice")}</p>}
      {saveFailed && (
        <p className="message" role="alert">
          {t("errors.profileNotSaved")}
        </p>
      )}
      {training !== null && gestures[training] && (
        <GestureTrainer
          key={training}
          gesture={gestures[training]}
          index={training}
          onClose={() => setTraining(null)}
        />
      )}
    </section>
  );
}

function LivePrediction({ trained }: { trained: TrainedGesture[] }) {
  const { t } = useTranslation();
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const examples = useMemo(() => flattenExamples(trained), [trained]);
  const inSession = useSessionStore((state) => state.status === "connected");

  useEffect(() => {
    if (examples.length === 0) {
      return;
    }
    const smoother = new PredictionSmoother();
    return subscribeToAnalysisFrames((analysis) => {
      const result = classify(examples, extractFeatures(analysis.rms));
      if (result) {
        setPrediction({ ...result, gesture: smoother.add(result.gesture) });
      }
    });
  }, [examples]);

  const gesture = prediction ? trained[prediction.gesture] : null;

  return (
    <section className="card">
      <h2>{t("training.liveTitle")}</h2>
      {inSession && gesture && prediction ? (
        <div className="pose-display">
          {gesture.illustration ? (
            <GestureIllustration
              step={gesture.illustration}
              placement={DEFAULT_PLACEMENT}
              label={gesture.name}
            />
          ) : null}
          <strong className="pose-name">{gesture.name}</strong>
          <span className="hint numeric">
            {t("training.confidence", {
              value: Math.round(prediction.confidence * 100),
            })}
          </span>
        </div>
      ) : (
        <p className="hint">{t("training.liveEmpty")}</p>
      )}
    </section>
  );
}

function EvaluationCard({ trained }: { trained: TrainedGesture[] }) {
  const { t } = useTranslation();
  useThemeVersion();
  const evaluation = useMemo(() => evaluate(trained), [trained]);
  const dark = isDarkTheme();

  return (
    <section className="card">
      <h2>{t("training.evaluationTitle")}</h2>
      {evaluation ? (
        <>
          <p className="result numeric">
            {t("training.accuracy", {
              value: (evaluation.accuracy * 100).toFixed(0),
            })}
          </p>
          <p className="hint">{t("training.confusionCaption")}</p>
          <div className="confusion-scroll">
            <table className="confusion">
              <thead>
                <tr>
                  <th scope="col" />
                  {trained.map((gesture) => (
                    <th key={gesture.name} scope="col">
                      {gesture.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="numeric">
                {evaluation.confusion.map((row, rowIndex) => {
                  const total = row.reduce((sum, value) => sum + value, 0);
                  return (
                    <tr key={trained[rowIndex].name}>
                      <th scope="row">{trained[rowIndex].name}</th>
                      {row.map((value, columnIndex) => {
                        const share = total > 0 ? value / total : 0;
                        return (
                          <td
                            key={columnIndex}
                            style={{
                              background: rampCss(share, dark),
                              color:
                                share > 0.5 === dark ? "#111318" : "#ffffff",
                            }}
                          >
                            {Math.round(share * 100)}%
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint">{t("training.evaluationHint")}</p>
        </>
      ) : (
        <p className="hint">{t("training.evaluationEmpty")}</p>
      )}
    </section>
  );
}

export function TrainingView() {
  const gestures = useGesturesStore((state) => state.gestures);
  const load = useGesturesStore((state) => state.load);
  const trained = useMemo(
    () => gestures.filter((gesture) => gesture.repetitions.length > 0),
    [gestures],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="view-grid training-view">
      <GesturesCard />
      <LivePrediction trained={trained} />
      <EvaluationCard trained={trained} />
    </div>
  );
}
