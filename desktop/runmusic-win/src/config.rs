//! Tiny JSON config stored in `%LOCALAPPDATA%\RunMusic\config.json`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Bluetooth address of the last connected host (48-bit).
    #[serde(default)]
    pub last_address: Option<u64>,
    #[serde(default)]
    pub last_name: Option<String>,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub lyrics_open: bool,
    /// Remembered client height (logical px) when the lyrics panel is open.
    #[serde(default = "default_window_width")]
    pub window_width: i32,
    #[serde(default = "default_lyrics_height")]
    pub lyrics_height: i32,
    /// Lyric font size in logical px.
    #[serde(default = "default_lyrics_font")]
    pub lyrics_font: f32,
    /// Last window position (physical screen px, outer window rect).
    #[serde(default)]
    pub window_x: Option<i32>,
    #[serde(default)]
    pub window_y: Option<i32>,
}

pub const LYRICS_FONT_MIN: f32 = 10.0;
pub const LYRICS_FONT_MAX: f32 = 24.0;
pub const LYRICS_HEIGHT_MIN: i32 = 260;
pub const LYRICS_HEIGHT_MAX: i32 = 1600;
pub const WINDOW_WIDTH_MIN: i32 = 360;
pub const WINDOW_WIDTH_MAX: i32 = 2400;

fn default_window_width() -> i32 {
    400
}

fn default_lyrics_height() -> i32 {
    390
}

fn default_lyrics_font() -> f32 {
    13.0
}

impl Default for Config {
    fn default() -> Self {
        Self {
            last_address: None,
            last_name: None,
            autostart: false,
            always_on_top: false,
            lyrics_open: false,
            window_width: default_window_width(),
            lyrics_height: default_lyrics_height(),
            lyrics_font: default_lyrics_font(),
            window_x: None,
            window_y: None,
        }
    }
}

fn sanitize(mut config: Config) -> Config {
    config.window_width = config
        .window_width
        .clamp(WINDOW_WIDTH_MIN, WINDOW_WIDTH_MAX);
    config.lyrics_height = config
        .lyrics_height
        .clamp(LYRICS_HEIGHT_MIN, LYRICS_HEIGHT_MAX);
    config.lyrics_font = if config.lyrics_font.is_finite() {
        config
            .lyrics_font
            .clamp(LYRICS_FONT_MIN, LYRICS_FONT_MAX)
    } else {
        default_lyrics_font()
    };
    config
}

impl Config {
    pub fn load() -> Self {
        let Some(path) = config_path() else {
            return Self::default();
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            return Self::default();
        };
        serde_json::from_str(raw.trim_start_matches('\u{feff}'))
            .map(sanitize)
            .unwrap_or_default()
    }

    pub fn save(&self) {
        let Some(path) = config_path() else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let Ok(raw) = serde_json::to_string_pretty(self) else {
            return;
        };
        let tmp = path.with_extension("json.tmp");
        if fs::write(&tmp, raw).is_ok() {
            let _ = fs::rename(&tmp, &path);
        }
    }
}

static DATA_DIR: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Picks the first writable location: `%LOCALAPPDATA%\RunMusic`, then a
/// `data` folder next to the executable, then the temp directory. Checking the
/// write access once keeps config and log writes from failing silently when a
/// sandbox blocks the usual profile folder.
pub fn data_dir() -> Option<PathBuf> {
    DATA_DIR
        .get_or_init(|| {
            let mut candidates = Vec::new();
            if let Some(base) = std::env::var_os("LOCALAPPDATA") {
                candidates.push(PathBuf::from(base).join("RunMusic"));
            }
            if let Ok(exe) = std::env::current_exe() {
                if let Some(parent) = exe.parent() {
                    candidates.push(parent.join("data"));
                }
            }
            candidates.push(std::env::temp_dir().join("RunMusic"));
            candidates.into_iter().find(|dir| writable(dir))
        })
        .clone()
}

fn writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    let ok = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&probe)
        .is_ok();
    let _ = fs::remove_file(&probe);
    ok
}

pub fn config_path() -> Option<PathBuf> {
    Some(data_dir()?.join("config.json"))
}

pub fn autostart_enabled() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_QUERY_VALUE, REG_SZ,
    };

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let expected = format!("\"{}\"", exe.display());
    let mut key = HKEY::default();
    let mut buffer = [0u16; 1024];
    let mut size = (buffer.len() * 2) as u32;
    let mut kind = REG_SZ;

    unsafe {
        if RegOpenKeyExW(
            windows::Win32::System::Registry::HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
            Some(0),
            KEY_QUERY_VALUE,
            &mut key,
        )
        .is_err()
        {
            return false;
        }

        let status = RegQueryValueExW(
            key,
            w!("RunMusicRemote"),
            None,
            Some(&mut kind),
            Some(buffer.as_mut_ptr() as *mut u8),
            Some(&mut size),
        );
        let _ = RegCloseKey(key);
        if status.is_err() {
            return false;
        }
    }

    let length = (size as usize / 2).min(buffer.len());
    let value = String::from_utf16_lossy(&buffer[..length]);
    value.trim_end_matches('\0').eq_ignore_ascii_case(&expected)
}

pub fn set_autostart(enabled: bool) -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegSetValueExW, HKEY, KEY_SET_VALUE,
    };

    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let command = format!("\"{}\"", exe.display());
    let data: Vec<u8> = command
        .encode_utf16()
        .chain(std::iter::once(0))
        .flat_map(|unit| unit.to_le_bytes())
        .collect();

    let mut key = HKEY::default();
    unsafe {
        if RegOpenKeyExW(
            windows::Win32::System::Registry::HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
            Some(0),
            KEY_SET_VALUE,
            &mut key,
        )
        .is_err()
        {
            return false;
        }

        let status = if enabled {
            RegSetValueExW(
                key,
                w!("RunMusicRemote"),
                Some(0),
                windows::Win32::System::Registry::REG_SZ,
                Some(&data),
            )
        } else {
            RegDeleteValueW(key, w!("RunMusicRemote"))
        };
        let _ = RegCloseKey(key);
        status.is_ok()
    }
}
