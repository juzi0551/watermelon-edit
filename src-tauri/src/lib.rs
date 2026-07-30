use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Spawn the Python backend as a sidecar
            let (mut rx, child) = app
                .shell()
                .sidecar("watermelon-server")
                .expect("failed to find sidecar binary")
                .spawn()
                .expect("failed to spawn backend");

            app.manage(BackendProcess(Mutex::new(Some(child))));

            // Log sidecar output
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    let line = match &event {
                        CommandEvent::Stdout(bytes) => String::from_utf8_lossy(bytes),
                        CommandEvent::Stderr(bytes) => String::from_utf8_lossy(bytes),
                        _ => continue,
                    };
                    print!("[backend] {line}");
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<BackendProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
