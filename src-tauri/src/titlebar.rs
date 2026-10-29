//! On macOS the window keeps its own close, minimise and zoom buttons. Shoji's title bar is taller
//! than the system's, so the buttons move down to sit centred in it. Tauri's setting for this has no
//! effect on macOS 26, so Shoji places them itself, and again whenever the window resizes or changes
//! focus, since AppKit can put them back.

use objc2_app_kit::{NSWindow, NSWindowButton};
use objc2_foundation::NSPoint;
use tauri::{WebviewWindow, WindowEvent};

/// The title bar's height in points, as shell.css draws it.
const TITLE_BAR: f64 = 42.0;
/// How far the close button sits from the window's left edge, in points.
const LEFT: f64 = 16.0;

pub fn keep_buttons_centred(window: &WebviewWindow) {
    place(window);
    let handle = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_)
                | WindowEvent::Focused(_)
                | WindowEvent::ScaleFactorChanged { .. }
                | WindowEvent::ThemeChanged(_)
        ) {
            place(&handle);
        }
    });
}

fn place(window: &WebviewWindow) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: Tauri hands out the window's own NSWindow, and setup and window events run on the
    // main thread, where AppKit must be used.
    centre(unsafe { &*pointer.cast() });
}

fn centre(ns_window: &NSWindow) {
    let [Some(close), Some(minimise), Some(zoom)] = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .map(|which| ns_window.standardWindowButton(which)) else {
        return;
    };
    let size = close.frame().size;
    let gap = minimise.frame().origin.x - close.frame().origin.x;
    let height = ns_window.frame().size.height;

    // The buttons' container must span the whole title bar, or they're cut off once moved.
    // SAFETY: superview only reads the view hierarchy.
    if let Some(container) = unsafe { close.superview().and_then(|view| view.superview()) } {
        let mut frame = container.frame();
        frame.size.height = TITLE_BAR;
        frame.origin.y = height - TITLE_BAR;
        container.setFrame(frame);
    }

    // Window coordinates start at the bottom left. Each button's bottom edge goes where centring it
    // in the title bar puts it, converted into its own parent's coordinates.
    let bottom = height - (TITLE_BAR + size.height) / 2.0;
    for (i, button) in [close, minimise, zoom].iter().enumerate() {
        // SAFETY: as above.
        let Some(parent) = (unsafe { button.superview() }) else {
            continue;
        };
        let at = NSPoint::new(LEFT + i as f64 * gap, bottom);
        button.setFrameOrigin(parent.convertPoint_fromView(at, None));
    }
}
