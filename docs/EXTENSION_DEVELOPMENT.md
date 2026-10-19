# RunMusic Extension Development Guide (SDK v1)

Welcome to the RunMusic Extension ecosystem! RunMusic allows developers to build rich, interactive plugins for music streaming, media servers, podcasts, radios, and lyrics providers using standard web technologies (HTML, CSS, JavaScript, React, Vue, Svelte, etc.).

No native code, app compilation, or store approval required. Extensions run inside sandboxed WebViews and communicate with RunMusic via the `window.RunMusic` JavaScript Bridge.

---

## 1. Extension Manifest (`manifest.json`)

Every extension must provide a publicly accessible `manifest.json` file.

### Example Manifest (`manifest.json`):
```json
{
  "id": "sample-audio-extension",
  "name": "Example Audio Extension",
  "version": "1.0.0",
  "description": "Example Extension for RunMusic",
  "author": "Runterya",
  "icon": "https://raw.githubusercontent.com/Runteryaa/RunMusic/main/assets/images/play-store-icon-512.png",
  "page": "https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/index.html",
  "url": "https://runteryaa.github.io/RunMusic/examples/sample-audio-extension/manifest.json"
}
```

### Manifest Fields:
- `id` *(required)*: Unique identifier string for the extension (e.g. `sample-audio-extension`).
- `name` *(required)*: Display name of your extension.
- `version` *(required)*: SemVer version string (e.g. `1.0.0`).
- `page` *(required)*: The HTTPS URL or relative path to the HTML page loaded inside RunMusic's WebView.
- `url`: The URL to this `manifest.json` itself (used for updates and deep-linking).
- `description`: A short summary of what your extension provides.
- `author`: The author/creator name string (e.g. `"Runterya"`).
- `icon`: Square icon image URL (PNG/WebP/SVG recommended).

---

## 2. JavaScript Bridge SDK (`window.RunMusic`)

When your web page loads inside RunMusic, the native app automatically injects the `window.RunMusic` SDK object.

You can listen for the `RunMusicReady` event:
```javascript
window.addEventListener('RunMusicReady', (event) => {
  console.log('RunMusic Bridge is ready! Extension ID:', event.detail.extensionId);
  initExtension();
});
```

---

## 3. SDK Reference

### 3.1. Player API (`window.RunMusic.player`)

#### `play(track)`
Stream a track immediately in RunMusic's native player (supports lock-screen controls, notifications, and background playback):
```javascript
await window.RunMusic.player.play({
  id: "track-12345",                    // Optional unique ID
  title: "Creative Song Title",        // Required track title
  artist: "Independent Artist",        // Optional artist name
  artwork: "https://.../cover.jpg",    // Optional album art URL
  streamUrl: "https://.../audio.mp3",  // Required HTTP/HTTPS audio stream
  duration: 215                        // Duration in seconds
});
```

#### `addToQueue(tracks)`
Append one or more tracks to the current native playback queue:
```javascript
await window.RunMusic.player.addToQueue([
  {
    title: "Next Track",
    artist: "Artist",
    streamUrl: "https://.../stream.mp3",
    artwork: "https://.../art.jpg"
  }
]);
```

#### Playback Controls:
```javascript
await window.RunMusic.player.pause();
await window.RunMusic.player.resume();
await window.RunMusic.player.skipNext();
await window.RunMusic.player.skipPrevious();
await window.RunMusic.player.seekTo(45); // Seek to 45 seconds
```

---

### 3.2. Downloader API (`window.RunMusic.downloader`)

#### `download(options)`
Download an audio track directly to the user's device or private storage:
```javascript
const { downloadId } = await window.RunMusic.downloader.download({
  title: "Track Name",
  artist: "Artist Name",
  artwork: "https://.../art.jpg",
  downloadUrl: "https://.../audio.mp3",
  suggestedFileName: "Artist Name - Track Name.mp3",
  // 'public' saves to Android's Music folder and indexes into RunMusic library
  // 'private' saves into app internal sandbox
  storageTarget: "public"
});

console.log("Download started with ID:", downloadId);
```

#### `cancel(downloadId)`
Cancel an in-progress download:
```javascript
await window.RunMusic.downloader.cancel(downloadId);
```

---

### 3.3. Scoped Storage API (`window.RunMusic.storage`)

Each extension gets its own persistent, isolated key-value storage (survives app restarts):
```javascript
// Save user settings or favorites
await window.RunMusic.storage.setItem("userFavorites", JSON.stringify([101, 102, 103]));

// Retrieve data
const favoritesRaw = await window.RunMusic.storage.getItem("userFavorites");
const favorites = favoritesRaw ? JSON.parse(favoritesRaw) : [];

// Delete key
await window.RunMusic.storage.removeItem("userFavorites");
```

---

### 3.4. Theme API (`window.RunMusic.theme`)

Adapt your extension's web styling to match RunMusic's active theme:
```javascript
const theme = await window.RunMusic.theme.getTheme();
console.log(theme);
// Returns:
// {
//   primary: "#3b82f6",
//   background: "#121212",
//   cardBackground: "#1e1e1e",
//   text: "#ffffff",
//   isDark: true
// }

// Apply to your CSS variables
document.documentElement.style.setProperty('--accent-color', theme.primary);
```

---

### 3.5. UI Utilities (`window.RunMusic.ui`)
```javascript
// Open link in external device browser
await window.RunMusic.ui.openExternalUrl("https://github.com/...");

// Show toast alert
await window.RunMusic.ui.showToast("Added to favorites!");
```

---

## 4. Publishing & Hosting Your Extension

1. Create a GitHub repository with your `manifest.json` and `index.html`.
2. Enable **GitHub Pages** (Settings > Pages > Source: main / root).
3. Copy your live manifest URL (e.g. `https://yourusername.github.io/my-extension/manifest.json`).
4. In RunMusic: Open **Eklentiler (Extensions)** tab > Click **+ Ekle** > Paste your manifest URL.
5. Your extension is live and usable immediately!
