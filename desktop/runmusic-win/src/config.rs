//! Tiny JSON config stored in `%LOCALAPPDATA%\RunMusic\config.json`.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
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
}

impl Config {
    pub fn load() -> Self {
        let Some(path) = config_path() else {
            return Self::default();
        };
        let Ok(raw) = fs::read_to_string(&path) else {
            return Self::default();
        };
        serde_json::from_str(&raw).unwrap_or_default()
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
