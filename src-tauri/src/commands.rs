//! Tauri commands exposed to the frontend.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State};
use tokio::sync::{Mutex, OnceCell};

use crate::myo::device::{DeviceDetails, Session, SessionEvent, SessionSink, StreamModes};
use crate::myo::protocol::{
    Command, SleepMode, UnlockType, VIBRATE2_STEPS, VibrationStep, VibrationType,
};
use crate::myo::recorder::{self, Recorder, RecordingError, RecordingMetadata, RecordingSummary};
use crate::myo::transport::ble::{BleScanner, DiscoveredDevice};
use crate::myo::transport::mock::MockTransport;
use crate::myo::transport::playback::{PlaybackStatus, PlaybackTransport};
use crate::myo::transport::{MyoTransport, TransportError};
use crate::shell::{SessionNotifier, Shell};

const SIMULATION_SEED: u64 = 0x4741_4c56_414e_4921;
const SCAN_DURATION: Duration = Duration::from_secs(4);

#[derive(Default)]
pub struct AppState {
    session: Mutex<Option<Session>>,
    playback: std::sync::Mutex<Option<Arc<PlaybackTransport>>>,
    /// Created on first use, because it can trigger the Bluetooth permission prompt.
    scanner: OnceCell<BleScanner>,
}

impl AppState {
    async fn scanner(&self) -> Result<&BleScanner, TransportError> {
        self.scanner.get_or_try_init(BleScanner::new).await
    }

    /// Ends the current session, if any. Doing nothing when there is none keeps this safe
    /// to call after the device has dropped the connection, or after a frontend reload.
    pub async fn end_session(&self) -> Result<(), TransportError> {
        *self.playback.lock().expect("playback lock poisoned") = None;
        let session = self.session.lock().await.take();
        if let Some(session) = session {
            session.stop().await?;
            log::info!("Disconnected");
        }
        Ok(())
    }
}

/// Machine-readable errors. The frontend translates them from the `code`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommandError {
    AlreadyConnected,
    DeviceDisconnected,
    AdapterNotFound,
    BluetoothOff,
    BluetoothUnavailable,
    PermissionDenied,
    DeviceNotFound,
    ConnectionTimedOut,
    NotAMyo,
    BluetoothError,
    InvalidPattern,
    RecordingFailed,
    NotRecording,
    AlreadyRecording,
}

impl From<TransportError> for CommandError {
    fn from(error: TransportError) -> Self {
        log::warn!("Transport error: {error}");
        match error {
            TransportError::Disconnected => Self::DeviceDisconnected,
            TransportError::AdapterNotFound => Self::AdapterNotFound,
            TransportError::BluetoothOff => Self::BluetoothOff,
            TransportError::BluetoothUnavailable => Self::BluetoothUnavailable,
            TransportError::PermissionDenied => Self::PermissionDenied,
            TransportError::DeviceNotFound => Self::DeviceNotFound,
            TransportError::TimedOut => Self::ConnectionTimedOut,
            TransportError::NotAMyo(_) => Self::NotAMyo,
            TransportError::InvalidData(_) | TransportError::Bluetooth(_) => Self::BluetoothError,
        }
    }
}

impl From<RecordingError> for CommandError {
    fn from(error: RecordingError) -> Self {
        log::error!("Recording error: {error}");
        Self::RecordingFailed
    }
}

struct ChannelSink {
    frames: Channel<InvokeResponseBody>,
    analysis: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
    /// A hidden webview may not process messages, so samples would just pile up in memory.
    window_visible: Arc<AtomicBool>,
    /// `None` for recordings, whose events aren't happening now.
    notifier: Option<SessionNotifier>,
}

impl SessionSink for ChannelSink {
    fn send_frame(&mut self, frame: Vec<u8>) -> bool {
        !self.window_visible.load(Ordering::Relaxed)
            || self.frames.send(InvokeResponseBody::Raw(frame)).is_ok()
    }

    fn send_analysis(&mut self, frame: Vec<u8>) -> bool {
        !self.window_visible.load(Ordering::Relaxed)
            || self.analysis.send(InvokeResponseBody::Raw(frame)).is_ok()
    }

    fn send_event(&mut self, event: SessionEvent) -> bool {
        if let Some(notifier) = &mut self.notifier {
            notifier.on_event(&event);
        }
        self.events.send(event).is_ok()
    }
}

/// Starts a session on an already connected transport, and stores it as the current one.
async fn begin_session(
    app: AppHandle,
    live: bool,
    current: &mut Option<Session>,
    transport: Arc<dyn MyoTransport>,
    frames: Channel<InvokeResponseBody>,
    analysis: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<DeviceDetails, CommandError> {
    let notifier = if live {
        let mut notifier = SessionNotifier::new(app.clone());
        if let Ok(level) = transport.read_battery().await {
            notifier.check_battery(level);
        }
        Some(notifier)
    } else {
        None
    };
    let sink = ChannelSink {
        frames,
        analysis,
        events,
        window_visible: app.state::<Shell>().window_visible(),
        notifier,
    };
    match Session::start(Arc::clone(&transport), sink).await {
        Ok((session, details)) => {
            *current = Some(session);
            log::info!(
                "Connected to {}, firmware {}.{}.{}",
                details.name,
                details.firmware.major,
                details.firmware.minor,
                details.firmware.patch,
            );
            Ok(details)
        }
        Err(error) => {
            // A connection that failed halfway shouldn't stay open.
            if let Err(disconnect_error) = transport.disconnect().await {
                log::debug!("Could not disconnect: {disconnect_error}");
            }
            Err(error.into())
        }
    }
}

#[tauri::command]
pub async fn connect_simulated(
    app: AppHandle,
    state: State<'_, AppState>,
    frames: Channel<InvokeResponseBody>,
    analysis: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<DeviceDetails, CommandError> {
    let mut current = state.session.lock().await;
    if current.is_some() {
        return Err(CommandError::AlreadyConnected);
    }
    let transport = Arc::new(MockTransport::new(SIMULATION_SEED));
    begin_session(app, true, &mut current, transport, frames, analysis, events).await
}

#[tauri::command]
pub async fn scan_devices(
    state: State<'_, AppState>,
) -> Result<Vec<DiscoveredDevice>, CommandError> {
    Ok(state.scanner().await?.scan(SCAN_DURATION).await?)
}

#[tauri::command]
pub async fn connect_device(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    name: String,
    frames: Channel<InvokeResponseBody>,
    analysis: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<DeviceDetails, CommandError> {
    let mut current = state.session.lock().await;
    if current.is_some() {
        return Err(CommandError::AlreadyConnected);
    }
    let transport = state.scanner().await?.connect(&id, name).await?;
    begin_session(
        app,
        true,
        &mut current,
        Arc::new(transport),
        frames,
        analysis,
        events,
    )
    .await
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), CommandError> {
    Ok(state.end_session().await?)
}

/// Runs an action on the current session, failing if there isn't one.
async fn with_session<'a>(
    state: &'a State<'_, AppState>,
) -> Result<tokio::sync::MappedMutexGuard<'a, Session>, CommandError> {
    tokio::sync::MutexGuard::try_map(state.session.lock().await, Option::as_mut)
        .map_err(|_| CommandError::DeviceDisconnected)
}

#[tauri::command]
pub async fn vibrate(
    state: State<'_, AppState>,
    vibration: VibrationType,
) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    Ok(session.send(Command::Vibrate(vibration)).await?)
}

/// Plays up to 6 vibration steps. The protocol has a fixed size, so unused steps are empty.
#[tauri::command]
pub async fn vibrate_pattern(
    state: State<'_, AppState>,
    steps: Vec<VibrationStep>,
) -> Result<(), CommandError> {
    if steps.len() > VIBRATE2_STEPS {
        return Err(CommandError::InvalidPattern);
    }
    let mut pattern = [VibrationStep::default(); VIBRATE2_STEPS];
    pattern[..steps.len()].copy_from_slice(&steps);
    let session = with_session(&state).await?;
    Ok(session.send(Command::Vibrate2(pattern)).await?)
}

#[tauri::command]
pub async fn set_stream_modes(
    state: State<'_, AppState>,
    modes: StreamModes,
) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    Ok(session.set_modes(modes).await?)
}

#[tauri::command]
pub async fn unlock(state: State<'_, AppState>, unlock: UnlockType) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    Ok(session.send(Command::Unlock(unlock)).await?)
}

#[tauri::command]
pub async fn set_sleep_mode(
    state: State<'_, AppState>,
    sleep: SleepMode,
) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    Ok(session.set_sleep_mode(sleep).await?)
}

#[tauri::command]
pub async fn set_leds(
    state: State<'_, AppState>,
    logo: [u8; 3],
    line: [u8; 3],
) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    Ok(session.send(Command::SetLeds { logo, line }).await?)
}

#[tauri::command]
pub async fn deep_sleep(state: State<'_, AppState>) -> Result<(), CommandError> {
    let session = state.session.lock().await.take();
    let session = session.ok_or(CommandError::DeviceDisconnected)?;
    session.deep_sleep().await?;
    log::info!("The device went into deep sleep");
    Ok(())
}

fn recordings_root(app: &AppHandle) -> Result<std::path::PathBuf, CommandError> {
    let directory = app.path().app_data_dir().map_err(|error| {
        log::error!("Could not locate the recordings folder: {error}");
        CommandError::RecordingFailed
    })?;
    Ok(directory.join("recordings"))
}

#[tauri::command]
pub async fn start_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    label: String,
    placement: serde_json::Value,
) -> Result<String, CommandError> {
    let root = recordings_root(&app)?;
    let session = with_session(&state).await?;
    if session.is_recording() {
        return Err(CommandError::AlreadyRecording);
    }
    let recorder = Recorder::start(
        &root,
        recorder::new_recording_id(),
        label,
        session.details().clone(),
        placement,
    )?;
    let id = recorder.id().to_owned();
    session.start_recording(recorder);
    log::info!("Recording {id}");
    Ok(id)
}

#[tauri::command]
pub async fn stop_recording(state: State<'_, AppState>) -> Result<RecordingMetadata, CommandError> {
    let session = with_session(&state).await?;
    let metadata = session
        .stop_recording()?
        .ok_or(CommandError::NotRecording)?;
    log::info!("Saved recording {}", metadata.id);
    Ok(metadata)
}

#[tauri::command]
pub async fn add_mark(state: State<'_, AppState>, label: String) -> Result<(), CommandError> {
    let session = with_session(&state).await?;
    if !session.is_recording() {
        return Err(CommandError::NotRecording);
    }
    Ok(session.add_mark(&label)?)
}

#[tauri::command]
pub fn list_recordings(app: AppHandle) -> Result<Vec<RecordingSummary>, CommandError> {
    Ok(recorder::list_recordings(&recordings_root(&app)?)?)
}

#[tauri::command]
pub fn delete_recording(app: AppHandle, id: String) -> Result<(), CommandError> {
    recorder::delete_recording(&recordings_root(&app)?, &id)?;
    log::info!("Deleted recording {id}");
    Ok(())
}

#[tauri::command]
pub fn export_recording_json(app: AppHandle, id: String) -> Result<String, CommandError> {
    let path = recorder::export_json(&recordings_root(&app)?, &id)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Plays a recording back through the same path as a live device.
#[tauri::command]
pub async fn open_recording(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    frames: Channel<InvokeResponseBody>,
    analysis: Channel<InvokeResponseBody>,
    events: Channel<SessionEvent>,
) -> Result<DeviceDetails, CommandError> {
    let mut current = state.session.lock().await;
    if current.is_some() {
        return Err(CommandError::AlreadyConnected);
    }
    let root = recordings_root(&app)?;
    let metadata = recorder::read_metadata(&root, &id)?;
    let notifications = recorder::load_notifications(&root, &id)?;
    let transport = Arc::new(PlaybackTransport::new(
        metadata.device,
        notifications,
        metadata.duration_ms,
    ));
    let details = begin_session(
        app,
        false,
        &mut current,
        Arc::clone(&transport) as Arc<dyn MyoTransport>,
        frames,
        analysis,
        events,
    )
    .await?;
    *state.playback.lock().expect("playback lock poisoned") = Some(transport);
    log::info!("Playing recording {id}");
    Ok(details)
}

fn with_playback<T>(
    state: &State<'_, AppState>,
    action: impl FnOnce(&PlaybackTransport) -> T,
) -> Result<T, CommandError> {
    state
        .playback
        .lock()
        .expect("playback lock poisoned")
        .as_deref()
        .map(action)
        .ok_or(CommandError::DeviceDisconnected)
}

#[tauri::command]
pub fn playback_status(state: State<'_, AppState>) -> Result<PlaybackStatus, CommandError> {
    with_playback(&state, PlaybackTransport::status)
}

#[tauri::command]
pub fn playback_set_playing(state: State<'_, AppState>, playing: bool) -> Result<(), CommandError> {
    with_playback(&state, |playback| playback.set_playing(playing))
}

#[tauri::command]
pub fn playback_set_speed(state: State<'_, AppState>, speed: f64) -> Result<(), CommandError> {
    with_playback(&state, |playback| playback.set_speed(speed))
}

#[tauri::command]
pub fn playback_seek(state: State<'_, AppState>, position_ms: f64) -> Result<(), CommandError> {
    with_playback(&state, |playback| playback.seek(position_ms))
}
