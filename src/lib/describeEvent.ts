import type { SessionEvent } from "./types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Name and detail of an event, for lists. */
export function describeEvent(
  event: SessionEvent,
  t: Translate,
): [string, string] {
  switch (event.kind) {
    case "classifier": {
      const inner = event.event;
      switch (inner.type) {
        case "pose":
          return [t("data.pose"), t(`classifier.poses.${inner.pose}`)];
        case "armSynced":
          return [t("data.armSynced"), t(`classifier.arms.${inner.arm}`)];
        case "armUnsynced":
          return [t("data.armUnsynced"), ""];
        case "locked":
          return [t("classifier.lock"), t("classifier.locked")];
        case "unlocked":
          return [t("classifier.lock"), t("classifier.unlocked")];
        case "syncFailed":
          return [t("data.syncFailed"), String(inner.result)];
        case "unknown":
          return [t("data.unknownEvent"), String(inner.rawType)];
      }
      break;
    }
    case "motion":
      return event.event.type === "tap"
        ? [
            t("data.tap"),
            t("data.tapDetail", {
              count: event.event.count,
              direction: event.event.direction,
            }),
          ]
        : [t("data.unknownEvent"), String(event.event.rawType)];
    case "battery":
      return [t("device.battery"), `${event.level}%`];
    case "rssi":
      return [t("device.rssi"), t("device.rssiValue", { value: event.value })];
    case "reconnecting":
      return [t("device.status.reconnecting"), ""];
    case "reconnected":
      return [t("device.status.connected"), ""];
    case "disconnected":
      return [t("device.status.disconnected"), ""];
    case "mark":
      return [t("data.mark"), event.label];
  }
}

/** Short label for the event timeline, or `null` if the event doesn't belong on it. */
export function timelineLabel(
  event: SessionEvent,
  t: Translate,
): string | null {
  if (event.kind === "mark") {
    return event.label;
  }
  if (event.kind === "motion") {
    return event.event.type === "tap" ? t("data.tap") : null;
  }
  if (event.kind !== "classifier") {
    return null;
  }
  const inner = event.event;
  switch (inner.type) {
    case "pose":
      return t(`classifier.poses.${inner.pose}`);
    case "armSynced":
      return t("data.armSynced");
    case "armUnsynced":
      return t("data.armUnsynced");
    case "locked":
      return t("classifier.locked");
    case "unlocked":
      return t("classifier.unlocked");
    case "syncFailed":
      return t("data.syncFailed");
    case "unknown":
      return null;
  }
}
