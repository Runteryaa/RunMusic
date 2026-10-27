#![cfg_attr(not(test), windows_subsystem = "windows")]

mod ble;
mod config;
mod icon;
mod log;
mod lyrics;
mod media_controls;
mod ndjson;
mod now_playing;
mod protocol;
mod ui;

use windows::core::w;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS};
use windows::Win32::System::Threading::CreateMutexW;
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::WindowsAndMessaging::{
    FindWindowW, MessageBoxW, SetForegroundWindow, ShowWindow, MB_ICONERROR, MB_OK, SW_SHOW,
};

fn main() {
    log::init();
    unsafe {
        let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        // Single instance: keep the mutex alive for the whole process.
        let _mutex = CreateMutexW(None, true, w!("Local\\RunMusicRemoteMutex"));
        if GetLastError() == ERROR_ALREADY_EXISTS {
            if let Ok(hwnd) = FindWindowW(w!("RunMusicRemoteWindow"), None) {
                let _ = ShowWindow(hwnd, SW_SHOW);
                let _ = SetForegroundWindow(hwnd);
            }
            return;
        }
    }

    if let Err(error) = ui::run() {
        log::log(&format!("fatal: {error}"));
        show_error(&format!("RunMusic Remote başlatılamadı:\n{error}"));
    }
}

fn show_error(message: &str) {
    let text = wide(message);
    let caption = wide("RunMusic Remote");
    unsafe {
        let _ = MessageBoxW(
            None,
            windows::core::PCWSTR(text.as_ptr()),
            windows::core::PCWSTR(caption.as_ptr()),
            MB_OK | MB_ICONERROR,
        );
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}
