//! The armband placement and user calibration, stored as one local JSON file.
//!
//! The file holds per-channel statistics only, never recordings of the signal.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const FILE_NAME: &str = "profile.json";
const GESTURES_FILE_NAME: &str = "gestures.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlacementArm {
    Left,
    Right,
}

/// The end of the forearm that the armband's blue LED line points to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineDirection {
    Wrist,
    Elbow,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub arm: PlacementArm,
    pub line_toward: LineDirection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calibration {
    /// Placement stated by the user when calibrating.
    pub placement: Placement,
    pub calibrated_at: String,
    /// RMS of each channel at rest.
    pub noise_floor: [f32; 8],
    /// Highest short-term RMS of each channel during a firm fist.
    pub max_activation: [f32; 8],
    pub wave_in_activation: [f32; 8],
    pub wave_out_activation: [f32; 8],
    /// Zero-based index of the most active channel during each gesture.
    pub wave_in_channel: u8,
    pub wave_out_channel: u8,
    /// Mean X acceleration in g with the arm hanging down, which reveals the band's direction.
    pub hanging_accelerometer_x: f32,
    /// Orientation with the arm extended forward, in `w, x, y, z` order.
    pub reference_orientation: [f32; 4],
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub placement: Option<Placement>,
    pub calibration: Option<Calibration>,
}

/// A gesture trained by the user, as the features of each recorded repetition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrainedGesture {
    pub name: String,
    /// Which illustration to show, for the gestures that have one.
    pub illustration: Option<String>,
    pub repetitions: Vec<Vec<Vec<f32>>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GestureModel {
    pub gestures: Vec<TrainedGesture>,
}

/// A missing or unreadable file gives an empty value, because the user can recreate it.
fn load_from<T: Default + serde::de::DeserializeOwned>(path: &Path) -> T {
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return T::default(),
        Err(error) => {
            log::warn!("Could not read {}: {error}", path.display());
            return T::default();
        }
    };
    serde_json::from_str(&contents).unwrap_or_else(|error| {
        log::warn!("Ignoring the invalid file {}: {error}", path.display());
        T::default()
    })
}

/// Writes to a temporary file first, so that a crash can't leave a truncated profile.
fn save_to<T: Serialize>(path: &Path, value: &T) -> io::Result<()> {
    if let Some(directory) = path.parent() {
        fs::create_dir_all(directory)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, serde_json::to_vec_pretty(value)?)?;
    fs::rename(&temporary, path)
}

fn config_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, ProfileError> {
    let directory = app.path().app_config_dir().map_err(|error| {
        log::error!("Could not locate the profile directory: {error}");
        ProfileError::ProfileNotSaved
    })?;
    Ok(directory.join(file_name))
}

/// Machine-readable error, translated by the frontend.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileError {
    ProfileNotSaved,
}

#[tauri::command]
pub fn load_profile(app: AppHandle) -> Result<Profile, ProfileError> {
    Ok(load_from(&config_path(&app, FILE_NAME)?))
}

#[tauri::command]
pub fn save_profile(app: AppHandle, profile: Profile) -> Result<(), ProfileError> {
    save_to(&config_path(&app, FILE_NAME)?, &profile).map_err(|error| {
        log::error!("Could not save the profile: {error}");
        ProfileError::ProfileNotSaved
    })
}

#[tauri::command]
pub fn load_gesture_model(app: AppHandle) -> Result<GestureModel, ProfileError> {
    Ok(load_from(&config_path(&app, GESTURES_FILE_NAME)?))
}

#[tauri::command]
pub fn save_gesture_model(app: AppHandle, model: GestureModel) -> Result<(), ProfileError> {
    save_to(&config_path(&app, GESTURES_FILE_NAME)?, &model).map_err(|error| {
        log::error!("Could not save the gestures: {error}");
        ProfileError::ProfileNotSaved
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_path(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "galvani-profile-test-{}-{name}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&directory);
        directory.join(FILE_NAME)
    }

    fn sample_profile() -> Profile {
        let placement = Placement {
            arm: PlacementArm::Left,
            line_toward: LineDirection::Wrist,
        };
        Profile {
            placement: Some(placement),
            calibration: Some(Calibration {
                placement,
                calibrated_at: "2026-11-04T20:00:00Z".to_owned(),
                noise_floor: [1.0; 8],
                max_activation: [40.0; 8],
                wave_in_activation: [10.0; 8],
                wave_out_activation: [20.0; 8],
                wave_in_channel: 2,
                wave_out_channel: 6,
                hanging_accelerometer_x: -0.98,
                reference_orientation: [1.0, 0.0, 0.0, 0.0],
            }),
        }
    }

    #[test]
    fn saves_and_loads_a_profile() {
        let path = temporary_path("round-trip");
        save_to(&path, &sample_profile()).unwrap();
        assert_eq!(load_from::<Profile>(&path), sample_profile());
        assert!(!path.with_extension("json.tmp").exists());
    }

    #[test]
    fn a_missing_file_gives_an_empty_profile() {
        assert_eq!(
            load_from::<Profile>(&temporary_path("missing")),
            Profile::default()
        );
    }

    #[test]
    fn an_invalid_file_gives_an_empty_profile() {
        let path = temporary_path("invalid");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ not json").unwrap();
        assert_eq!(load_from::<Profile>(&path), Profile::default());
    }

    #[test]
    fn saves_and_loads_a_gesture_model() {
        let path = temporary_path("gestures");
        let model = GestureModel {
            gestures: vec![TrainedGesture {
                name: "Fist".to_owned(),
                illustration: Some("fist".to_owned()),
                repetitions: vec![vec![vec![1.5; 8]]],
            }],
        };
        save_to(&path, &model).unwrap();
        assert_eq!(load_from::<GestureModel>(&path), model);
    }

    #[test]
    fn serializes_with_the_names_the_frontend_expects() {
        let json = serde_json::to_value(sample_profile()).unwrap();
        assert_eq!(json["placement"]["lineToward"], "wrist");
        assert_eq!(json["calibration"]["waveInChannel"], 2);
    }
}
