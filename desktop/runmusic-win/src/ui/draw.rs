//! GDI rendering for the mini player. No GPU, no extra crates.

use windows::Win32::Foundation::{COLORREF, RECT};
use windows::Win32::Graphics::Gdi::{
    CreateFontW, CreateSolidBrush, DeleteObject, DrawTextW, Ellipse, FillRect, SelectObject,
    SetBkMode, SetTextColor, DT_CENTER, DT_END_ELLIPSIS, DT_LEFT, DT_NOPREFIX, DT_RIGHT,
    DT_SINGLELINE, DT_VCENTER, FONT_CHARSET, FONT_CLIP_PRECISION, FONT_OUTPUT_PRECISION,
    FONT_QUALITY, HDC, HFONT, HGDIOBJ,
};
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

use super::App;
use crate::ble::Status;

pub const LOGICAL_WIDTH: i32 = 400;
pub const HEADER_HEIGHT: f32 = 34.0;
pub const LOGICAL_HEIGHT: i32 = 190;
pub const LOGICAL_HEIGHT_LYRICS: i32 = 390;

const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    r as u32 | ((g as u32) << 8) | ((b as u32) << 16)
}

fn lighten_color(color: u32) -> u32 {
    let r = ((color & 0xFF) as u16 + 30).min(255) as u8;
    let g = (((color >> 8) & 0xFF) as u16 + 30).min(255) as u8;
    let b = (((color >> 16) & 0xFF) as u16 + 30).min(255) as u8;
    rgb(r, g, b)
}

const BG: u32 = rgb(20, 20, 26);
const PANEL: u32 = rgb(34, 34, 45);
const PANEL_HOVER: u32 = rgb(46, 46, 60);
const TRACK_BG: u32 = rgb(44, 44, 58);
pub const ACCENT: u32 = rgb(124, 92, 255);
const TEXT: u32 = rgb(245, 245, 250);
const MUTED: u32 = rgb(139, 139, 158);
const MUTED_DIM: u32 = rgb(94, 94, 110);
const DOT_GREEN: u32 = rgb(74, 222, 128);
const DOT_AMBER: u32 = rgb(251, 191, 36);
const DOT_RED: u32 = rgb(248, 113, 113);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Previous,
    PlayPause,
    Next,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HeaderAction {
    Lyrics,
    Pin,
    Minimize,
    Close,
}

pub struct Layout {
    pub header: RECT,
    pub header_title: RECT,
    pub header_buttons: [(HeaderAction, RECT); 4],
    pub title: RECT,
    pub artist: RECT,
    pub status: RECT,
    pub progress: RECT,
    pub seek: RECT,
    pub time_left: RECT,
    pub time_right: RECT,
    pub connect: RECT,
    pub buttons: [(Action, RECT); 3],
    pub divider: RECT,
    pub lyrics_panel: RECT,
}

pub fn layout(width: i32, height: i32, scale: f32) -> Layout {
    let s = scale;
    let pad = (18.0 * s) as i32;
    let icon = (26.0 * s) as i32;
    let top = (HEADER_HEIGHT * s) as i32;
    let player_height = (LOGICAL_HEIGHT as f32 * s) as i32;
    let center_x = width / 2;
    let center_y = player_height - (30.0 * s) as i32;
    let play_radius = (19.0 * s) as i32;

    let play = RECT {
        left: center_x - play_radius,
        top: center_y - play_radius,
        right: center_x + play_radius,
        bottom: center_y + play_radius,
    };

    // Three centered controls: previous - play/pause - next.
    let step = (66.0 * s) as i32;
    let square = |cx: i32, size: i32| RECT {
        left: cx - size / 2,
        right: cx + size / 2,
        top: center_y - size / 2,
        bottom: center_y + size / 2,
    };
    let previous = square(center_x - step, icon);
    let next = square(center_x + step, icon);

    let connect = RECT {
        left: center_x - (65.0 * s) as i32,
        right: center_x + (65.0 * s) as i32,
        top: top + (90.0 * s) as i32,
        bottom: top + (124.0 * s) as i32,
    };

    // Custom caption buttons on the right: lyrics, pin, minimize, close.
    let button = (28.0 * s) as i32;
    let gap = (4.0 * s) as i32;
    let right = width - (10.0 * s) as i32;
    let button_top = (top - button) / 2;
    let close = RECT {
        left: right - button,
        top: button_top,
        right,
        bottom: button_top + button,
    };
    let minimize = RECT {
        left: close.left - gap - button,
        right: close.left - gap,
        ..close
    };
    let pin = RECT {
        left: minimize.left - gap - button,
        right: minimize.left - gap,
        ..close
    };
    let lyrics = RECT {
        left: pin.left - gap - button,
        right: pin.left - gap,
        ..close
    };

    let line = (1.0 * s).max(1.0) as i32;
    let divider = RECT {
        left: pad,
        top: player_height,
        right: width - pad,
        bottom: player_height + line,
    };
    let lyrics_panel = RECT {
        left: pad,
        top: player_height + (8.0 * s) as i32,
        right: width - pad,
        bottom: height - (8.0 * s) as i32,
    };

    Layout {
        header: RECT {
            left: 0,
            top: 0,
            right: width,
            bottom: top,
        },
        header_title: RECT {
            left: pad,
            top: 0,
            right: lyrics.left - (10.0 * s) as i32,
            bottom: top,
        },
        header_buttons: [
            (HeaderAction::Lyrics, lyrics),
            (HeaderAction::Pin, pin),
            (HeaderAction::Minimize, minimize),
            (HeaderAction::Close, close),
        ],
        title: RECT {
            left: pad,
            top: top + (12.0 * s) as i32,
            right: width - (150.0 * s) as i32,
            bottom: top + (36.0 * s) as i32,
        },
        artist: RECT {
            left: pad,
            top: top + (36.0 * s) as i32,
            right: width - (150.0 * s) as i32,
            bottom: top + (56.0 * s) as i32,
        },
        status: RECT {
            left: (width - (150.0 * s) as i32).max(pad),
            top: top + (12.0 * s) as i32,
            right: width - pad,
            bottom: top + (34.0 * s) as i32,
        },
        progress: RECT {
            left: pad,
            top: top + (62.0 * s) as i32,
            right: width - pad,
            bottom: top + (68.0 * s) as i32,
        },
        seek: RECT {
            left: pad,
            top: top + (50.0 * s) as i32,
            right: width - pad,
            bottom: top + (74.0 * s) as i32,
        },
        time_left: RECT {
            left: pad,
            top: top + (72.0 * s) as i32,
            right: pad + (90.0 * s) as i32,
            bottom: top + (88.0 * s) as i32,
        },
        time_right: RECT {
            left: width - pad - (90.0 * s) as i32,
            top: top + (72.0 * s) as i32,
            right: width - pad,
            bottom: top + (88.0 * s) as i32,
        },
        connect,
        buttons: [
            (Action::Previous, previous),
            (Action::PlayPause, play),
            (Action::Next, next),
        ],
        divider,
        lyrics_panel,
    }
}

pub fn hit_button(layout: &Layout, x: i32, y: i32) -> Option<Action> {
    layout
        .buttons
        .iter()
        .find(|(_, rect)| contains(rect, x, y))
        .map(|(action, _)| *action)
}

pub fn hit_header(layout: &Layout, x: i32, y: i32) -> Option<HeaderAction> {
    layout
        .header_buttons
        .iter()
        .find(|(_, rect)| contains(rect, x, y))
        .map(|(action, _)| *action)
}

pub fn contains(rect: &RECT, x: i32, y: i32) -> bool {
    x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom
}

pub fn paint(hdc: HDC, app: &App) {
    let mut client = RECT::default();
    let _ = unsafe { GetClientRect(app.hwnd, &mut client) };
    let l = layout(client.right, client.bottom, app.scale);

    fill(hdc, &client, BG);

    // Custom header: app name on the left, pin/minimize/close on the right.
    fill(hdc, &l.header, BG);
    let line = (1.0 * app.scale).max(1.0) as i32;
    fill(
        hdc,
        &RECT {
            left: 0,
            right: client.right,
            top: l.header.bottom - line,
            bottom: l.header.bottom,
        },
        PANEL,
    );
    let mut header_title = l.header_title;
    text(
        hdc,
        "RunMusic Remote",
        &mut header_title,
        app.fonts.small,
        MUTED,
        DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX,
    );
    draw_header_buttons(hdc, app, &l);

    let (title, artist) = if let Some(track) = &app.np.track {
        (
            if track.title.is_empty() {
                "Bilinmeyen parça".to_string()
            } else {
                track.title.clone()
            },
            if track.artist.is_empty() {
                "Bilinmeyen sanatçı".to_string()
            } else {
                track.artist.clone()
            },
        )
    } else if app.status.is_connected() {
        (
            "RunMusic Remote".to_string(),
            "Bağlı — parça bekleniyor".to_string(),
        )
    } else {
        (
            "RunMusic Remote".to_string(),
            "Telefonda Uzaktan Kumanda → Host".to_string(),
        )
    };

    let mut rect = l.title;
    text(
        hdc,
        &title,
        &mut rect,
        app.fonts.title,
        TEXT,
        DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX,
    );

    let mut rect = l.artist;
    text(
        hdc,
        &artist,
        &mut rect,
        app.fonts.body,
        MUTED,
        DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX,
    );

    // Connection state pill in the top-right corner.
    let status_color = status_color(&app.status);
    let dot_radius = (3.5 * app.scale) as i32;
    let dot_x = l.status.right - dot_radius - (2.0 * app.scale) as i32;
    let dot_y = (l.status.top + l.status.bottom) / 2;
    circle(
        hdc,
        dot_x - dot_radius,
        dot_y - dot_radius,
        dot_x + dot_radius,
        dot_y + dot_radius,
        status_color,
    );
    let mut text_rect = RECT {
        left: l.status.left,
        right: dot_x - dot_radius - (6.0 * app.scale) as i32,
        ..l.status
    };
    text(
        hdc,
        &app.status.short_label(),
        &mut text_rect,
        app.fonts.small,
        status_color,
        DT_SINGLELINE | DT_VCENTER | DT_RIGHT | DT_END_ELLIPSIS | DT_NOPREFIX,
    );

    if app.status.is_connected() {
        if app.np.has_track() {
            draw_progress(hdc, app, &l);
        }
        draw_buttons(hdc, app, &l);
    } else {
        let busy = app.status.is_busy();
        let rect = l.connect;
        rounded(
            hdc,
            &rect,
            (9.0 * app.scale) as i32,
            if busy { PANEL } else { PANEL_HOVER },
        );
        let label = if busy {
            app.status.short_label()
        } else {
            "Bağlan".to_string()
        };
        let mut text_rect = rect;
        text(
            hdc,
            &label,
            &mut text_rect,
            app.fonts.body,
            if busy { MUTED } else { TEXT },
            DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX,
        );
    }

    if app.lyrics_open && client.bottom > (LOGICAL_HEIGHT as f32 * app.scale) as i32 + 10 {
        fill(hdc, &l.divider, PANEL);
        draw_lyrics(hdc, app, &l.lyrics_panel);
    }
}

fn draw_lyrics(hdc: HDC, app: &App, panel: &RECT) {
    let s = app.scale;
    let accent = app.accent_color();

    let lyrics = match &app.np.lyrics {
        Some(l) if !l.lines.is_empty() => l,
        _ => {
            let mut r = *panel;
            let msg = if !app.status.is_connected() {
                "Bağlantı bekleniyor…"
            } else if !app.np.has_track() {
                "Parça çalmıyor"
            } else {
                "Bu parça için söz bulunamadı"
            };
            text(
                hdc,
                msg,
                &mut r,
                app.fonts.body,
                MUTED_DIM,
                DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_NOPREFIX,
            );
            return;
        }
    };

    if let Some(source) = &lyrics.source {
        let mut source_rect = RECT {
            left: panel.right - (90.0 * s) as i32,
            top: panel.top - (2.0 * s) as i32,
            right: panel.right,
            bottom: panel.top + (14.0 * s) as i32,
        };
        text(
            hdc,
            &source.to_uppercase(),
            &mut source_rect,
            app.fonts.small,
            MUTED_DIM,
            DT_SINGLELINE | DT_RIGHT | DT_VCENTER | DT_NOPREFIX,
        );
    }

    let line_height = (25.0 * s) as i32;
    let total_lines = lyrics.lines.len();
    let position = app.np.position();
    let active_idx = lyrics.active_index(position);

    let visible_lines = ((panel.bottom - panel.top) / line_height).max(1) as usize;
    let center_row = visible_lines / 2;

    let center_line = if let Some(idx) = active_idx {
        idx as i32
    } else {
        0
    };

    let start_idx = (center_line - center_row as i32 + app.lyrics_scroll)
        .clamp(-(visible_lines as i32), total_lines as i32);
    let panel_center_y = (panel.top + panel.bottom) / 2;

    for row in 0..visible_lines {
        let line_idx = start_idx + row as i32;
        let line_top = panel.top + (row as i32) * line_height;
        let line_bottom = line_top + line_height;

        if line_idx >= 0 && (line_idx as usize) < total_lines {
            let idx = line_idx as usize;
            let line_item = &lyrics.lines[idx];
            let is_active = Some(idx) == active_idx;

            let mut line_rect = RECT {
                left: panel.left,
                top: line_top,
                right: panel.right,
                bottom: line_bottom,
            };

            let dist_from_center = ((line_top + line_height / 2 - panel_center_y).abs() as f32
                / ((panel.bottom - panel.top) as f32 / 2.0))
                .clamp(0.0, 1.0);

            let color = if is_active {
                accent
            } else if dist_from_center > 0.75 {
                MUTED_DIM
            } else {
                MUTED
            };

            let font = if is_active {
                app.fonts.body_bold
            } else {
                app.fonts.body
            };

            text(
                hdc,
                &line_item.text,
                &mut line_rect,
                font,
                color,
                DT_SINGLELINE | DT_CENTER | DT_VCENTER | DT_END_ELLIPSIS | DT_NOPREFIX,
            );
        }
    }
}

fn draw_header_buttons(hdc: HDC, app: &App, l: &Layout) {
    for (action, rect) in l.header_buttons {
        let hovered = app.hover_header == Some(action);
        let (glyph, active) = match action {
            HeaderAction::Lyrics => ("\u{EC4F}", app.lyrics_open),
            HeaderAction::Pin => ("\u{E840}", app.always_on_top),
            HeaderAction::Minimize => ("\u{E921}", false),
            HeaderAction::Close => ("\u{E8BB}", false),
        };
        let color = if active {
            app.accent_color()
        } else if hovered {
            TEXT
        } else {
            MUTED
        };

        if hovered {
            let cx = (rect.left + rect.right) / 2;
            let cy = (rect.top + rect.bottom) / 2;
            let radius = (rect.right - rect.left) / 2 - (1.0 * app.scale).max(1.0) as i32;
            let background = if action == HeaderAction::Close {
                rgb(196, 48, 43)
            } else {
                PANEL_HOVER
            };
            circle(
                hdc,
                cx - radius,
                cy - radius,
                cx + radius,
                cy + radius,
                background,
            );
        }

        icon(
            hdc,
            glyph,
            &mut rect.clone(),
            app.fonts.icon_small,
            color,
        );
    }
}

fn draw_progress(hdc: HDC, app: &App, l: &Layout) {
    let duration = app.np.duration.max(0.0);
    let position = app
        .drag
        .map(|drag| drag.position)
        .unwrap_or_else(|| app.np.position())
        .clamp(0.0, if duration > 0.0 { duration } else { f64::MAX });
    let fraction = if duration > 0.0 {
        (position / duration).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let radius = (3.0 * app.scale) as i32;
    rounded(hdc, &l.progress, radius, TRACK_BG);

    let span = l.progress.right - l.progress.left;
    let pos_x = l.progress.left + (span as f64 * fraction).round() as i32;

    if fraction > 0.0 {
        let filled = RECT {
            left: l.progress.left,
            right: pos_x.max(l.progress.left + radius * 2),
            ..l.progress
        };
        rounded(hdc, &filled, radius, app.accent_color());
    }

    if duration > 0.0 {
        let center_y = (l.progress.top + l.progress.bottom) / 2;
        let outer = (5.5 * app.scale) as i32;
        let inner = (3.2 * app.scale) as i32;
        circle(
            hdc,
            pos_x - outer,
            center_y - outer,
            pos_x + outer,
            center_y + outer,
            app.accent_color(),
        );
        circle(
            hdc,
            pos_x - inner,
            center_y - inner,
            pos_x + inner,
            center_y + inner,
            TEXT,
        );
    }

    let mut rect = l.time_left;
    text(
        hdc,
        &format_time(position),
        &mut rect,
        app.fonts.small,
        TEXT,
        DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX,
    );
    let mut rect = l.time_right;
    text(
        hdc,
        &format_time(duration),
        &mut rect,
        app.fonts.small,
        MUTED,
        DT_SINGLELINE | DT_VCENTER | DT_RIGHT | DT_NOPREFIX,
    );
}

fn draw_buttons(hdc: HDC, app: &App, l: &Layout) {
    for (action, rect) in l.buttons {
        let hovered = app.hover == Some(action);

        match action {
            Action::PlayPause => {
                let accent = app.accent_color();
                circle(
                    hdc,
                    rect.left,
                    rect.top,
                    rect.right,
                    rect.bottom,
                    if hovered { lighten_color(accent) } else { accent },
                );
                let glyph = if app.np.is_playing { "\u{E769}" } else { "\u{E768}" };
                let mut icon_rect = rect;
                icon(
                    hdc,
                    glyph,
                    &mut icon_rect,
                    app.fonts.icon_large,
                    TEXT,
                );
            }
            _ => {
                if hovered {
                    let cx = (rect.left + rect.right) / 2;
                    let cy = (rect.top + rect.bottom) / 2;
                    let radius = (16.0 * app.scale) as i32;
                    circle(
                        hdc,
                        cx - radius,
                        cy - radius,
                        cx + radius,
                        cy + radius,
                        PANEL_HOVER,
                    );
                }
                let glyph = match action {
                    Action::Previous => "\u{E892}",
                    Action::Next => "\u{E893}",
                    Action::PlayPause => unreachable!(),
                };
                icon(hdc, glyph, &mut rect.clone(), app.fonts.icon, TEXT);
            }
        }
    }
}

fn status_color(status: &Status) -> u32 {
    match status {
        Status::Connected(_) => DOT_GREEN,
        Status::Scanning | Status::Connecting | Status::Retrying(_) => DOT_AMBER,
        Status::Error(_) => DOT_RED,
        Status::Idle => MUTED_DIM,
    }
}

fn format_time(seconds: f64) -> String {
    let total = if seconds.is_finite() {
        seconds.max(0.0) as u64
    } else {
        0
    };
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let rest = total % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{rest:02}")
    } else {
        format!("{minutes}:{rest:02}")
    }
}

pub struct Fonts {
    pub title: HFONT,
    pub body: HFONT,
    pub body_bold: HFONT,
    pub small: HFONT,
    pub icon: HFONT,
    pub icon_large: HFONT,
    pub icon_small: HFONT,
}

impl Fonts {
    pub fn create(scale: f32) -> Self {
        let face = wide("Segoe UI");
        let icons = wide("Segoe MDL2 Assets");
        Self {
            title: font(&face, 17.0 * scale, 600),
            body: font(&face, 13.0 * scale, 400),
            body_bold: font(&face, 13.0 * scale, 600),
            small: font(&face, 11.0 * scale, 400),
            icon: font(&icons, 16.0 * scale, 400),
            icon_large: font(&icons, 19.0 * scale, 400),
            icon_small: font(&icons, 14.0 * scale, 400),
        }
    }
}

impl Drop for Fonts {
    fn drop(&mut self) {
        unsafe {
            for font in [
                self.title,
                self.body,
                self.body_bold,
                self.small,
                self.icon,
                self.icon_large,
                self.icon_small,
            ] {
                if !font.is_invalid() {
                    let _ = DeleteObject(font.into());
                }
            }
        }
    }
}

fn font(face: &[u16], height: f32, weight: i32) -> HFONT {
    unsafe {
        CreateFontW(
            -(height as i32),
            0,
            0,
            0,
            weight,
            0,
            0,
            0,
            FONT_CHARSET(1),         // DEFAULT_CHARSET
            FONT_OUTPUT_PRECISION(0), // OUT_DEFAULT_PRECIS
            FONT_CLIP_PRECISION(0),  // CLIP_DEFAULT_PRECIS
            FONT_QUALITY(5),         // CLEARTYPE_QUALITY
            0,                       // DEFAULT_PITCH
            windows::core::PCWSTR(face.as_ptr()),
        )
    }
}

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn fill(hdc: HDC, rect: &RECT, color: u32) {
    unsafe {
        let brush = CreateSolidBrush(COLORREF(color));
        let _ = FillRect(hdc, rect, brush);
        let _ = DeleteObject(brush.into());
    }
}

fn rounded(hdc: HDC, rect: &RECT, radius: i32, color: u32) {
    unsafe {
        let brush = CreateSolidBrush(COLORREF(color));
        let old_brush = SelectObject(hdc, brush.into());
        let old_pen = SelectObject(
            hdc,
            windows::Win32::Graphics::Gdi::GetStockObject(
                windows::Win32::Graphics::Gdi::NULL_PEN,
            ),
        );
        let _ = windows::Win32::Graphics::Gdi::RoundRect(
            hdc,
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
            radius * 2,
            radius * 2,
        );
        let _ = SelectObject(hdc, old_pen);
        let _ = SelectObject(hdc, old_brush);
        let _ = DeleteObject(brush.into());
    }
}

fn circle(hdc: HDC, left: i32, top: i32, right: i32, bottom: i32, color: u32) {
    unsafe {
        let brush = CreateSolidBrush(COLORREF(color));
        let old_brush = SelectObject(hdc, brush.into());
        let old_pen = SelectObject(
            hdc,
            windows::Win32::Graphics::Gdi::GetStockObject(
                windows::Win32::Graphics::Gdi::NULL_PEN,
            ),
        );
        let _ = Ellipse(hdc, left, top, right, bottom);
        let _ = SelectObject(hdc, old_pen);
        let _ = SelectObject(hdc, old_brush);
        let _ = DeleteObject(brush.into());
    }
}

fn text(
    hdc: HDC,
    value: &str,
    rect: &mut RECT,
    font: HFONT,
    color: u32,
    format: windows::Win32::Graphics::Gdi::DRAW_TEXT_FORMAT,
) {
    unsafe {
        let old = SelectObject(hdc, HGDIOBJ::from(font));
        let _ = SetTextColor(hdc, COLORREF(color));
        let _ = SetBkMode(hdc, windows::Win32::Graphics::Gdi::TRANSPARENT);
        let mut buffer: Vec<u16> = value.encode_utf16().collect();
        if !buffer.is_empty() {
            let _ = DrawTextW(hdc, &mut buffer, rect, format);
        }
        let _ = SelectObject(hdc, old);
    }
}

fn icon(
    hdc: HDC,
    glyph: &str,
    rect: &mut RECT,
    font: HFONT,
    color: u32,
) {
    text(
        hdc,
        glyph,
        rect,
        font,
        color,
        DT_SINGLELINE | DT_VCENTER | DT_CENTER | DT_NOPREFIX,
    );
}
