import { useSyncExternalStore } from "react";
import { decodeAnalysis, type Analysis } from "./analysis";
import { decodeFrame, type Frame } from "./frames";
import { RateMeter } from "./rateMeter";
import { MultiChannelRingBuffer } from "./ringBuffer";
import {
  EMG_CHANNELS,
  EMG_RATE_HZ,
  IMU_FIELDS,
  IMU_RATE_HZ,
  type SessionEvent,
} from "./types";

export const MAX_WINDOW_SECONDS = 10;
export const ANALYSIS_RATE_HZ = 10;
export const ANALYSIS_HISTORY_SECONDS = 30;
export const ANALYSIS_HISTORY_LENGTH =
  ANALYSIS_RATE_HZ * ANALYSIS_HISTORY_SECONDS;
export const SPECTRUM_BINS = 129;
const MAX_LOGGED_EVENTS = 500;

// High-frequency data lives here rather than in React state, so that incoming samples
// don't trigger renders. Charts read it on their own animation frames.
export const emgBuffer = new MultiChannelRingBuffer(
  EMG_CHANNELS,
  EMG_RATE_HZ * MAX_WINDOW_SECONDS,
);
export const imuBuffer = new MultiChannelRingBuffer(
  IMU_FIELDS,
  IMU_RATE_HZ * MAX_WINDOW_SECONDS,
);
export const rmsHistory = new MultiChannelRingBuffer(
  EMG_CHANNELS,
  ANALYSIS_HISTORY_LENGTH,
);
export const spectrumHistory = new MultiChannelRingBuffer(
  EMG_CHANNELS * SPECTRUM_BINS,
  ANALYSIS_HISTORY_LENGTH,
);
export const emgRate = new RateMeter();
export const imuRate = new RateMeter();

export interface LoggedEvent {
  time: Date;
  event: SessionEvent;
  /** Count of EMG samples received so far, which places it exactly on the EMG charts. */
  emgIndex: number;
}

/** Newest first. */
export const eventLog: LoggedEvent[] = [];

export function logEvent(event: SessionEvent): void {
  eventLog.unshift({
    time: new Date(),
    event,
    emgIndex: emgBuffer.totalWritten,
  });
  eventLog.length = Math.min(eventLog.length, MAX_LOGGED_EVENTS);
}

const frameListeners = new Set<(frame: Frame) => void>();

/** Calls `listener` with every incoming frame until the returned function is called. */
export function subscribeToFrames(
  listener: (frame: Frame) => void,
): () => void {
  frameListeners.add(listener);
  return () => frameListeners.delete(listener);
}

export function ingestFrame(buffer: ArrayBuffer): void {
  const frame = decodeFrame(buffer);
  frameListeners.forEach((listener) => listener(frame));
  const now = performance.now();
  emgBuffer.pushInterleaved(frame.emg);
  imuBuffer.pushInterleaved(frame.imu);
  emgRate.add(frame.emgSamples, now);
  imuRate.add(frame.imuSamples, now);
}

let latestAnalysis: Analysis | null = null;
let analysisVersion = 0;
let frozen = false;
const analysisListeners = new Set<() => void>();

function notifyAnalysisListeners() {
  analysisVersion++;
  analysisListeners.forEach((listener) => listener());
}

const analysisFrameListeners = new Set<(analysis: Analysis) => void>();

/** Calls `listener` with every analysis, also while the views are paused. */
export function subscribeToAnalysisFrames(
  listener: (analysis: Analysis) => void,
): () => void {
  analysisFrameListeners.add(listener);
  return () => analysisFrameListeners.delete(listener);
}

export function ingestAnalysis(buffer: ArrayBuffer): void {
  const analysis = decodeAnalysis(buffer);
  analysisFrameListeners.forEach((listener) => listener(analysis));
  rmsHistory.pushInterleaved(analysis.rms);
  spectrumHistory.pushInterleaved(analysis.spectra);
  // While paused, views keep showing the last analysis they received.
  if (!frozen) {
    latestAnalysis = analysis;
    notifyAnalysisListeners();
  }
}

/** Stops the analysis views from updating, while data keeps being collected. */
export function setStreamFrozen(value: boolean): void {
  frozen = value;
}

function subscribeToAnalysis(listener: () => void): () => void {
  analysisListeners.add(listener);
  return () => analysisListeners.delete(listener);
}

/** The latest analysis, updating the calling component about 10 times per second. */
export function useLatestAnalysis(): Analysis | null {
  return useSyncExternalStore(subscribeToAnalysis, () => latestAnalysis);
}

export function useAnalysisVersion(): number {
  return useSyncExternalStore(subscribeToAnalysis, () => analysisVersion);
}

export function resetStream(): void {
  emgBuffer.clear();
  imuBuffer.clear();
  rmsHistory.clear();
  spectrumHistory.clear();
  emgRate.clear();
  imuRate.clear();
  eventLog.length = 0;
  frozen = false;
  latestAnalysis = null;
  notifyAnalysisListeners();
}
