//! Loads the RunMusic icon that `build.rs` embeds as a Windows resource.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, HANDLE};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{LoadImageW, HICON, IMAGE_ICON, LR_DEFAULTCOLOR};

const APP_ICON: PCWSTR = PCWSTR(1 as _);

/// Loads the embedded icon at `size` pixels (16 for the tray, 32 for the window).
pub fn load(size: i32) -> HICON {
    unsafe {
        let Ok(module) = GetModuleHandleW(None) else {
            return HICON::default();
        };
        let handle: HANDLE = LoadImageW(
            Some(HINSTANCE(module.0)),
            APP_ICON,
            IMAGE_ICON,
            size,
            size,
            LR_DEFAULTCOLOR,
        )
        .unwrap_or_default();
        HICON(handle.0)
    }
}
