# RunMusic Remote (Windows)

Rust ile yazılmış, RunMusic Android uygulamasını Bluetooth LE üzerinden kumanda
eden hafif Windows istemcisi.

- **Rol:** BLE central (uzaktan kumanda). Müzik telefonda çalar.
- **Arayüz:** native Win32/GDI mini oynatıcı + sistem tepsisi. WebView, GPU,
  async runtime yok.
- **Protokol:** `src/services/remote/remoteTypes.ts` ile aynı NDJSON mesajları.

## Gereksinimler

- Windows 10/11, BLE 4.0+ adaptör
- Android telefonda RunMusic çalışıyor olmalı
- Telefonda **Uzaktan Kumanda → Host** modu açık olmalı (BLE host yalnızca
  Android'de destekleniyor)
- Derleme için Rust (GNU veya MSVC toolchain) ve `cargo`

## Telefonda hazırlık

1. RunMusic'i açın.
2. Uzaktan kumanda ayarlarından **Host** modunu seçin.
3. Bluetooth'u açık bırakın. Uygulama `0000feed-...` servisini reklam eder.

Windows istemcisi ilk çalıştırmada host'u tarar, bulunca bağlanır ve cihaz
adresini `%LOCALAPPDATA%\RunMusic\config.json` içine yazar. Sonraki açılışlarda
doğrudan bağlanmayı dener.

## Derleme

```powershell
cd desktop
cargo build --release
```

Çıktı: `desktop/target/release/runmusic-win.exe`

Boyut ve kaynak optimizasyonu `desktop/Cargo.toml` içindeki release profilinde
(`opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`, `panic = "abort"`,
`strip = true`).

## Kullanım

- Sol tık tepsi ikonu: pencereyi göster
- Sağ tık: Bağlan / Bağlantıyı kes / Windows ile başlat / Çıkış
- Pencereyi kapatmak uygulamayı kapatmaz, tepsiye küçültür.
- İlerleme çubuğuna tıklayıp sürükleyerek telefonda arama yapılır.

## Sınırlar

- BLE protokolü kuyruk, albüm kapağı ve kütüphane listesi göndermez; bu istemci
  bilinçli olarak sade bir medya kumandasıdır.
- BLE üzerinden kimlik doğrulama yoktur: menzildeki herkes kumanda edebilir.
- BLE host Android'de çalışır; iOS desteklenmez.

## Günlük

Sorun giderme için: `%LOCALAPPDATA%\RunMusic\remote.log`
