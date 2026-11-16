# src-tauri

The Tauri 2 app (Windows first) goes here in [#11](https://github.com/jmusick/astir/issues/11). It loads the same React UI as the web view from `../src`.

Rust in this folder handles native features only: tray, notifications, hotkey, autostart, badge and updater. Data logic stays in the shared TypeScript sync engine.
