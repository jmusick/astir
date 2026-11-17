// Astir's native shell. It hosts the shared React UI and TypeScript sync engine (D12, D13) and
// adds only what a browser can't: the tray, start-at-login, the quick-add shortcut, reminder
// toasts, updates, the astir:// sign-in link, opening the browser and the local SQLite file. Data
// logic never lives in Rust.
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

/// Passed by the autostart entry so a login start stays in the tray (D35).
const MINIMIZED_ARG: &str = "--minimized";

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Shows a reminder as a Windows toast (D36, D42). The UI decides what's due and what it says; this
/// only delivers it and reports back, by tag, whether the user clicked it (open the item) or closed
/// it (dismiss it everywhere). A toast that times out into the Action Center reports nothing.
#[cfg(windows)]
#[tauri::command]
fn show_reminder(app: AppHandle, tag: String, title: String, body: String) -> Result<(), String> {
    use tauri_winrt_notification::{Duration, Toast, ToastDismissalReason};
    // An installed app's shortcut carries its identifier as the toast app id; a development build
    // has no shortcut, so it borrows PowerShell's, as Tauri's own notification plugin does.
    let app_id = if cfg!(debug_assertions) { Toast::POWERSHELL_APP_ID.to_string() } else { app.config().identifier.clone() };
    let on_click = (app.clone(), tag.clone());
    let on_close = (app.clone(), tag);
    Toast::new(&app_id)
        .title(&title)
        .text1(&body)
        .duration(Duration::Long)
        .on_activated(move |_| {
            show_main(&on_click.0);
            let _ = on_click.0.emit_to("main", "astir://reminder-activated", on_click.1.clone());
            Ok(())
        })
        .on_dismissed(move |reason| {
            if reason == Some(ToastDismissalReason::UserCanceled) {
                let _ = on_close.0.emit_to("main", "astir://reminder-dismissed", on_close.1.clone());
            }
            Ok(())
        })
        .show()
        .map_err(|error| error.to_string())
}

/// Elsewhere the UI falls back to the webview's own notifications.
#[cfg(not(windows))]
#[tauri::command]
fn show_reminder(_tag: String, _title: String, _body: String) -> Result<(), String> {
    Err("native reminders are Windows-only for now".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // One Astir per user. Opening an astir:// link (or Astir again) while it runs reaches the
    // running copy, which the deep-link plugin hands the link to, instead of a second window.
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                Some(vec![MINIMIZED_ARG]),
            ))
            // The quick-add shortcut (D35); the UI registers and changes it.
            .plugin(tauri_plugin_global_shortcut::Builder::new().build())
            // Silent updates from GitHub Releases (D38); the UI decides when to install.
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Installers register astir:// themselves; a development build has to do it at run time.
            #[cfg(all(desktop, debug_assertions))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // The tray (D35). Its actions that touch data are events for the shared UI to handle.
            let open = MenuItem::with_id(app, "open", "Open Astir", true, None::<&str>)?;
            let quick_add = MenuItem::with_id(app, "quick-add", "Quick add", true, None::<&str>)?;
            let sync = MenuItem::with_id(app, "sync", "Sync now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Astir", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick_add, &sync, &PredefinedMenuItem::separator(app)?, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Astir")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "quick-add" => {
                        let _ = app.emit("astir://quick-add", ());
                    }
                    "sync" => {
                        let _ = app.emit("astir://sync-now", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // The window starts hidden; a login start leaves it in the tray.
            if !std::env::args().any(|arg| arg == MINIMIZED_ARG) {
                show_main(app.handle());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![show_reminder])
        .on_window_event(|window, event| {
            // Closing a window keeps Astir in the tray, syncing and reminding (D35); the quick-add
            // box just hides until it's wanted again. Quit is in the tray menu.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Astir");
}
