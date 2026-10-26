//! Embeds the RunMusic app icon into the executable.
//!
//! The icon comes from the mobile app (`assets/images/icon.png`) and is
//! compiled into a Windows resource so Explorer, the taskbar and the tray all
//! show the same artwork. `windres` ships with the MinGW toolchain used to
//! link this binary; if it is missing the build still succeeds without an icon.

use std::path::PathBuf;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=icon.rc");
    println!("cargo:rerun-if-changed=icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_env == "msvc" {
        let res = out_dir.join("runmusic_icon.res");
        let output = Command::new("rc.exe")
            .arg(format!("/fo{}", res.display()))
            .arg("icon.rc")
            .output();
        match output {
            Ok(result) if result.status.success() => {
                println!("cargo:rustc-link-arg={}", res.display());
                return;
            }
            Ok(result) => {
                println!(
                    "cargo:warning=rc.exe basarisiz: {}",
                    String::from_utf8_lossy(&result.stderr).trim()
                );
            }
            Err(e) => {
                println!("cargo:warning=rc.exe calistirilamadi: {e}");
            }
        }
    }

    let object = out_dir.join("runmusic_icon.o");

    let Some(windres) = find_windres() else {
        println!("cargo:warning=windres bulunamadi, uygulama simgesi gomulmedi");
        return;
    };

    let output = Command::new(&windres)
        .args(["-i", "icon.rc", "-o"])
        .arg(&object)
        .args(["-O", "coff", "--target=pe-x86-64"])
        // `windres` normally preprocesses with gcc, but the toolchain is
        // extracted without cc1. The resource file needs no preprocessing, so
        // let cmd print it verbatim.
        .args([
            "--preprocessor=cmd.exe",
            "--preprocessor-arg=/c",
            "--preprocessor-arg=type",
        ])
        .output();

    match output {
        Ok(result) if result.status.success() => {
            println!("cargo:rustc-link-arg={}", object.display());
        }
        Ok(result) => {
            println!(
                "cargo:warning=windres basarisiz: {}",
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        Err(error) => println!("cargo:warning=windres calistirilamadi: {error}"),
    }
}

fn find_windres() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("WINDRES") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(base)
            .join("RunMusicRemote")
            .join("toolchain")
            .join("mingw64")
            .join("bin")
            .join("windres.exe");
        if path.is_file() {
            return Some(path);
        }
    }

    Some(PathBuf::from("windres.exe"))
}
