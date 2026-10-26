//! BLE connection manager.
//!
//! A single thread owns the WinRT objects. UI commands and WinRT callbacks are
//! funnelled through one crossbeam channel, so the thread sleeps while idle and
//! reacts immediately to playback commands.

pub mod winrt;

use std::thread;
use std::time::{Duration, Instant};

use crossbeam_channel::{unbounded, Receiver, Sender};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::log::log;
use crate::ndjson::FeedResult;
use crate::protocol::{Command, Incoming};

/// UI message posted when a BLE event has been queued.
pub const WM_APP_BLE: u32 = 0x8001;

const SCAN_TIMEOUT: Duration = Duration::from_secs(15);
// The host only streams POSITION_SYNC while it is playing *and* its JS timer is
// running, so silence does not mean the link is dead (Android pauses JS timers
// in the background). Probe occasionally, never reconnect just for silence.
const WATCHDOG_QUIET: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Status {
    Idle,
    Scanning,
    Connecting,
    Connected(String),
    Retrying(u64),
    Error(String),
}

impl Status {
    pub fn label(&self) -> String {
        match self {
            Self::Idle => "Bağlı değil".to_string(),
            Self::Scanning => "Aranıyor…".to_string(),
            Self::Connecting => "Bağlanıyor…".to_string(),
            Self::Connected(name) => name.clone(),
            Self::Retrying(seconds) => format!("Yeniden bağlanıyor ({seconds}s)"),
            Self::Error(error) => error.clone(),
        }
    }

    pub fn short_label(&self) -> String {
        match self {
            Self::Idle => "Bağlı değil".to_string(),
            Self::Scanning => "Aranıyor…".to_string(),
            Self::Connecting => "Bağlanıyor…".to_string(),
            Self::Connected(_) => "Bağlı".to_string(),
            Self::Retrying(seconds) => format!("Bekliyor {seconds}s"),
            Self::Error(_) => "Hata".to_string(),
        }
    }

    pub fn is_connected(&self) -> bool {
        matches!(self, Self::Connected(_))
    }

    pub fn is_busy(&self) -> bool {
        matches!(
            self,
            Self::Scanning | Self::Connecting | Self::Retrying(_)
        )
    }
}

#[derive(Debug)]
pub enum AppEvent {
    Status(Status),
    Connected { address: u64, name: String },
    Message(Incoming),
}

pub enum Control {
    Connect,
    Disconnect,
    Command(Command),
    Tick,
    Found { address: u64, name: String },
    Notification(Vec<u8>),
    LyricsNotification(Vec<u8>),
    ConnectionChanged(bool),
    Shutdown,
}

pub struct BleHandle {
    pub control: Sender<Control>,
}

/// Starts the manager thread and returns a handle for the UI.
pub fn spawn(
    events: Sender<AppEvent>,
    hwnd: isize,
    initial: Option<(u64, String)>,
) -> BleHandle {
    let (control_tx, control_rx) = unbounded();

    // One wake-up per second: drives scan timeouts, retries and the watchdog.
    let tick_tx = control_tx.clone();
    let _ = thread::Builder::new()
        .name("runmusic-ble-tick".into())
        .spawn(move || loop {
            thread::sleep(Duration::from_secs(1));
            if tick_tx.send(Control::Tick).is_err() {
                break;
            }
        });

    let manager_tx = control_tx.clone();
    let _ = thread::Builder::new()
        .name("runmusic-ble".into())
        .spawn(move || {
            let init = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if let Err(error) = init.ok() {
                log(&format!("CoInitializeEx failed: {error}"));
            }
            Manager::new(events, control_rx, manager_tx, hwnd, initial).run();
        });

    BleHandle { control: control_tx }
}

struct Manager {
    events: Sender<AppEvent>,
    control: Receiver<Control>,
    control_tx: Sender<Control>,
    hwnd: isize,
    link: Option<winrt::Link>,
    scanner: Option<winrt::Scanner>,
    desired: Option<u64>,
    desired_name: Option<String>,
    want: bool,
    failures: u32,
    retry_at: Option<Instant>,
    scan_deadline: Option<Instant>,
    last_scan: Option<Instant>,
    last_sync: Instant,
    last_ping: Instant,
    is_playing: bool,
    status: Status,
}

impl Manager {
    fn new(
        events: Sender<AppEvent>,
        control: Receiver<Control>,
        control_tx: Sender<Control>,
        hwnd: isize,
        initial: Option<(u64, String)>,
    ) -> Self {
        let (desired, desired_name) = match initial {
            Some((address, name)) => (Some(address), Some(name)),
            None => (None, None),
        };
        Self {
            events,
            control,
            control_tx,
            hwnd,
            link: None,
            scanner: None,
            desired,
            desired_name,
            want: true,
            failures: 0,
            retry_at: None,
            scan_deadline: None,
            last_scan: None,
            last_sync: Instant::now(),
            last_ping: Instant::now(),
            is_playing: false,
            status: Status::Idle,
        }
    }

    fn run(mut self) {
        if self.want {
            self.connect_now();
        } else {
            self.set_status(Status::Idle);
        }

        while let Ok(control) = self.control.recv() {
            match control {
                Control::Connect => {
                    self.want = true;
                    self.failures = 0;
                    self.retry_at = None;
                    if self.link.is_some() {
                        continue;
                    }
                    self.connect_now();
                }
                Control::Disconnect => {
                    self.want = false;
                    self.retry_at = None;
                    self.scan_deadline = None;
                    self.stop_scan();
                    self.link = None;
                    self.is_playing = false;
                    self.set_status(Status::Idle);
                }
                Control::Command(command) => {
                    self.send_command(&command);
                }
                Control::Tick => self.on_tick(),
                Control::Found { address, name } => {
                    if self.link.is_some() || self.scan_deadline.is_none() {
                        continue;
                    }
                    self.scan_deadline = None;
                    self.stop_scan();
                    self.desired = Some(address);
                    if !name.is_empty() {
                        self.desired_name = Some(name);
                    }
                    self.connect_now();
                }
                Control::Notification(bytes) => self.on_notification(&bytes),
                Control::LyricsNotification(bytes) => self.on_lyrics_notification(&bytes),
                Control::ConnectionChanged(connected) => {
                    if !connected && self.link.is_some() {
                        log("BLE link lost");
                        self.link = None;
                        self.is_playing = false;
                        self.failures = 0;
                        self.set_status(Status::Retrying(1));
                        self.schedule_retry();
                    }
                }
                Control::Shutdown => {
                    self.stop_scan();
                    self.link = None;
                    break;
                }
            }
        }

        self.stop_scan();
        self.link = None;
        log("BLE manager stopped");
    }

    fn connect_now(&mut self) {
        self.stop_scan();
        self.scan_deadline = None;

        let Some(address) = self.desired else {
            self.start_scan();
            return;
        };

        self.set_status(Status::Connecting);
        match winrt::Link::connect(address, self.control_tx.clone()) {
            Ok(link) => {
                let name = link
                    .device_name()
                    .or_else(|| self.desired_name.clone())
                    .unwrap_or_else(|| "RunMusic".to_string());
                self.desired_name = Some(name.clone());
                self.link = Some(link);
                self.failures = 0;
                self.retry_at = None;
                self.is_playing = false;
                self.last_sync = Instant::now();
                self.last_ping = Instant::now();
                log(&format!(
                    "connected to {:012X} ({name}), pdu={:?}",
                    address,
                    self.link.as_ref().and_then(|link| link.max_pdu())
                ));
                let _ = self.events.send(AppEvent::Connected {
                    address,
                    name: name.clone(),
                });
                self.set_status(Status::Connected(name));
                self.send_command(&Command::GetState);
            }
            Err(error) => {
                log(&format!("connect failed: {error}"));
                self.failures = self.failures.saturating_add(1);
                self.set_status(Status::Error(error));
                self.schedule_retry();
            }
        }
    }

    fn start_scan(&mut self) {
        self.stop_scan();
        self.set_status(Status::Scanning);
        self.last_scan = Some(Instant::now());
        match winrt::Scanner::start(self.control_tx.clone()) {
            Ok(scanner) => {
                self.scanner = Some(scanner);
                self.scan_deadline = Some(Instant::now() + SCAN_TIMEOUT);
            }
            Err(error) => {
                log(&format!("scan failed: {error}"));
                self.failures = self.failures.saturating_add(1);
                self.set_status(Status::Error(error));
                self.schedule_retry();
            }
        }
    }

    fn stop_scan(&mut self) {
        if let Some(mut scanner) = self.scanner.take() {
            scanner.stop();
        }
        self.scan_deadline = None;
    }

    fn schedule_retry(&mut self) {
        let delay = match self.failures {
            0 | 1 => 1,
            2 => 2,
            3 => 4,
            4 => 8,
            _ => 10,
        };
        self.retry_at = Some(Instant::now() + Duration::from_secs(delay));
        self.set_status(Status::Retrying(delay));
    }

    fn on_tick(&mut self) {
        if let Some(at) = self.retry_at {
            if Instant::now() >= at && self.want && self.link.is_none() {
                self.retry_at = None;
                // A direct connect is cheap; only fall back to a full scan
                // occasionally so a powered-off phone does not keep the radio busy.
                let scan_due = self.desired.is_none()
                    || self
                        .last_scan
                        .map_or(true, |last| last.elapsed() >= Duration::from_secs(60));
                if scan_due {
                    self.start_scan();
                } else {
                    self.connect_now();
                }
            }
        }

        if let Some(deadline) = self.scan_deadline {
            if Instant::now() >= deadline && self.scanner.is_some() {
                log("scan timed out");
                self.stop_scan();
                self.failures = self.failures.saturating_add(1);
                self.set_status(Status::Error("Host bulunamadı".to_string()));
                if self.desired.is_none() {
                    // First run without a saved host: stop until the user asks again.
                    self.want = false;
                    self.retry_at = None;
                } else {
                    self.schedule_retry();
                }
            }
        }

        if self.link.is_some() && self.is_playing {
            let now = Instant::now();
            let quiet = now.duration_since(self.last_sync);
            if quiet >= WATCHDOG_QUIET && now.duration_since(self.last_ping) >= WATCHDOG_QUIET {
                self.last_ping = now;
                self.send_command(&Command::GetState);
            }
        }
    }

    fn on_notification(&mut self, bytes: &[u8]) {
        if self.link.is_none() {
            return;
        }
        let mut parsed: Vec<Incoming> = Vec::new();
        let result = {
            let link = self.link.as_mut().expect("link checked above");
            link.parser.feed(bytes, |line| {
                match serde_json::from_slice::<Incoming>(line) {
                    Ok(message) => parsed.push(message),
                    Err(error) => log(&format!(
                        "ndjson parse error: {error} ({})",
                        String::from_utf8_lossy(line)
                    )),
                }
            })
        };

        if result == FeedResult::Resync {
            log("ndjson buffer overflow, resyncing");
            if let Some(link) = self.link.as_mut() {
                link.parser.reset();
            }
            self.send_command(&Command::GetState);
        }

        for message in parsed {
            self.observe(&message);
            let _ = self.events.send(AppEvent::Message(message));
        }
        self.wake();
    }

    fn on_lyrics_notification(&mut self, bytes: &[u8]) {
        if self.link.is_none() {
            return;
        }
        let mut parsed: Vec<Incoming> = Vec::new();
        let result = {
            let link = self.link.as_mut().expect("link checked above");
            link.lyrics_parser.feed(bytes, |line| {
                match serde_json::from_slice::<Incoming>(line) {
                    Ok(message) => parsed.push(message),
                    Err(error) => log(&format!(
                        "lyrics ndjson parse error: {error} ({})",
                        String::from_utf8_lossy(line)
                    )),
                }
            })
        };

        if result == FeedResult::Resync {
            log("lyrics ndjson buffer overflow, resetting");
            if let Some(link) = self.link.as_mut() {
                link.lyrics_parser.reset();
            }
        }

        for message in parsed {
            self.observe(&message);
            let _ = self.events.send(AppEvent::Message(message));
        }
        self.wake();
    }

    fn observe(&mut self, message: &Incoming) {
        match message {
            Incoming::InitialState {
                is_playing,
                active_track,
                ..
            } => {
                self.last_sync = Instant::now();
                self.is_playing = *is_playing;
                match active_track {
                    Some(track) => log(&format!(
                        "initial state: playing={is_playing} track={:?} - {:?}",
                        track.title, track.artist
                    )),
                    None => log(&format!("initial state: playing={is_playing} no track")),
                }
            }
            Incoming::PositionSync { is_playing, .. } => {
                self.last_sync = Instant::now();
                if self.is_playing != *is_playing {
                    log(&format!("state: playing={is_playing}"));
                }
                self.is_playing = *is_playing;
            }
            Incoming::StateChange {
                is_playing: Some(is_playing),
                ..
            } => {
                if self.is_playing != *is_playing {
                    log(&format!("state: playing={is_playing}"));
                }
                self.is_playing = *is_playing;
            }
            Incoming::TrackChange { track, .. } => match track {
                Some(track) => log(&format!("track: {:?} - {:?}", track.title, track.artist)),
                None => log("track: stopped"),
            },
            _ => {}
        }
    }

    fn send_command(&mut self, command: &Command) {
        if self.link.is_none() {
            return;
        }
        if !matches!(command, Command::Seek { .. }) {
            log(&format!("sent: {command:?}"));
        }
        let mut failure = None;
        if let Some(link) = self.link.as_ref() {
            if let Err(error) = link.send_command(command) {
                failure = Some(error);
            }
        }
        if let Some(error) = failure {
            log(&format!("write failed: {error}"));
            self.link = None;
            self.is_playing = false;
            self.failures = 0;
            self.schedule_retry();
        }
        self.wake();
    }

    fn set_status(&mut self, status: Status) {
        if self.status != status {
            log(&format!("status: {status:?}"));
            self.status = status.clone();
            let _ = self.events.send(AppEvent::Status(status));
            self.wake();
        }
    }

    fn wake(&self) {
        unsafe {
            let _ = PostMessageW(
                Some(HWND(self.hwnd as *mut core::ffi::c_void)),
                WM_APP_BLE,
                WPARAM(0),
                LPARAM(0),
            );
        }
    }
}
