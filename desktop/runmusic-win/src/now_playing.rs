//! Authoritative remote playback state plus local position interpolation.
//!
//! The host sends `POSITION_SYNC` every 1.5 s; between messages the position is
//! derived from a monotonic clock. Nothing polls the phone.

use std::time::Instant;

use crate::lyrics::TrackLyrics;
use crate::protocol::{Incoming, RepeatMode, TrackSummary};

#[derive(Debug, Clone, Default)]
pub struct Track {
    pub id: String,
    pub title: String,
    pub artist: String,
}

impl From<&TrackSummary> for Track {
    fn from(value: &TrackSummary) -> Self {
        Self {
            id: value.id.clone(),
            title: value.title.clone(),
            artist: value.artist.clone(),
        }
    }
}

#[derive(Debug)]
pub struct NowPlaying {
    pub track: Option<Track>,
    pub is_playing: bool,
    pub duration: f64,
    pub rate: f64,
    pub repeat: RepeatMode,
    pub shuffle: bool,
    pub lyrics: Option<TrackLyrics>,
    pub theme_color: Option<u32>,
    base_position: f64,
    base_at: Instant,
    pub synced_once: bool,
}

impl Default for NowPlaying {
    fn default() -> Self {
        Self {
            track: None,
            is_playing: false,
            duration: 0.0,
            rate: 1.0,
            repeat: RepeatMode::Off,
            shuffle: false,
            lyrics: None,
            theme_color: None,
            base_position: 0.0,
            base_at: Instant::now(),
            synced_once: false,
        }
    }
}

impl NowPlaying {
    /// Current playback position in seconds, clamped to the known duration.
    pub fn position(&self) -> f64 {
        let mut position = self.base_position;
        if self.is_playing {
            position += self.base_at.elapsed().as_secs_f64() * self.rate.max(0.0);
        }
        position = position.max(0.0);
        if self.duration > 0.0 {
            position = position.min(self.duration);
        }
        position
    }

    pub fn has_track(&self) -> bool {
        self.track.is_some()
    }

    /// Re-anchors interpolation after a local seek so the progress bar does not
    /// jump back before the host's next POSITION_SYNC arrives.
    pub fn seek_local(&mut self, position: f64) {
        self.base_position = position.max(0.0);
        self.base_at = Instant::now();
    }

    pub fn apply(&mut self, message: &Incoming) {
        match message {
            Incoming::InitialState {
                active_track,
                is_playing,
                playback_rate,
                position,
                repeat_mode,
                is_shuffle,
                lyrics,
                theme_color,
            } => {
                self.track = active_track.as_ref().map(Track::from);
                self.duration = active_track
                    .as_ref()
                    .map(|t| t.duration.max(0.0))
                    .unwrap_or(0.0);
                self.is_playing = *is_playing;
                self.rate = sane_rate(*playback_rate);
                self.base_position = position.max(0.0);
                self.base_at = Instant::now();
                self.repeat = RepeatMode::from_value(repeat_mode.as_ref());
                self.shuffle = *is_shuffle;
                self.lyrics = self.track.as_ref().and_then(|track| {
                    lyrics
                        .as_ref()
                        .and_then(|payload| TrackLyrics::from_payload(payload, &track.id))
                });
                if let Some(color) = theme_color.as_deref().and_then(parse_hex_color) {
                    self.theme_color = Some(color);
                }
                self.synced_once = true;
            }
            Incoming::PositionSync {
                position,
                duration,
                is_playing,
                playback_rate,
            } => {
                if let Some(duration) = duration {
                    if *duration > 0.0 {
                        self.duration = *duration;
                    }
                }
                self.is_playing = *is_playing;
                self.rate = sane_rate(*playback_rate);
                // Trust the host; the local clock is only an interpolator.
                self.base_position = position.max(0.0);
                self.base_at = Instant::now();
                self.synced_once = true;
            }
            Incoming::StateChange {
                is_playing,
                repeat_mode,
                is_shuffle,
                playback_rate,
            } => {
                if let Some(is_playing) = is_playing {
                    if *is_playing != self.is_playing {
                        // Freeze the interpolated value before flipping state.
                        self.base_position = self.position();
                        self.base_at = Instant::now();
                    }
                    self.is_playing = *is_playing;
                }
                if let Some(repeat_mode) = repeat_mode {
                    self.repeat = RepeatMode::from_value(Some(repeat_mode));
                }
                if let Some(shuffle) = is_shuffle {
                    self.shuffle = *shuffle;
                }
                if let Some(rate) = playback_rate {
                    self.rate = sane_rate(*rate);
                }
            }
            Incoming::TrackChange {
                track,
                lyrics,
                theme_color,
            } => {
                self.track = track.as_ref().map(Track::from);
                self.duration = track.as_ref().map(|t| t.duration.max(0.0)).unwrap_or(0.0);
                self.base_position = 0.0;
                self.base_at = Instant::now();
                self.lyrics = self.track.as_ref().and_then(|track| {
                    lyrics
                        .as_ref()
                        .and_then(|payload| TrackLyrics::from_payload(payload, &track.id))
                });
                if let Some(color) = theme_color.as_deref().and_then(parse_hex_color) {
                    self.theme_color = Some(color);
                }
                // The host follows a track change with POSITION_SYNC(0).
                if self.track.is_none() {
                    self.is_playing = false;
                }
            }
            Incoming::ThemeSync { theme_color } => {
                if let Some(color) = theme_color.as_deref().and_then(parse_hex_color) {
                    self.theme_color = Some(color);
                }
            }
            Incoming::LyricsSync { track_id, lyrics } => {
                let Some(track) = self.track.as_ref() else {
                    return;
                };
                if !track_id.is_empty() && track_id != &track.id {
                    return;
                }
                self.lyrics = lyrics
                    .as_ref()
                    .and_then(|payload| TrackLyrics::from_payload(payload, &track.id));
            }
            Incoming::Other => {}
        }
    }
}

fn sane_rate(rate: f64) -> f64 {
    if rate.is_finite() && rate > 0.0 {
        rate
    } else {
        1.0
    }
}

pub fn parse_hex_color(hex: &str) -> Option<u32> {
    let s = hex.trim().trim_start_matches('#');
    if s.len() == 6 {
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some(r as u32 | ((g as u32) << 8) | ((b as u32) << 16))
    } else if s.len() == 3 {
        let r = u8::from_str_radix(&s[0..1], 16).ok()?;
        let g = u8::from_str_radix(&s[1..2], 16).ok()?;
        let b = u8::from_str_radix(&s[2..3], 16).ok()?;
        Some((r * 17) as u32 | (((g * 17) as u32) << 8) | (((b * 17) as u32) << 16))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn position_sync(position: f64, is_playing: bool) -> Incoming {
        Incoming::PositionSync {
            position,
            duration: Some(200.0),
            is_playing,
            playback_rate: 1.0,
        }
    }

    #[test]
    fn position_is_clamped_and_frozen_when_paused() {
        let mut np = NowPlaying::default();
        np.apply(&position_sync(10.0, true));
        std::thread::sleep(std::time::Duration::from_millis(30));
        assert!(np.position() >= 10.0);

        np.apply(&Incoming::StateChange {
            is_playing: Some(false),
            repeat_mode: None,
            is_shuffle: None,
            playback_rate: None,
        });
        let frozen = np.position();
        std::thread::sleep(std::time::Duration::from_millis(20));
        assert!((np.position() - frozen).abs() < 0.001);
        assert!(frozen < 200.0);
    }

    #[test]
    fn track_change_resets_position() {
        let mut np = NowPlaying::default();
        np.apply(&position_sync(30.0, true));
        np.apply(&Incoming::TrackChange {
            track: Some(TrackSummary {
                id: "1".into(),
                title: "A".into(),
                artist: "B".into(),
                duration: 120.0,
            }),
            lyrics: None,
            theme_color: None,
        });
        assert_eq!(np.duration, 120.0);
        assert!(np.position() < 1.0);
    }

    #[test]
    fn parses_hex_color_and_applies_theme_sync() {
        assert_eq!(parse_hex_color("#3b82f6"), Some(0x00f6823b));
        assert_eq!(parse_hex_color("3b82f6"), Some(0x00f6823b));
        assert_eq!(parse_hex_color("#fff"), Some(0x00ffffff));
        assert_eq!(parse_hex_color("invalid"), None);

        let mut np = NowPlaying::default();
        np.apply(&Incoming::ThemeSync {
            theme_color: Some("#ff5500".into()),
        });
        assert_eq!(np.theme_color, Some(0x000055ff));
    }
}
