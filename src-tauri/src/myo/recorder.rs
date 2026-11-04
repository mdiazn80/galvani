//! Records sessions to disk, one folder per recording, in formats any tool can open:
//!
//! - `session.json`: metadata, rewritten when the recording ends.
//! - `emg.csv`: `time_ms`, then one column per channel.
//! - `imu.csv`: `time_ms`, then orientation, accelerometer and gyroscope.
//! - `events.csv`: `time_ms`, `kind`, the raw payload in hexadecimal, and a readable description.

use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::time::Instant;

use super::device::DeviceDetails;
use super::protocol::{
    ClassifierEvent, EMG_RATE_HZ, IMU_PACKET_LEN, ImuSample, MotionEvent, encode_emg,
    parse_battery, parse_emg,
};
use super::transport::{Notification, Source};

const METADATA_FILE: &str = "session.json";
const EMG_FILE: &str = "emg.csv";
const IMU_FILE: &str = "imu.csv";
const EVENTS_FILE: &str = "events.csv";
const JSON_EXPORT_FILE: &str = "session-export.json";
const FORMAT_VERSION: u32 = 1;
const SAMPLE_PERIOD_MS: f64 = 1000.0 / EMG_RATE_HZ as f64;

#[derive(Debug, Error)]
pub enum RecordingError {
    #[error("the recording {0} doesn't exist")]
    NotFound(String),
    #[error("could not access the recording: {0}")]
    Io(#[from] io::Error),
    #[error("the recording's metadata is invalid: {0}")]
    InvalidMetadata(#[from] serde_json::Error),
    #[error("the recording has invalid data at {file}, line {line}")]
    InvalidData { file: &'static str, line: usize },
}

/// Written when the recording starts, so that even an interrupted one remains readable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingMetadata {
    pub format_version: u32,
    pub id: String,
    pub label: String,
    /// Milliseconds since the Unix epoch.
    pub started_at_ms: u64,
    pub app_version: String,
    pub device: DeviceDetails,
    /// As chosen by the user in the app. It's kept as received, since it's informative.
    pub placement: serde_json::Value,
    pub duration_ms: f64,
    pub emg_samples: u64,
    pub imu_samples: u64,
    pub events: u64,
}

impl RecordingMetadata {
    /// The share of EMG samples missing against the nominal rate, or `None` without EMG.
    fn lost_emg_fraction(&self) -> Option<f64> {
        if self.emg_samples == 0 || self.duration_ms <= 0.0 {
            return None;
        }
        let expected = self.duration_ms / SAMPLE_PERIOD_MS;
        Some((1.0 - self.emg_samples as f64 / expected).max(0.0))
    }
}

/// A recording as listed for the user.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingSummary {
    #[serde(flatten)]
    pub metadata: RecordingMetadata,
    pub size_bytes: u64,
    pub lost_emg_fraction: Option<f64>,
    pub path: String,
}

pub fn new_recording_id() -> String {
    format!("recording-{}", now_ms())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(text.get(index..index + 2)?, 16).ok())
        .collect()
}

fn csv_quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

fn describe_payload(notification: &Notification) -> String {
    let data = &notification.data;
    match notification.source {
        Source::Classifier => ClassifierEvent::parse(data)
            .map_or_else(|error| error.to_string(), |e| format!("{e:?}")),
        Source::Motion => {
            MotionEvent::parse(data).map_or_else(|error| error.to_string(), |e| format!("{e:?}"))
        }
        Source::Battery => {
            parse_battery(data).map_or_else(|error| error.to_string(), |level| format!("{level}%"))
        }
        Source::Mark => String::from_utf8_lossy(data).into_owned(),
        Source::Emg(_) | Source::Imu => String::new(),
    }
}

fn event_kind(source: Source) -> Option<&'static str> {
    match source {
        Source::Classifier => Some("classifier"),
        Source::Motion => Some("motion"),
        Source::Battery => Some("battery"),
        Source::Mark => Some("mark"),
        Source::Emg(_) | Source::Imu => None,
    }
}

fn source_for_kind(kind: &str) -> Option<Source> {
    match kind {
        "classifier" => Some(Source::Classifier),
        "motion" => Some(Source::Motion),
        "battery" => Some(Source::Battery),
        "mark" => Some(Source::Mark),
        _ => None,
    }
}

pub struct Recorder {
    directory: PathBuf,
    metadata: RecordingMetadata,
    started: Instant,
    emg: BufWriter<File>,
    imu: BufWriter<File>,
    events: BufWriter<File>,
}

impl Recorder {
    pub fn start(
        root: &Path,
        id: String,
        label: String,
        device: DeviceDetails,
        placement: serde_json::Value,
    ) -> Result<Self, RecordingError> {
        let directory = root.join(&id);
        fs::create_dir_all(&directory)?;

        let metadata = RecordingMetadata {
            format_version: FORMAT_VERSION,
            id,
            label,
            started_at_ms: now_ms(),
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            device,
            placement,
            duration_ms: 0.0,
            emg_samples: 0,
            imu_samples: 0,
            events: 0,
        };
        write_metadata(&directory, &metadata)?;

        let mut emg = BufWriter::new(File::create(directory.join(EMG_FILE))?);
        writeln!(emg, "time_ms,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8")?;
        let mut imu = BufWriter::new(File::create(directory.join(IMU_FILE))?);
        writeln!(
            imu,
            "time_ms,qw,qx,qy,qz,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps"
        )?;
        let mut events = BufWriter::new(File::create(directory.join(EVENTS_FILE))?);
        writeln!(events, "time_ms,kind,payload_hex,description")?;

        Ok(Self {
            directory,
            metadata,
            started: Instant::now(),
            emg,
            imu,
            events,
        })
    }

    pub fn id(&self) -> &str {
        &self.metadata.id
    }

    pub fn record(&mut self, notification: &Notification) -> Result<(), RecordingError> {
        let time_ms = self.started.elapsed().as_secs_f64() * 1000.0;
        self.record_at(time_ms, notification)
    }

    /// Malformed payloads aren't recorded, matching what the session does with them.
    fn record_at(
        &mut self,
        time_ms: f64,
        notification: &Notification,
    ) -> Result<(), RecordingError> {
        match notification.source {
            Source::Emg(_) => {
                if let Ok(samples) = parse_emg(&notification.data) {
                    for (index, sample) in samples.iter().enumerate() {
                        let values: Vec<String> = sample.iter().map(i8::to_string).collect();
                        writeln!(
                            self.emg,
                            "{:.2},{}",
                            time_ms + index as f64 * SAMPLE_PERIOD_MS,
                            values.join(","),
                        )?;
                        self.metadata.emg_samples += 1;
                    }
                }
            }
            Source::Imu => {
                if let Ok(sample) = ImuSample::parse(&notification.data) {
                    let values: Vec<String> = sample
                        .orientation
                        .iter()
                        .chain(&sample.accelerometer)
                        .chain(&sample.gyroscope)
                        .map(f32::to_string)
                        .collect();
                    writeln!(self.imu, "{time_ms:.2},{}", values.join(","))?;
                    self.metadata.imu_samples += 1;
                }
            }
            source => {
                let kind = event_kind(source).expect("data sources are handled above");
                writeln!(
                    self.events,
                    "{time_ms:.2},{kind},{},{}",
                    hex(&notification.data),
                    csv_quoted(&describe_payload(notification)),
                )?;
                self.metadata.events += 1;
            }
        }
        self.metadata.duration_ms = self.metadata.duration_ms.max(time_ms);
        Ok(())
    }

    /// Completes the files and metadata. A last write failure leaves the data already written.
    pub fn finish(mut self) -> Result<RecordingMetadata, RecordingError> {
        self.metadata.duration_ms = self
            .metadata
            .duration_ms
            .max(self.started.elapsed().as_secs_f64() * 1000.0);
        self.emg.flush()?;
        self.imu.flush()?;
        self.events.flush()?;
        write_metadata(&self.directory, &self.metadata)?;
        Ok(self.metadata)
    }
}

fn write_metadata(directory: &Path, metadata: &RecordingMetadata) -> Result<(), RecordingError> {
    let temporary = directory.join(format!("{METADATA_FILE}.tmp"));
    fs::write(&temporary, serde_json::to_vec_pretty(metadata)?)?;
    fs::rename(temporary, directory.join(METADATA_FILE))?;
    Ok(())
}

/// Ids come from the frontend, so they must not be able to point outside the recordings.
fn recording_directory(root: &Path, id: &str) -> Result<PathBuf, RecordingError> {
    let valid = !id.is_empty()
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-');
    let directory = root.join(id);
    if valid && directory.join(METADATA_FILE).is_file() {
        Ok(directory)
    } else {
        Err(RecordingError::NotFound(id.to_owned()))
    }
}

pub fn read_metadata(root: &Path, id: &str) -> Result<RecordingMetadata, RecordingError> {
    let directory = recording_directory(root, id)?;
    let contents = fs::read(directory.join(METADATA_FILE))?;
    Ok(serde_json::from_slice(&contents)?)
}

fn directory_size(directory: &Path) -> io::Result<u64> {
    let mut total = 0;
    for entry in fs::read_dir(directory)? {
        total += entry?.metadata()?.len();
    }
    Ok(total)
}

/// Lists the recordings, newest first. Folders that aren't valid recordings are skipped.
pub fn list_recordings(root: &Path) -> Result<Vec<RecordingSummary>, RecordingError> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.into()),
    };

    let mut recordings = Vec::new();
    for entry in entries {
        let path = entry?.path();
        let Some(id) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        match read_metadata(root, id) {
            Ok(metadata) => recordings.push(RecordingSummary {
                lost_emg_fraction: metadata.lost_emg_fraction(),
                size_bytes: directory_size(&path)?,
                path: path.to_string_lossy().into_owned(),
                metadata,
            }),
            Err(error) => log::warn!("Skipping recording {id}: {error}"),
        }
    }
    recordings.sort_by_key(|recording| std::cmp::Reverse(recording.metadata.started_at_ms));
    Ok(recordings)
}

pub fn delete_recording(root: &Path, id: &str) -> Result<(), RecordingError> {
    fs::remove_dir_all(recording_directory(root, id)?)?;
    Ok(())
}

/// A recorded notification, at the time it should be replayed.
#[derive(Debug, Clone, PartialEq)]
pub struct TimedNotification {
    pub time_ms: f64,
    pub notification: Notification,
}

fn data_lines(
    directory: &Path,
    file: &'static str,
) -> Result<impl Iterator<Item = (usize, io::Result<String>)>, RecordingError> {
    let reader = BufReader::new(File::open(directory.join(file))?);
    // The first line holds the column names. Numbers count from 1 for error messages.
    Ok(reader
        .lines()
        .enumerate()
        .skip(1)
        .map(|(index, line)| (index + 1, line)))
}

fn parse_row(line: &str) -> Option<Vec<f64>> {
    line.split(',').map(|value| value.parse().ok()).collect()
}

/// Reads a recording back as the notifications that produced it, in time order.
pub fn load_notifications(root: &Path, id: &str) -> Result<Vec<TimedNotification>, RecordingError> {
    let directory = recording_directory(root, id)?;
    let mut timed = Vec::new();

    let mut pending: Option<(f64, [i8; 8])> = None;
    let mut characteristic = 0u8;
    for (line_number, line) in data_lines(&directory, EMG_FILE)? {
        let line = line?;
        let invalid = || RecordingError::InvalidData {
            file: EMG_FILE,
            line: line_number,
        };
        let row = parse_row(&line)
            .filter(|row| row.len() == 9)
            .ok_or_else(invalid)?;
        let mut sample = [0i8; 8];
        for (value, target) in row[1..].iter().zip(&mut sample) {
            *target = *value as i8;
        }
        // Each notification carries two samples. An unpaired last one can't be replayed.
        match pending.take() {
            None => pending = Some((row[0], sample)),
            Some((time_ms, first)) => {
                timed.push(TimedNotification {
                    time_ms,
                    notification: Notification {
                        source: Source::Emg(characteristic),
                        data: encode_emg(&[first, sample]).to_vec(),
                    },
                });
                characteristic = (characteristic + 1) % 4;
            }
        }
    }

    for (line_number, line) in data_lines(&directory, IMU_FILE)? {
        let line = line?;
        let invalid = || RecordingError::InvalidData {
            file: IMU_FILE,
            line: line_number,
        };
        let row = parse_row(&line)
            .filter(|row| row.len() == 11)
            .ok_or_else(invalid)?;
        let value = |index: usize| row[index + 1] as f32;
        let sample = ImuSample {
            orientation: [value(0), value(1), value(2), value(3)],
            accelerometer: [value(4), value(5), value(6)],
            gyroscope: [value(7), value(8), value(9)],
        };
        let data: [u8; IMU_PACKET_LEN] = sample.encode();
        timed.push(TimedNotification {
            time_ms: row[0],
            notification: Notification {
                source: Source::Imu,
                data: data.to_vec(),
            },
        });
    }

    for (line_number, line) in data_lines(&directory, EVENTS_FILE)? {
        let line = line?;
        let invalid = || RecordingError::InvalidData {
            file: EVENTS_FILE,
            line: line_number,
        };
        // The description comes last and may contain commas, and isn't needed to replay.
        let mut columns = line.splitn(4, ',');
        let time_ms = columns.next().and_then(|value| value.parse().ok());
        let source = columns.next().and_then(source_for_kind);
        let data = columns.next().and_then(from_hex);
        let (Some(time_ms), Some(source), Some(data)) = (time_ms, source, data) else {
            return Err(invalid());
        };
        timed.push(TimedNotification {
            time_ms,
            notification: Notification { source, data },
        });
    }

    timed.sort_by(|a, b| a.time_ms.total_cmp(&b.time_ms));
    Ok(timed)
}

fn csv_rows_as_json(directory: &Path, file: &'static str) -> Result<Vec<Vec<f64>>, RecordingError> {
    let mut rows = Vec::new();
    for (line_number, line) in data_lines(directory, file)? {
        let line = line?;
        rows.push(parse_row(&line).ok_or(RecordingError::InvalidData {
            file,
            line: line_number,
        })?);
    }
    Ok(rows)
}

/// Writes everything in the recording to one JSON file in its folder, and returns its path.
pub fn export_json(root: &Path, id: &str) -> Result<PathBuf, RecordingError> {
    let directory = recording_directory(root, id)?;
    let metadata = read_metadata(root, id)?;

    let events: Vec<serde_json::Value> = load_notifications(root, id)?
        .into_iter()
        .filter_map(|timed| {
            let kind = event_kind(timed.notification.source)?;
            Some(serde_json::json!({
                "timeMs": timed.time_ms,
                "kind": kind,
                "payloadHex": hex(&timed.notification.data),
                "description": describe_payload(&timed.notification),
            }))
        })
        .collect();

    let export = serde_json::json!({
        "metadata": metadata,
        "emgColumns": ["time_ms", "ch1", "ch2", "ch3", "ch4", "ch5", "ch6", "ch7", "ch8"],
        "emg": csv_rows_as_json(&directory, EMG_FILE)?,
        "imuColumns": ["time_ms", "qw", "qx", "qy", "qz", "ax_g", "ay_g", "az_g", "gx_dps", "gy_dps", "gz_dps"],
        "imu": csv_rows_as_json(&directory, IMU_FILE)?,
        "events": events,
    });

    let path = directory.join(JSON_EXPORT_FILE);
    fs::write(&path, serde_json::to_vec(&export)?)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::myo::protocol::{
        FirmwareVersion, HardwareRev, LATEST_KNOWN_FIRMWARE, MyoInfo, Pose, Sku,
    };

    fn temporary_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "galvani-recorder-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        root
    }

    fn device() -> DeviceDetails {
        DeviceDetails {
            name: "Test Myo".to_owned(),
            info: MyoInfo {
                serial_number: [1, 2, 3, 4, 5, 6],
                unlock_pose: Pose::DoubleTap,
                active_classifier_type: 0,
                active_classifier_index: 0,
                has_custom_classifier: false,
                stream_indicating: false,
                sku: Sku::Black,
            },
            firmware: FirmwareVersion {
                hardware_rev: HardwareRev::RevD,
                ..LATEST_KNOWN_FIRMWARE
            },
            firmware_outdated: false,
            battery: 80,
        }
    }

    fn start(root: &Path, id: &str) -> Recorder {
        Recorder::start(
            root,
            id.to_owned(),
            "A test, with \"quotes\"".to_owned(),
            device(),
            serde_json::json!({ "arm": "right" }),
        )
        .unwrap()
    }

    fn sample_notifications() -> Vec<(f64, Notification)> {
        let mut emg = [0u8; 16];
        for (index, byte) in emg.iter_mut().enumerate() {
            *byte = (index as i8 - 8) as u8;
        }
        let imu = ImuSample {
            orientation: [1.0, 0.0, 0.0, 0.0],
            accelerometer: [0.5, -0.5, 1.0],
            gyroscope: [10.0, -10.0, 0.0],
        };
        vec![
            (
                10.0,
                Notification {
                    source: Source::Emg(0),
                    data: emg.to_vec(),
                },
            ),
            (
                20.0,
                Notification {
                    source: Source::Imu,
                    data: imu.encode().to_vec(),
                },
            ),
            (
                30.0,
                Notification {
                    source: Source::Classifier,
                    data: vec![3, 1, 0],
                },
            ),
            (
                40.0,
                Notification {
                    source: Source::Mark,
                    data: "first, try".as_bytes().to_vec(),
                },
            ),
            (
                50.0,
                Notification {
                    source: Source::Battery,
                    data: vec![79],
                },
            ),
        ]
    }

    #[tokio::test(start_paused = true)]
    async fn replays_exactly_what_was_recorded() {
        let root = temporary_root("round-trip");
        let mut recorder = start(&root, "recording-1");
        for (time_ms, notification) in sample_notifications() {
            recorder.record_at(time_ms, &notification).unwrap();
        }
        recorder.finish().unwrap();

        let loaded = load_notifications(&root, "recording-1").unwrap();
        let expected: Vec<_> = sample_notifications()
            .into_iter()
            .map(|(time_ms, notification)| TimedNotification {
                time_ms,
                notification,
            })
            .collect();
        assert_eq!(loaded, expected);
    }

    #[tokio::test(start_paused = true)]
    async fn counts_samples_in_the_metadata() {
        let root = temporary_root("metadata");
        let mut recorder = start(&root, "recording-1");
        for (time_ms, notification) in sample_notifications() {
            recorder.record_at(time_ms, &notification).unwrap();
        }
        let metadata = recorder.finish().unwrap();

        assert_eq!(metadata.emg_samples, 2);
        assert_eq!(metadata.imu_samples, 1);
        assert_eq!(metadata.events, 3);
        assert_eq!(metadata.duration_ms, 50.0);

        let read = read_metadata(&root, "recording-1").unwrap();
        assert_eq!(read.label, "A test, with \"quotes\"");
        assert_eq!(read.device.name, "Test Myo");
    }

    #[tokio::test(start_paused = true)]
    async fn writes_readable_csv_files() {
        let root = temporary_root("csv");
        let mut recorder = start(&root, "recording-1");
        for (time_ms, notification) in sample_notifications() {
            recorder.record_at(time_ms, &notification).unwrap();
        }
        recorder.finish().unwrap();

        let directory = root.join("recording-1");
        let emg = fs::read_to_string(directory.join(EMG_FILE)).unwrap();
        let lines: Vec<&str> = emg.lines().collect();
        assert_eq!(lines[0], "time_ms,ch1,ch2,ch3,ch4,ch5,ch6,ch7,ch8");
        assert_eq!(lines[1], "10.00,-8,-7,-6,-5,-4,-3,-2,-1");
        // The second sample of a notification comes one sample period later.
        assert_eq!(lines[2], "15.00,0,1,2,3,4,5,6,7");

        let events = fs::read_to_string(directory.join(EVENTS_FILE)).unwrap();
        assert!(events.contains("40.00,mark,66697273742c20747279,\"first, try\""));
        assert!(events.contains("Pose"));
    }

    #[tokio::test(start_paused = true)]
    async fn keeps_an_unfinished_recording_listed() {
        let root = temporary_root("unfinished");
        let recorder = start(&root, "recording-1");
        drop(recorder);

        let recordings = list_recordings(&root).unwrap();
        assert_eq!(recordings.len(), 1);
        assert_eq!(recordings[0].metadata.emg_samples, 0);
        assert!(load_notifications(&root, "recording-1").unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn lists_newest_first_and_skips_other_folders() {
        let root = temporary_root("list");
        let mut older = start(&root, "recording-1");
        older.metadata.started_at_ms = 1000;
        older.finish().unwrap();
        let mut newer = start(&root, "recording-2");
        newer.metadata.started_at_ms = 2000;
        newer.finish().unwrap();
        fs::create_dir_all(root.join("not-a-recording")).unwrap();

        let recordings = list_recordings(&root).unwrap();
        let ids: Vec<&str> = recordings.iter().map(|r| r.metadata.id.as_str()).collect();
        assert_eq!(ids, ["recording-2", "recording-1"]);
        assert!(recordings[0].size_bytes > 0);
    }

    #[test]
    fn listing_without_a_folder_gives_nothing() {
        let root = temporary_root("missing");
        assert!(list_recordings(&root).unwrap().is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn estimates_lost_samples() {
        let root = temporary_root("lost");
        let mut metadata = start(&root, "recording-1").finish().unwrap();
        assert_eq!(metadata.lost_emg_fraction(), None);

        metadata.duration_ms = 1000.0;
        metadata.emg_samples = 150;
        assert_eq!(metadata.lost_emg_fraction(), Some(0.25));
    }

    #[tokio::test(start_paused = true)]
    async fn deletes_only_real_recordings() {
        let root = temporary_root("delete");
        start(&root, "recording-1").finish().unwrap();
        let outside = temporary_root("delete-outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join(METADATA_FILE), "{}").unwrap();

        // None of these may reach anything outside the recordings folder.
        for id in [
            "../galvani-outside",
            "..",
            "",
            "a/b",
            outside.to_str().unwrap(),
        ] {
            assert!(matches!(
                delete_recording(&root, id),
                Err(RecordingError::NotFound(_))
            ));
        }
        assert!(outside.join(METADATA_FILE).exists());

        delete_recording(&root, "recording-1").unwrap();
        assert!(!root.join("recording-1").exists());
        assert!(matches!(
            delete_recording(&root, "recording-1"),
            Err(RecordingError::NotFound(_))
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn reports_corrupted_data() {
        let root = temporary_root("corrupt");
        start(&root, "recording-1").finish().unwrap();
        fs::write(
            root.join("recording-1").join(EMG_FILE),
            "header\n1,2,not-a-number\n",
        )
        .unwrap();
        assert!(matches!(
            load_notifications(&root, "recording-1"),
            Err(RecordingError::InvalidData { line: 2, .. })
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn exports_everything_to_json() {
        let root = temporary_root("export");
        let mut recorder = start(&root, "recording-1");
        for (time_ms, notification) in sample_notifications() {
            recorder.record_at(time_ms, &notification).unwrap();
        }
        recorder.finish().unwrap();

        let path = export_json(&root, "recording-1").unwrap();
        let export: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(export["metadata"]["emgSamples"], 2);
        assert_eq!(export["emg"].as_array().unwrap().len(), 2);
        assert_eq!(export["imu"].as_array().unwrap().len(), 1);
        assert_eq!(export["events"].as_array().unwrap().len(), 3);
        assert_eq!(export["events"][1]["description"], "first, try");
    }

    #[test]
    fn converts_hexadecimal_both_ways() {
        assert_eq!(from_hex(&hex(&[0, 1, 255])), Some(vec![0, 1, 255]));
        assert_eq!(from_hex("abc"), None);
        assert_eq!(from_hex("zz"), None);
    }
}
