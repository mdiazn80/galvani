//! A live session with a Myo: configures it, parses its notifications, and forwards them
//! to a sink, batching the high-frequency samples into binary frames. It also restores
//! the connection when the device drops it.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval, sleep, timeout};

use super::dsp::Analyzer;
use super::protocol::{
    ClassifierEvent, ClassifierMode, Command, EMG_CHANNELS, EmgMode, FirmwareVersion, ImuMode,
    ImuSample, LATEST_KNOWN_FIRMWARE, MotionEvent, MyoInfo, SleepMode, parse_battery, parse_emg,
};
use super::recorder::{Recorder, RecordingError, RecordingMetadata};
use super::transport::{MyoTransport, Notification, Source, TransportError};

const FRAME_INTERVAL: Duration = Duration::from_millis(16);
const FRAME_VERSION: u8 = 1;
const FRAME_HEADER_LEN: usize = 8;
const IMU_FIELDS: usize = 10;
const RSSI_INTERVAL: Duration = Duration::from_secs(5);
/// Notifications aren't guaranteed, and regular readings show which way the level is going.
const BATTERY_INTERVAL: Duration = Duration::from_secs(60);
const STATS_INTERVAL: Duration = Duration::from_secs(60);
const ANALYSIS_INTERVAL: Duration = Duration::from_millis(100);
const RECONNECT_ATTEMPTS: u32 = 5;
const RECONNECT_DELAY: Duration = Duration::from_secs(2);
const GOODBYE_TIMEOUT: Duration = Duration::from_secs(2);

/// What the device should stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamModes {
    pub emg: EmgMode,
    pub imu: ImuMode,
    pub classifier: ClassifierMode,
}

impl StreamModes {
    fn command(self) -> Command {
        Command::SetMode {
            emg: self.emg,
            imu: self.imu,
            classifier: self.classifier,
        }
    }
}

impl Default for StreamModes {
    fn default() -> Self {
        Self {
            emg: EmgMode::Filtered,
            imu: ImuMode::All,
            classifier: ClassifierMode::Enabled,
        }
    }
}

/// Settings to apply to the device on every connection, including after a reconnection.
#[derive(Debug, Clone, Copy)]
struct DeviceConfig {
    modes: StreamModes,
    sleep: SleepMode,
}

impl Default for DeviceConfig {
    fn default() -> Self {
        Self {
            modes: StreamModes::default(),
            sleep: SleepMode::NeverSleep,
        }
    }
}

/// Device details shown to the user when a session starts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceDetails {
    pub name: String,
    pub info: MyoInfo,
    pub firmware: FirmwareVersion,
    pub firmware_outdated: bool,
    pub battery: u8,
}

/// Low-frequency events, sent as JSON.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SessionEvent {
    Classifier {
        event: ClassifierEvent,
    },
    Motion {
        event: MotionEvent,
    },
    Battery {
        level: u8,
    },
    Rssi {
        value: i16,
    },
    Reconnecting,
    Reconnected,
    Disconnected,
    /// A label in a recording being played back.
    Mark {
        label: String,
    },
}

/// Receives the output of a session. It returns `false` when the receiver is gone.
pub trait SessionSink: Send + 'static {
    fn send_frame(&mut self, frame: Vec<u8>) -> bool;
    fn send_analysis(&mut self, frame: Vec<u8>) -> bool;
    fn send_event(&mut self, event: SessionEvent) -> bool;
}

/// Samples waiting to be sent, encoded as one binary frame.
///
/// All values are little-endian. Layout:
/// - Header: version (`u8`), EMG channels (`u8`), EMG sample count (`u16`), IMU sample
///   count (`u16`), reserved (2 bytes).
/// - EMG: `i8` values ordered by sample and then channel.
/// - Padding: zeros up to a 4-byte boundary.
/// - IMU: `f32` values in the order orientation (`w, x, y, z`), accelerometer, gyroscope.
#[derive(Default)]
struct FrameBuilder {
    emg: Vec<i8>,
    imu: Vec<ImuSample>,
}

impl FrameBuilder {
    fn is_empty(&self) -> bool {
        self.emg.is_empty() && self.imu.is_empty()
    }

    fn take_frame(&mut self) -> Vec<u8> {
        let emg_samples = self.emg.len() / EMG_CHANNELS;
        let imu_samples = self.imu.len();
        let emg_end = FRAME_HEADER_LEN + self.emg.len();
        let imu_start = emg_end.next_multiple_of(4);

        let mut frame = Vec::with_capacity(imu_start + imu_samples * IMU_FIELDS * 4);
        frame.push(FRAME_VERSION);
        frame.push(EMG_CHANNELS as u8);
        frame.extend_from_slice(&(emg_samples as u16).to_le_bytes());
        frame.extend_from_slice(&(imu_samples as u16).to_le_bytes());
        frame.extend_from_slice(&[0, 0]);
        frame.extend(self.emg.iter().map(|value| *value as u8));
        frame.resize(imu_start, 0);
        for sample in &self.imu {
            let values = sample
                .orientation
                .iter()
                .chain(&sample.accelerometer)
                .chain(&sample.gyroscope);
            for value in values {
                frame.extend_from_slice(&value.to_le_bytes());
            }
        }

        self.emg.clear();
        self.imu.clear();
        frame
    }
}

/// Traffic counters, logged periodically to help validate real hardware.
#[derive(Default)]
struct StreamStats {
    emg_notifications: [u32; 4],
    imu_samples: u32,
    invalid_packets: u32,
    orientation_norm: f32,
}

impl StreamStats {
    fn log_and_reset(&mut self) {
        let seconds = STATS_INTERVAL.as_secs_f32();
        let notifications: u32 = self.emg_notifications.iter().sum();
        log::info!(
            "Stream: EMG {:.1} Hz, per characteristic {:?}, IMU {:.1} Hz, quaternion norm {:.3}, invalid packets {}",
            (notifications * 2) as f32 / seconds,
            self.emg_notifications,
            self.imu_samples as f32 / seconds,
            self.orientation_norm,
            self.invalid_packets,
        );
        *self = Self::default();
    }
}

/// Handle to a running session.
pub struct Session {
    transport: Arc<dyn MyoTransport>,
    config: Arc<Mutex<DeviceConfig>>,
    details: DeviceDetails,
    recorder: Arc<Mutex<Option<Recorder>>>,
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}

impl Session {
    /// Reads the device details, configures streaming and starts forwarding to `sink`.
    pub async fn start(
        transport: Arc<dyn MyoTransport>,
        sink: impl SessionSink,
    ) -> Result<(Self, DeviceDetails), TransportError> {
        let firmware = transport.read_firmware().await?;
        let details = DeviceDetails {
            name: transport.name().to_owned(),
            info: transport.read_info().await?,
            firmware,
            firmware_outdated: firmware.is_older_than(&LATEST_KNOWN_FIRMWARE),
            battery: transport.read_battery().await?,
        };

        let config = Arc::new(Mutex::new(DeviceConfig::default()));
        let notifications = configure(transport.as_ref(), &config).await?;
        let (stop, stopped) = oneshot::channel();
        let recorder = Arc::new(Mutex::new(None));
        let task = tokio::spawn(forward(
            Arc::clone(&transport),
            Arc::clone(&config),
            Arc::clone(&recorder),
            notifications,
            sink,
            stopped,
        ));
        let session = Self {
            transport,
            config,
            details: details.clone(),
            recorder,
            stop: Some(stop),
            task,
        };
        Ok((session, details))
    }

    /// Sends a one-off command, such as a vibration.
    pub async fn send(&self, command: Command) -> Result<(), TransportError> {
        self.transport.send_command(command).await
    }

    /// Changes what the device streams, including after any later reconnection.
    pub async fn set_modes(&self, modes: StreamModes) -> Result<(), TransportError> {
        self.transport.send_command(modes.command()).await?;
        self.config.lock().expect("config lock poisoned").modes = modes;
        Ok(())
    }

    /// Changes the sleep mode, including after any later reconnection.
    pub async fn set_sleep_mode(&self, sleep: SleepMode) -> Result<(), TransportError> {
        self.transport
            .send_command(Command::SetSleepMode(sleep))
            .await?;
        self.config.lock().expect("config lock poisoned").sleep = sleep;
        Ok(())
    }

    /// The details the session started with, for describing a recording.
    pub fn details(&self) -> &DeviceDetails {
        &self.details
    }

    pub fn is_recording(&self) -> bool {
        self.recorder
            .lock()
            .expect("recorder lock poisoned")
            .is_some()
    }

    /// Records everything from now on. It runs inside the session, so it keeps going while
    /// the window is hidden.
    pub fn start_recording(&self, recorder: Recorder) {
        *self.recorder.lock().expect("recorder lock poisoned") = Some(recorder);
    }

    pub fn stop_recording(&self) -> Result<Option<RecordingMetadata>, RecordingError> {
        let recorder = self.recorder.lock().expect("recorder lock poisoned").take();
        recorder.map(Recorder::finish).transpose()
    }

    /// Adds a label to the recording at the current moment.
    pub fn add_mark(&self, label: &str) -> Result<(), RecordingError> {
        if let Some(recorder) = self
            .recorder
            .lock()
            .expect("recorder lock poisoned")
            .as_mut()
        {
            recorder.record(&Notification {
                source: Source::Mark,
                data: label.as_bytes().to_vec(),
            })?;
        }
        Ok(())
    }

    fn finish_recording(&self) {
        match self.stop_recording() {
            Ok(Some(metadata)) => log::info!("Saved recording {}", metadata.id),
            Ok(None) => {}
            Err(error) => log::error!("Could not finish the recording: {error}"),
        }
    }

    async fn stop_forwarding(&mut self) {
        self.finish_recording();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Err(error) = (&mut self.task).await {
            log::warn!("Session task ended abnormally: {error}");
        }
    }

    /// Puts the device into deep sleep and ends the session.
    pub async fn deep_sleep(mut self) -> Result<(), TransportError> {
        self.stop_forwarding().await;
        self.transport.send_command(Command::DeepSleep).await?;
        self.transport.disconnect().await
    }

    /// Stops forwarding, returns the device to its normal state and disconnects from it.
    pub async fn stop(mut self) -> Result<(), TransportError> {
        self.stop_forwarding().await;

        // The device may already be gone, so a failure here isn't an error.
        let goodbye = async {
            self.transport
                .send_command(Command::SetMode {
                    emg: EmgMode::None,
                    imu: ImuMode::None,
                    classifier: ClassifierMode::Disabled,
                })
                .await?;
            self.transport
                .send_command(Command::SetSleepMode(SleepMode::Normal))
                .await
        };
        match timeout(GOODBYE_TIMEOUT, goodbye).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => log::debug!("Could not reset the device: {error}"),
            Err(_) => log::debug!("Timed out resetting the device"),
        }
        self.transport.disconnect().await
    }
}

/// Subscribes to the device's data and starts streaming. Sleep mode comes first because,
/// according to pyomyo, the Myo otherwise disconnects after about 30 seconds.
async fn configure(
    transport: &dyn MyoTransport,
    config: &Mutex<DeviceConfig>,
) -> Result<mpsc::Receiver<Notification>, TransportError> {
    let config = *config.lock().expect("config lock poisoned");
    let notifications = transport.subscribe().await?;
    transport
        .send_command(Command::SetSleepMode(config.sleep))
        .await?;
    transport.send_command(config.modes.command()).await?;
    Ok(notifications)
}

async fn forward(
    transport: Arc<dyn MyoTransport>,
    config: Arc<Mutex<DeviceConfig>>,
    recorder: Arc<Mutex<Option<Recorder>>>,
    notifications: mpsc::Receiver<Notification>,
    sink: impl SessionSink,
    stopped: oneshot::Receiver<()>,
) {
    let (reading_sender, readings) = mpsc::channel(1);
    let monitor_transport = Arc::clone(&transport);
    // In its own task because a read can take a while, and shouldn't hold up the samples.
    let monitor = tokio::spawn(async move {
        let mut rssi_ticker = interval(RSSI_INTERVAL);
        rssi_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut battery_ticker = interval(BATTERY_INTERVAL);
        battery_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            let reading = tokio::select! {
                _ = rssi_ticker.tick() => {
                    monitor_transport.read_rssi().await.map(|value| SessionEvent::Rssi { value })
                }
                _ = battery_ticker.tick() => {
                    monitor_transport.read_battery().await.map(|level| SessionEvent::Battery { level })
                }
            };
            match reading {
                Ok(event) => {
                    if reading_sender.send(event).await.is_err() {
                        return;
                    }
                }
                Err(error) => log::debug!("Could not read from the device: {error}"),
            }
        }
    });

    run_stream(
        transport,
        config,
        recorder,
        notifications,
        readings,
        sink,
        stopped,
    )
    .await;
    monitor.abort();
}

async fn run_stream(
    transport: Arc<dyn MyoTransport>,
    config: Arc<Mutex<DeviceConfig>>,
    recorder: Arc<Mutex<Option<Recorder>>>,
    mut notifications: mpsc::Receiver<Notification>,
    mut readings: mpsc::Receiver<SessionEvent>,
    mut sink: impl SessionSink,
    mut stopped: oneshot::Receiver<()>,
) {
    let mut builder = FrameBuilder::default();
    let mut stats = StreamStats::default();
    let mut frame_ticker = interval(FRAME_INTERVAL);
    frame_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut stats_ticker = interval(STATS_INTERVAL);
    stats_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    stats_ticker.tick().await;
    let mut analyzer = Analyzer::new();
    let mut analysis_ticker = interval(ANALYSIS_INTERVAL);
    analysis_ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = &mut stopped => return,
            _ = frame_ticker.tick() => {
                if !builder.is_empty() && !sink.send_frame(builder.take_frame()) {
                    return;
                }
            }
            _ = stats_ticker.tick() => stats.log_and_reset(),
            _ = analysis_ticker.tick() => {
                if analyzer.has_new_data() && !sink.send_analysis(analyzer.encode_frame()) {
                    return;
                }
            }
            Some(event) = readings.recv() => {
                if !sink.send_event(event) {
                    return;
                }
            }
            notification = notifications.recv() => {
                let Some(notification) = notification else {
                    if !builder.is_empty() {
                        sink.send_frame(builder.take_frame());
                    }
                    sink.send_event(SessionEvent::Reconnecting);
                    match restore_connection(transport.as_ref(), &config, &mut stopped).await {
                        Restored::Yes(restored) => {
                            notifications = restored;
                            log::info!("Reconnected");
                            sink.send_event(SessionEvent::Reconnected);
                        }
                        Restored::GaveUp => {
                            log::warn!("Gave up reconnecting");
                            sink.send_event(SessionEvent::Disconnected);
                            return;
                        }
                        Restored::Stopped => return,
                    }
                    continue;
                };
                record(&recorder, &notification);
                if !handle(notification, &mut builder, &mut analyzer, &mut stats, &mut sink) {
                    return;
                }
            }
        }
    }
}

enum Restored {
    Yes(mpsc::Receiver<Notification>),
    GaveUp,
    Stopped,
}

async fn restore_connection(
    transport: &dyn MyoTransport,
    config: &Mutex<DeviceConfig>,
    stopped: &mut oneshot::Receiver<()>,
) -> Restored {
    for number in 1..=RECONNECT_ATTEMPTS {
        tokio::select! {
            _ = &mut *stopped => return Restored::Stopped,
            _ = sleep(RECONNECT_DELAY) => {}
        }
        let attempt = async {
            transport.reconnect().await?;
            configure(transport, config).await
        };
        tokio::select! {
            _ = &mut *stopped => return Restored::Stopped,
            result = attempt => match result {
                Ok(notifications) => return Restored::Yes(notifications),
                Err(error) => log::warn!("Reconnection attempt {number} failed: {error}"),
            },
        }
    }
    Restored::GaveUp
}

/// A failing disk shouldn't end the session, so the recording stops instead.
fn record(recorder: &Mutex<Option<Recorder>>, notification: &Notification) {
    let mut recorder = recorder.lock().expect("recorder lock poisoned");
    if let Some(active) = recorder.as_mut()
        && let Err(error) = active.record(notification)
    {
        log::error!("Stopping the recording {}: {error}", active.id());
        *recorder = None;
    }
}

/// Parses one notification. Malformed payloads are logged and dropped, because a single
/// bad packet shouldn't end the session. It returns `false` when the sink is gone.
fn handle(
    notification: Notification,
    builder: &mut FrameBuilder,
    analyzer: &mut Analyzer,
    stats: &mut StreamStats,
    sink: &mut impl SessionSink,
) -> bool {
    let data = &notification.data;
    let event = match notification.source {
        Source::Emg(index) => {
            match parse_emg(data) {
                Ok(samples) => {
                    builder.emg.extend(samples.iter().flatten());
                    for sample in &samples {
                        analyzer.push(sample);
                    }
                    stats.emg_notifications[usize::from(index)] += 1;
                }
                Err(error) => {
                    stats.invalid_packets += 1;
                    log::warn!("Dropped EMG packet: {error}");
                }
            }
            return true;
        }
        Source::Imu => {
            match ImuSample::parse(data) {
                Ok(sample) => {
                    stats.imu_samples += 1;
                    stats.orientation_norm = sample
                        .orientation
                        .iter()
                        .map(|value| value * value)
                        .sum::<f32>()
                        .sqrt();
                    builder.imu.push(sample);
                }
                Err(error) => {
                    stats.invalid_packets += 1;
                    log::warn!("Dropped IMU packet: {error}");
                }
            }
            return true;
        }
        Source::Motion => MotionEvent::parse(data).map(|event| SessionEvent::Motion { event }),
        Source::Classifier => {
            ClassifierEvent::parse(data).map(|event| SessionEvent::Classifier { event })
        }
        Source::Battery => parse_battery(data).map(|level| SessionEvent::Battery { level }),
        Source::Mark => Ok(SessionEvent::Mark {
            label: String::from_utf8_lossy(data).into_owned(),
        }),
    };

    match event {
        Ok(event) => {
            log::debug!("Event: {event:?}");
            sink.send_event(event)
        }
        Err(error) => {
            stats.invalid_packets += 1;
            log::warn!("Dropped event: {error}");
            true
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicU32, Ordering};

    use async_trait::async_trait;

    use super::*;
    use crate::myo::protocol::{Arm, HardwareRev, Pose, Sku, XDirection};
    use crate::myo::transport::mock::MockTransport;

    #[derive(Clone, Default)]
    struct RecordingSink {
        frames: Arc<Mutex<Vec<Vec<u8>>>>,
        analysis: Arc<Mutex<Vec<Vec<u8>>>>,
        events: Arc<Mutex<Vec<SessionEvent>>>,
    }

    impl RecordingSink {
        fn has_event(&self, matches: impl Fn(&SessionEvent) -> bool) -> bool {
            self.events.lock().unwrap().iter().any(matches)
        }
    }

    impl SessionSink for RecordingSink {
        fn send_frame(&mut self, frame: Vec<u8>) -> bool {
            self.frames.lock().unwrap().push(frame);
            true
        }

        fn send_analysis(&mut self, frame: Vec<u8>) -> bool {
            self.analysis.lock().unwrap().push(frame);
            true
        }

        fn send_event(&mut self, event: SessionEvent) -> bool {
            self.events.lock().unwrap().push(event);
            true
        }
    }

    /// Scripted transport whose connection can be dropped from a test.
    #[derive(Default)]
    struct FlakyTransport {
        commands: Mutex<Vec<Command>>,
        subscriptions: AtomicU32,
        reconnects: AtomicU32,
        failing_reconnects: u32,
        current: Mutex<Option<mpsc::Sender<Notification>>>,
    }

    impl FlakyTransport {
        fn drop_connection(&self) {
            self.current.lock().unwrap().take();
        }
    }

    #[async_trait]
    impl MyoTransport for FlakyTransport {
        fn name(&self) -> &str {
            "Flaky"
        }

        async fn read_info(&self) -> Result<MyoInfo, TransportError> {
            Ok(MyoInfo {
                serial_number: [0; 6],
                unlock_pose: Pose::Rest,
                active_classifier_type: 0,
                active_classifier_index: 0,
                has_custom_classifier: false,
                stream_indicating: false,
                sku: Sku::Unknown,
            })
        }

        async fn read_firmware(&self) -> Result<FirmwareVersion, TransportError> {
            Ok(FirmwareVersion {
                major: 1,
                minor: 1,
                patch: 0,
                hardware_rev: HardwareRev::Unknown,
            })
        }

        async fn read_battery(&self) -> Result<u8, TransportError> {
            Ok(50)
        }

        async fn read_rssi(&self) -> Result<i16, TransportError> {
            Err(TransportError::Disconnected)
        }

        async fn send_command(&self, command: Command) -> Result<(), TransportError> {
            self.commands.lock().unwrap().push(command);
            Ok(())
        }

        async fn subscribe(&self) -> Result<mpsc::Receiver<Notification>, TransportError> {
            let (sender, receiver) = mpsc::channel(8);
            *self.current.lock().unwrap() = Some(sender);
            self.subscriptions.fetch_add(1, Ordering::SeqCst);
            Ok(receiver)
        }

        async fn reconnect(&self) -> Result<(), TransportError> {
            let attempt = self.reconnects.fetch_add(1, Ordering::SeqCst);
            if attempt < self.failing_reconnects {
                Err(TransportError::TimedOut)
            } else {
                Ok(())
            }
        }

        async fn disconnect(&self) -> Result<(), TransportError> {
            Ok(())
        }
    }

    fn sample_counts(frames: &[Vec<u8>]) -> (usize, usize) {
        frames.iter().fold((0, 0), |(emg, imu), frame| {
            (
                emg + usize::from(u16::from_le_bytes([frame[2], frame[3]])),
                imu + usize::from(u16::from_le_bytes([frame[4], frame[5]])),
            )
        })
    }

    #[test]
    fn encodes_frames_with_aligned_imu_data() {
        let mut builder = FrameBuilder::default();
        builder.emg.extend([1, -1, 2, -2, 3, -3, 4, -4]);
        builder.imu.push(ImuSample {
            orientation: [1.0, 0.0, 0.0, 0.0],
            accelerometer: [0.0, 0.0, 1.0],
            gyroscope: [0.0, 0.0, 2.5],
        });
        let frame = builder.take_frame();

        assert_eq!(&frame[..8], [1, 8, 1, 0, 1, 0, 0, 0]);
        assert_eq!(&frame[8..16], [1, 255, 2, 254, 3, 253, 4, 252]);
        assert_eq!(frame.len(), 16 + 40);
        assert_eq!(&frame[16..20], 1.0f32.to_le_bytes());
        assert_eq!(&frame[52..56], 2.5f32.to_le_bytes());
        assert!(builder.is_empty());
    }

    #[test]
    fn pads_the_emg_section_to_a_four_byte_boundary() {
        let mut builder = FrameBuilder::default();
        builder.emg.extend([0i8; 9]);
        builder.imu.push(ImuSample {
            orientation: [1.0, 0.0, 0.0, 0.0],
            accelerometer: [0.0; 3],
            gyroscope: [0.0; 3],
        });
        let frame = builder.take_frame();
        assert_eq!(frame.len(), 20 + 40);
        assert_eq!(&frame[20..24], 1.0f32.to_le_bytes());
    }

    #[test]
    fn drops_malformed_packets_without_ending_the_session() {
        let mut builder = FrameBuilder::default();
        let mut analyzer = Analyzer::new();
        let mut stats = StreamStats::default();
        let mut sink = RecordingSink::default();
        let keep_going = handle(
            Notification {
                source: Source::Emg(0),
                data: vec![0; 3],
            },
            &mut builder,
            &mut analyzer,
            &mut stats,
            &mut sink,
        );
        assert!(keep_going);
        assert!(builder.is_empty());
        assert_eq!(stats.invalid_packets, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn streams_the_simulated_device_at_the_nominal_rates() {
        let sink = RecordingSink::default();
        let transport = Arc::new(MockTransport::new(1));
        let (session, details) = Session::start(transport, sink.clone()).await.unwrap();
        assert_eq!(details.battery, 87);
        assert!(!details.firmware_outdated);

        sleep(Duration::from_secs(4)).await;
        session.stop().await.unwrap();

        {
            let frames = sink.frames.lock().unwrap();
            let (emg, imu) = sample_counts(&frames);
            assert!((780..=820).contains(&emg), "EMG samples: {emg}");
            assert!((195..=205).contains(&imu), "IMU samples: {imu}");

            // 16 ms frames, so about 60 per second.
            assert!((230..=260).contains(&frames.len()), "{}", frames.len());
        }

        assert!(sink.has_event(|event| matches!(
            event,
            SessionEvent::Classifier {
                event: ClassifierEvent::ArmSynced {
                    arm: Arm::Right,
                    x_direction: XDirection::TowardWrist,
                },
            }
        )));
        assert!(sink.has_event(|event| matches!(
            event,
            SessionEvent::Classifier {
                event: ClassifierEvent::Pose { pose: Pose::Fist },
            }
        )));
        assert!(sink.has_event(|event| matches!(event, SessionEvent::Rssi { .. })));
        assert!(sink.has_event(|event| matches!(event, SessionEvent::Battery { level: 87 })));

        // About 10 per second, starting once the first metrics window has filled.
        let analysis = sink.analysis.lock().unwrap();
        assert!((35..=41).contains(&analysis.len()), "{}", analysis.len());
        assert_eq!(analysis[0][0], 1);
    }

    #[tokio::test(start_paused = true)]
    async fn configures_never_sleep_before_starting_the_stream() {
        let transport = Arc::new(FlakyTransport::default());
        let (session, details) = Session::start(transport.clone(), RecordingSink::default())
            .await
            .unwrap();
        assert!(details.firmware_outdated);

        {
            let commands = transport.commands.lock().unwrap();
            assert_eq!(commands[0], Command::SetSleepMode(SleepMode::NeverSleep),);
            assert!(matches!(commands[1], Command::SetMode { .. }));
        }

        session.stop().await.unwrap();
        let commands = transport.commands.lock().unwrap();
        assert_eq!(
            commands[commands.len() - 2],
            Command::SetMode {
                emg: EmgMode::None,
                imu: ImuMode::None,
                classifier: ClassifierMode::Disabled,
            },
        );
        assert_eq!(
            commands[commands.len() - 1],
            Command::SetSleepMode(SleepMode::Normal),
        );
    }

    #[tokio::test(start_paused = true)]
    async fn reconnects_and_reconfigures_after_a_dropped_connection() {
        let sink = RecordingSink::default();
        let transport = Arc::new(FlakyTransport {
            failing_reconnects: 2,
            ..FlakyTransport::default()
        });
        let (session, _) = Session::start(transport.clone(), sink.clone())
            .await
            .unwrap();

        sleep(Duration::from_millis(100)).await;
        transport.drop_connection();
        sleep(Duration::from_secs(10)).await;

        assert!(sink.has_event(|event| matches!(event, SessionEvent::Reconnecting)));
        assert!(sink.has_event(|event| matches!(event, SessionEvent::Reconnected)));
        assert!(!sink.has_event(|event| matches!(event, SessionEvent::Disconnected)));
        assert_eq!(transport.reconnects.load(Ordering::SeqCst), 3);
        assert_eq!(transport.subscriptions.load(Ordering::SeqCst), 2);
        session.stop().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn reports_a_disconnection_after_running_out_of_attempts() {
        let sink = RecordingSink::default();
        let transport = Arc::new(FlakyTransport {
            failing_reconnects: u32::MAX,
            ..FlakyTransport::default()
        });
        let (session, _) = Session::start(transport.clone(), sink.clone())
            .await
            .unwrap();

        sleep(Duration::from_millis(100)).await;
        transport.drop_connection();
        sleep(Duration::from_secs(60)).await;

        assert!(sink.has_event(|event| matches!(event, SessionEvent::Disconnected)));
        assert_eq!(
            transport.reconnects.load(Ordering::SeqCst),
            RECONNECT_ATTEMPTS,
        );
        session.stop().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_changed_settings_after_a_reconnection() {
        let transport = Arc::new(FlakyTransport::default());
        let (session, _) = Session::start(transport.clone(), RecordingSink::default())
            .await
            .unwrap();
        let modes = StreamModes {
            emg: EmgMode::Raw,
            imu: ImuMode::Data,
            classifier: ClassifierMode::Disabled,
        };
        session.set_modes(modes).await.unwrap();
        session.set_sleep_mode(SleepMode::Normal).await.unwrap();
        transport.commands.lock().unwrap().clear();

        sleep(Duration::from_millis(100)).await;
        transport.drop_connection();
        sleep(Duration::from_secs(10)).await;

        assert_eq!(
            *transport.commands.lock().unwrap(),
            [Command::SetSleepMode(SleepMode::Normal), modes.command()],
        );
        session.stop().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn deep_sleep_sends_the_command_without_resetting_the_device() {
        let transport = Arc::new(FlakyTransport::default());
        let (session, _) = Session::start(transport.clone(), RecordingSink::default())
            .await
            .unwrap();
        transport.commands.lock().unwrap().clear();

        session.deep_sleep().await.unwrap();

        assert_eq!(*transport.commands.lock().unwrap(), [Command::DeepSleep]);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_analyzing_when_the_emg_is_turned_off() {
        let sink = RecordingSink::default();
        let transport = Arc::new(MockTransport::new(1));
        let (session, _) = Session::start(transport, sink.clone()).await.unwrap();
        sleep(Duration::from_secs(2)).await;

        session
            .set_modes(StreamModes {
                emg: EmgMode::None,
                ..StreamModes::default()
            })
            .await
            .unwrap();
        sleep(Duration::from_millis(200)).await;
        let count = sink.analysis.lock().unwrap().len();
        sleep(Duration::from_secs(2)).await;

        assert_eq!(sink.analysis.lock().unwrap().len(), count);
        session.stop().await.unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn stopping_interrupts_reconnection() {
        let transport = Arc::new(FlakyTransport {
            failing_reconnects: u32::MAX,
            ..FlakyTransport::default()
        });
        let (session, _) = Session::start(transport.clone(), RecordingSink::default())
            .await
            .unwrap();

        sleep(Duration::from_millis(100)).await;
        transport.drop_connection();
        sleep(Duration::from_millis(100)).await;

        session.stop().await.unwrap();
        assert_eq!(transport.reconnects.load(Ordering::SeqCst), 0);
    }
}
