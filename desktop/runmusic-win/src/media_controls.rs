//! Windows System Media Transport Controls (SMTC) integration.
//!
//! Registering the window as a media session gives us the hardware media keys
//! (play/pause/next/previous), the Windows media flyout metadata and a seek
//! slider, without polling or global keyboard hooks. Button presses arrive on a
//! WinRT callback thread, so they are marshalled back to the UI thread with
//! `PostMessageW`; the UI thread owns the BLE command channel.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use windows::core::{Interface, Ref, HSTRING};
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
    SystemMediaTransportControls, SystemMediaTransportControlsButtonPressedEventArgs,
    SystemMediaTransportControlsDisplayUpdater, SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::{
    DataWriter, IOutputStream, IRandomAccessStream, InMemoryRandomAccessStream,
    RandomAccessStreamReference,
};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::WinRT::{RoGetActivationFactory, ISystemMediaTransportControlsInterop};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;

use crate::log::log;
use crate::now_playing::NowPlaying;

/// Posted with the pressed `SystemMediaTransportControlsButton` value.
pub const WM_APP_SMTC: u32 = 0x8004;
/// Posted after a playback position has been stored in `pending_seek`.
pub const WM_APP_SMTC_SEEK: u32 = 0x8005;

const SEEK_SENTINEL: u64 = u64::MAX;
const TICKS_PER_SECOND: f64 = 10_000_000.0;

pub struct MediaControls {
    smtc: SystemMediaTransportControls,
    updater: SystemMediaTransportControlsDisplayUpdater,
    /// Keeps the thumbnail reference and its backing PNG stream alive while
    /// the shell reads the artwork.
    _icon: Option<(RandomAccessStreamReference, InMemoryRandomAccessStream)>,
    pending_seek: Arc<AtomicU64>,
    status: Option<i32>,
    title: Option<String>,
    artist: Option<String>,
    duration: f64,
    position: f64,
}

impl MediaControls {
    /// Registers the window as a media session. Failures are logged and the
    /// remote keeps working without the Windows controls.
    pub fn new(hwnd: HWND) -> Option<Self> {
        match Self::try_new(hwnd) {
            Ok(controls) => {
                log("media controls: System Media Transport Controls registered");
                Some(controls)
            }
            Err(error) => {
                log(&format!("media controls: SMTC unavailable: {error}"));
                None
            }
        }
    }

    fn try_new(hwnd: HWND) -> windows::core::Result<Self> {
        let hwnd_value = hwnd.0 as isize;
        let factory: ISystemMediaTransportControlsInterop = unsafe {
            RoGetActivationFactory(&HSTRING::from("Windows.Media.SystemMediaTransportControls"))?
        };
        let smtc: SystemMediaTransportControls = unsafe { factory.GetForWindow(hwnd) }?;

        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsNextEnabled(true)?;
        smtc.SetIsPreviousEnabled(true)?;
        smtc.SetIsStopEnabled(false)?;
        smtc.SetIsEnabled(true)?;
        smtc.SetPlaybackStatus(MediaPlaybackStatus::Stopped)?;

        smtc.ButtonPressed(&TypedEventHandler::new(
            move |_sender: Ref<SystemMediaTransportControls>,
                  args: Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    if let Ok(button) = args.Button() {
                        unsafe {
                            let _ = PostMessageW(
                                Some(HWND(hwnd_value as *mut core::ffi::c_void)),
                                WM_APP_SMTC,
                                WPARAM(button.0 as usize),
                                LPARAM(0),
                            );
                        }
                    }
                }
                Ok(())
            },
        ))?;

        let pending_seek = Arc::new(AtomicU64::new(SEEK_SENTINEL));
        let seek_slot = Arc::clone(&pending_seek);
        smtc.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_sender: Ref<SystemMediaTransportControls>,
                  args: Ref<PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(args) = args.as_ref() {
                    if let Ok(requested) = args.RequestedPlaybackPosition() {
                        let seconds =
                            (requested.Duration as f64 / TICKS_PER_SECOND).clamp(0.0, 86_400.0);
                        seek_slot.store(seconds.to_bits(), Ordering::Relaxed);
                        unsafe {
                            let _ = PostMessageW(
                                Some(HWND(hwnd_value as *mut core::ffi::c_void)),
                                WM_APP_SMTC_SEEK,
                                WPARAM(0),
                                LPARAM(0),
                            );
                        }
                    }
                }
                Ok(())
            },
        ))?;

        let updater = smtc.DisplayUpdater()?;
        let _ = updater.SetType(MediaPlaybackType::Music);
        let icon = icon_reference();
        if let Some((reference, _stream)) = &icon {
            if let Err(error) = updater.SetThumbnail(reference) {
                log(&format!("media controls: thumbnail rejected: {error}"));
            }
        } else {
            log("media controls: thumbnail unavailable");
        }
        let _ = updater.Update();

        Ok(Self {
            smtc,
            updater,
            _icon: icon,
            pending_seek,
            status: None,
            title: None,
            artist: None,
            duration: -1.0,
            position: -1.0,
        })
    }

    /// Mirrors the remote playback state into the media flyout. Only changed
    /// values are pushed so the 150 ms repaint timer stays cheap.
    pub fn sync(&mut self, np: &NowPlaying) {
        let status = match np.track {
            None => MediaPlaybackStatus::Stopped,
            Some(_) if np.is_playing => MediaPlaybackStatus::Playing,
            Some(_) => MediaPlaybackStatus::Paused,
        };
        if self.status != Some(status.0) {
            let _ = self.smtc.SetPlaybackStatus(status);
            self.status = Some(status.0);
        }

        let title = np
            .track
            .as_ref()
            .map(|track| track.title.as_str())
            .unwrap_or("RunMusic Remote");
        let artist = np
            .track
            .as_ref()
            .map(|track| track.artist.as_str())
            .unwrap_or("");
        if self.title.as_deref() != Some(title) || self.artist.as_deref() != Some(artist) {
            if let Ok(properties) = self.updater.MusicProperties() {
                let _ = properties.SetTitle(&HSTRING::from(title));
                let _ = properties.SetArtist(&HSTRING::from(artist));
            }
            let _ = self.updater.Update();
            self.title = Some(title.to_string());
            self.artist = Some(artist.to_string());
        }

        let duration = np.duration.max(0.0);
        let position = np.position().clamp(0.0, duration);
        if (duration - self.duration).abs() >= 0.5 || (position - self.position).abs() >= 1.0 {
            self.duration = duration;
            self.position = position;
            if let Ok(timeline) = SystemMediaTransportControlsTimelineProperties::new() {
                let _ = timeline.SetStartTime(span(0.0));
                let _ = timeline.SetEndTime(span(duration));
                let _ = timeline.SetMinSeekTime(span(0.0));
                let _ = timeline.SetMaxSeekTime(span(duration));
                let _ = timeline.SetPosition(span(position));
                let _ = self.smtc.UpdateTimelineProperties(&timeline);
            }
        }
    }

    /// Returns the pending seek position in seconds, if the shell asked for one.
    pub fn take_seek(&self) -> Option<f64> {
        let bits = self.pending_seek.swap(SEEK_SENTINEL, Ordering::Relaxed);
        (bits != SEEK_SENTINEL).then(|| f64::from_bits(bits))
    }

    pub fn shutdown(&self) {
        let _ = self.smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed);
        let _ = self.smtc.SetIsEnabled(false);
    }
}

fn span(seconds: f64) -> TimeSpan {
    TimeSpan {
        Duration: (seconds.max(0.0) * TICKS_PER_SECOND) as i64,
    }
}

/// Builds the flyout thumbnail from the embedded app icon. The bytes live in an
/// in-memory stream so the shell never has to touch the filesystem (a `file:`
/// URI reference is silently dropped by SMTC).
fn icon_reference() -> Option<(RandomAccessStreamReference, InMemoryRandomAccessStream)> {
    const ICON: &[u8] = include_bytes!("../icon-panel.png");

    let memory = InMemoryRandomAccessStream::new().ok()?;
    let output: IOutputStream = memory.cast().ok()?;
    let writer = DataWriter::CreateDataWriter(&output).ok()?;
    writer.WriteBytes(ICON).ok()?;
    if let Ok(store) = writer.StoreAsync() {
        let _ = store.join();
    }
    let _ = writer.DetachStream();

    let stream: IRandomAccessStream = memory.cast().ok()?;
    stream.Seek(0).ok()?;
    let reference = RandomAccessStreamReference::CreateFromStream(&stream).ok()?;
    Some((reference, memory))
}
