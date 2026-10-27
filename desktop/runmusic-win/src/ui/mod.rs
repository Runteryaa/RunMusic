//! Native Win32 mini player and tray integration.

mod draw;
mod tray;

use std::cell::RefCell;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE,
    DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
};
use windows::Win32::UI::Controls::MARGINS;
use windows::Win32::Graphics::Gdi::{
    BeginPaint, BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject,
    EndPaint, GetMonitorInfoW, HBRUSH, HDC, HGDIOBJ, InvalidateRect, MonitorFromPoint, PAINTSTRUCT,
    SRCCOPY, ScreenToClient, SelectObject, UpdateWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{AdjustWindowRectExForDpi, GetDpiForSystem, GetDpiForWindow};
use windows::Win32::UI::Input::KeyboardAndMouse::{ReleaseCapture, SetCapture};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetMessageW,
    GetSystemMetrics, GetWindowRect, LoadCursorW, PostQuitMessage, RegisterClassW,
    SetForegroundWindow, SetTimer, SetWindowPos, ShowWindow, TranslateMessage, HTCAPTION,
    HWND_NOTOPMOST, HWND_TOPMOST, MINMAXINFO, MSG, SIZE_MINIMIZED, SM_CXSCREEN, SM_CYSCREEN,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER, SWP_NOSIZE, SW_HIDE, SW_RESTORE, SW_SHOW, WM_APP,
    WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_DPICHANGED, WM_ERASEBKGND, WM_EXITSIZEMOVE,
    WM_GETMINMAXINFO, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MOUSEMOVE, WM_MOUSEWHEEL, WM_NCHITTEST,
    WM_NCMOUSEMOVE, WM_PAINT, WM_RBUTTONUP, WM_SIZE, WM_TIMER, WINDOW_EX_STYLE, WNDCLASSW,
    WS_EX_APPWINDOW, WS_EX_TOPMOST, WS_POPUP, WS_SYSMENU, WS_THICKFRAME, CS_HREDRAW, CS_VREDRAW,
    IDC_ARROW,
};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

use crate::ble::{self, AppEvent, Control, Status, WM_APP_BLE};
use crate::config::{self, Config};
use crate::log::log;
use crate::media_controls::{MediaControls, WM_APP_SMTC, WM_APP_SMTC_SEEK};
use crate::now_playing::NowPlaying;
use crate::protocol::Command;

pub const WM_APP_TRAY: u32 = WM_APP + 2;
pub const WM_APP_SHOW: u32 = WM_APP + 3;

pub(crate) const ID_CONNECT: u32 = 1;
pub(crate) const ID_DISCONNECT: u32 = 2;
pub(crate) const ID_SHOW: u32 = 3;
pub(crate) const ID_AUTOSTART: u32 = 4;
pub(crate) const ID_EXIT: u32 = 5;

const CLASS_NAME: &str = "RunMusicRemoteWindow";
const TIMER_ID: usize = 1;

thread_local! {
    static APP: RefCell<Option<Box<App>>> = const { RefCell::new(None) };
}

fn with_app<R>(function: impl FnOnce(&mut App) -> R) -> Option<R> {
    // Messages can arrive re-entrantly (e.g. while a popup menu or a drag loop
    // pumps messages). Skipping them is safe and avoids a RefCell panic inside
    // an `extern "system"` callback, which would abort the process.
    APP.with(|cell| {
        let mut slot = cell.try_borrow_mut().ok()?;
        slot.as_mut().map(|app| function(app))
    })
}

#[derive(Clone, Copy)]
struct Drag {
    position: f64,
}

pub struct App {
    hwnd: HWND,
    config: Config,
    np: NowPlaying,
    status: Status,
    scale: f32,
    fonts: draw::Fonts,
    buffer: Option<BackBuffer>,
    tray: tray::Tray,
    hover: Option<draw::Action>,
    hover_header: Option<draw::HeaderAction>,
    drag: Option<Drag>,
    last_seek: Instant,
    control: Option<Sender<Control>>,
    events: Option<Receiver<AppEvent>>,
    autostart: bool,
    tip: String,
    tray_hint: bool,
    always_on_top: bool,
    pub lyrics_open: bool,
    pub lyrics_scroll: i32,
    pub lyrics_font: f32,
    /// Windows media session; `None` when SMTC could not be registered.
    media: Option<MediaControls>,
    /// True when the remembered position did not fit the monitors available at
    /// launch (for example a screen that is still waking up at logon). The stored
    /// coordinates are kept until the user actually moves the window, so a
    /// temporary monitor outage cannot permanently drag it to the main screen.
    position_clamped: bool,
}

impl App {
    pub fn accent_color(&self) -> u32 {
        self.np.theme_color.unwrap_or(draw::ACCENT)
    }

    fn new(hwnd: HWND) -> Result<Self, String> {
        let dpi = unsafe { GetDpiForWindow(hwnd) };
        let scale = dpi as f32 / 96.0;
        let config = Config::load();
        let autostart = config::autostart_enabled();
        let always_on_top = config.always_on_top;
        let lyrics_open = config.lyrics_open;
        let lyrics_font = config.lyrics_font;
        let app = Self {
            hwnd,
            config,
            np: NowPlaying::default(),
            status: Status::Idle,
            scale,
            fonts: draw::Fonts::create(scale, lyrics_font),
            buffer: None,
            tray: tray::Tray::new(hwnd, crate::icon::load(16)),
            hover: None,
            hover_header: None,
            drag: None,
            last_seek: Instant::now(),
            control: None,
            events: None,
            autostart,
            tip: String::new(),
            tray_hint: false,
            always_on_top,
            lyrics_open,
            lyrics_scroll: 0,
            lyrics_font,
            media: None,
            position_clamped: false,
        };
        app.set_topmost(always_on_top);
        app.update_timer();
        Ok(app)
    }

    fn start_ble(&mut self) {
        let (events_tx, events_rx) = crossbeam_channel::unbounded();
        let initial = self
            .config
            .last_address
            .map(|address| (address, self.config.last_name.clone().unwrap_or_default()));
        let handle = ble::spawn(events_tx, self.hwnd.0 as isize, initial);
        self.control = Some(handle.control);
        self.events = Some(events_rx);
        self.update_tray();
    }

    fn shutdown(&mut self) {
        if let Some(control) = &self.control {
            let _ = control.send(Control::Shutdown);
        }
    }

    fn send_control(&self, control: Control) {
        if let Some(sender) = &self.control {
            let _ = sender.send(control);
        }
    }

    fn send(&self, command: Command) {
        if let Some(sender) = &self.control {
            let _ = sender.send(Control::Command(command));
        }
    }

    /// Pushes the current track/position into the Windows media flyout.
    fn sync_media(&mut self) {
        if let Some(media) = &mut self.media {
            media.sync(&self.np);
        }
    }

    /// Handles a transport button coming from the Windows media controls.
    fn on_media_button(&mut self, button: i32) {
        use windows::Media::SystemMediaTransportControlsButton as Button;

        let command = if button == Button::Play.0 {
            Command::Play
        } else if button == Button::Pause.0 {
            Command::Pause
        } else if button == Button::Next.0 {
            Command::SkipNext
        } else if button == Button::Previous.0 {
            Command::SkipPrevious
        } else {
            return;
        };
        log(&format!("media key: {command:?}"));
        if !self.status.is_connected() {
            return;
        }
        self.send(command);
    }

    /// Handles a position request from the media flyout's seek slider.
    fn on_media_seek(&mut self) {
        let Some(position) = self.media.as_ref().and_then(MediaControls::take_seek) else {
            return;
        };
        log(&format!("media key: seek to {position:.1}s"));
        if !self.status.is_connected() {
            return;
        }
        self.np.seek_local(position);
        self.send(Command::Seek { position });
        self.invalidate();
    }

    fn drain_events(&mut self) {
        let mut events = Vec::new();
        if let Some(receiver) = &self.events {
            while let Ok(event) = receiver.try_recv() {
                events.push(event);
            }
        }
        if events.is_empty() {
            return;
        }

        for event in events {
            match event {
                AppEvent::Status(status) => {
                    self.status = status;
                }
                AppEvent::Connected { address, name } => {
                    if self.config.last_address != Some(address)
                        || self.config.last_name.as_deref() != Some(name.as_str())
                    {
                        self.config.last_address = Some(address);
                        self.config.last_name = Some(name);
                        self.config.save();
                    }
                }
                AppEvent::Message(message) => {
                    if matches!(message, crate::protocol::Incoming::TrackChange { .. } | crate::protocol::Incoming::InitialState { .. }) {
                        self.lyrics_scroll = 0;
                    }
                    self.np.apply(&message);
                }
            }
        }

        self.update_tray();
        self.invalidate();
        self.sync_media();
    }

    fn update_tray(&mut self) {
        let tip = if let Some(track) = &self.np.track {
            let title = if track.title.is_empty() {
                "RunMusic Remote"
            } else {
                &track.title
            };
            let mut tip = format!("{title} — {} · {}", track.artist, self.status.short_label());
            if tip.len() > 120 {
                tip.truncate(120);
            }
            tip
        } else {
            format!("RunMusic Remote — {}", self.status.label())
        };
        if tip == self.tip {
            return;
        }
        self.tray.set_tip(&tip);
        self.tip = tip;
    }

    fn invalidate(&self) {
        unsafe {
            let _ = InvalidateRect(Some(self.hwnd), None, false);
        }
    }

    fn show_window(&self) {
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(self.hwnd);
        }
    }

    fn hide_to_tray(&mut self) {
        unsafe {
            let _ = ShowWindow(self.hwnd, SW_HIDE);
        }
        if !self.tray_hint {
            self.tray_hint = true;
            self.tray.notify(
                "RunMusic Remote",
                "Arka planda çalışıyor. Tepsi simgesine sağ tıklayarak açabilirsiniz.",
            );
        }
    }

    fn set_topmost(&self, enabled: bool) {
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                Some(if enabled { HWND_TOPMOST } else { HWND_NOTOPMOST }),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    fn toggle_pin(&mut self) {
        self.always_on_top = !self.always_on_top;
        self.set_topmost(self.always_on_top);
        self.config.always_on_top = self.always_on_top;
        self.config.save();
        self.invalidate();
    }

    fn toggle_lyrics(&mut self) {
        self.lyrics_open = !self.lyrics_open;
        self.lyrics_scroll = 0;
        self.config.lyrics_open = self.lyrics_open;
        if self.lyrics_open {
            // Keep an already taller window and remember that height.
            let height = self
                .client_height_logical()
                .max(self.config.lyrics_height as f32)
                .max(config::LYRICS_HEIGHT_MIN as f32);
            self.config.lyrics_height = height.round() as i32;
        }
        self.config.save();
        self.resize_to_state();
        self.update_timer();
        self.invalidate();
    }

    fn client_height_logical(&self) -> f32 {
        let mut client = RECT::default();
        unsafe {
            let _ = GetClientRect(self.hwnd, &mut client);
        }
        if self.scale > 0.0 {
            client.bottom as f32 / self.scale
        } else {
            draw::LOGICAL_HEIGHT as f32
        }
    }

    fn client_width_logical(&self) -> f32 {
        let mut client = RECT::default();
        unsafe {
            let _ = GetClientRect(self.hwnd, &mut client);
        }
        if self.scale > 0.0 {
            client.right as f32 / self.scale
        } else {
            draw::LOGICAL_WIDTH as f32
        }
    }

    fn set_logical_size(&self, logical_w: f32, logical_h: f32) {
        let dpi = unsafe { GetDpiForWindow(self.hwnd) };
        let style = WS_POPUP | WS_SYSMENU | WS_THICKFRAME;
        let ex_style = WS_EX_APPWINDOW;
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: (logical_w * self.scale) as i32,
            bottom: (logical_h * self.scale) as i32,
        };
        let _ = unsafe { AdjustWindowRectExForDpi(&mut rect, style, false, ex_style, dpi) };
        let new_w = rect.right - rect.left;
        let new_h = rect.bottom - rect.top;
        unsafe {
            let _ = SetWindowPos(
                self.hwnd,
                None,
                0,
                0,
                new_w,
                new_h,
                SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    }

    fn resize_to_state(&mut self) {
        let width = self
            .client_width_logical()
            .max(config::WINDOW_WIDTH_MIN as f32);
        let logical_h = if self.lyrics_open {
            self.config
                .lyrics_height
                .max(config::LYRICS_HEIGHT_MIN)
                .max(self.client_height_logical().round() as i32) as f32
        } else {
            draw::LOGICAL_HEIGHT as f32
        };
        self.set_logical_size(width, logical_h);
    }

    /// Persists the size and position the user dragged the window to.
    fn remember_size(&mut self) {
        let width = (self.client_width_logical().round() as i32)
            .clamp(config::WINDOW_WIDTH_MIN, config::WINDOW_WIDTH_MAX);
        let mut changed = width != self.config.window_width;
        self.config.window_width = width;
        if self.lyrics_open {
            let height = (self.client_height_logical().round() as i32)
                .clamp(config::LYRICS_HEIGHT_MIN, config::LYRICS_HEIGHT_MAX);
            if height != self.config.lyrics_height {
                self.config.lyrics_height = height;
                changed = true;
            }
        }
        if !self.position_clamped {
            let mut window = RECT::default();
            if unsafe { GetWindowRect(self.hwnd, &mut window) }.is_ok() {
                if self.config.window_x != Some(window.left) {
                    self.config.window_x = Some(window.left);
                    changed = true;
                }
                if self.config.window_y != Some(window.top) {
                    self.config.window_y = Some(window.top);
                    changed = true;
                }
            }
        }
        if changed {
            self.config.save();
        }
    }

    fn adjust_lyrics_font(&mut self, delta: f32) {
        if !self.lyrics_open {
            return;
        }
        let next = (self.lyrics_font + delta)
            .clamp(config::LYRICS_FONT_MIN, config::LYRICS_FONT_MAX);
        if (next - self.lyrics_font).abs() < 0.001 {
            return;
        }
        self.lyrics_font = next;
        self.fonts = draw::Fonts::create(self.scale, next);
        self.config.lyrics_font = next;
        self.config.save();
        self.lyrics_scroll = 0;
        self.invalidate();
    }

    fn update_timer(&self) {
        let interval = if self.lyrics_open { 150 } else { 1000 };
        unsafe {
            let _ = SetTimer(Some(self.hwnd), TIMER_ID, interval, None);
        }
    }

    fn ensure_buffer(&mut self, hdc: HDC, width: i32, height: i32) {
        let recreate = match &self.buffer {
            Some(buffer) => buffer.width != width || buffer.height != height,
            None => true,
        };
        if recreate {
            self.buffer = BackBuffer::create(hdc, width, height);
        }
    }

    fn paint(&mut self) {
        unsafe {
            let mut ps = PAINTSTRUCT::default();
            let hdc = BeginPaint(self.hwnd, &mut ps);
            let mut client = RECT::default();
            let _ = GetClientRect(self.hwnd, &mut client);
            if client.right > 0 && client.bottom > 0 {
                self.ensure_buffer(hdc, client.right, client.bottom);
                if let Some(buffer) = &self.buffer {
                    draw::paint(buffer.dc, self);
                    let _ = BitBlt(
                        hdc,
                        0,
                        0,
                        client.right,
                        client.bottom,
                        Some(buffer.dc),
                        0,
                        0,
                        SRCCOPY,
                    );
                } else {
                    draw::paint(hdc, self);
                }
            }
            let _ = EndPaint(self.hwnd, &ps);
        }
    }

    fn on_dpi_changed(&mut self, dpi: u32) {
        self.scale = dpi as f32 / 96.0;
        self.fonts = draw::Fonts::create(self.scale, self.lyrics_font);
        self.buffer = None;
        self.remember_size();
        self.invalidate();
    }

    fn layout(&self) -> draw::Layout {
        let mut client = RECT::default();
        unsafe {
            let _ = GetClientRect(self.hwnd, &mut client);
        }
        draw::layout(client.right, client.bottom, self.scale, self.lyrics_open)
    }

    fn seek_position(&self, x: i32, layout: &draw::Layout) -> f64 {
        let width = (layout.progress.right - layout.progress.left).max(1);
        let fraction = ((x - layout.progress.left) as f64 / width as f64).clamp(0.0, 1.0);
        fraction * self.np.duration.max(0.0)
    }

    fn action(&self, action: draw::Action) {
        if !self.status.is_connected() {
            return;
        }
        let command = match action {
            draw::Action::Previous => Command::SkipPrevious,
            draw::Action::PlayPause => {
                if self.np.is_playing {
                    Command::Pause
                } else {
                    Command::Play
                }
            }
            draw::Action::Next => Command::SkipNext,
        };
        self.send(command);
    }

    fn on_down(&mut self, x: i32, y: i32) {
        let layout = self.layout();
        if let Some(action) = draw::hit_header(&layout, x, y) {
            match action {
                draw::HeaderAction::Lyrics => self.toggle_lyrics(),
                draw::HeaderAction::LyricsSmaller => self.adjust_lyrics_font(-1.0),
                draw::HeaderAction::LyricsLarger => self.adjust_lyrics_font(1.0),
                draw::HeaderAction::Pin => self.toggle_pin(),
                draw::HeaderAction::Minimize | draw::HeaderAction::Close => self.hide_to_tray(),
            }
            return;
        }

        if let Some(action) = draw::hit_button(&layout, x, y) {
            self.action(action);
            return;
        }

        if !self.status.is_connected() {
            if draw::contains(&layout.connect, x, y) && !self.status.is_busy() {
                self.send_control(Control::Connect);
            }
            return;
        }

        if self.np.has_track()
            && self.np.duration > 0.0
            && draw::contains(&layout.seek, x, y)
        {
            let position = self.seek_position(x, &layout);
            self.drag = Some(Drag { position });
            self.np.seek_local(position);
            self.last_seek = Instant::now();
            unsafe {
                SetCapture(self.hwnd);
            }
            self.send(Command::Seek { position });
            self.invalidate();
        }
    }

    fn on_move(&mut self, x: i32, y: i32) {
        let layout = self.layout();
        if self.drag.is_some() {
            let position = self.seek_position(x, &layout);
            if let Some(drag) = self.drag.as_mut() {
                drag.position = position;
            }
            self.np.seek_local(position);
            if self.last_seek.elapsed() >= Duration::from_millis(150) {
                self.last_seek = Instant::now();
                self.send(Command::Seek { position });
            }
            self.invalidate();
            return;
        }

        let hover = if self.status.is_connected() {
            draw::hit_button(&layout, x, y)
        } else {
            None
        };
        let hover_header = draw::hit_header(&layout, x, y);
        if hover != self.hover || hover_header != self.hover_header {
            self.hover = hover;
            self.hover_header = hover_header;
            self.invalidate();
        }
    }

    fn on_up(&mut self) {
        if let Some(drag) = self.drag.take() {
            if self.status.is_connected() && self.np.duration > 0.0 {
                self.np.seek_local(drag.position);
                self.send(Command::Seek {
                    position: drag.position,
                });
            }
            unsafe {
                let _ = ReleaseCapture();
            }
            self.invalidate();
        }
    }

    fn menu(&mut self, command: u32) {
        match command {
            ID_CONNECT => self.send_control(Control::Connect),
            ID_DISCONNECT => self.send_control(Control::Disconnect),
            ID_SHOW => self.show_window(),
            ID_AUTOSTART => {
                self.autostart = !self.autostart;
                if !config::set_autostart(self.autostart) {
                    log("could not update autostart registry entry");
                }
                self.update_tray();
            }
            ID_EXIT => {
                if let Some(media) = &self.media {
                    media.shutdown();
                }
                self.remember_size();
                self.send_control(Control::Shutdown);
                unsafe {
                    let _ = DestroyWindow(self.hwnd);
                }
            }
            _ => {}
        }
    }
}

struct BackBuffer {
    dc: HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    old: HGDIOBJ,
    width: i32,
    height: i32,
}

impl BackBuffer {
    fn create(hdc: HDC, width: i32, height: i32) -> Option<Self> {
        unsafe {
            let dc = CreateCompatibleDC(Some(hdc));
            if dc.is_invalid() {
                return None;
            }
            let bitmap = CreateCompatibleBitmap(hdc, width, height);
            if bitmap.is_invalid() {
                let _ = DeleteDC(dc);
                return None;
            }
            let old = SelectObject(dc, bitmap.into());
            Some(Self {
                dc,
                bitmap,
                old,
                width,
                height,
            })
        }
    }
}

impl Drop for BackBuffer {
    fn drop(&mut self) {
        unsafe {
            let _ = SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

pub fn run() -> Result<(), String> {
    unsafe { run_inner() }
}

/// Keeps a restored window fully inside the work area of the nearest monitor,
/// so unplugging the screen the user left it on cannot strand the window.
unsafe fn clamp_window_position(x: i32, y: i32, width: i32, height: i32) -> (i32, i32) {
    let point = POINT {
        x: x + width / 2,
        y: y + height / 2,
    };
    let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if GetMonitorInfoW(monitor, &mut info).as_bool() {
        let work = info.rcWork;
        let max_x = (work.right - width).max(work.left);
        let max_y = (work.bottom - height).max(work.top);
        return (x.clamp(work.left, max_x), y.clamp(work.top, max_y));
    }
    (x, y)
}

unsafe fn run_inner() -> Result<(), String> {
    // WinRT activation (SMTC) and the shell extract icons need an initialized
    // apartment on the UI thread. S_FALSE ("already initialized") is fine.
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    let instance = GetModuleHandleW(None).map_err(|error| error.to_string())?;
    let class_name = wide(CLASS_NAME);

    let window_class = WNDCLASSW {
        style: CS_HREDRAW | CS_VREDRAW,
        lpfnWndProc: Some(wndproc),
        cbClsExtra: 0,
        cbWndExtra: 0,
        hInstance: instance.into(),
        hIcon: crate::icon::load(32),
        hCursor: LoadCursorW(None, IDC_ARROW).map_err(|error| error.to_string())?,
        hbrBackground: HBRUSH::default(),
        lpszMenuName: PCWSTR::null(),
        lpszClassName: PCWSTR(class_name.as_ptr()),
    };
    if RegisterClassW(&window_class) == 0 {
        return Err("RegisterClassW failed".to_string());
    }

    let initial_config = Config::load();
    let initial_w = initial_config
        .window_width
        .clamp(config::WINDOW_WIDTH_MIN, config::WINDOW_WIDTH_MAX);
    let initial_h = if initial_config.lyrics_open {
        initial_config
            .lyrics_height
            .clamp(config::LYRICS_HEIGHT_MIN, config::LYRICS_HEIGHT_MAX)
    } else {
        draw::LOGICAL_HEIGHT
    };

    let style = WS_POPUP | WS_SYSMENU | WS_THICKFRAME;
    let ex_style: WINDOW_EX_STYLE = if initial_config.always_on_top {
        WS_EX_APPWINDOW | WS_EX_TOPMOST
    } else {
        WS_EX_APPWINDOW
    };
    let dpi = GetDpiForSystem();
    let scale = dpi as f32 / 96.0;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: (initial_w as f32 * scale) as i32,
        bottom: (initial_h as f32 * scale) as i32,
    };
    let _ = AdjustWindowRectExForDpi(&mut rect, style, false, ex_style, dpi,);
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let (x, y) = match (initial_config.window_x, initial_config.window_y) {
        (Some(x), Some(y)) => clamp_window_position(x, y, width, height),
        _ => (
            (GetSystemMetrics(SM_CXSCREEN) - width) / 2,
            (GetSystemMetrics(SM_CYSCREEN) - height) / 2,
        ),
    };

    let hwnd = CreateWindowExW(
        ex_style,
        PCWSTR(class_name.as_ptr()),
        w!("RunMusic Remote"),
        style,
        x,
        y,
        width,
        height,
        None,
        None,
        Some(instance.into()),
        None,
    )
    .map_err(|error| error.to_string())?;

    // The "system DPI" is captured when the user signs in and can lag behind the
    // monitor's current scale, so size and center the window using the DPI of
    // the monitor it actually landed on.
    let dpi = GetDpiForWindow(hwnd);
    let scale = dpi as f32 / 96.0;
    let mut rect = RECT {
        left: 0,
        top: 0,
        right: (initial_w as f32 * scale) as i32,
        bottom: (initial_h as f32 * scale) as i32,
    };
    let _ = AdjustWindowRectExForDpi(&mut rect, style, false, ex_style, dpi);
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    let (x, y, position_clamped) = match (initial_config.window_x, initial_config.window_y) {
        (Some(x), Some(y)) => {
            let (clamped_x, clamped_y) = clamp_window_position(x, y, width, height);
            (
                clamped_x,
                clamped_y,
                clamped_x != x || clamped_y != y,
            )
        }
        _ => (
            (GetSystemMetrics(SM_CXSCREEN) - width) / 2,
            (GetSystemMetrics(SM_CYSCREEN) - height) / 2,
            false,
        ),
    };
    let _ = SetWindowPos(
        hwnd,
        None,
        x,
        y,
        width,
        height,
        SWP_NOZORDER | SWP_NOACTIVATE,
    );

    let dark: i32 = 1;
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_USE_IMMERSIVE_DARK_MODE,
        &dark as *const _ as *const core::ffi::c_void,
        std::mem::size_of::<i32>() as u32,
    );

    // Borderless window with a DWM shadow and rounded corners.
    let margins = MARGINS {
        cxLeftWidth: 1,
        cyTopHeight: 1,
        cxRightWidth: 1,
        cyBottomHeight: 1,
    };
    let _ = DwmExtendFrameIntoClientArea(hwnd, &margins);
    let corner = DWMWCP_ROUND;
    let _ = DwmSetWindowAttribute(
        hwnd,
        DWMWA_WINDOW_CORNER_PREFERENCE,
        &corner as *const _ as *const core::ffi::c_void,
        std::mem::size_of_val(&corner) as u32,
    );

    let mut app = App::new(hwnd)?;
    app.position_clamped = position_clamped;
    app.media = MediaControls::new(hwnd);
    APP.with(|cell| *cell.borrow_mut() = Some(Box::new(app)));
    with_app(|app| app.start_ble());

    let _ = ShowWindow(hwnd, SW_SHOW);
    let _ = UpdateWindow(hwnd);
    // Apply the remembered pin state once the window is actually on screen.
    // Toggling OFF then ON (or OFF twice) matches what the user does with the
    // button, which is the only sequence the shell honors reliably at startup.
    with_app(|app| {
        let pinned = app.always_on_top;
        app.set_topmost(false);
        if pinned {
            app.set_topmost(true);
        }
    });
    with_app(|app| app.update_timer());

    let mut message = MSG::default();
    while GetMessageW(&mut message, None, 0, 0).0 > 0 {
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
    }

    with_app(|app| app.shutdown());
    Ok(())
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn cursor_point(lparam: LPARAM) -> (i32, i32) {
    let raw = lparam.0 as u32;
    let x = (raw & 0xFFFF) as u16 as i16 as i32;
    let y = ((raw >> 16) & 0xFFFF) as u16 as i16 as i32;
    (x, y)
}

unsafe extern "system" fn wndproc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // Explorer broadcasts this after a restart; without re-adding, the tray
    // icon stays gone for the rest of the process lifetime.
    if message == tray::taskbar_created_message() {
        with_app(|app| app.tray.re_add());
        return LRESULT(0);
    }

    match message {
        WM_PAINT => {
            with_app(|app| app.paint());
            LRESULT(0)
        }
        WM_ERASEBKGND => LRESULT(1),
        WM_SIZE => {
            with_app(|app| {
                if wparam.0 == SIZE_MINIMIZED as usize {
                    app.hide_to_tray();
                }
            });
            LRESULT(0)
        }
        WM_EXITSIZEMOVE => {
            with_app(|app| {
                app.position_clamped = false;
                app.remember_size();
            });
            LRESULT(0)
        }
        WM_GETMINMAXINFO => {
            // Minimum size: the player must always fit; width leaves room for
            // the header buttons and a truncated title.
            let scale = with_app(|app| app.scale)
                .unwrap_or_else(|| unsafe { GetDpiForWindow(hwnd) as f32 / 96.0 });
            let dpi = unsafe { GetDpiForWindow(hwnd) };
            let style = WS_POPUP | WS_SYSMENU | WS_THICKFRAME;
            let ex_style = WS_EX_APPWINDOW;
            let mut rect = RECT {
                left: 0,
                top: 0,
                right: (draw::MIN_LOGICAL_WIDTH as f32 * scale) as i32,
                bottom: (draw::LOGICAL_HEIGHT as f32 * scale) as i32,
            };
            let _ = unsafe { AdjustWindowRectExForDpi(&mut rect, style, false, ex_style, dpi) };
            let info = unsafe { &mut *(lparam.0 as *mut MINMAXINFO) };
            info.ptMinTrackSize.x = rect.right - rect.left;
            info.ptMinTrackSize.y = rect.bottom - rect.top;
            DefWindowProcW(hwnd, message, wparam, lparam)
        }
        WM_TIMER if wparam.0 == TIMER_ID => {
            with_app(|app| {
                app.sync_media();
                if app.np.is_playing {
                    app.invalidate();
                }
            });
            LRESULT(0)
        }
        WM_MOUSEWHEEL => {
            let delta = ((wparam.0 >> 16) as i16) as i32;
            with_app(|app| {
                if app.lyrics_open {
                    let lines = delta / 120;
                    app.lyrics_scroll += lines;
                    app.invalidate();
                }
            });
            LRESULT(0)
        }
        WM_APP_SMTC => {
            with_app(|app| app.on_media_button(wparam.0 as i32));
            LRESULT(0)
        }
        WM_APP_SMTC_SEEK => {
            with_app(|app| app.on_media_seek());
            LRESULT(0)
        }
        WM_APP_BLE => {
            with_app(|app| app.drain_events());
            LRESULT(0)
        }
        WM_APP_SHOW => {
            with_app(|app| app.show_window());
            LRESULT(0)
        }
        WM_APP_TRAY => {
            let event = (lparam.0 as u32) & 0xFFFF;
            match event {
                WM_LBUTTONUP => {
                    with_app(|app| app.show_window());
                }
                WM_RBUTTONUP => {
                    // `TrackPopupMenu` runs its own message loop, so nothing may
                    // hold the `App` borrow while the menu is open.
                    let state = with_app(|app| Some((app.status.is_connected(), app.autostart)));
                    if let Some((connected, autostart)) = state.flatten() {
                        let command = tray::show_menu(hwnd, connected, autostart);
                        if command != 0 {
                            with_app(|app| app.menu(command));
                        }
                    }
                }
                _ => {}
            }
            LRESULT(0)
        }
        WM_COMMAND => {
            let id = (wparam.0 as u32) & 0xFFFF;
            with_app(|app| app.menu(id));
            LRESULT(0)
        }
        WM_NCHITTEST => {
            let hit = with_app(|app| {
                let mut point = POINT {
                    x: (lparam.0 & 0xFFFF) as u16 as i16 as i32,
                    y: ((lparam.0 >> 16) & 0xFFFF) as u16 as i16 as i32,
                };
                let _ = ScreenToClient(hwnd, &mut point);
                let layout = app.layout();
                let header = (draw::HEADER_HEIGHT * app.scale) as i32;
                if point.y >= 0
                    && point.y < header
                    && draw::hit_header(&layout, point.x, point.y).is_none()
                {
                    Some(HTCAPTION as isize)
                } else {
                    None
                }
            });
            match hit {
                Some(Some(value)) => LRESULT(value),
                _ => DefWindowProcW(hwnd, message, wparam, lparam),
            }
        }
        WM_NCMOUSEMOVE => {
            with_app(|app| {
                if app.hover.is_some() || app.hover_header.is_some() {
                    app.hover = None;
                    app.hover_header = None;
                    app.invalidate();
                }
            });
            LRESULT(0)
        }
        WM_LBUTTONDOWN => {
            let (x, y) = cursor_point(lparam);
            with_app(|app| app.on_down(x, y));
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            with_app(|app| app.on_up());
            LRESULT(0)
        }
        WM_MOUSEMOVE => {
            let (x, y) = cursor_point(lparam);
            with_app(|app| app.on_move(x, y));
            LRESULT(0)
        }
        WM_DPICHANGED => {
            let dpi = (wparam.0 as u32) & 0xFFFF;
            let suggested = &*(lparam.0 as *const RECT);
            let _ = SetWindowPos(
                hwnd,
                None,
                suggested.left,
                suggested.top,
                suggested.right - suggested.left,
                suggested.bottom - suggested.top,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
            with_app(|app| app.on_dpi_changed(dpi));
            LRESULT(0)
        }
        WM_CLOSE => {
            with_app(|app| app.hide_to_tray());
            LRESULT(0)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wparam, lparam),
    }
}
