mod commands;
mod myo;
mod profile;
mod shell;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};
#[cfg(desktop)]
use tauri_plugin_window_state::StateFlags;

const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;
const KEPT_LOG_FILES: usize = 5;
const EXIT_TIMEOUT: Duration = Duration::from_secs(3);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered before any other plugin.
    // The window-state plugin must be registered on the builder, not in `setup`:
    // windows from tauri.conf.json are created before `setup` runs, so the plugin
    // would miss them and never restore or save their state.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                shell::show_main_window(app);
            }))
            .plugin(
                tauri_plugin_window_state::Builder::default()
                    // Visibility isn't restored, or quitting from the background would
                    // make the next launch start with no window.
                    .with_state_flags(StateFlags::all() - StateFlags::VISIBLE)
                    .build(),
            );
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .target(Target::new(TargetKind::Stdout))
                .target(Target::new(TargetKind::LogDir { file_name: None }))
                .level(log_level)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(MAX_LOG_FILE_BYTES)
                .rotation_strategy(RotationStrategy::KeepSome(KEPT_LOG_FILES))
                .build(),
        )
        .manage(commands::AppState::default())
        .manage(shell::Shell::default())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            // The window starts hidden, so that the saved position applies without a flash.
            #[cfg(desktop)]
            {
                shell::setup_tray(app.handle())?;
                shell::show_main_window(app.handle());
            }

            log::info!("Galvani {} started", app.package_info().version);
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window leaves the app running in the background. Quitting is
            // available from the tray menu and the app menu.
            #[cfg(desktop)]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                shell::hide_main_window(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::connect_simulated,
            commands::connect_device,
            commands::scan_devices,
            commands::disconnect,
            commands::vibrate,
            commands::vibrate_pattern,
            commands::set_stream_modes,
            commands::unlock,
            commands::set_sleep_mode,
            commands::deep_sleep,
            commands::set_leds,
            profile::load_gesture_model,
            profile::save_gesture_model,
            commands::start_recording,
            commands::stop_recording,
            commands::add_mark,
            commands::list_recordings,
            commands::delete_recording,
            commands::export_recording_json,
            commands::open_recording,
            commands::playback_status,
            commands::playback_set_playing,
            commands::playback_set_speed,
            commands::playback_seek,
            shell::set_language,
            profile::load_profile,
            profile::save_profile
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Clicking the Dock icon brings the window back.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => shell::show_main_window(app),
            // Returns the armband to its normal sleep mode instead of leaving it awake.
            tauri::RunEvent::Exit => {
                let state = app.state::<commands::AppState>();
                // The timeout must be created inside the runtime, or Tokio panics.
                let result = tauri::async_runtime::block_on(async {
                    tokio::time::timeout(EXIT_TIMEOUT, state.end_session()).await
                });
                match result {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => log::warn!("Could not end the session cleanly: {error}"),
                    Err(_) => log::warn!("Timed out ending the session"),
                }
            }
            _ => {}
        });
}
