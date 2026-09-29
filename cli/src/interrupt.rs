//! Ctrl+C (and a terminal closing) during `dev`: the first one asks the
//! loop to stop, remove its package and leave; the loop polls
//! [`requested`]. A second one ends the process at once.

use std::sync::atomic::{AtomicBool, Ordering};

static REQUESTED: AtomicBool = AtomicBool::new(false);

/// Whether the user asked to stop.
pub fn requested() -> bool {
    REQUESTED.load(Ordering::SeqCst)
}

/// A second request while the first is handled: leave now.
fn on_request() -> bool {
    REQUESTED.swap(true, Ordering::SeqCst)
}

#[cfg(unix)]
pub fn install() {
    extern "C" fn handler(_signal: libc::c_int) {
        if on_request() {
            // SAFETY: `_exit` is async-signal-safe.
            unsafe { libc::_exit(130) };
        }
    }
    for signal in [libc::SIGINT, libc::SIGTERM, libc::SIGHUP] {
        // SAFETY: a zeroed `sigaction` with an async-signal-safe handler
        // that only touches an atomic.
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handler as *const () as libc::sighandler_t;
            libc::sigemptyset(&raw mut action.sa_mask);
            libc::sigaction(signal, &raw const action, std::ptr::null_mut());
        }
    }
}

#[cfg(windows)]
pub fn install() {
    use windows_sys::Win32::System::Console::SetConsoleCtrlHandler;

    unsafe extern "system" fn handler(_event: u32) -> windows_sys::core::BOOL {
        if on_request() {
            std::process::exit(130);
        }
        // Handled: the loop stops on its own.
        1
    }
    // SAFETY: a handler that only touches an atomic (or exits).
    unsafe { SetConsoleCtrlHandler(Some(handler), 1) };
}

#[cfg(not(any(unix, windows)))]
pub fn install() {}
