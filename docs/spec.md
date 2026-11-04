# Galvani specification

Galvani is a desktop app that connects to a **Thalmic Labs Myo** armband, shows all the data the device offers in graphical and interactive form, and lets the user control it.

## Decisions that shape the project

- **Language:** code and documentation are in English. The UI supports English (default) and Spanish.
- **Platform:** macOS on Apple Silicon first. Windows and Linux stay possible, but they are not targets yet.
- **No vendor SDK:** North, formerly Thalmic Labs, was acquired by Google in 2020, and the official SDK and Myo Connect are no longer distributed. Galvani talks to the device directly over BLE.

## Device

- 8 sEMG sensors (8-bit ADC, values −128 to 127, up to 200 Hz).
- 9-axis IMU (orientation quaternion, accelerometer and gyroscope, about 50 Hz).
- Onboard gesture classifier, vibration motor and LEDs.
- Last known firmware: 1.5.1970. The app reads and shows the firmware version and warns when it is older.

See [protocol.md](protocol.md) for the BLE protocol and [myo-repos-github-en.md](myo-repos-github-en.md) for reference projects.

## Technical stack

- **Tauri v2** on stable Rust, with capabilities and permissions configured correctly.
- **Backend:** `btleplug` for BLE behind a `MyoTransport` trait, `tokio`, `serde`, `thiserror`, and `log` with `tauri-plugin-log`.
- **Streaming:** high-frequency data goes through `tauri::ipc::Channel` as batched binary frames at about 60 Hz, not through global events.
- **Simulated device:** `MockMyo` generates realistic synthetic EMG, IMU and events, is selectable from the UI, and allows development without hardware.
- **Frontend:** TypeScript, React and Vite.
  - Live time series: uPlot, or WebGL. No SVG-based libraries for live EMG.
  - 3D: Three.js.
  - Activation figures and heatmaps: SVG and canvas, without a chart library. Tables are virtualized.
  - State: Zustand for UI state, with circular `Float32Array` buffers outside reactive state.
  - Translations: i18next.

## Features

### 1. Connection and device management

- BLE scan filtered by the control service UUID, listing name, RSSI and peripheral ID.
- Connect, disconnect, automatic reconnection and a status indicator.
- Information panel: name, serial number, SKU, firmware (with a warning when older than 1.5.1970), hardware revision, battery and live RSSI.
- One Myo at a time. Controlling several at once is out of scope.

### Placement and calibration

- The user states which arm wears the armband, and whether the blue LED line beside the Thalmic logo points toward the wrist or the elbow.
- The calibration runs one step at a time. Each step shows an illustration of the gesture, starts when the user chooses, and ends with the user accepting or repeating it.
- A guided calibration measures the resting noise and fist strength per channel, the strongest channel for each wrist gesture, the band direction with the arm hanging, and a reference posture with the arm forward.
- One placement and calibration are stored locally, as summary values and not recordings.

### Tray and background mode

- A menu bar icon opens or quits the app. Closing the window keeps it running, and the session with the armband stays up.
- Notifications warn about a low battery and lost connections.

### 2. Interactive control

- Live EMG, IMU and classifier mode selectors.
- Vibration: short, medium and long buttons, and a visual Vibrate2 pattern editor with a timeline of draggable steps.
- Lock and unlock, sleep mode, and deep sleep with confirmation.
- Experimental LEDs with a color picker.

### 3. EMG visualizations

- 8-channel live oscilloscope (stacked and overlaid) with pause, zoom, adjustable time window and scale.
- Spatial armband map: the 8 electrodes around the forearm, colored by real-time RMS.
- Channel × time heatmap.
- Per-channel activation radar chart.
- Frequency spectrum (FFT) and spectrogram per channel.
- Per-channel metrics with live bars: RMS, MAV, peak and zero crossings.
- Configurable envelope and filters: band-pass, and notch at 50 Hz (Europe) or 60 Hz.

### 4. IMU and spatial visualizations

- Forearm and armband 3D model oriented in real time from the quaternion, with a button to recalibrate the zero orientation.
- Euler angles (roll, pitch, yaw) in instrument-style indicators and time series.
- Accelerometer and gyroscope: 3-axis time series and magnitude.
- 3D trajectory or orientation sphere: a trail of the pointing vector on a sphere.
- Animated tap events.

### 5. Gestures and events

- Classifier status panel: synced arm (left or right), orientation, lock state, and the current pose with a large icon.
- Event timeline (poses, sync, taps, lock) synchronized with the charts.
- Advanced: training custom gestures by recording labeled examples, with a kNN or similar classifier on EMG features, a confusion matrix and live prediction.

### 6. Data and tables

- Live virtualized table with the latest samples (EMG, IMU, events), with pause and filter.
- Session recording with marks and labels; export to CSV and JSON, optionally Parquet, with metadata (device, firmware, modes, date).
- Playback of recorded sessions through all the visualizations, with speed control and seek.
- Session statistics: measured sample rate, lost packets and latency.

### 7. UI and UX

- Dashboard layout with resizable, rearrangeable panels and saved layouts.
- Light and dark themes.
- Target performance: smooth 60 fps UI with EMG at 200 Hz and IMU at 50 Hz.

## Non-functional requirements

- `cargo clippy` and `cargo fmt` without warnings; ESLint and Prettier on the frontend.
- Unit tests for the protocol and DSP in Rust, and tests for key frontend components.
- Robust error handling, with clear messages when the BLE adapter is off, permissions are missing or the device disconnects.
- Documented platform permissions, starting with `NSBluetoothAlwaysUsageDescription` on macOS.
- A README covering installation, build, usage, architecture and known limitations.
- A notice in the app and README: sEMG data can be identifying, so recordings should not be shared without consent.

## Phases

1. **Skeleton:** Tauri v2 and frontend setup, `protocol.rs` with tests, simulated device, EMG oscilloscope with mock data through a Channel.
2. **Real BLE:** scan, connection with btleplug, reading information, firmware and battery, set mode, keep-alive, EMG and IMU streaming.
3. **Visualizations:** spatial map, 3D, FFT, radar, heatmap, metrics and live table.
4. **Control and events:** vibration and Vibrate2 editor, lock and unlock, classifier, event timeline.
5. **Data:** recording, export and playback.
6. **Advanced:** gesture training and experimental LEDs.

A Bluegiga BLED112 dongle transport was part of the original brief. It is out of scope for now, and `MyoTransport` leaves room to add it later.

## Acceptance criteria

- The app builds and works in simulated mode without hardware.
- With a real Myo, it connects, shows firmware and battery, stays connected for more than 10 minutes, and receives EMG at about 200 Hz and IMU at about 50 Hz, showing the measured rate.
- The 3D model follows arm movement without perceptible delay.
- Exported recordings play back in the app with identical visualizations.

## Working agreements

- When a protocol detail is unclear, check `myohw.h` and pyomyo and document the decision. Don't invent values.
- Each delivery states what is done, what is missing and how to test it.
- Ask before making major scope decisions, such as the recording format.
