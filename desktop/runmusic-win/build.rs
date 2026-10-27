//! Embeds the RunMusic app icon and version metadata into the executable.
//!
//! The icon comes from the mobile app (`assets/images/icon.png`) and is
//! compiled into a Windows resource so Explorer, the taskbar and the tray all
//! show the same artwork. The VERSIONINFO block is generated from
//! `CARGO_PKG_VERSION` (synced from `package.json` by `scripts/version.mjs`)
//! so Explorer -> Properties -> Details shows the release version.
//!
//! `windres` ships with the MinGW toolchain used to link this binary; if it is
//! missing the build still succeeds without resources.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=icon.rc");
    println!("cargo:rerun-if-changed=icon.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let version = std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION is set by cargo");

    let version_rc = out_dir.join("runmusic_version.rc");
    if let Err(error) = fs::write(&version_rc, version_info(&version)) {
        println!("cargo:warning=version.rc yazilamadi: {error}");
        return;
    }

    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    if target_env == "msvc" {
        compile_msvc("icon.rc", &out_dir.join("runmusic_icon.res"));
        compile_msvc(&version_rc, &out_dir.join("runmusic_version.res"));
        return;
    }

    let Some(windres) = find_windres() else {
        println!("cargo:warning=windres bulunamadi, uygulama simgesi/surum bilgisi gomulmedi");
        return;
    };

    compile_windres(&windres, "icon.rc", &out_dir.join("runmusic_icon.o"));
    compile_windres(
        &windres,
        &version_rc,
        &out_dir.join("runmusic_version.o"),
    );
}

fn compile_msvc(rc_file: impl AsRef<Path>, res_file: &Path) {
    let output = Command::new("rc.exe")
        .arg(format!("/fo{}", res_file.display()))
        .arg(rc_file.as_ref())
        .output();
    match output {
        Ok(result) if result.status.success() => {
            println!("cargo:rustc-link-arg={}", res_file.display());
        }
        Ok(result) => {
            println!(
                "cargo:warning=rc.exe basarisiz ({}): {}",
                rc_file.as_ref().display(),
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        Err(error) => {
            println!("cargo:warning=rc.exe calistirilamadi: {error}");
        }
    }
}

fn compile_windres(windres: &Path, rc_file: impl AsRef<Path>, object: &Path) {
    let output = Command::new(windres)
        .arg("-i")
        .arg(rc_file.as_ref())
        .arg("-o")
        .arg(object)
        .args(["-O", "coff", "--target=pe-x86-64"])
        // `windres` normally preprocesses with gcc, but the toolchain is
        // extracted without cc1. The resource files need no preprocessing, so
        // let cmd print them verbatim.
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
                "cargo:warning=windres basarisiz ({}): {}",
                rc_file.as_ref().display(),
                String::from_utf8_lossy(&result.stderr).trim()
            );
        }
        Err(error) => println!("cargo:warning=windres calistirilamadi: {error}"),
    }
}

fn version_info(version: &str) -> String {
    let mut parts = version
        .split('.')
        .map(|part| part.trim().parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    let patch = parts.next().unwrap_or(0);

    format!(
        r#"1 VERSIONINFO
FILEVERSION {major},{minor},{patch},0
PRODUCTVERSION {major},{minor},{patch},0
FILEOS 0x40004
FILETYPE 0x1
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "CompanyName", "RunMusic"
      VALUE "FileDescription", "RunMusic Remote"
      VALUE "FileVersion", "{version}"
      VALUE "InternalName", "runmusic-win"
      VALUE "OriginalFilename", "runmusic-win.exe"
      VALUE "ProductName", "RunMusic Remote"
      VALUE "ProductVersion", "{version}"
      VALUE "LegalCopyright", "RunMusic"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
"#
    )
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
