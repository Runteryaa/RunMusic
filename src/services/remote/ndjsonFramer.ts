import { Buffer } from 'buffer';
import type { RemoteMessage } from './remoteTypes';

/**
 * Serializes a typed remote message into an NDJSON line ending in '\n'.
 */
export function serializeNDJSON(message: RemoteMessage | Record<string, unknown>): string {
  return JSON.stringify(message) + '\n';
}

/**
 * Robust stream parser for Newline-Delimited JSON (NDJSON) over raw TCP streams.
 *
 * Hermes-safe & Multi-byte UTF-8 resilient:
 * Accumulates raw incoming bytes in a Buffer and splits on byte 0x0A ('\n')
 * BEFORE converting to a UTF-8 string. This ensures multi-byte characters
 * (Turkish characters like 'ş, ğ, ı, ö, ü, ç', emojis, etc.) that cross
 * TCP packet chunk boundaries are never split or corrupted into replacement chars.
 */
export class NDJSONParser {
  private byteBuffer: Buffer = Buffer.alloc(0);

  /**
   * Feed a new incoming TCP chunk (Buffer or string) into the buffer and parse
   * any completed newline-delimited lines.
   */
  public feed(
    chunk: Buffer | Uint8Array | string,
    onMessage: (message: RemoteMessage) => void
  ): void {
    const incoming: Buffer =
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk);

    this.byteBuffer = Buffer.concat([this.byteBuffer, incoming]);

    let newlineIndex: number;
    // 0x0A is the ASCII byte for newline '\n'
    while ((newlineIndex = this.byteBuffer.indexOf(0x0a)) !== -1) {
      const lineBuffer = Buffer.from(this.byteBuffer.subarray(0, newlineIndex));
      this.byteBuffer = Buffer.from(this.byteBuffer.subarray(newlineIndex + 1));

      const trimmed = lineBuffer.toString('utf8').trim();
      if (!trimmed) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed) as RemoteMessage;
        onMessage(parsed);
      } catch (err) {
        console.warn('[NDJSONParser] Failed to parse JSON line:', trimmed, err);
      }
    }
  }

  /**
   * Reset buffer on socket close or connection reset.
   */
  public reset(): void {
    this.byteBuffer = Buffer.alloc(0);
  }
}
