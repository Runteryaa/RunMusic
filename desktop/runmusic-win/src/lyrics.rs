//! Lyric model for the remote player.
//!
//! The phone is the source of truth: it decides which lyric source is active
//! and how much the timeline is shifted by the user's offset. The desktop only
//! receives the resulting lines (or the raw LRC as a fallback) and mirrors the
//! phone's highlighting rule: `position - offset`, where a positive offset
//! delays the lyrics.

use std::cmp::Ordering;

use crate::protocol::LyricsPayload;

/// Same bound as the phone's `MAX_LYRICS_OFFSET_SECONDS`.
const MAX_OFFSET: f64 = 30.0;

#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    /// Start time in seconds.
    pub at: f64,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct TrackLyrics {
    pub lines: Vec<Line>,
    /// Only synced lyrics get an active line; plain text is just scrollable.
    pub synced: bool,
    pub source: Option<String>,
    /// Seconds added by the phone; positive delays the lyrics.
    pub offset: f64,
}

impl TrackLyrics {
    /// Builds the model from a host payload. Returns `None` when the payload
    /// belongs to another track (stale sync) or carries no usable text.
    pub fn from_payload(payload: &LyricsPayload, track_id: &str) -> Option<Self> {
        if let Some(id) = payload.track_id.as_deref() {
            if !id.is_empty() && !track_id.is_empty() && id != track_id {
                return None;
            }
        }

        let mut lines = payload
            .lines
            .iter()
            .filter(|line| line.time.is_finite() && line.time >= 0.0)
            .map(|line| Line {
                at: line.time,
                text: normalize(&line.text),
            })
            .filter(|line| !line.text.is_empty())
            .collect::<Vec<_>>();
        sort_lines(&mut lines);

        let mut synced = !lines.is_empty() && payload.is_synced;
        if lines.is_empty() {
            // Slim BLE payloads only carry `lines`; the raw strings are a
            // fallback for older hosts or messages built differently.
            for raw in [payload.synced_lyrics.as_deref(), payload.lyricsfile.as_deref()]
                .into_iter()
                .flatten()
            {
                let parsed = parse_lrc(raw);
                if !parsed.is_empty() {
                    lines = parsed;
                    synced = true;
                    break;
                }
            }
        }

        if lines.is_empty() {
            lines = plain_lines(payload.plain_lyrics.as_deref()?);
            synced = false;
        }
        if lines.is_empty() || (synced && !lines.iter().any(|line| line.at > 0.0)) {
            synced = false;
        }

        let offset = if payload.offset_seconds.is_finite() {
            payload.offset_seconds.clamp(-MAX_OFFSET, MAX_OFFSET)
        } else {
            0.0
        };

        Some(Self {
            lines,
            synced,
            source: payload.source.clone().filter(|source| !source.is_empty()),
            offset,
        })
    }

    /// Index of the last line whose timestamp has been reached, mirroring the
    /// phone's `progress.position - offset` computation.
    pub fn active_index(&self, position: f64) -> Option<usize> {
        if !self.synced || self.lines.is_empty() {
            return None;
        }
        let effective = position - self.offset;
        if !effective.is_finite() || effective < self.lines[0].at {
            return None;
        }
        let mut low = 0usize;
        let mut high = self.lines.len();
        while low < high {
            let mid = (low + high) / 2;
            if self.lines[mid].at <= effective {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        Some(low - 1)
    }

    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }
}

fn sort_lines(lines: &mut [Line]) {
    lines.sort_by(|a, b| a.at.partial_cmp(&b.at).unwrap_or(Ordering::Equal));
}

fn normalize(text: &str) -> String {
    strip_word_tags(text)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Removes Enhanced LRC word tags (`<mm:ss.xx>`) while leaving unrelated
/// angle-bracket text alone.
fn strip_word_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        if let Some(end) = after.find('>') {
            if parse_time_tag(&after[..end]).is_some() {
                rest = &after[end + 1..];
                continue;
            }
        }
        out.push('<');
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Parses `mm:ss`, `mm:ss.xx`, `mm:ss.xxx` and `mm:ss:xx` timestamps.
fn parse_time_tag(tag: &str) -> Option<f64> {
    let colon = tag.find(':')?;
    let minutes: u32 = tag[..colon].parse().ok()?;
    let rest = &tag[colon + 1..];
    if rest.len() < 2 {
        return None;
    }
    let (seconds_text, fraction) = match rest.find(['.', ':']) {
        Some(index) => (&rest[..index], Some(&rest[index + 1..])),
        None => (rest, None),
    };
    if seconds_text.len() != 2 {
        return None;
    }
    let seconds: u32 = seconds_text.parse().ok()?;
    let millis = match fraction {
        None => 0,
        Some(fraction) if !fraction.is_empty() && fraction.chars().all(|c| c.is_ascii_digit()) => {
            let mut padded = fraction.to_string();
            while padded.len() < 3 {
                padded.push('0');
            }
            padded[..3].parse::<u32>().ok()?
        }
        Some(_) => return None,
    };
    Some(minutes as f64 * 60.0 + seconds as f64 + millis as f64 / 1000.0)
}

/// Parses LRC content: one line may carry several `[mm:ss.xx]` timestamps.
pub fn parse_lrc(raw: &str) -> Vec<Line> {
    let mut out = Vec::new();
    for raw_line in raw.lines() {
        let mut times = Vec::new();
        let mut text = String::new();
        let mut in_tag = false;
        let mut tag = String::new();
        for ch in raw_line.chars() {
            match ch {
                '[' if !in_tag => {
                    in_tag = true;
                    tag.clear();
                }
                ']' if in_tag => {
                    in_tag = false;
                    if let Some(time) = parse_time_tag(&tag) {
                        times.push(time);
                    }
                }
                _ if in_tag => tag.push(ch),
                _ => text.push(ch),
            }
        }
        if times.is_empty() {
            continue;
        }
        let text = normalize(&text);
        if text.is_empty() {
            continue;
        }
        for at in times {
            out.push(Line {
                at,
                text: text.clone(),
            });
        }
    }
    sort_lines(&mut out);
    out
}

fn plain_lines(raw: &str) -> Vec<Line> {
    raw.lines()
        .map(|line| Line {
            at: 0.0,
            text: normalize(line),
        })
        .filter(|line| !line.text.is_empty())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::LyricLinePayload;

    #[test]
    fn parses_lrc_with_multiple_timestamps_and_word_tags() {
        let raw = "[00:12.50][00:20.00]Merhaba <00:13.00>dünya\n\
                   [01:02.3]İkinci satır\n\
                   [ar:Grup]\n\
                   [00:05.00]\n\
                   [00:30:75]Üçüncü";
        let lines = parse_lrc(raw);
        assert_eq!(lines.len(), 4);
        assert!((lines[0].at - 12.5).abs() < 1e-9);
        assert_eq!(lines[0].text, "Merhaba dünya");
        assert!((lines[1].at - 20.0).abs() < 1e-9);
        assert!((lines[2].at - 30.75).abs() < 1e-9);
        assert_eq!(lines[2].text, "Üçüncü");
        assert!((lines[3].at - 62.3).abs() < 1e-6);
    }

    #[test]
    fn ignores_angle_brackets_that_are_not_time_tags() {
        assert_eq!(normalize("I <3 you <b>now</b>"), "I <3 you <b>now</b>");
    }

    fn payload(lines: Vec<(f64, &str)>, offset: f64) -> LyricsPayload {
        LyricsPayload {
            track_id: Some("t1".into()),
            lines: lines
                .into_iter()
                .map(|(time, text)| LyricLinePayload {
                    time,
                    text: text.into(),
                })
                .collect(),
            is_synced: true,
            offset_seconds: offset,
            ..LyricsPayload::default()
        }
    }

    #[test]
    fn active_line_follows_position_and_offset() {
        let lyrics = TrackLyrics::from_payload(
            &payload(vec![(1.0, "bir"), (5.0, "iki"), (0.5, "sıfır")], 0.0),
            "t1",
        )
        .unwrap();
        assert_eq!(
            lyrics.lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>(),
            vec!["sıfır", "bir", "iki"]
        );
        assert_eq!(lyrics.active_index(0.2), None);
        assert_eq!(lyrics.active_index(0.5), Some(0));
        assert_eq!(lyrics.active_index(4.9), Some(1));
        assert_eq!(lyrics.active_index(60.0), Some(2));

        let shifted = TrackLyrics::from_payload(
            &payload(vec![(1.0, "bir"), (5.0, "iki")], 1.5),
            "t1",
        )
        .unwrap();
        assert_eq!(shifted.offset, 1.5);
        assert_eq!(shifted.active_index(2.0), None);
        assert_eq!(shifted.active_index(2.5), Some(0));
        assert_eq!(shifted.active_index(6.5), Some(1));
    }

    #[test]
    fn falls_back_to_raw_lrc_and_plain_text() {
        let mut raw = LyricsPayload {
            track_id: Some("t1".into()),
            is_synced: true,
            synced_lyrics: Some("[00:01.00]bir\n[00:02.00]iki".into()),
            ..LyricsPayload::default()
        };
        let lyrics = TrackLyrics::from_payload(&raw, "t1").unwrap();
        assert!(lyrics.synced);
        assert_eq!(lyrics.lines.len(), 2);
        assert_eq!(lyrics.active_index(1.5), Some(0));

        raw.synced_lyrics = None;
        raw.is_synced = false;
        raw.lines.clear();
        raw.plain_lyrics = Some("bir\n\niki".into());
        let lyrics = TrackLyrics::from_payload(&raw, "t1").unwrap();
        assert!(!lyrics.synced);
        assert_eq!(lyrics.lines.len(), 2);
        assert_eq!(lyrics.active_index(100.0), None);
    }

    #[test]
    fn rejects_stale_payloads_and_caps_offset() {
        let mut raw = payload(vec![(1.0, "bir")], 99.0);
        assert!(TrackLyrics::from_payload(&raw, "t2").is_none());

        raw.track_id = None;
        let lyrics = TrackLyrics::from_payload(&raw, "t2").unwrap();
        assert!((lyrics.offset - MAX_OFFSET).abs() < 1e-9);
    }
}
