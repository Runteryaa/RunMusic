//! RunMusic remote protocol.
//!
//! Mirrors `src/services/remote/remoteTypes.ts` from the Expo app. Only the
//! messages a BLE media remote actually receives are modelled; everything else
//! is ignored via `#[serde(other)]` so new host messages never break the client.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const SERVICE_UUID: u128 = 0x0000_feed_0000_1000_8000_00805f9b34fb;
pub const CHAR_STATE_NOTIFY_UUID: u128 = 0x0000_fee1_0000_1000_8000_00805f9b34fb;
pub const CHAR_COMMAND_WRITE_UUID: u128 = 0x0000_fee2_0000_1000_8000_00805f9b34fb;
#[allow(dead_code)]
pub const CHAR_QUEUE_LYRICS_UUID: u128 = 0x0000_fee3_0000_1000_8000_00805f9b34fb;
pub const CHAR_DEVICE_INFO_UUID: u128 = 0x0000_fee4_0000_1000_8000_00805f9b34fb;

/// Safe notification/ATT payload size used by the Android host.
pub const BLE_CHUNK_SIZE: usize = 180;

fn default_rate() -> f64 {
    1.0
}

/// `RepeatMode` is a numeric enum on the host (0 = off, 1 = track, 2 = queue).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RepeatMode {
    #[default]
    Off,
    Track,
    Queue,
}

impl RepeatMode {
    pub fn from_value(value: Option<&Value>) -> Self {
        match value {
            Some(Value::Number(n)) => match n.as_u64() {
                Some(1) => Self::Track,
                Some(2) => Self::Queue,
                _ => Self::Off,
            },
            Some(Value::String(s)) => match s.as_str() {
                "track" | "TRACK" | "Track" => Self::Track,
                "queue" | "QUEUE" | "Queue" => Self::Queue,
                _ => Self::Off,
            },
            _ => Self::Off,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSummary {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub artist: String,
    #[serde(default)]
    pub duration: f64,
}

/// One pre-parsed lyric line. The host normally sends these without `words`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLinePayload {
    #[serde(default)]
    pub time: f64,
    #[serde(default)]
    pub text: String,
}

/// The lyric payload embedded in `INITIAL_STATE`, `TRACK_CHANGE` and
/// `LYRICS_SYNC`. BLE clients receive a slim version (no word timings).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricsPayload {
    #[serde(default)]
    pub track_id: Option<String>,
    #[serde(default)]
    pub lines: Vec<LyricLinePayload>,
    #[serde(default)]
    pub is_synced: bool,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub plain_lyrics: Option<String>,
    #[serde(default)]
    pub synced_lyrics: Option<String>,
    #[serde(default)]
    pub lyricsfile: Option<String>,
    /// Seconds; positive values delay the lyrics (same as the phone).
    #[serde(default)]
    pub offset_seconds: f64,
}

/// Host -> client messages. Unknown types deserialize to `Other`.
#[derive(Debug, Clone, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum Incoming {
    InitialState {
        #[serde(default)]
        active_track: Option<TrackSummary>,
        #[serde(default)]
        is_playing: bool,
        #[serde(default = "default_rate")]
        playback_rate: f64,
        #[serde(default)]
        position: f64,
        #[serde(default)]
        repeat_mode: Option<Value>,
        #[serde(default)]
        is_shuffle: bool,
        #[serde(default)]
        lyrics: Option<LyricsPayload>,
        #[serde(default)]
        theme_color: Option<String>,
    },
    PositionSync {
        #[serde(default)]
        position: f64,
        #[serde(default)]
        duration: Option<f64>,
        #[serde(default)]
        is_playing: bool,
        #[serde(default = "default_rate")]
        playback_rate: f64,
    },
    StateChange {
        #[serde(default)]
        is_playing: Option<bool>,
        #[serde(default)]
        repeat_mode: Option<Value>,
        #[serde(default)]
        is_shuffle: Option<bool>,
        #[serde(default)]
        playback_rate: Option<f64>,
    },
    TrackChange {
        #[serde(default)]
        track: Option<TrackSummary>,
        #[serde(default)]
        lyrics: Option<LyricsPayload>,
        #[serde(default)]
        theme_color: Option<String>,
    },
    LyricsSync {
        #[serde(default)]
        track_id: String,
        #[serde(default)]
        lyrics: Option<LyricsPayload>,
    },
    ThemeSync {
        #[serde(default)]
        theme_color: Option<String>,
    },
    #[serde(other)]
    Other,
}

/// Client -> host commands.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum Command {
    #[serde(rename = "COMMAND_PLAY")]
    Play,
    #[serde(rename = "COMMAND_PAUSE")]
    Pause,
    #[serde(rename = "COMMAND_SKIP_NEXT")]
    SkipNext,
    #[serde(rename = "COMMAND_SKIP_PREVIOUS")]
    SkipPrevious,
    #[serde(rename = "COMMAND_SEEK")]
    Seek { position: f64 },
    // The desktop UI no longer exposes shuffle/repeat, but the host protocol
    // still supports these commands (and `to_ndjson` keeps them tested).
    #[allow(dead_code)]
    #[serde(rename = "COMMAND_SET_SHUFFLE")]
    SetShuffle { enabled: bool },
    #[allow(dead_code)]
    #[serde(rename = "COMMAND_SET_REPEAT")]
    SetRepeat { mode: u8 },
    #[serde(rename = "COMMAND_GET_STATE")]
    GetState,
}

impl Command {
    /// Serializes the command to a single NDJSON line.
    pub fn to_ndjson(&self) -> String {
        let mut line = serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string());
        line.push('\n');
        line
    }

    /// High-frequency seeks go out as write-without-response on the host side.
    pub fn is_seek(&self) -> bool {
        matches!(self, Self::Seek { .. })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_initial_state() {
        let raw = br#"{"type":"INITIAL_STATE","activeTrack":{"id":"a","title":"Sarki","artist":"Sanatci","duration":182.4,"hasArtwork":true},"isPlaying":true,"playbackRate":1,"position":12.5,"repeatMode":2,"isShuffle":true,"queue":[],"upNext":[],"lyrics":null}"#;
        let msg: Incoming = serde_json::from_slice(raw).unwrap();
        match msg {
            Incoming::InitialState {
                active_track,
                is_playing,
                repeat_mode,
                is_shuffle,
                ..
            } => {
                let track = active_track.unwrap();
                assert_eq!(track.title, "Sarki");
                assert!((track.duration - 182.4).abs() < 0.001);
                assert!(is_playing);
                assert_eq!(RepeatMode::from_value(repeat_mode.as_ref()), RepeatMode::Queue);
                assert!(is_shuffle);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn parses_position_and_state_change() {
        let pos: Incoming =
            serde_json::from_slice(br#"{"type":"POSITION_SYNC","position":3.5,"isPlaying":true,"playbackRate":1}"#)
                .unwrap();
        assert!(matches!(pos, Incoming::PositionSync { .. }));

        let state: Incoming = serde_json::from_slice(
            br#"{"type":"STATE_CHANGE","isPlaying":false,"repeatMode":1,"isShuffle":false}"#,
        )
        .unwrap();
        match state {
            Incoming::StateChange {
                is_playing,
                repeat_mode,
                ..
            } => {
                assert_eq!(is_playing, Some(false));
                assert_eq!(RepeatMode::from_value(repeat_mode.as_ref()), RepeatMode::Track);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn unknown_messages_are_ignored() {
        let msg: Incoming =
            serde_json::from_slice(br#"{"type":"LIBRARY_RESULT","tracks":[]}"#).unwrap();
        assert!(matches!(msg, Incoming::Other));

        let msg: Incoming = serde_json::from_slice(br#"{"type":"SOMETHING_NEW","x":1}"#).unwrap();
        assert!(matches!(msg, Incoming::Other));
    }

    #[test]
    fn parses_lyrics_payloads() {
        let raw = r##"{"type":"INITIAL_STATE","activeTrack":{"id":"t1","title":"S","artist":"A","duration":100},"isPlaying":true,"playbackRate":1,"position":1,"themeColor":"#3b82f6","lyrics":{"trackId":"t1","isSynced":true,"source":"lrclib","lines":[{"time":12.5,"text":"Merhaba dünya"}],"offsetSeconds":0.4}}"##.as_bytes();
        match serde_json::from_slice::<Incoming>(raw).unwrap() {
            Incoming::InitialState { lyrics, theme_color, .. } => {
                let lyrics = lyrics.unwrap();
                assert_eq!(lyrics.track_id.as_deref(), Some("t1"));
                assert!(lyrics.is_synced);
                assert_eq!(lyrics.lines.len(), 1);
                assert_eq!(lyrics.lines[0].text, "Merhaba dünya");
                assert!((lyrics.offset_seconds - 0.4).abs() < 1e-9);
                assert_eq!(theme_color.as_deref(), Some("#3b82f6"));
            }
            _ => panic!("wrong variant"),
        }

        let raw = br##"{"type":"THEME_SYNC","themeColor":"#ff5500"}"##;
        match serde_json::from_slice::<Incoming>(raw).unwrap() {
            Incoming::ThemeSync { theme_color } => {
                assert_eq!(theme_color.as_deref(), Some("#ff5500"));
            }
            _ => panic!("wrong variant"),
        }

        let raw = br#"{"type":"LYRICS_SYNC","trackId":"t1","lyrics":{"trackId":"t1","isSynced":false,"plainLyrics":"bir\niki"}}"#;
        match serde_json::from_slice::<Incoming>(raw).unwrap() {
            Incoming::LyricsSync { track_id, lyrics } => {
                assert_eq!(track_id, "t1");
                assert!(lyrics.unwrap().plain_lyrics.as_deref() == Some("bir\niki"));
            }
            _ => panic!("wrong variant"),
        }

        let raw = br#"{"type":"TRACK_CHANGE","track":null,"lyrics":null}"#;
        assert!(matches!(
            serde_json::from_slice::<Incoming>(raw).unwrap(),
            Incoming::TrackChange { lyrics: None, .. }
        ));
    }

    #[test]
    fn commands_serialize_like_the_host_expects() {
        assert_eq!(
            Command::Seek { position: 12.5 }.to_ndjson(),
            "{\"type\":\"COMMAND_SEEK\",\"position\":12.5}\n"
        );
        assert_eq!(
            Command::SetShuffle { enabled: true }.to_ndjson(),
            "{\"type\":\"COMMAND_SET_SHUFFLE\",\"enabled\":true}\n"
        );
        assert_eq!(
            Command::GetState.to_ndjson(),
            "{\"type\":\"COMMAND_GET_STATE\"}\n"
        );
    }
}
