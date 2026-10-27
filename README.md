<p align="center">
  <img src="assets/images/play-store-icon-512.png" width="100" height="100" alt="RunMusic Logo" style="border-radius: 20px;" />
</p>

<h1 align="center">RunMusic</h1>

<p align="center">
  Modern, open-source, and extensible local audio player.
</p>

<p align="center">
  <a href="https://github.com/Runteryaa/RunMusic/releases"><img src="https://img.shields.io/github/v/release/Runteryaa/RunMusic?style=flat-square&color=3b82f6" alt="Latest Release" /></a>
  <a href="https://github.com/Runteryaa/RunMusic/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-emerald?style=flat-square" alt="License" /></a>
  <img src="https://img.shields.io/badge/Platform-Android%20%7C%20iOS-orange?style=flat-square" alt="Platform" />
  <img src="https://img.shields.io/badge/Expo-SDK%2057-black?style=flat-square" alt="Expo" />
  <img src="https://img.shields.io/badge/React%20Native-0.86-61dafb?style=flat-square" alt="React Native" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-blue?style=flat-square" alt="TypeScript" />
</p>

<p align="center">
  <a href="https://github.com/Runteryaa/RunMusic/releases">Latest APK</a> •
  <a href="https://runteryaa.github.io/RunMusic/">Website</a> •
  <a href="docs/EXTENSION_DEVELOPMENT.md">Extension Docs</a> •
  <a href="https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json">Sample Extension</a>
</p>

---

## Features

- **Local Playback:** Lossless playback for MP3, FLAC, WAV, M4A, AAC, and OGG.
- **Extension System:** Add external web extensions via manifest URL.
- **Synced Lyrics:** Real-time synchronized line-by-line and word-by-word lyrics powered by LRCLIB.
- **Remote Connect:** Remote control and cross-device library sync over Wi-Fi, BLE, and internet relay.
- **Smart Shuffle:** Intelligent shuffle algorithm that prevents repetitive playback based on listening history.
- **Sleep Timer:** Automatic playback fade-out timer.
- **Dynamic Theming:** Fluid UI colors that adapt dynamically to the current album artwork.

---

## Installing Extensions

### 1. YouTube Music & Video Extension
- **One-Click Web Install:** [Install YouTube Extension](https://runteryaa.github.io/RunMusic/install?url=https://runteryaa.github.io/RunMusic/examples/youtube-extension/manifest.json)
- **Direct Deep Link:** `runmusic://install-extension?url=https://runteryaa.github.io/RunMusic/examples/youtube-extension/manifest.json`
- **Manifest URL:** `https://runteryaa.github.io/RunMusic/examples/youtube-extension/manifest.json`

### 2. Sample Audio Extension
- **One-Click Web Install:** [Install Sample Extension](https://runteryaa.github.io/RunMusic/install?url=https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json)
- **Direct Deep Link:** `runmusic://install-extension?url=https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json`
- **Manifest URL:** `https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json`

Or manually:
1. Open the app and navigate to the **Extensions** tab.
2. Enter the extension manifest URL in the top input field.
3. Tap **Add**.

To build your own extension, see the [Extension Development Guide](docs/EXTENSION_DEVELOPMENT.md).

---

### Windows Client

<img src="https://i.ibb.co/BKHsjHjm/image.png"/>

## License

This project is licensed under the [MIT License](LICENSE).
