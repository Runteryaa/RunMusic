//! Loads the RunMusic icon that `build.rs` embeds as a Windows resource.

use windows::core::PCWSTR;
use windows::Win32::Foundation::{GetLastError, HINSTANCE, HANDLE};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    LoadIconW, LoadImageW, HICON, IDI_APPLICATION, IMAGE_ICON, LR_DEFAULTCOLOR,
};

const APP_ICON: PCWSTR = PCWSTR(1 as _);

/// Loads the embedded icon at `size` pixels (16 for the tray, 32 for the window).
/// Falls back to the generic application icon so the tray entry is never blank.
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
        if handle.0.is_null() {
            crate::log::log(&format!(
                "icon: LoadImage({size}) failed ({}), using default icon",
                GetLastError().0
            ));
            return LoadIconW(None, IDI_APPLICATION).unwrap_or_default();
        }
        HICON(handle.0)
    }
}
