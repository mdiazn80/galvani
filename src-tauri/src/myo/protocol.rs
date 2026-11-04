//! Pure parsing and serialization of the Myo BLE protocol.
//!
//! The layouts come from `myohw.h`. See `docs/protocol.md` for the decisions taken
//! where the sources disagree, including the use of little-endian byte order.

// This module covers the whole protocol, and later phases use the parts still unused.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const EMG_CHANNELS: usize = 8;
pub const EMG_SAMPLES_PER_PACKET: usize = 2;
pub const EMG_PACKET_LEN: usize = EMG_CHANNELS * EMG_SAMPLES_PER_PACKET;
pub const EMG_RATE_HZ: u32 = 200;
pub const IMU_PACKET_LEN: usize = 20;
pub const IMU_RATE_HZ: u32 = 50;
pub const VIBRATE2_STEPS: usize = 6;

pub const ORIENTATION_SCALE: f32 = 16384.0;
pub const ACCELEROMETER_SCALE: f32 = 2048.0;
pub const GYROSCOPE_SCALE: f32 = 16.0;

/// Last firmware known to have been released. It doesn't appear in `myohw.h` or pyomyo.
pub const LATEST_KNOWN_FIRMWARE: FirmwareVersion = FirmwareVersion {
    major: 1,
    minor: 5,
    patch: 1970,
    hardware_rev: HardwareRev::Unknown,
};

const fn myo_uuid(short_id: u16) -> Uuid {
    Uuid::from_u128(0xd506_0000_a904_deb9_4748_2c7f_4a12_4842 | ((short_id as u128) << 96))
}

const fn standard_uuid(short_id: u16) -> Uuid {
    Uuid::from_u128(0x0000_0000_0000_1000_8000_0080_5f9b_34fb | ((short_id as u128) << 96))
}

pub const CONTROL_SERVICE: Uuid = myo_uuid(0x0001);
pub const MYO_INFO_CHARACTERISTIC: Uuid = myo_uuid(0x0101);
pub const FIRMWARE_VERSION_CHARACTERISTIC: Uuid = myo_uuid(0x0201);
pub const COMMAND_CHARACTERISTIC: Uuid = myo_uuid(0x0401);
pub const IMU_SERVICE: Uuid = myo_uuid(0x0002);
pub const IMU_DATA_CHARACTERISTIC: Uuid = myo_uuid(0x0402);
pub const MOTION_EVENT_CHARACTERISTIC: Uuid = myo_uuid(0x0502);
pub const CLASSIFIER_SERVICE: Uuid = myo_uuid(0x0003);
pub const CLASSIFIER_EVENT_CHARACTERISTIC: Uuid = myo_uuid(0x0103);
pub const EMG_SERVICE: Uuid = myo_uuid(0x0005);
pub const EMG_DATA_CHARACTERISTICS: [Uuid; 4] = [
    myo_uuid(0x0105),
    myo_uuid(0x0205),
    myo_uuid(0x0305),
    myo_uuid(0x0405),
];
pub const BATTERY_SERVICE: Uuid = standard_uuid(0x180f);
pub const BATTERY_LEVEL_CHARACTERISTIC: Uuid = standard_uuid(0x2a19);
pub const DEVICE_NAME_CHARACTERISTIC: Uuid = standard_uuid(0x2a00);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("{what} payload has {actual} bytes, expected {expected}")]
    InvalidLength {
        what: &'static str,
        expected: usize,
        actual: usize,
    },
}

fn require_exact(what: &'static str, data: &[u8], expected: usize) -> Result<(), ParseError> {
    if data.len() == expected {
        Ok(())
    } else {
        Err(ParseError::InvalidLength {
            what,
            expected,
            actual: data.len(),
        })
    }
}

fn require_at_least(what: &'static str, data: &[u8], expected: usize) -> Result<(), ParseError> {
    if data.len() >= expected {
        Ok(())
    } else {
        Err(ParseError::InvalidLength {
            what,
            expected,
            actual: data.len(),
        })
    }
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([data[offset], data[offset + 1]])
}

fn read_i16(data: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes([data[offset], data[offset + 1]])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Pose {
    Rest,
    Fist,
    WaveIn,
    WaveOut,
    FingersSpread,
    DoubleTap,
    Unknown,
}

impl Pose {
    pub fn from_raw(raw: u16) -> Self {
        match raw {
            0 => Self::Rest,
            1 => Self::Fist,
            2 => Self::WaveIn,
            3 => Self::WaveOut,
            4 => Self::FingersSpread,
            5 => Self::DoubleTap,
            _ => Self::Unknown,
        }
    }

    pub fn to_raw(self) -> u16 {
        match self {
            Self::Rest => 0,
            Self::Fist => 1,
            Self::WaveIn => 2,
            Self::WaveOut => 3,
            Self::FingersSpread => 4,
            Self::DoubleTap => 5,
            Self::Unknown => 0xffff,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Sku {
    Unknown,
    Black,
    White,
}

impl Sku {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Black,
            2 => Self::White,
            _ => Self::Unknown,
        }
    }

    fn to_raw(self) -> u8 {
        match self {
            Self::Unknown => 0,
            Self::Black => 1,
            Self::White => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HardwareRev {
    Unknown,
    RevC,
    RevD,
}

impl HardwareRev {
    fn from_raw(raw: u16) -> Self {
        match raw {
            1 => Self::RevC,
            2 => Self::RevD,
            _ => Self::Unknown,
        }
    }

    fn to_raw(self) -> u16 {
        match self {
            Self::Unknown => 0,
            Self::RevC => 1,
            Self::RevD => 2,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyoInfo {
    pub serial_number: [u8; 6],
    pub unlock_pose: Pose,
    pub active_classifier_type: u8,
    pub active_classifier_index: u8,
    pub has_custom_classifier: bool,
    pub stream_indicating: bool,
    pub sku: Sku,
}

impl MyoInfo {
    pub const LEN: usize = 20;

    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        require_exact("MyoInfo", data, Self::LEN)?;
        let mut serial_number = [0; 6];
        serial_number.copy_from_slice(&data[..6]);
        Ok(Self {
            serial_number,
            unlock_pose: Pose::from_raw(read_u16(data, 6)),
            active_classifier_type: data[8],
            active_classifier_index: data[9],
            has_custom_classifier: data[10] != 0,
            stream_indicating: data[11] != 0,
            sku: Sku::from_raw(data[12]),
        })
    }

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut bytes = [0; Self::LEN];
        bytes[..6].copy_from_slice(&self.serial_number);
        bytes[6..8].copy_from_slice(&self.unlock_pose.to_raw().to_le_bytes());
        bytes[8] = self.active_classifier_type;
        bytes[9] = self.active_classifier_index;
        bytes[10] = u8::from(self.has_custom_classifier);
        bytes[11] = u8::from(self.stream_indicating);
        bytes[12] = self.sku.to_raw();
        bytes
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FirmwareVersion {
    pub major: u16,
    pub minor: u16,
    pub patch: u16,
    pub hardware_rev: HardwareRev,
}

impl FirmwareVersion {
    pub const LEN: usize = 8;

    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        require_exact("FirmwareVersion", data, Self::LEN)?;
        Ok(Self {
            major: read_u16(data, 0),
            minor: read_u16(data, 2),
            patch: read_u16(data, 4),
            hardware_rev: HardwareRev::from_raw(read_u16(data, 6)),
        })
    }

    pub fn encode(&self) -> [u8; Self::LEN] {
        let mut bytes = [0; Self::LEN];
        bytes[0..2].copy_from_slice(&self.major.to_le_bytes());
        bytes[2..4].copy_from_slice(&self.minor.to_le_bytes());
        bytes[4..6].copy_from_slice(&self.patch.to_le_bytes());
        bytes[6..8].copy_from_slice(&self.hardware_rev.to_raw().to_le_bytes());
        bytes
    }

    pub fn is_older_than(&self, other: &FirmwareVersion) -> bool {
        (self.major, self.minor, self.patch) < (other.major, other.minor, other.patch)
    }
}

/// Two consecutive 8-channel EMG samples, as carried by one notification.
pub type EmgSample = [i8; EMG_CHANNELS];

pub fn parse_emg(data: &[u8]) -> Result<[EmgSample; EMG_SAMPLES_PER_PACKET], ParseError> {
    require_exact("EMG", data, EMG_PACKET_LEN)?;
    let mut samples = [[0; EMG_CHANNELS]; EMG_SAMPLES_PER_PACKET];
    for (index, byte) in data.iter().enumerate() {
        samples[index / EMG_CHANNELS][index % EMG_CHANNELS] = *byte as i8;
    }
    Ok(samples)
}

pub fn encode_emg(samples: &[EmgSample; EMG_SAMPLES_PER_PACKET]) -> [u8; EMG_PACKET_LEN] {
    let mut bytes = [0; EMG_PACKET_LEN];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = samples[index / EMG_CHANNELS][index % EMG_CHANNELS] as u8;
    }
    bytes
}

/// IMU reading converted to physical units.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImuSample {
    /// Unit quaternion, in `w, x, y, z` order.
    pub orientation: [f32; 4],
    /// Acceleration in g.
    pub accelerometer: [f32; 3],
    /// Angular velocity in degrees per second.
    pub gyroscope: [f32; 3],
}

impl ImuSample {
    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        require_exact("IMU", data, IMU_PACKET_LEN)?;
        let value = |index: usize| f32::from(read_i16(data, index * 2));
        Ok(Self {
            orientation: [
                value(0) / ORIENTATION_SCALE,
                value(1) / ORIENTATION_SCALE,
                value(2) / ORIENTATION_SCALE,
                value(3) / ORIENTATION_SCALE,
            ],
            accelerometer: [
                value(4) / ACCELEROMETER_SCALE,
                value(5) / ACCELEROMETER_SCALE,
                value(6) / ACCELEROMETER_SCALE,
            ],
            gyroscope: [
                value(7) / GYROSCOPE_SCALE,
                value(8) / GYROSCOPE_SCALE,
                value(9) / GYROSCOPE_SCALE,
            ],
        })
    }

    pub fn encode(&self) -> [u8; IMU_PACKET_LEN] {
        let scaled = |value: f32, scale: f32| (value * scale).round() as i16;
        let values = [
            scaled(self.orientation[0], ORIENTATION_SCALE),
            scaled(self.orientation[1], ORIENTATION_SCALE),
            scaled(self.orientation[2], ORIENTATION_SCALE),
            scaled(self.orientation[3], ORIENTATION_SCALE),
            scaled(self.accelerometer[0], ACCELEROMETER_SCALE),
            scaled(self.accelerometer[1], ACCELEROMETER_SCALE),
            scaled(self.accelerometer[2], ACCELEROMETER_SCALE),
            scaled(self.gyroscope[0], GYROSCOPE_SCALE),
            scaled(self.gyroscope[1], GYROSCOPE_SCALE),
            scaled(self.gyroscope[2], GYROSCOPE_SCALE),
        ];
        let mut bytes = [0; IMU_PACKET_LEN];
        for (index, value) in values.iter().enumerate() {
            bytes[index * 2..index * 2 + 2].copy_from_slice(&value.to_le_bytes());
        }
        bytes
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MotionEvent {
    #[serde(rename_all = "camelCase")]
    Tap { direction: u8, count: u8 },
    #[serde(rename_all = "camelCase")]
    Unknown { raw_type: u8 },
}

impl MotionEvent {
    pub const LEN: usize = 3;

    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        require_at_least("MotionEvent", data, Self::LEN)?;
        Ok(match data[0] {
            0 => Self::Tap {
                direction: data[1],
                count: data[2],
            },
            raw_type => Self::Unknown { raw_type },
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Arm {
    Right,
    Left,
    Unknown,
}

impl Arm {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::Right,
            2 => Self::Left,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum XDirection {
    TowardWrist,
    TowardElbow,
    Unknown,
}

impl XDirection {
    fn from_raw(raw: u8) -> Self {
        match raw {
            1 => Self::TowardWrist,
            2 => Self::TowardElbow,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ClassifierEvent {
    #[serde(rename_all = "camelCase")]
    ArmSynced {
        arm: Arm,
        x_direction: XDirection,
    },
    ArmUnsynced,
    Pose {
        pose: Pose,
    },
    Unlocked,
    Locked,
    #[serde(rename_all = "camelCase")]
    SyncFailed {
        result: u8,
    },
    #[serde(rename_all = "camelCase")]
    Unknown {
        raw_type: u8,
    },
}

impl ClassifierEvent {
    /// Minimum size according to `myohw.h`. pyomyo reads 6 bytes, so longer payloads are valid.
    pub const MIN_LEN: usize = 3;

    pub fn parse(data: &[u8]) -> Result<Self, ParseError> {
        require_at_least("ClassifierEvent", data, Self::MIN_LEN)?;
        Ok(match data[0] {
            1 => Self::ArmSynced {
                arm: Arm::from_raw(data[1]),
                x_direction: XDirection::from_raw(data[2]),
            },
            2 => Self::ArmUnsynced,
            3 => Self::Pose {
                pose: Pose::from_raw(read_u16(data, 1)),
            },
            4 => Self::Unlocked,
            5 => Self::Locked,
            6 => Self::SyncFailed { result: data[1] },
            raw_type => Self::Unknown { raw_type },
        })
    }
}

pub fn parse_battery(data: &[u8]) -> Result<u8, ParseError> {
    require_exact("Battery", data, 1)?;
    Ok(data[0])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum EmgMode {
    None = 0x00,
    Filtered = 0x02,
    Raw = 0x03,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum ImuMode {
    None = 0x00,
    Data = 0x01,
    Events = 0x02,
    All = 0x03,
    Raw = 0x04,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum ClassifierMode {
    Disabled = 0x00,
    Enabled = 0x01,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum VibrationType {
    None = 0x00,
    Short = 0x01,
    Medium = 0x02,
    Long = 0x03,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VibrationStep {
    pub duration_ms: u16,
    pub strength: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum SleepMode {
    Normal = 0,
    NeverSleep = 1,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum UnlockType {
    Lock = 0x00,
    Timed = 0x01,
    Hold = 0x02,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    SetMode {
        emg: EmgMode,
        imu: ImuMode,
        classifier: ClassifierMode,
    },
    Vibrate(VibrationType),
    DeepSleep,
    Vibrate2([VibrationStep; VIBRATE2_STEPS]),
    SetSleepMode(SleepMode),
    Unlock(UnlockType),
    UserActionSingle,
    /// Undocumented in `myohw.h`, and taken from pyomyo: RGB of the logo, then of the line.
    SetLeds {
        logo: [u8; 3],
        line: [u8; 3],
    },
}

impl Command {
    pub fn encode(&self) -> Vec<u8> {
        match *self {
            Self::SetMode {
                emg,
                imu,
                classifier,
            } => vec![0x01, 3, emg as u8, imu as u8, classifier as u8],
            Self::Vibrate(vibration) => vec![0x03, 1, vibration as u8],
            Self::DeepSleep => vec![0x04, 0],
            Self::Vibrate2(steps) => {
                let mut bytes = vec![0x07, 18];
                for step in steps {
                    bytes.extend_from_slice(&step.duration_ms.to_le_bytes());
                    bytes.push(step.strength);
                }
                bytes
            }
            Self::SetSleepMode(mode) => vec![0x09, 1, mode as u8],
            Self::Unlock(unlock) => vec![0x0a, 1, unlock as u8],
            Self::UserActionSingle => vec![0x0b, 1, 0],
            Self::SetLeds { logo, line } => {
                let mut bytes = vec![0x06, 6];
                bytes.extend_from_slice(&logo);
                bytes.extend_from_slice(&line);
                bytes
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuids_match_the_specification() {
        assert_eq!(
            CONTROL_SERVICE.to_string(),
            "d5060001-a904-deb9-4748-2c7f4a124842"
        );
        assert_eq!(
            COMMAND_CHARACTERISTIC.to_string(),
            "d5060401-a904-deb9-4748-2c7f4a124842"
        );
        assert_eq!(
            EMG_DATA_CHARACTERISTICS[3].to_string(),
            "d5060405-a904-deb9-4748-2c7f4a124842"
        );
        assert_eq!(
            BATTERY_LEVEL_CHARACTERISTIC.to_string(),
            "00002a19-0000-1000-8000-00805f9b34fb"
        );
    }

    #[test]
    fn control_service_matches_the_advertised_bytes_in_myohw() {
        // MYO_SERVICE_INFO_UUID in myohw.h, which lists the bytes in reverse order.
        let mut advertised = [
            0x42, 0x48, 0x12, 0x4a, 0x7f, 0x2c, 0x48, 0x47, 0xb9, 0xde, 0x04, 0xa9, 0x01, 0x00,
            0x06, 0xd5,
        ];
        advertised.reverse();
        assert_eq!(Uuid::from_bytes(advertised), CONTROL_SERVICE);
    }

    #[test]
    fn parses_myo_info() {
        let bytes = [
            1, 2, 3, 4, 5, 6, // serial number
            0x05, 0x00, // unlock pose: double tap
            1, 7, 1, 0, 2, // classifier type, index, custom, indicating, SKU
            0, 0, 0, 0, 0, 0, 0, // reserved
        ];
        let info = MyoInfo::parse(&bytes).unwrap();
        assert_eq!(info.serial_number, [1, 2, 3, 4, 5, 6]);
        assert_eq!(info.unlock_pose, Pose::DoubleTap);
        assert_eq!(info.active_classifier_type, 1);
        assert_eq!(info.active_classifier_index, 7);
        assert!(info.has_custom_classifier);
        assert!(!info.stream_indicating);
        assert_eq!(info.sku, Sku::White);
        assert_eq!(info.encode(), bytes);
    }

    #[test]
    fn parses_firmware_version_as_little_endian() {
        let bytes = [0x01, 0x00, 0x05, 0x00, 0xb2, 0x07, 0x02, 0x00];
        let firmware = FirmwareVersion::parse(&bytes).unwrap();
        assert_eq!(
            firmware,
            FirmwareVersion {
                major: 1,
                minor: 5,
                patch: 1970,
                hardware_rev: HardwareRev::RevD,
            }
        );
        assert_eq!(firmware.encode(), bytes);
    }

    #[test]
    fn compares_firmware_versions_ignoring_the_hardware_revision() {
        let latest = LATEST_KNOWN_FIRMWARE;
        let same = FirmwareVersion {
            hardware_rev: HardwareRev::RevD,
            ..latest
        };
        let older = FirmwareVersion {
            major: 1,
            minor: 4,
            patch: 9999,
            hardware_rev: HardwareRev::RevD,
        };
        assert!(!same.is_older_than(&latest));
        assert!(older.is_older_than(&latest));
    }

    #[test]
    fn parses_emg_as_two_signed_samples() {
        let bytes = [
            0x00, 0x01, 0x7f, 0x80, 0xff, 0xfe, 0x10, 0xf0, // first sample
            0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, // second sample
        ];
        let samples = parse_emg(&bytes).unwrap();
        assert_eq!(samples[0], [0, 1, 127, -128, -1, -2, 16, -16]);
        assert_eq!(samples[1], [2, 3, 4, 5, 6, 7, 8, 9]);
        assert_eq!(encode_emg(&samples), bytes);
    }

    #[test]
    fn parses_imu_and_applies_scales() {
        let bytes = [
            0x00, 0x40, // w = 16384 -> 1.0
            0x00, 0xc0, // x = -16384 -> -1.0
            0x00, 0x20, // y = 8192 -> 0.5
            0x00, 0x00, // z = 0
            0x00, 0x08, // accel x = 2048 -> 1 g
            0x00, 0xf8, // accel y = -2048 -> -1 g
            0x00, 0x04, // accel z = 1024 -> 0.5 g
            0x10, 0x00, // gyro x = 16 -> 1 deg/s
            0xf0, 0xff, // gyro y = -16 -> -1 deg/s
            0xa0, 0x00, // gyro z = 160 -> 10 deg/s
        ];
        let sample = ImuSample::parse(&bytes).unwrap();
        assert_eq!(sample.orientation, [1.0, -1.0, 0.5, 0.0]);
        assert_eq!(sample.accelerometer, [1.0, -1.0, 0.5]);
        assert_eq!(sample.gyroscope, [1.0, -1.0, 10.0]);
        assert_eq!(sample.encode(), bytes);
    }

    #[test]
    fn parses_motion_events() {
        assert_eq!(
            MotionEvent::parse(&[0, 3, 2]).unwrap(),
            MotionEvent::Tap {
                direction: 3,
                count: 2
            }
        );
        assert_eq!(
            MotionEvent::parse(&[9, 0, 0]).unwrap(),
            MotionEvent::Unknown { raw_type: 9 }
        );
    }

    #[test]
    fn parses_classifier_events() {
        assert_eq!(
            ClassifierEvent::parse(&[1, 2, 1]).unwrap(),
            ClassifierEvent::ArmSynced {
                arm: Arm::Left,
                x_direction: XDirection::TowardWrist,
            }
        );
        assert_eq!(
            ClassifierEvent::parse(&[2, 0, 0]).unwrap(),
            ClassifierEvent::ArmUnsynced
        );
        assert_eq!(
            ClassifierEvent::parse(&[3, 0x04, 0x00]).unwrap(),
            ClassifierEvent::Pose {
                pose: Pose::FingersSpread
            }
        );
        assert_eq!(
            ClassifierEvent::parse(&[3, 0xff, 0xff]).unwrap(),
            ClassifierEvent::Pose {
                pose: Pose::Unknown
            }
        );
        assert_eq!(
            ClassifierEvent::parse(&[4, 0, 0]).unwrap(),
            ClassifierEvent::Unlocked
        );
        assert_eq!(
            ClassifierEvent::parse(&[5, 0, 0]).unwrap(),
            ClassifierEvent::Locked
        );
        assert_eq!(
            ClassifierEvent::parse(&[6, 1, 0]).unwrap(),
            ClassifierEvent::SyncFailed { result: 1 }
        );
    }

    #[test]
    fn accepts_the_longer_classifier_payload_read_by_pyomyo() {
        assert_eq!(
            ClassifierEvent::parse(&[3, 1, 0, 0, 0, 0]).unwrap(),
            ClassifierEvent::Pose { pose: Pose::Fist }
        );
    }

    #[test]
    fn keeps_unknown_classifier_event_types() {
        assert_eq!(
            ClassifierEvent::parse(&[7, 0, 0]).unwrap(),
            ClassifierEvent::Unknown { raw_type: 7 }
        );
    }

    #[test]
    fn rejects_invalid_lengths() {
        let short = ParseError::InvalidLength {
            what: "EMG",
            expected: 16,
            actual: 15,
        };
        assert_eq!(parse_emg(&[0; 15]), Err(short));
        assert!(ImuSample::parse(&[0; 21]).is_err());
        assert!(MyoInfo::parse(&[0; 19]).is_err());
        assert!(FirmwareVersion::parse(&[0; 7]).is_err());
        assert!(MotionEvent::parse(&[0; 2]).is_err());
        assert!(ClassifierEvent::parse(&[0; 2]).is_err());
        assert!(parse_battery(&[]).is_err());
    }

    #[test]
    fn parses_battery() {
        assert_eq!(parse_battery(&[87]), Ok(87));
    }

    #[test]
    fn encodes_commands() {
        assert_eq!(
            Command::SetMode {
                emg: EmgMode::Raw,
                imu: ImuMode::Data,
                classifier: ClassifierMode::Disabled,
            }
            .encode(),
            [0x01, 0x03, 0x03, 0x01, 0x00]
        );
        assert_eq!(
            Command::Vibrate(VibrationType::Medium).encode(),
            [0x03, 0x01, 0x02]
        );
        assert_eq!(Command::DeepSleep.encode(), [0x04, 0x00]);
        assert_eq!(
            Command::SetSleepMode(SleepMode::NeverSleep).encode(),
            [0x09, 0x01, 0x01]
        );
        assert_eq!(
            Command::Unlock(UnlockType::Hold).encode(),
            [0x0a, 0x01, 0x02]
        );
        assert_eq!(Command::UserActionSingle.encode(), [0x0b, 0x01, 0x00]);
        assert_eq!(
            Command::SetLeds {
                logo: [1, 2, 3],
                line: [4, 5, 6],
            }
            .encode(),
            [0x06, 6, 1, 2, 3, 4, 5, 6]
        );
    }

    #[test]
    fn encodes_vibrate2_with_six_fixed_steps() {
        let mut steps = [VibrationStep::default(); VIBRATE2_STEPS];
        steps[0] = VibrationStep {
            duration_ms: 0x0102,
            strength: 255,
        };
        let bytes = Command::Vibrate2(steps).encode();
        assert_eq!(bytes.len(), 20);
        assert_eq!(&bytes[..5], [0x07, 18, 0x02, 0x01, 255]);
        assert!(bytes[5..].iter().all(|byte| *byte == 0));
    }
}
