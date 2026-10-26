//! System tray icon and context menu.

use windows::core::w;
use windows::Win32::Foundation::{GetLastError, HWND, POINT};
use windows::Win32::UI::Shell::{
    Shell_NotifyIconW, NIF_ICON, NIF_INFO, NIF_MESSAGE, NIF_TIP, NIIF_INFO, NIM_ADD, NIM_DELETE,
    NIM_MODIFY, NOTIFYICONDATAW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AppendMenuW, CheckMenuItem, CreatePopupMenu, DestroyMenu, EnableMenuItem, GetCursorPos, HICON,
    PostMessageW, SetForegroundWindow, TrackPopupMenu, MF_BYCOMMAND, MF_CHECKED, MF_ENABLED,
    MF_GRAYED, MF_STRING, TPM_NONOTIFY, TPM_RETURNCMD, TPM_RIGHTBUTTON, WM_NULL,
};

use super::{
    ID_AUTOSTART, ID_CONNECT, ID_DISCONNECT, ID_EXIT, ID_SHOW, WM_APP_TRAY,
};

const TRAY_ID: u32 = 1;

pub struct Tray {
    nid: NOTIFYICONDATAW,
}

impl Tray {
    pub fn new(hwnd: HWND, hicon: HICON) -> Self {
        let mut nid = NOTIFYICONDATAW::default();
        nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        nid.hWnd = hwnd;
        nid.uID = TRAY_ID;
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        nid.uCallbackMessage = WM_APP_TRAY;
        nid.hIcon = hicon;
        write_tip(&mut nid, "RunMusic Remote");
        unsafe {
            if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
                crate::log::log(&format!(
                    "tray: NIM_ADD failed ({}), cbSize={}",
                    GetLastError().0,
                    nid.cbSize
                ));
            }
        }
        Self { nid }
    }

    pub fn set_tip(&mut self, tip: &str) {
        write_tip(&mut self.nid, tip);
        unsafe {
            let _ = Shell_NotifyIconW(NIM_MODIFY, &self.nid);
        }
    }

    /// Shows a one-off balloon so the user knows the window lives in the tray.
    pub fn notify(&mut self, title: &str, text: &str) {
        copy_wide(&mut self.nid.szInfoTitle, title);
        copy_wide(&mut self.nid.szInfo, text);
        self.nid.dwInfoFlags = NIIF_INFO;
        self.nid.uFlags |= NIF_INFO;
        unsafe {
            let _ = Shell_NotifyIconW(NIM_MODIFY, &self.nid);
        }
        self.nid.uFlags &= !NIF_INFO;
    }
}

impl Drop for Tray {
    fn drop(&mut self) {
        unsafe {
            let _ = Shell_NotifyIconW(NIM_DELETE, &self.nid);
        }
    }
}

fn write_tip(nid: &mut NOTIFYICONDATAW, tip: &str) {
    copy_wide(&mut nid.szTip, tip);
}

fn copy_wide<const N: usize>(dst: &mut [u16; N], value: &str) {
    let mut encoded: Vec<u16> = value.encode_utf16().take(N - 1).collect();
    encoded.resize(N, 0);
    dst.copy_from_slice(&encoded);
}

/// Shows the context menu and returns the chosen command id (0 = dismissed).
pub fn show_menu(hwnd: HWND, connected: bool, autostart: bool) -> u32 {
    unsafe {
        let Ok(menu) = CreatePopupMenu() else {
            return 0;
        };

        let _ = AppendMenuW(menu, MF_STRING, ID_CONNECT as usize, w!("Bağlan"));
        let _ = AppendMenuW(menu, MF_STRING, ID_DISCONNECT as usize, w!("Bağlantıyı kes"));
        let _ = AppendMenuW(menu, MF_STRING, ID_SHOW as usize, w!("Pencereyi göster"));
        let _ = AppendMenuW(menu, MF_STRING, ID_AUTOSTART as usize, w!("Windows ile başlat"));
        let _ = AppendMenuW(menu, MF_STRING, ID_EXIT as usize, w!("Çıkış"));

        if connected {
            let _ = EnableMenuItem(menu, ID_CONNECT, MF_BYCOMMAND | MF_GRAYED);
            let _ = EnableMenuItem(menu, ID_DISCONNECT, MF_BYCOMMAND | MF_ENABLED);
        } else {
            let _ = EnableMenuItem(menu, ID_CONNECT, MF_BYCOMMAND | MF_ENABLED);
            let _ = EnableMenuItem(menu, ID_DISCONNECT, MF_BYCOMMAND | MF_GRAYED);
        }
        if autostart {
            let _ = CheckMenuItem(menu, ID_AUTOSTART, (MF_BYCOMMAND | MF_CHECKED).0);
        }

        let mut point = POINT::default();
        let _ = GetCursorPos(&mut point);
        let _ = SetForegroundWindow(hwnd);
        let command = TrackPopupMenu(
            menu,
            TPM_RIGHTBUTTON | TPM_RETURNCMD | TPM_NONOTIFY,
            point.x,
            point.y,
            Some(0),
            hwnd,
            None,
        );
        let _ = DestroyMenu(menu);
        let _ = PostMessageW(Some(hwnd), WM_NULL, windows::Win32::Foundation::WPARAM(0), windows::Win32::Foundation::LPARAM(0));
        command.0 as u32
    }
}
