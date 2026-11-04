//! Simulated Myo that produces protocol-accurate bytes, for working without hardware.

use std::f32::consts::{PI, TAU};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::{mpsc, watch};
use tokio::time::{MissedTickBehavior, interval};

use super::{MyoTransport, Notification, Source, TransportError};
use crate::myo::protocol::{
    ClassifierMode, Command, EMG_CHANNELS, EMG_RATE_HZ, EMG_SAMPLES_PER_PACKET, EmgMode, EmgSample,
    FirmwareVersion, HardwareRev, IMU_RATE_HZ, ImuMode, ImuSample, MyoInfo, Pose, Sku, UnlockType,
    encode_emg,
};

const TICK: Duration = Duration::from_millis(1000 / (EMG_RATE_HZ as u64 / 2));
const TICKS_PER_IMU_SAMPLE: u64 = (EMG_RATE_HZ / 2 / IMU_RATE_HZ) as u64;
const POSE_DURATION_TICKS: u64 = 300;
const TAP_PERIOD_TICKS: u64 = 700;
const BATTERY_PERIOD_TICKS: u64 = 6000;
const CHANNEL_CAPACITY: usize = 1024;
const SIMULATED_BATTERY: u8 = 87;
const SIMULATED_RSSI: i16 = -52;
const REST_AMPLITUDE: f32 = 2.5;
const ENVELOPE_SMOOTHING: f32 = 0.02;

const POSE_SEQUENCE: [Pose; 8] = [
    Pose::Rest,
    Pose::Fist,
    Pose::Rest,
    Pose::WaveIn,
    Pose::Rest,
    Pose::WaveOut,
    Pose::Rest,
    Pose::FingersSpread,
];

/// Peak activation of each electrode for a pose. The values are invented to be visually
/// plausible, and aren't derived from recordings.
fn pose_activation(pose: Pose) -> [f32; EMG_CHANNELS] {
    match pose {
        Pose::Fist => [32.0, 38.0, 44.0, 36.0, 26.0, 22.0, 24.0, 28.0],
        Pose::WaveIn => [10.0, 8.0, 7.0, 9.0, 22.0, 38.0, 44.0, 26.0],
        Pose::WaveOut => [30.0, 44.0, 38.0, 20.0, 9.0, 7.0, 8.0, 11.0],
        Pose::FingersSpread => [14.0, 24.0, 40.0, 42.0, 30.0, 16.0, 10.0, 10.0],
        Pose::DoubleTap => [18.0; EMG_CHANNELS],
        Pose::Rest | Pose::Unknown => [REST_AMPLITUDE; EMG_CHANNELS],
    }
}

/// SplitMix64, so that the simulation is deterministic and needs no extra dependency.
struct Rng(u64);

impl Rng {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn unit(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32 + 1.0) / (1u64 << 24) as f32
    }

    /// Standard normal value, using the Box-Muller transform.
    fn normal(&mut self) -> f32 {
        (-2.0 * self.unit().ln()).sqrt() * (TAU * self.unit()).cos()
    }
}

/// Generates synthetic signals. It has no timing of its own, which makes it easy to test.
struct Signal {
    rng: Rng,
    envelope: [f32; EMG_CHANNELS],
    seconds: f32,
}

impl Signal {
    fn new(seed: u64) -> Self {
        Self {
            rng: Rng(seed),
            envelope: [REST_AMPLITUDE; EMG_CHANNELS],
            seconds: 0.0,
        }
    }

    fn next_emg(&mut self, pose: Pose) -> EmgSample {
        let target = pose_activation(pose);
        let mut sample = [0; EMG_CHANNELS];
        for channel in 0..EMG_CHANNELS {
            self.envelope[channel] +=
                (target[channel] - self.envelope[channel]) * ENVELOPE_SMOOTHING;
            let value = self.rng.normal() * self.envelope[channel];
            sample[channel] = value.round().clamp(-128.0, 127.0) as i8;
        }
        sample
    }

    fn next_imu(&mut self) -> ImuSample {
        self.seconds += 1.0 / IMU_RATE_HZ as f32;
        let t = self.seconds;
        let angle = 0.6 * (t * 0.5).sin();
        let half = angle / 2.0;
        let angular_rate = 0.3 * (t * 0.5).cos();
        ImuSample {
            orientation: [half.cos(), 0.0, 0.0, half.sin()],
            accelerometer: [
                0.01 * self.rng.normal(),
                0.01 * self.rng.normal(),
                1.0 + 0.01 * self.rng.normal(),
            ],
            gyroscope: [
                0.2 * self.rng.normal(),
                0.2 * self.rng.normal(),
                angular_rate * 180.0 / PI + 0.2 * self.rng.normal(),
            ],
        }
    }
}

#[derive(Clone, Copy)]
struct Modes {
    emg: EmgMode,
    imu: ImuMode,
    classifier: ClassifierMode,
}

pub struct MockTransport {
    seed: u64,
    modes: Arc<Mutex<Modes>>,
    /// Responses to commands, delivered on the next tick.
    responses: Arc<Mutex<Vec<Notification>>>,
    stop: watch::Sender<bool>,
}

impl MockTransport {
    pub fn new(seed: u64) -> Self {
        Self {
            seed,
            modes: Arc::new(Mutex::new(Modes {
                emg: EmgMode::None,
                imu: ImuMode::None,
                classifier: ClassifierMode::Disabled,
            })),
            responses: Arc::new(Mutex::new(Vec::new())),
            stop: watch::channel(false).0,
        }
    }
}

#[async_trait]
impl MyoTransport for MockTransport {
    fn name(&self) -> &str {
        "Simulated Myo"
    }

    async fn read_info(&self) -> Result<MyoInfo, TransportError> {
        Ok(MyoInfo {
            serial_number: [0x47, 0x41, 0x4c, 0x56, 0x41, 0x4e],
            unlock_pose: Pose::DoubleTap,
            active_classifier_type: 0,
            active_classifier_index: 0,
            has_custom_classifier: false,
            stream_indicating: false,
            sku: Sku::Black,
        })
    }

    async fn read_firmware(&self) -> Result<FirmwareVersion, TransportError> {
        Ok(FirmwareVersion {
            major: 1,
            minor: 5,
            patch: 1970,
            hardware_rev: HardwareRev::RevD,
        })
    }

    async fn read_battery(&self) -> Result<u8, TransportError> {
        Ok(SIMULATED_BATTERY)
    }

    async fn read_rssi(&self) -> Result<i16, TransportError> {
        Ok(SIMULATED_RSSI)
    }

    async fn send_command(&self, command: Command) -> Result<(), TransportError> {
        match command {
            Command::SetMode {
                emg,
                imu,
                classifier,
            } => {
                *self.modes.lock().expect("mock modes lock poisoned") = Modes {
                    emg,
                    imu,
                    classifier,
                };
            }
            Command::Unlock(unlock) => {
                let event_type = if unlock == UnlockType::Lock { 5 } else { 4 };
                self.responses
                    .lock()
                    .expect("mock responses lock poisoned")
                    .push(Notification {
                        source: Source::Classifier,
                        data: vec![event_type, 0, 0],
                    });
            }
            other => log::debug!("Simulated Myo received {other:?}"),
        }
        Ok(())
    }

    async fn subscribe(&self) -> Result<mpsc::Receiver<Notification>, TransportError> {
        let (sender, receiver) = mpsc::channel(CHANNEL_CAPACITY);
        let modes = Arc::clone(&self.modes);
        let stop = self.stop.subscribe();
        let responses = Arc::clone(&self.responses);
        tokio::spawn(generate(self.seed, modes, responses, sender, stop));
        Ok(receiver)
    }

    /// The simulated connection never drops, so there is nothing to restore.
    async fn reconnect(&self) -> Result<(), TransportError> {
        Err(TransportError::Disconnected)
    }

    async fn disconnect(&self) -> Result<(), TransportError> {
        let _ = self.stop.send(true);
        Ok(())
    }
}

async fn generate(
    seed: u64,
    modes: Arc<Mutex<Modes>>,
    responses: Arc<Mutex<Vec<Notification>>>,
    sender: mpsc::Sender<Notification>,
    mut stop: watch::Receiver<bool>,
) {
    let mut signal = Signal::new(seed);
    let mut ticker = interval(TICK);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Burst);
    let mut tick: u64 = 0;
    let mut announced_sync = false;

    loop {
        tokio::select! {
            _ = stop.changed() => return,
            _ = ticker.tick() => {}
        }

        let modes = *modes.lock().expect("mock modes lock poisoned");
        let pose = POSE_SEQUENCE[(tick / POSE_DURATION_TICKS) as usize % POSE_SEQUENCE.len()];
        let mut outgoing: Vec<Notification> = responses
            .lock()
            .expect("mock responses lock poisoned")
            .drain(..)
            .collect();

        if modes.emg != EmgMode::None {
            let mut samples = [[0; EMG_CHANNELS]; EMG_SAMPLES_PER_PACKET];
            for sample in &mut samples {
                *sample = signal.next_emg(pose);
            }
            outgoing.push(Notification {
                source: Source::Emg((tick % 4) as u8),
                data: encode_emg(&samples).to_vec(),
            });
        }

        if matches!(modes.imu, ImuMode::Data | ImuMode::All | ImuMode::Raw)
            && tick.is_multiple_of(TICKS_PER_IMU_SAMPLE)
        {
            outgoing.push(Notification {
                source: Source::Imu,
                data: signal.next_imu().encode().to_vec(),
            });
        }

        if matches!(modes.imu, ImuMode::Events | ImuMode::All)
            && tick > 0
            && tick.is_multiple_of(TAP_PERIOD_TICKS)
        {
            outgoing.push(Notification {
                source: Source::Motion,
                data: vec![0, 1, 2],
            });
        }

        if modes.classifier == ClassifierMode::Enabled {
            if !announced_sync {
                announced_sync = true;
                outgoing.push(Notification {
                    source: Source::Classifier,
                    data: vec![1, 1, 1],
                });
                outgoing.push(Notification {
                    source: Source::Classifier,
                    data: vec![4, 0, 0],
                });
            }
            if tick.is_multiple_of(POSE_DURATION_TICKS) {
                let raw = pose.to_raw().to_le_bytes();
                outgoing.push(Notification {
                    source: Source::Classifier,
                    data: vec![3, raw[0], raw[1]],
                });
            }
        }

        if tick > 0 && tick.is_multiple_of(BATTERY_PERIOD_TICKS) {
            outgoing.push(Notification {
                source: Source::Battery,
                data: vec![SIMULATED_BATTERY],
            });
        }

        for notification in outgoing {
            if sender.send(notification).await.is_err() {
                return;
            }
        }
        tick += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rms(samples: &[EmgSample], channel: usize) -> f32 {
        let total: f32 = samples
            .iter()
            .map(|sample| f32::from(sample[channel]).powi(2))
            .sum();
        (total / samples.len() as f32).sqrt()
    }

    #[test]
    fn active_pose_has_more_energy_than_rest() {
        let mut signal = Signal::new(1);
        let rest: Vec<_> = (0..500).map(|_| signal.next_emg(Pose::Rest)).collect();
        let fist: Vec<_> = (0..500).map(|_| signal.next_emg(Pose::Fist)).collect();
        for channel in 0..EMG_CHANNELS {
            assert!(rms(&fist, channel) > rms(&rest, channel) * 3.0);
        }
    }

    #[test]
    fn same_seed_produces_the_same_signal() {
        let mut first = Signal::new(7);
        let mut second = Signal::new(7);
        for _ in 0..100 {
            assert_eq!(first.next_emg(Pose::Fist), second.next_emg(Pose::Fist));
        }
    }

    #[test]
    fn imu_orientation_stays_a_unit_quaternion() {
        let mut signal = Signal::new(3);
        for _ in 0..1000 {
            let norm: f32 = signal
                .next_imu()
                .orientation
                .iter()
                .map(|value| value * value)
                .sum();
            assert!((norm - 1.0).abs() < 1e-4);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn stays_silent_until_a_mode_is_set() {
        let transport = MockTransport::new(1);
        let mut receiver = transport.subscribe().await.unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(receiver.try_recv().is_err());
    }

    #[tokio::test(start_paused = true)]
    async fn reports_lock_changes_as_classifier_events() {
        let transport = MockTransport::new(1);
        let mut receiver = transport.subscribe().await.unwrap();
        transport
            .send_command(Command::Unlock(UnlockType::Lock))
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(
            receiver.try_recv().unwrap(),
            Notification {
                source: Source::Classifier,
                data: vec![5, 0, 0],
            },
        );
    }

    #[tokio::test(start_paused = true)]
    async fn disconnect_ends_the_stream() {
        let transport = MockTransport::new(1);
        let mut receiver = transport.subscribe().await.unwrap();
        transport.disconnect().await.unwrap();
        assert!(receiver.recv().await.is_none());
    }
}
