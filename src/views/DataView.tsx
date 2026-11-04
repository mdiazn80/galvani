import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { describeEvent } from "../lib/describeEvent";
import {
  emgBuffer,
  eventLog,
  imuBuffer,
  type LoggedEvent,
} from "../lib/stream";
import {
  EMG_CHANNELS,
  EMG_RATE_HZ,
  IMU_FIELDS,
  IMU_RATE_HZ,
} from "../lib/types";
import { useSessionStore } from "../stores/session";

const ROW_HEIGHT = 26;
const OVERSCAN_ROWS = 8;
const REFRESH_INTERVAL_MS = 250;

type DataKind = "emg" | "imu" | "events";

interface TableData {
  columns: string[];
  rows: string[][];
}

/** Reads the latest values of a buffer as rows of text, newest first. */
function readRows(
  buffer: typeof emgBuffer,
  fields: number,
  rate: number,
  decimals: number,
): string[][] {
  const count = buffer.length;
  const columns = Array.from({ length: fields }, () => new Float32Array(count));
  columns.forEach((column, field) => buffer.copyLatest(field, count, column));

  return Array.from({ length: count }, (_, rowIndex) => {
    const index = count - 1 - rowIndex;
    return [
      (rowIndex / rate).toFixed(3),
      ...columns.map((column) => column[index].toFixed(decimals)),
    ];
  });
}

export function DataView() {
  const { t, i18n } = useTranslation();
  const paused = useSessionStore((state) => state.paused);
  const [kind, setKind] = useState<DataKind>("emg");
  const [hideRssi, setHideRssi] = useState(true);
  const [data, setData] = useState<TableData>({ columns: [], rows: [] });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const refresh = () => {
      const channel = (number: number) =>
        i18n.t("oscilloscope.channel", { number });
      const age = i18n.t("data.age");

      if (kind === "emg") {
        setData({
          columns: [
            age,
            ...Array.from({ length: EMG_CHANNELS }, (_, index) =>
              channel(index + 1),
            ),
          ],
          rows: readRows(emgBuffer, EMG_CHANNELS, EMG_RATE_HZ, 0),
        });
      } else if (kind === "imu") {
        setData({
          columns: [
            age,
            "qw",
            "qx",
            "qy",
            "qz",
            "ax (g)",
            "ay (g)",
            "az (g)",
            "gx (°/s)",
            "gy (°/s)",
            "gz (°/s)",
          ],
          rows: readRows(imuBuffer, IMU_FIELDS, IMU_RATE_HZ, 3),
        });
      } else {
        const visible = (entry: LoggedEvent) =>
          !hideRssi || entry.event.kind !== "rssi";
        setData({
          columns: [
            i18n.t("data.time"),
            i18n.t("data.event"),
            i18n.t("data.detail"),
          ],
          rows: eventLog
            .filter(visible)
            .map((entry) => [
              entry.time.toLocaleTimeString(i18n.language),
              ...describeEvent(entry.event, i18n.t),
            ]),
        });
      }
    };

    refresh();
    if (paused) {
      return;
    }
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [kind, hideRssi, paused, i18n, i18n.language]);

  const firstRow = Math.max(
    Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS,
    0,
  );
  const lastRow = Math.min(
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS,
    data.rows.length,
  );

  return (
    <section className="card fill data-view">
      <header className="toolbar">
        <h2>{t("data.title")}</h2>
        <div className="toolbar-controls">
          {kind === "events" && (
            <label className="field-inline">
              <input
                type="checkbox"
                checked={hideRssi}
                onChange={(event) => setHideRssi(event.target.checked)}
              />
              {t("data.hideRssi")}
            </label>
          )}
          <label className="field-inline">
            {t("data.show")}
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as DataKind);
                setScrollTop(0);
              }}
            >
              <option value="emg">EMG</option>
              <option value="imu">IMU</option>
              <option value="events">{t("data.events")}</option>
            </select>
          </label>
          <span className="hint numeric">
            {t("data.rowCount", { count: data.rows.length })}
          </span>
        </div>
      </header>

      <div
        className="data-scroll"
        ref={(element) => {
          if (element && element.clientHeight !== viewportHeight) {
            setViewportHeight(element.clientHeight);
          }
        }}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <table className="data-table numeric">
          <thead>
            <tr>
              {data.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: firstRow * ROW_HEIGHT }} aria-hidden="true" />
            {data.rows.slice(firstRow, lastRow).map((row, index) => (
              <tr key={firstRow + index} style={{ height: ROW_HEIGHT }}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
            <tr
              style={{ height: (data.rows.length - lastRow) * ROW_HEIGHT }}
              aria-hidden="true"
            />
          </tbody>
        </table>
        {data.rows.length === 0 && (
          <p className="view-empty">{t("views.empty")}</p>
        )}
      </div>
    </section>
  );
}
