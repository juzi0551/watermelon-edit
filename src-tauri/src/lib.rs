use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

/// 获取 exe 所在目录（用于 crash.log 写入）
fn exe_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

/// 将错误写入 crash.log
fn log_crash(msg: &str) {
    let path = exe_dir().join("crash.log");
    if let Ok(mut f) = OpenOptions::new().create(true).write(true).truncate(true).open(&path) {
        let _ = writeln!(f, "{msg}");
    }
}

/// Windows 下弹出错误消息框
#[cfg(target_os = "windows")]
extern "system" {
    fn MessageBoxW(
        hWnd: *mut std::ffi::c_void,
        lpText: *const u16,
        lpCaption: *const u16,
        uType: u32,
    ) -> i32;
}

fn show_error_box(title: &str, message: &str) {
    #[cfg(target_os = "windows")]
    unsafe {
        let title: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
        let message: Vec<u16> = message.encode_utf16().chain(std::iter::once(0)).collect();
        // MB_ICONERROR | MB_OK
        MessageBoxW(std::ptr::null_mut(), message.as_ptr(), title.as_ptr(), 0x00000010);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // 启动后端 sidecar
            let cmd = match app.shell().sidecar("watermelon-server") {
                Ok(c) => c,
                Err(e) => {
                    let msg = format!(
                        "找不到后端程序: {}\n\n\
                         请检查 binaries/ 目录下是否存在 watermelon-server 文件。",
                        e
                    );
                    log_crash(&msg);
                    show_error_box("西瓜审校 - 启动失败", &msg);
                    return Err(Box::new(e));
                }
            };

            let (mut rx, child) = match cmd.spawn() {
                Ok(v) => v,
                Err(e) => {
                    let msg = format!("后端启动失败: {}", e);
                    log_crash(&msg);
                    show_error_box("西瓜审校 - 启动失败", &msg);
                    return Err(Box::new(e));
                }
            };

            app.manage(BackendProcess(Mutex::new(Some(child))));

            // 打印后端输出到 stdout（仅开发/调试时可见）
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
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
