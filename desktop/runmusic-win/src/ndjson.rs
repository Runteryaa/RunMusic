//! Byte-level NDJSON framing.
//!
//! Splits on the `\n` byte *before* UTF-8 decoding so multi-byte characters
//! (Turkish `ş ğ ı`, emoji) split across BLE notification boundaries are never
//! corrupted. Matches `src/services/remote/ndjsonFramer.ts` on the host.

/// Upper bound for a single un-terminated line. Protects against a corrupt
/// stream filling memory; callers should resync with `COMMAND_GET_STATE`.
pub const MAX_LINE: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedResult {
    Ok,
    /// Buffer overflowed and was dropped; the caller should resync.
    Resync,
}

#[derive(Debug, Default)]
pub struct NdjsonBuffer {
    buf: Vec<u8>,
}

impl NdjsonBuffer {
    pub fn new() -> Self {
        Self {
            buf: Vec::with_capacity(512),
        }
    }

    pub fn reset(&mut self) {
        self.buf.clear();
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.buf.is_empty()
    }

    /// Appends `chunk` and calls `on_line` for every complete line (without the
    /// trailing newline and surrounding ASCII whitespace).
    pub fn feed<F: FnMut(&[u8])>(&mut self, chunk: &[u8], mut on_line: F) -> FeedResult {
        self.buf.extend_from_slice(chunk);

        let mut start = 0usize;
        while let Some(offset) = self.buf[start..].iter().position(|&b| b == b'\n') {
            let end = start + offset;
            let mut line = &self.buf[start..end];
            while let Some((&first, rest)) = line.split_first() {
                if first.is_ascii_whitespace() {
                    line = rest;
                } else {
                    break;
                }
            }
            while let Some((&last, rest)) = line.split_last() {
                if last.is_ascii_whitespace() {
                    line = rest;
                } else {
                    break;
                }
            }
            if !line.is_empty() {
                on_line(line);
            }
            start = end + 1;
        }

        if start > 0 {
            self.buf.drain(..start);
        }

        if self.buf.len() > MAX_LINE {
            self.buf.clear();
            return FeedResult::Resync;
        }

        FeedResult::Ok
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Incoming;

    fn collect(buffer: &mut NdjsonBuffer, chunk: &[u8]) -> (Vec<Incoming>, FeedResult) {
        let mut out = Vec::new();
        let result = buffer.feed(chunk, |line| {
            if let Ok(msg) = serde_json::from_slice::<Incoming>(line) {
                out.push(msg);
            }
        });
        (out, result)
    }

    #[test]
    fn reassembles_split_multibyte_utf8() {
        let line = "{\"type\":\"TRACK_CHANGE\",\"track\":{\"id\":\"1\",\"title\":\"Şu ğibi ırmak 🎵\",\"artist\":\"Çal\",\"duration\":3}}\n";
        let bytes = line.as_bytes();
        let mut buffer = NdjsonBuffer::new();
        let mut messages = Vec::new();

        // One byte at a time forces every multi-byte character across a chunk edge.
        for byte in bytes {
            let (mut parsed, _) = collect(&mut buffer, &[*byte]);
            messages.append(&mut parsed);
        }

        assert_eq!(messages.len(), 1);
        match &messages[0] {
            Incoming::TrackChange { track, .. } => {
                let track = track.as_ref().unwrap();
                assert_eq!(track.title, "Şu ğibi ırmak 🎵");
                assert_eq!(track.artist, "Çal");
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn parses_multiple_lines_in_one_chunk() {
        let mut buffer = NdjsonBuffer::new();
        let (messages, result) = collect(
            &mut buffer,
            b"{\"type\":\"COMMAND_GET_STATE\"}\n\n{\"type\":\"POSITION_SYNC\",\"position\":1,\"isPlaying\":true}\n",
        );
        assert_eq!(result, FeedResult::Ok);
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn overflows_and_resyncs() {
        let mut buffer = NdjsonBuffer::new();
        let mut fired = false;
        let chunk = vec![b'x'; MAX_LINE + 1];
        let result = buffer.feed(&chunk, |_| fired = true);
        assert_eq!(result, FeedResult::Resync);
        assert!(!fired);
        assert!(buffer.is_empty());
    }

    #[test]
    fn handles_partial_trailing_line() {
        let mut buffer = NdjsonBuffer::new();
        let (messages, _) = collect(
            &mut buffer,
            b"{\"type\":\"POSITION_SYNC\",\"position\":2,\"isPlaying\":false}",
        );
        assert!(messages.is_empty());
        let (messages, _) = collect(&mut buffer, b"\n");
        assert_eq!(messages.len(), 1);
    }
}
