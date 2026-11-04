//! The app's presence outside its window: tray icon, background mode and notifications.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;

use crate::myo::device::SessionEvent;

const MAIN_WINDOW: &str = "main";
const MENU_SHOW: &str = "show";
const MENU_QUIT: &str = "quit";
const LOW_BATTERY_PERCENT: u8 = 15;
/// Warns again only after recovering past this, so that readings near the limit don't repeat it.
const BATTERY_RECOVERED_PERCENT: u8 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Es,
}

#[derive(Debug, Clone, Copy)]
enum Text {
    ShowWindow,
    Quit,
    RunningInBackground,
    RunningInBackgroundDetail,
    LowBattery,
    LowBatteryDetail,
    ConnectionLost,
    ConnectionLostDetail,
    Reconnected,
    Disconnected,
    DisconnectedDetail,
}

/// Texts shown outside the webview. The frontend's translations can't reach them there.
fn text(language: Language, key: Text) -> &'static str {
    match (language, key) {
        (Language::En, Text::ShowWindow) => "Show Galvani",
        (Language::Es, Text::ShowWindow) => "Mostrar Galvani",
        (Language::En, Text::Quit) => "Quit Galvani",
        (Language::Es, Text::Quit) => "Salir de Galvani",
        (Language::En, Text::RunningInBackground) => "Galvani is still running",
        (Language::Es, Text::RunningInBackground) => "Galvani sigue en marcha",
        (Language::En, Text::RunningInBackgroundDetail) => {
            "It stays connected in the background. Use the menu bar icon to open or quit it."
        }
        (Language::Es, Text::RunningInBackgroundDetail) => {
            "Sigue conectada en segundo plano. Usa el icono de la barra de menús para abrirla o salir."
        }
        (Language::En, Text::LowBattery) => "Myo battery is low",
        (Language::Es, Text::LowBattery) => "Batería del Myo baja",
        (Language::En, Text::LowBatteryDetail) => "Charge it soon to avoid losing the connection.",
        (Language::Es, Text::LowBatteryDetail) => "Cárgalo pronto para no perder la conexión.",
        (Language::En, Text::ConnectionLost) => "Myo connection lost",
        (Language::Es, Text::ConnectionLost) => "Conexión con el Myo perdida",
        (Language::En, Text::ConnectionLostDetail) => "Trying to reconnect…",
        (Language::Es, Text::ConnectionLostDetail) => "Intentando reconectar…",
        (Language::En, Text::Reconnected) => "Myo reconnected",
        (Language::Es, Text::Reconnected) => "Myo reconectado",
        (Language::En, Text::Disconnected) => "Myo disconnected",
        (Language::Es, Text::Disconnected) => "Myo desconectado",
        (Language::En, Text::DisconnectedDetail) => "Galvani couldn't restore the connection.",
        (Language::Es, Text::DisconnectedDetail) => "Galvani no ha podido recuperar la conexión.",
    }
}

struct TrayItems {
    show: MenuItem<Wry>,
    quit: MenuItem<Wry>,
}

pub struct Shell {
    window_visible: Arc<AtomicBool>,
    language: Mutex<Language>,
    tray_items: Mutex<Option<TrayItems>>,
    told_about_background: AtomicBool,
}

impl Default for Shell {
    fn default() -> Self {
        Self {
            window_visible: Arc::new(AtomicBool::new(true)),
            language: Mutex::new(Language::default()),
            tray_items: Mutex::new(None),
            told_about_background: AtomicBool::new(false),
        }
    }
}

impl Shell {
    /// Shared flag that says whether the window can show data at all.
    pub fn window_visible(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.window_visible)
    }

    fn language(&self) -> Language {
        *self.language.lock().expect("language lock poisoned")
    }
}

fn notify(app: &AppHandle, title: Text, body: Option<Text>) {
    let language = app.state::<Shell>().language();
    let mut notification = app.notification().builder().title(text(language, title));
    if let Some(body) = body {
        notification = notification.body(text(language, body));
    }
    if let Err(error) = notification.show() {
        log::warn!("Could not show a notification: {error}");
    }
}

#[cfg(target_os = "macos")]
fn set_dock_icon_visible(app: &AppHandle, visible: bool) {
    let policy = if visible {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    };
    if let Err(error) = app.set_activation_policy(policy) {
        log::warn!("Could not change the Dock icon: {error}");
    }
}

#[cfg(not(target_os = "macos"))]
fn set_dock_icon_visible(_app: &AppHandle, _visible: bool) {}

/// Brings the window to the front, from the background or behind other apps.
pub fn show_main_window(app: &AppHandle) {
    set_dock_icon_visible(app, true);
    app.state::<Shell>()
        .window_visible
        .store(true, Ordering::Relaxed);

    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("The main window was not found");
        return;
    };
    if let Err(error) = window
        .show()
        .and_then(|_| window.unminimize())
        .and_then(|_| window.set_focus())
    {
        log::warn!("Could not show the main window: {error}");
    }
}

/// Hides the window and keeps the app running, including any session with the armband.
pub fn hide_main_window(app: &AppHandle) {
    let shell = app.state::<Shell>();
    shell.window_visible.store(false, Ordering::Relaxed);

    if let Some(window) = app.get_webview_window(MAIN_WINDOW)
        && let Err(error) = window.hide()
    {
        log::warn!("Could not hide the main window: {error}");
    }
    set_dock_icon_visible(app, false);
    log::info!("Running in the background");

    if !shell.told_about_background.swap(true, Ordering::Relaxed) {
        notify(
            app,
            Text::RunningInBackground,
            Some(Text::RunningInBackgroundDetail),
        );
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let language = app.state::<Shell>().language();
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        text(language, Text::ShowWindow),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_QUIT,
        text(language, Text::Quit),
        true,
        None::<&str>,
    )?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main")
        .icon(Image::from_bytes(include_bytes!(
            "../icons/tray-icon@2x.png"
        ))?)
        .icon_as_template(true)
        .tooltip("Galvani")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_SHOW => show_main_window(app),
            MENU_QUIT => app.exit(0),
            _ => {}
        })
        .build(app)?;

    *app.state::<Shell>()
        .tray_items
        .lock()
        .expect("tray lock poisoned") = Some(TrayItems { show, quit });
    Ok(())
}

/// Follows the language chosen in the frontend, for texts shown outside the webview.
#[tauri::command]
pub fn set_language(app: AppHandle, language: Language) {
    let shell = app.state::<Shell>();
    *shell.language.lock().expect("language lock poisoned") = language;
    if let Some(items) = &*shell.tray_items.lock().expect("tray lock poisoned") {
        let result = items
            .show
            .set_text(text(language, Text::ShowWindow))
            .and_then(|_| items.quit.set_text(text(language, Text::Quit)));
        if let Err(error) = result {
            log::warn!("Could not translate the tray menu: {error}");
        }
    }
}

/// Decides when a low battery deserves a warning: once, until it has recovered.
#[derive(Debug, Default)]
pub struct BatteryWatch {
    warned: bool,
}

impl BatteryWatch {
    pub fn should_warn(&mut self, level: u8) -> bool {
        if level >= BATTERY_RECOVERED_PERCENT {
            self.warned = false;
        } else if level <= LOW_BATTERY_PERCENT && !self.warned {
            self.warned = true;
            return true;
        }
        false
    }
}

/// Tells the user about session events that matter even without looking at the window.
pub struct SessionNotifier {
    app: AppHandle,
    battery: BatteryWatch,
}

impl SessionNotifier {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            battery: BatteryWatch::default(),
        }
    }

    pub fn check_battery(&mut self, level: u8) {
        if self.battery.should_warn(level) {
            notify(&self.app, Text::LowBattery, Some(Text::LowBatteryDetail));
        }
    }

    pub fn on_event(&mut self, event: &SessionEvent) {
        match event {
            SessionEvent::Battery { level } => self.check_battery(*level),
            SessionEvent::Reconnecting => notify(
                &self.app,
                Text::ConnectionLost,
                Some(Text::ConnectionLostDetail),
            ),
            SessionEvent::Reconnected => notify(&self.app, Text::Reconnected, None),
            SessionEvent::Disconnected => notify(
                &self.app,
                Text::Disconnected,
                Some(Text::DisconnectedDetail),
            ),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn warns_once_when_the_battery_gets_low() {
        let mut watch = BatteryWatch::default();
        assert!(!watch.should_warn(50));
        assert!(!watch.should_warn(16));
        assert!(watch.should_warn(15));
        assert!(!watch.should_warn(14));
        assert!(!watch.should_warn(10));
    }

    #[test]
    fn warns_at_once_when_connecting_with_a_low_battery() {
        assert!(BatteryWatch::default().should_warn(5));
    }

    #[test]
    fn warns_again_only_after_recovering() {
        let mut watch = BatteryWatch::default();
        assert!(watch.should_warn(15));
        // Small variations near the limit don't count as recovering.
        assert!(!watch.should_warn(17));
        assert!(!watch.should_warn(15));
        assert!(!watch.should_warn(25));
        assert!(watch.should_warn(15));
    }

    #[test]
    fn reads_the_language_codes_the_frontend_sends() {
        assert_eq!(
            serde_json::from_str::<Language>("\"es\"").unwrap(),
            Language::Es,
        );
        assert_eq!(
            serde_json::from_str::<Language>("\"en\"").unwrap(),
            Language::En,
        );
    }
}
