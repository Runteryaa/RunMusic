//! Minimal file logger. The binary is built without a console, so diagnostics
//! go to `%LOCALAPPDATA%\RunMusic\remote.log`.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

static LOG: OnceLock<Mutex<File>> = OnceLock::new();

pub fn init() {
    for path in candidate_paths() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(file) = OpenOptions::new().create(true).append(true).open(&path) {
            if LOG.set(Mutex::new(file)).is_ok() {
                break;
            }
        }
    }

    std::panic::set_hook(Box::new(|info| {
        log(&format!("PANIC: {info}"));
    }));

    log("---- RunMusic Remote starting ----");
}

fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(dir) = crate::config::data_dir() {
        paths.push(dir.join("remote.log"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths.push(parent.join("runmusic.log"));
        }
    }
    paths.push(std::env::temp_dir().join("RunMusic").join("remote.log"));
    paths
}

pub fn log(message: &str) {
    let Some(lock) = LOG.get() else { return };
    let Ok(mut file) = lock.lock() else { return };
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let _ = writeln!(file, "[{secs}] {message}");
    let _ = file.flush();
}
