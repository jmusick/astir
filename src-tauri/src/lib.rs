// Astir's native shell. It hosts the shared React UI and TypeScript sync engine (D12, D13) and
// adds only what a browser can't: here, the astir:// sign-in link, opening the browser and the
// local SQLite file. Data logic never lives in Rust.
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // One Astir per user. Opening an astir:// link (or Astir again) while it runs reaches the
    // running copy, which the deep-link plugin hands the link to, instead of a second window.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|_app| {
            // Installers register astir:// themselves; a development build has to do it at run time.
            #[cfg(all(desktop, debug_assertions))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                _app.deep_link().register_all()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Astir");
}
