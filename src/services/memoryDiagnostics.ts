import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Very small, dependency-free memory/event sampler.
 *
 * The Android OOM report only shows where the Java heap finally ran out (often
 * while Fabric is creating a native Animated node). It does not show which UI
 * tree kept growing. These counters let us correlate background time with:
 * - JS heap samples,
 * - component mount/unmount/render churn,
 * - app/player state transitions,
 * - ad load/fail events.
 *
 * The log is kept in a ring buffer and persisted as one small AsyncStorage
 * value, so a crash in a previous session can be inspected after relaunch.
 */
export interface ComponentStat {
  mounts: number;
  unmounts: number;
  renders: number;
}

export interface MemorySample {
  at: number;
  session: number;
  appState: string;
  jsHeapSize: number | null;
  jsAllocatedBytes: number | null;
  jsExternalBytes: number | null;
  components: Record<string, ComponentStat>;
  extra: Record<string, string | number | boolean | null>;
}

export interface DiagnosticEvent {
  at: number;
  name: string;
  detail?: string;
}

export interface DiagnosticSnapshot {
  session: number;
  samples: MemorySample[];
  events: DiagnosticEvent[];
  components: Record<string, ComponentStat>;
}

const STORAGE_KEY = '@runmusic/memory_diagnostics_v1';
const MAX_SAMPLES = 360;
const MAX_EVENTS = 200;
// Persist a shorter tail than the in-memory buffer. A large single
// AsyncStorage value is both slow to serialize and risky on Android; the last
// two hours are enough to see the growth trend before an OOM.
const MAX_PERSISTED_SAMPLES = 120;
const MAX_PERSISTED_EVENTS = 100;
const PERSIST_INTERVAL_MS = 180_000;
const SESSION_ID = Date.now();

const componentStats = new Map<string, ComponentStat>();
let samples: MemorySample[] = [];
let events: DiagnosticEvent[] = [];
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let persistInFlight = false;
let persistPending = false;
let lastPersistAt = 0;

function ensureStat(name: string): ComponentStat {
  let stat = componentStats.get(name);
  if (!stat) {
    stat = { mounts: 0, unmounts: 0, renders: 0 };
    componentStats.set(name, stat);
  }
  return stat;
}

export function trackMount(name: string): void {
  ensureStat(name).mounts += 1;
}

export function trackUnmount(name: string): void {
  ensureStat(name).unmounts += 1;
}

export function trackRender(name: string): void {
  ensureStat(name).renders += 1;
}

export function recordEvent(name: string, detail?: string): void {
  events.push({ at: Date.now(), name, detail });
  if (events.length > MAX_EVENTS) {
    events = events.slice(events.length - MAX_EVENTS);
  }
}

function readHermesStats(): {
  jsHeapSize: number | null;
  jsAllocatedBytes: number | null;
  jsExternalBytes: number | null;
} {
  try {
    const stats = (globalThis as { HermesInternal?: { getRuntimeStats?: () => Record<string, unknown> } })
      .HermesInternal?.getRuntimeStats?.();
    if (!stats) {
      return { jsHeapSize: null, jsAllocatedBytes: null, jsExternalBytes: null };
    }
    const asNumber = (value: unknown) => (typeof value === 'number' ? value : null);
    return {
      jsHeapSize: asNumber(stats.js_heapSize),
      jsAllocatedBytes: asNumber(stats.js_allocatedBytes),
      jsExternalBytes: asNumber(stats.js_externalBytes),
    };
  } catch {
    return { jsHeapSize: null, jsAllocatedBytes: null, jsExternalBytes: null };
  }
}

function snapshotComponents(): Record<string, ComponentStat> {
  const result: Record<string, ComponentStat> = {};
  componentStats.forEach((stat, name) => {
    result[name] = { ...stat };
  });
  return result;
}

async function persistNow(): Promise<void> {
  if (persistInFlight) {
    persistPending = true;
    return;
  }
  persistInFlight = true;
  lastPersistAt = Date.now();
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        session: SESSION_ID,
        samples: samples.slice(-MAX_PERSISTED_SAMPLES),
        events: events.slice(-MAX_PERSISTED_EVENTS),
      })
    );
  } catch {
    // Diagnostics must never interfere with playback.
  } finally {
    persistInFlight = false;
    if (persistPending) {
      persistPending = false;
      void persistNow();
    }
  }
}

export function recordMemorySample(
  appState: string,
  extra: Record<string, string | number | boolean | null> = {}
): MemorySample {
  const previousAppState = samples.length > 0 ? samples[samples.length - 1].appState : null;
  const hermes = readHermesStats();
  const sample: MemorySample = {
    at: Date.now(),
    session: SESSION_ID,
    appState,
    ...hermes,
    components: snapshotComponents(),
    extra,
  };
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) {
    samples = samples.slice(samples.length - MAX_SAMPLES);
  }
  // Persist immediately on a real app-state transition (so the crash boundary
  // is captured), otherwise batch writes every few minutes.
  if (previousAppState !== appState || Date.now() - lastPersistAt >= PERSIST_INTERVAL_MS) {
    void persistNow();
  }
  return sample;
}

/**
 * Loads the previous session's ring buffer once. The root sampler waits for
 * this before adding new samples, so a crash log is not overwritten on launch.
 */
export function ensureMemoryDiagnosticsHydrated(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          samples?: MemorySample[];
          events?: DiagnosticEvent[];
        };
        if (Array.isArray(parsed.samples)) {
          const restored = parsed.samples
            .filter((sample) => sample && typeof sample.at === 'number')
            .slice(-MAX_SAMPLES);
          // Keep any samples recorded while hydration was in flight.
          samples = [...restored, ...samples]
            .sort((a, b) => a.at - b.at)
            .slice(-MAX_SAMPLES);
        }
        if (Array.isArray(parsed.events)) {
          const restored = parsed.events
            .filter((event) => event && typeof event.at === 'number')
            .slice(-MAX_EVENTS);
          events = [...restored, ...events]
            .sort((a, b) => a.at - b.at)
            .slice(-MAX_EVENTS);
        }
      }
    } catch {
      // A corrupt log is not worth failing startup for.
    } finally {
      hydrated = true;
    }
  })();

  return hydratePromise;
}

export async function clearMemoryDiagnostics(): Promise<void> {
  samples = [];
  events = [];
  componentStats.clear();
  lastPersistAt = 0;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors; diagnostics are best-effort.
  }
  // If a write was already in flight, the pending write in persistNow() will
  // overwrite it with the empty state.
  await persistNow();
}

export function getDiagnosticSnapshot(): DiagnosticSnapshot {
  return {
    session: SESSION_ID,
    samples: samples.map((sample) => ({
      ...sample,
      components: { ...sample.components },
      extra: { ...sample.extra },
    })),
    events: events.map((event) => ({ ...event })),
    components: snapshotComponents(),
  };
}

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${(value / (1024 * 1024)).toFixed(1)}MB`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function formatComponents(components: Record<string, ComponentStat>): string {
  return Object.entries(components)
    .map(([name, stat]) => `${name}=${stat.mounts}/${stat.unmounts}/${stat.renders}`)
    .join(' ');
}

function formatExtra(extra: MemorySample['extra']): string {
  return Object.entries(extra)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}

export function formatMemoryDiagnostics(): string {
  const lines: string[] = [
    'RunMusic memory diagnostics',
    `session=${SESSION_ID}`,
    `samples=${samples.length} events=${events.length}`,
    'format: component=mounts/unmounts/renders',
    '',
  ];

  for (const sample of samples) {
    lines.push(
      `[${formatTime(sample.at)}] state=${sample.appState} ` +
        `jsHeap=${formatBytes(sample.jsHeapSize)} allocated=${formatBytes(sample.jsAllocatedBytes)} ` +
        `${formatExtra(sample.extra)}`
    );
    lines.push(`  ${formatComponents(sample.components)}`);
  }

  if (events.length > 0) {
    lines.push('', 'Events:');
    for (const event of events) {
      lines.push(
        `[${formatTime(event.at)}] ${event.name}${event.detail ? `: ${event.detail}` : ''}`
      );
    }
  }

  return lines.join('\n');
}
