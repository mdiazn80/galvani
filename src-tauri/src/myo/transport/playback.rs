//! Replays a recording as if it were a live device, so that every view works the same.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use tokio::sync::{mpsc, watch};
use tokio::time::{Instant, MissedTickBehavior, interval};

use super::{MyoTransport, Notification, Source, TransportError};
use crate::myo::device::DeviceDetails;
use crate::myo::protocol::{Command, FirmwareVersion, MyoInfo};
use crate::myo::recorder::TimedNotification;

const TICK: Duration = Duration::from_millis(5);
const CHANNEL_CAPACITY: usize = 1024;
pub const MIN_SPEED: f64 = 0.25;
pub const MAX_SPEED: f64 = 8.0;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub position_ms: f64,
    pub duration_ms: f64,
    pub playing: bool,
    pub speed: f64,
}

#[derive(Debug)]
struct Control {
    status: PlaybackStatus,
    pending_seek: Option<f64>,
}

pub struct PlaybackTransport {
    details: DeviceDetails,
    recording: Arc<Vec<TimedNotification>>,
    control: Arc<Mutex<Control>>,
    stop: watch::Sender<bool>,
}

impl PlaybackTransport {
    pub fn new(
        details: DeviceDetails,
        recording: Vec<TimedNotification>,
        duration_ms: f64,
    ) -> Self {
        Self {
            details,
            recording: Arc::new(recording),
            control: Arc::new(Mutex::new(Control {
                status: PlaybackStatus {
                    position_ms: 0.0,
                    duration_ms,
                    playing: true,
                    speed: 1.0,
                },
                pending_seek: None,
            })),
            stop: watch::channel(false).0,
        }
    }

    pub fn status(&self) -> PlaybackStatus {
        self.control.lock().expect("playback lock poisoned").status
    }

    pub fn set_playing(&self, playing: bool) {
        let mut control = self.control.lock().expect("playback lock poisoned");
        // Playing again from the very end starts over.
        if playing && control.status.position_ms >= control.status.duration_ms {
            control.pending_seek = Some(0.0);
        }
        control.status.playing = playing;
    }

    pub fn set_speed(&self, speed: f64) {
        self.control
            .lock()
            .expect("playback lock poisoned")
            .status
            .speed = speed.clamp(MIN_SPEED, MAX_SPEED);
    }

    pub fn seek(&self, position_ms: f64) {
        let mut control = self.control.lock().expect("playback lock poisoned");
        control.pending_seek = Some(position_ms.clamp(0.0, control.status.duration_ms));
    }
}

fn is_sample(source: Source) -> bool {
    matches!(source, Source::Emg(_) | Source::Imu)
}

/// Sends the recording according to the controls, until told to stop. The stream stays open
/// at the end of the recording, because for the session its end would mean a lost device.
async fn replay(
    recording: Arc<Vec<TimedNotification>>,
    control: Arc<Mutex<Control>>,
    sender: mpsc::Sender<Notification>,
    mut stop: watch::Receiver<bool>,
) {
    let mut ticker = interval(TICK);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut cursor = 0;
    let mut last_tick = Instant::now();

    loop {
        tokio::select! {
            _ = stop.changed() => return,
            _ = ticker.tick() => {}
        }
        let elapsed_ms = last_tick.elapsed().as_secs_f64() * 1000.0;
        last_tick = Instant::now();

        let (position_ms, seek_events) = {
            let mut control = control.lock().expect("playback lock poisoned");
            let mut seek_events = Vec::new();
            if let Some(target) = control.pending_seek.take() {
                control.status.position_ms = target;
                cursor = recording.partition_point(|timed| timed.time_ms < target);
                // Replaying the earlier events restores the state they describe, such as
                // the pose and the lock. Samples aren't needed for that.
                seek_events = recording[..cursor]
                    .iter()
                    .filter(|timed| !is_sample(timed.notification.source))
                    .map(|timed| timed.notification.clone())
                    .collect();
            } else if control.status.playing {
                let advanced = control.status.position_ms + elapsed_ms * control.status.speed;
                control.status.position_ms = advanced.min(control.status.duration_ms);
                if control.status.position_ms >= control.status.duration_ms {
                    control.status.playing = false;
                }
            }
            (control.status.position_ms, seek_events)
        };

        for notification in seek_events {
            if sender.send(notification).await.is_err() {
                return;
            }
        }
        while let Some(timed) = recording.get(cursor)
            && timed.time_ms <= position_ms
        {
            if sender.send(timed.notification.clone()).await.is_err() {
                return;
            }
            cursor += 1;
        }
    }
}

#[async_trait]
impl MyoTransport for PlaybackTransport {
    fn name(&self) -> &str {
        &self.details.name
    }

    async fn read_info(&self) -> Result<MyoInfo, TransportError> {
        Ok(self.details.info.clone())
    }

    async fn read_firmware(&self) -> Result<FirmwareVersion, TransportError> {
        Ok(self.details.firmware)
    }

    async fn read_battery(&self) -> Result<u8, TransportError> {
        Ok(self.details.battery)
    }

    /// There's no radio link in a recording.
    async fn read_rssi(&self) -> Result<i16, TransportError> {
        Err(TransportError::Disconnected)
    }

    /// A recording only plays back what happened, so commands have no effect on it.
    async fn send_command(&self, _command: Command) -> Result<(), TransportError> {
        Ok(())
    }

    async fn subscribe(&self) -> Result<mpsc::Receiver<Notification>, TransportError> {
        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        tokio::spawn(replay(
            Arc::clone(&self.recording),
            Arc::clone(&self.control),
            sender,
            self.stop.subscribe(),
        ));
        Ok(receiver)
    }

    async fn reconnect(&self) -> Result<(), TransportError> {
        Err(TransportError::Disconnected)
    }

    async fn disconnect(&self) -> Result<(), TransportError> {
        self.stop.send_replace(true);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::myo::protocol::{LATEST_KNOWN_FIRMWARE, MyoInfo, Pose, Sku};
    use tokio::time::sleep;

    fn details() -> DeviceDetails {
        DeviceDetails {
            name: "Recorded".to_owned(),
            info: MyoInfo {
                serial_number: [0; 6],
                unlock_pose: Pose::Rest,
                active_classifier_type: 0,
                active_classifier_index: 0,
                has_custom_classifier: false,
                stream_indicating: false,
                sku: Sku::Unknown,
            },
            firmware: LATEST_KNOWN_FIRMWARE,
            firmware_outdated: false,
            battery: 50,
        }
    }

    fn timed(time_ms: f64, source: Source) -> TimedNotification {
        TimedNotification {
            time_ms,
            notification: Notification {
                source,
                data: vec![time_ms as u8],
            },
        }
    }

    fn recording() -> Vec<TimedNotification> {
        vec![
            timed(100.0, Source::Classifier),
            timed(200.0, Source::Imu),
            timed(1000.0, Source::Imu),
            timed(1500.0, Source::Classifier),
            timed(1800.0, Source::Imu),
        ]
    }

    async fn drain(receiver: &mut mpsc::Receiver<Notification>) -> Vec<u8> {
        let mut received = Vec::new();
        while let Ok(notification) = receiver.try_recv() {
            received.push(notification.data[0]);
        }
        received
    }

    #[tokio::test(start_paused = true)]
    async fn delivers_notifications_at_their_recorded_times() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();

        sleep(Duration::from_millis(500)).await;
        assert_eq!(drain(&mut receiver).await, [100, 200]);

        sleep(Duration::from_millis(700)).await;
        assert_eq!(drain(&mut receiver).await, [255]);
    }

    #[tokio::test(start_paused = true)]
    async fn plays_faster_at_a_higher_speed() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        transport.set_speed(4.0);
        let mut receiver = transport.subscribe().await.unwrap();

        sleep(Duration::from_millis(300)).await;
        assert_eq!(drain(&mut receiver).await.len(), 3);
        assert!(transport.status().position_ms > 1100.0);
    }

    #[tokio::test(start_paused = true)]
    async fn clamps_the_speed() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        transport.set_speed(100.0);
        assert_eq!(transport.status().speed, MAX_SPEED);
        transport.set_speed(0.0);
        assert_eq!(transport.status().speed, MIN_SPEED);
    }

    #[tokio::test(start_paused = true)]
    async fn stops_advancing_while_paused() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        sleep(Duration::from_millis(150)).await;
        transport.set_playing(false);
        let paused_at = transport.status().position_ms;

        sleep(Duration::from_secs(5)).await;
        assert_eq!(transport.status().position_ms, paused_at);
        assert_eq!(drain(&mut receiver).await, [100]);
    }

    #[tokio::test(start_paused = true)]
    async fn seeking_restores_earlier_events_without_their_samples() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        transport.seek(1200.0);

        sleep(Duration::from_millis(20)).await;
        // Only the classifier event at 100 ms, and not the samples before the target.
        assert_eq!(drain(&mut receiver).await, [100]);
        assert!(transport.status().position_ms >= 1200.0);
    }

    #[tokio::test(start_paused = true)]
    async fn seeking_backward_replays_from_there() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        sleep(Duration::from_millis(1200)).await;
        drain(&mut receiver).await;

        transport.seek(150.0);
        sleep(Duration::from_millis(100)).await;
        assert_eq!(drain(&mut receiver).await, [100, 200]);
    }

    #[tokio::test(start_paused = true)]
    async fn holds_the_stream_open_at_the_end() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        sleep(Duration::from_secs(3)).await;
        drain(&mut receiver).await;

        let status = transport.status();
        assert_eq!(status.position_ms, 2000.0);
        assert!(!status.playing);
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::error::TryRecvError::Empty)
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn playing_again_at_the_end_starts_over() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        sleep(Duration::from_secs(3)).await;
        drain(&mut receiver).await;

        transport.set_playing(true);
        sleep(Duration::from_millis(300)).await;
        assert_eq!(drain(&mut receiver).await, [100, 200]);
    }

    #[tokio::test(start_paused = true)]
    async fn disconnect_ends_the_stream() {
        let transport = PlaybackTransport::new(details(), recording(), 2000.0);
        let mut receiver = transport.subscribe().await.unwrap();
        transport.disconnect().await.unwrap();
        sleep(Duration::from_millis(20)).await;
        while receiver.recv().await.is_some() {}
    }
}
