# src-tauri

The Tauri 2 app (Windows first). It loads the same React UI as the web view from `../src` and runs the same TypeScript sync engine, over SQLite instead of IndexedDB.

Rust in this folder handles native features only: today the single-instance guard, the `astir://` sign-in link, opening the browser and the SQLite plugin; later the tray, notifications, hotkey, autostart, badge and updater. Data logic stays in TypeScript.

Run it with `npm run app:dev` and build it with `npm run app:build`; see the root README for prerequisites.
