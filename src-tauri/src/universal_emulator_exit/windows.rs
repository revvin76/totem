use super::{ClosePlan, CloseProgress, CloseRequest, Hold, Profile, Settings, Shortcut, EVENT};
use std::{
    path::Path,
    process::{Child, ExitStatus},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, WebviewWindow};
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, TRUE},
    UI::{
        Input::{
            KeyboardAndMouse::IsWindowEnabled,
            XboxController::{
                XInputGetState, XINPUT_GAMEPAD, XINPUT_GAMEPAD_BACK, XINPUT_GAMEPAD_LEFT_SHOULDER,
                XINPUT_GAMEPAD_LEFT_THUMB, XINPUT_GAMEPAD_RIGHT_SHOULDER,
                XINPUT_GAMEPAD_RIGHT_THUMB, XINPUT_GAMEPAD_START, XINPUT_GAMEPAD_TRIGGER_THRESHOLD,
                XINPUT_STATE,
            },
        },
        WindowsAndMessaging::*,
    },
};

const SAMPLE_INTERVAL: Duration = Duration::from_millis(50);
const PENDING_INTERVAL: Duration = Duration::from_millis(200);

#[derive(Default)]
pub struct Sessions {
    busy: AtomicBool,
    stopping: AtomicBool,
}

impl Sessions {
    fn reserve(self: &Arc<Self>) -> Result<Reservation, String> {
        self.busy
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| {
                "A tracked emulator is still running. Exit it before launching another game."
            })?;
        Ok(Reservation(self.clone()))
    }

    #[cfg(test)]
    fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Acquire)
    }

    pub fn stop(&self) {
        self.stopping.store(true, Ordering::Release);
    }
}

pub struct Reservation(Arc<Sessions>);

impl Drop for Reservation {
    fn drop(&mut self) {
        self.0.busy.store(false, Ordering::Release);
    }
}

pub(crate) fn publish(window: &WebviewWindow, phase: &str, message: &str) {
    let _ = window.emit_to(
        window.label(),
        EVENT,
        serde_json::json!({ "phase": phase, "message": message }),
    );
}

pub(crate) fn notice(window: &WebviewWindow, message: &str) {
    publish(window, "notice", message);
}

// XInput reports the triggers separately from its 16-bit digital buttons.
const LEFT_TRIGGER: u32 = 1 << 16;
const RIGHT_TRIGGER: u32 = 1 << 17;

fn gamepad_buttons(gamepad: XINPUT_GAMEPAD) -> u32 {
    let mut buttons = u32::from(gamepad.wButtons);
    if u16::from(gamepad.bLeftTrigger) > XINPUT_GAMEPAD_TRIGGER_THRESHOLD {
        buttons |= LEFT_TRIGGER;
    }
    if u16::from(gamepad.bRightTrigger) > XINPUT_GAMEPAD_TRIGGER_THRESHOLD {
        buttons |= RIGHT_TRIGGER;
    }
    buttons
}

fn read_buttons(slot: u32) -> Option<u32> {
    let mut state = XINPUT_STATE::default();
    (unsafe { XInputGetState(slot, &mut state) } == 0).then(|| gamepad_buttons(state.Gamepad))
}

fn assign_controller(settings: Settings) -> Result<u32, &'static str> {
    if let Some(slot) = settings.controller_slot {
        return Ok(slot);
    }
    sole_slot(read_buttons).ok_or(
        "Universal Emulator Exit needs one connected XInput controller or an assigned slot in Gameplay / Launching."
    )
}

fn sole_slot(mut read: impl FnMut(u32) -> Option<u32>) -> Option<u32> {
    let mut slots = (0..4).filter(|&slot| read(slot).is_some());
    let first = slots.next()?;
    slots.next().is_none().then_some(first)
}

fn shortcut_mask(shortcut: Shortcut) -> u32 {
    let bumpers = u32::from(XINPUT_GAMEPAD_LEFT_SHOULDER | XINPUT_GAMEPAD_RIGHT_SHOULDER);
    let sticks = u32::from(XINPUT_GAMEPAD_LEFT_THUMB | XINPUT_GAMEPAD_RIGHT_THUMB);
    let back_start = u32::from(XINPUT_GAMEPAD_BACK | XINPUT_GAMEPAD_START);
    match shortcut {
        Shortcut::BumpersBackStart => bumpers | back_start,
        Shortcut::BackStart => back_start,
        Shortcut::StickClicks => sticks | u32::from(XINPUT_GAMEPAD_START),
        Shortcut::BumpersStickClicks => bumpers | sticks,
        Shortcut::BumpersTriggers => bumpers | LEFT_TRIGGER | RIGHT_TRIGGER,
    }
}

fn window_identity(window: HWND) -> Option<(u32, u32)> {
    if window.is_null() {
        return None;
    }
    let mut pid = 0;
    let thread = unsafe { GetWindowThreadProcessId(window, &mut pid) };
    (thread != 0 && pid != 0).then_some((thread, pid))
}

fn candidate(window: HWND, pid: u32) -> bool {
    pid != std::process::id()
        && window_identity(window).is_some_and(|(_, owner)| owner == pid)
        && visible_top_level(window)
}

fn visible_top_level(window: HWND) -> bool {
    unsafe {
        IsWindowVisible(window) != 0
            && GetWindow(window, GW_OWNER).is_null()
            && GetWindowLongW(window, GWL_EXSTYLE) as u32 & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)
                == 0
    }
}

fn unique_window(pid: u32) -> Option<HWND> {
    struct Search {
        pid: u32,
        first: HWND,
        ambiguous: bool,
    }
    unsafe extern "system" fn visit(window: HWND, context: LPARAM) -> i32 {
        // EnumWindows calls synchronously with the live search supplied below.
        let search = unsafe { &mut *(context as *mut Search) };
        if candidate(window, search.pid) {
            if search.first.is_null() {
                search.first = window;
            } else {
                search.ambiguous = true;
            }
        }
        TRUE
    }
    let mut search = Search {
        pid,
        first: std::ptr::null_mut(),
        ambiguous: false,
    };
    let enumerated = unsafe { EnumWindows(Some(visit), (&mut search as *mut Search) as LPARAM) };
    (enumerated != 0 && !search.ambiguous && !search.first.is_null()).then_some(search.first)
}

const NO_WINDOW: &str = "Exit was withheld. Bring the emulator's main gameplay window to the foreground and hold the shortcut again.";

fn verified_target(
    child: &mut Child,
    target: HWND,
    identity: (u32, u32),
    totem_foreground: Option<HWND>,
) -> Result<(), String> {
    match child.try_wait() {
        Ok(None)
            if identity.1 == child.id()
                && window_identity(target) == Some(identity)
                && identity.1 != std::process::id()
                && visible_top_level(target)
                && unsafe {
                    let foreground = GetForegroundWindow();
                    (foreground == target
                        || (totem_foreground == Some(foreground)
                            && window_identity(foreground)
                                .is_some_and(|(_, pid)| pid == std::process::id())))
                        && IsWindowEnabled(target) != 0
                        && IsHungAppWindow(target) == 0
                } =>
        {
            Ok(())
        }
        Ok(_) => Err(NO_WINDOW.into()),
        Err(error) => Err(format!("Could not verify the emulator process: {error}")),
    }
}

fn request_close(
    child: &mut Child,
    expected: HWND,
    request: CloseRequest,
    policy: super::WindowPolicy,
    before_close: impl FnOnce(HWND) -> Result<Option<HWND>, String>,
) -> Result<(), String> {
    let target = match policy {
        super::WindowPolicy::UniqueForeground => unique_window(child.id()),
    }
    .filter(|&target| target == expected)
    .ok_or(NO_WINDOW)?;
    let identity = window_identity(target).ok_or(NO_WINDOW)?;
    verified_target(child, target, identity, None)?;
    let totem_foreground = before_close(target)?;
    // The hook may take time or alter focus. Recheck the exact HWND, thread, and live child.
    if unique_window(child.id()) != Some(target) {
        return Err(NO_WINDOW.into());
    }
    verified_target(child, target, identity, totem_foreground)?;
    let (message, wparam, lparam) = match request {
        CloseRequest::Window => (WM_CLOSE, 0, 0),
        // System-menu close is the window-addressed equivalent of the normal
        // Alt+F4 action. A foreground change cannot reroute it as keyboard input.
        CloseRequest::System => (WM_SYSCOMMAND, SC_CLOSE as usize, 1 << 16),
    };
    if unsafe { PostMessageW(target, message, wparam, lparam) } == 0 {
        return Err(format!(
            "Windows rejected the emulator close request: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}

pub(crate) enum Poll {
    Running,
    Exited { restore: bool, status: ExitStatus },
    Stopped,
}

/// Session state is independent of the child owner. A cinematic loop can poll it
/// with its own Child and supply a bounded pre-close snapshot callback.
pub struct Session {
    reservation: Reservation,
    slot: u32,
    settings: Settings,
    profile: Profile,
    plan: ClosePlan,
    hold: Hold,
    progress: CloseProgress,
    sampled_window: Option<(usize, u32)>,
    last_foreground_owned: bool,
    process_error: bool,
}

impl Session {
    pub fn new(
        reservation: Reservation,
        slot: u32,
        settings: Settings,
        profile: Profile,
    ) -> Result<Self, &'static str> {
        let plan = profile.resolve(settings.method)?;
        Ok(Self {
            reservation,
            slot,
            settings,
            profile,
            plan,
            hold: Hold::default(),
            progress: CloseProgress::default(),
            sampled_window: None,
            last_foreground_owned: false,
            process_error: false,
        })
    }

    pub(crate) fn poll(
        &mut self,
        child: &mut Child,
        before_close: impl FnOnce(HWND) -> Result<Option<HWND>, String>,
        notice: impl Fn(&str),
    ) -> Poll {
        self.poll_with_buttons(child, before_close, notice, read_buttons)
    }

    fn poll_with_buttons(
        &mut self,
        child: &mut Child,
        before_close: impl FnOnce(HWND) -> Result<Option<HWND>, String>,
        notice: impl Fn(&str),
        buttons_for_slot: impl FnOnce(u32) -> Option<u32>,
    ) -> Poll {
        if self.reservation.0.stopping.load(Ordering::Acquire) {
            return Poll::Stopped;
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                return Poll::Exited {
                    restore: self.last_foreground_owned,
                    status,
                };
            }
            Ok(None) => self.process_error = false,
            Err(error) => {
                self.hold = Hold::default();
                if !self.process_error {
                    notice(&format!("Could not verify the emulator process. Exit monitoring is waiting to retry: {error}"));
                }
                self.process_error = true;
                return Poll::Running;
            }
        }
        let foreground = unsafe { GetForegroundWindow() };
        let foreground_identity = window_identity(foreground);
        self.last_foreground_owned = foreground_identity.is_some_and(|(_, pid)| pid == child.id());
        let sampled_window = foreground_identity
            .filter(|_| self.last_foreground_owned && visible_top_level(foreground))
            .map(|(thread, _)| (foreground as usize, thread));
        if self.sampled_window != sampled_window {
            self.hold = Hold::default();
            self.sampled_window = sampled_window;
        }
        let now = Instant::now();
        if self
            .progress
            .timed_out(now, Duration::from_millis(self.profile.timeout_ms))
        {
            notice("The emulator is still running. Finish or cancel any exit prompt. To retry, release the shortcut and hold it again in the gameplay window.");
        }
        let Some(request) = self.progress.request(self.plan) else {
            return Poll::Running;
        };
        let buttons = sampled_window.and_then(|_| buttons_for_slot(self.slot));
        if self.hold.sample(
            buttons,
            shortcut_mask(self.settings.shortcut),
            Duration::from_millis(self.settings.hold_ms),
            now,
        ) {
            match request_close(
                child,
                foreground,
                request,
                self.profile.window_policy,
                before_close,
            ) {
                Ok(()) => {
                    self.progress.posted(Instant::now());
                    notice("Close requested. Complete any save or exit prompt in the emulator.");
                }
                Err(error) => notice(&error),
            }
        }
        Poll::Running
    }

    pub(crate) fn interval(&self) -> Duration {
        if self.progress.pending_since.is_some() || self.process_error {
            PENDING_INTERVAL
        } else {
            SAMPLE_INTERVAL
        }
    }

    pub fn watch(mut self, mut child: Child, window: WebviewWindow) {
        let report = window.clone();
        let start = thread::Builder::new()
            .name("totem-emulator-exit".into())
            .spawn(move || {
                publish(&window, "active", "");
                let (restore, status) = loop {
                    match self.poll(&mut child, |_| Ok(None), |message| notice(&window, message)) {
                        Poll::Running => thread::sleep(self.interval()),
                        Poll::Exited { restore, status } => break (restore, status),
                        Poll::Stopped => return,
                    }
                };
                self.finish(window, restore, status);
            });
        if let Err(error) = start {
            notice(
                &report,
                &format!("Game launched. Exit monitoring could not start: {error}"),
            );
        }
    }

    pub(crate) fn finish(self, window: WebviewWindow, restore: bool, status: ExitStatus) {
        finish(window, self.reservation, restore, status);
    }
}

pub enum Prepared {
    Off(Reservation),
    Unavailable(Reservation, String),
    Ready(Reservation, Settings, u32),
}

pub fn prepare(sessions: &Arc<Sessions>, root: &Path) -> Result<Prepared, String> {
    let reservation = sessions.reserve()?;
    Ok(match super::launch_settings(root) {
        Ok(settings) if !settings.enabled => Prepared::Off(reservation),
        Ok(settings) => match assign_controller(settings) {
            Ok(slot) => Prepared::Ready(reservation, settings, slot),
            Err(reason) => Prepared::Unavailable(reservation, reason.into()),
        },
        Err(reason) => Prepared::Unavailable(reservation, reason),
    })
}

impl Prepared {
    // The child owner can also use this to attach exit monitoring to an existing
    // cinematic worker rather than creating a second process lifecycle owner.
    pub fn attach(self, record: &serde_json::Value, window: &WebviewWindow) -> Option<Session> {
        let result = match self {
            Self::Off(_reservation) => return None,
            Self::Unavailable(_reservation, reason) => Err(reason),
            Self::Ready(reservation, settings, slot) => crate::emulators::exit_profile(record)
                .and_then(|profile| {
                    Session::new(reservation, slot, settings, profile).map_err(str::to_owned)
                }),
        };
        match result {
            Ok(session) => Some(session),
            Err(reason) => {
                notice(
                    window,
                    &format!("Universal Emulator Exit is unavailable for this launch. {reason}"),
                );
                None
            }
        }
    }
}

fn finish(window: WebviewWindow, reservation: Reservation, restore: bool, status: ExitStatus) {
    let summary = if status.success() {
        "Launched emulator process exited.".to_owned()
    } else {
        format!("Launched emulator process exited with {status}.")
    };
    let target = window.clone();
    let queued_summary = summary.clone();
    let queued = window.run_on_main_thread(move || {
        // Keep this session reserved until the return decision is complete.
        let _reservation = reservation;
        let summary = queued_summary;
        let foreground = unsafe { GetForegroundWindow() };
        let Ok(hwnd) = target.hwnd() else {
            publish(&target, "ended", &summary);
            return;
        };
        let hwnd = hwnd.0 as HWND;
        if foreground != hwnd
            && restore
            && (foreground.is_null()
                || foreground == unsafe { GetShellWindow() }
                || foreground == unsafe { GetDesktopWindow() })
        {
            let _ = target.unminimize();
            let _ = target.set_focus();
        }
        let resume = if unsafe { GetForegroundWindow() } == hwnd {
            "Game selection resumed."
        } else {
            "Select Totem in the taskbar to resume."
        };
        publish(&target, "ended", &format!("{summary} {resume}"));
    });
    if queued.is_err() {
        publish(&window, "ended", &summary);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sole_slot_never_guesses_when_multiple_pads_are_connected() {
        assert_eq!(sole_slot(|_| None), None);
        assert_eq!(sole_slot(|slot| (slot == 2).then_some(0)), Some(2));
        assert_eq!(sole_slot(|slot| (slot != 0).then_some(0)), None);
        assert_eq!(
            assign_controller(Settings {
                controller_slot: Some(3),
                ..Settings::default()
            }),
            Ok(3)
        );
    }

    #[test]
    fn default_shortcut_uses_the_four_xinput_buttons() {
        assert_eq!(shortcut_mask(Settings::default().shortcut), 0x0310 | 0x0020);
        assert_eq!(shortcut_mask(Shortcut::BackStart), 0x0030);
        assert_eq!(shortcut_mask(Shortcut::StickClicks), 0x00d0);
        assert_eq!(shortcut_mask(Shortcut::BumpersStickClicks), 0x03c0);
    }

    #[test]
    fn bumper_and_trigger_shortcut_requires_both_analog_triggers() {
        let threshold = XINPUT_GAMEPAD_TRIGGER_THRESHOLD as u8;
        let mut gamepad = XINPUT_GAMEPAD {
            wButtons: XINPUT_GAMEPAD_LEFT_SHOULDER | XINPUT_GAMEPAD_RIGHT_SHOULDER,
            bLeftTrigger: threshold + 1,
            bRightTrigger: threshold,
            ..Default::default()
        };
        let mask = shortcut_mask(Shortcut::BumpersTriggers);
        assert_ne!(gamepad_buttons(gamepad) & mask, mask);
        gamepad.bRightTrigger += 1;
        assert_eq!(gamepad_buttons(gamepad) & mask, mask);
        gamepad.bLeftTrigger = 0;
        assert_ne!(gamepad_buttons(gamepad) & mask, mask);
    }

    #[test]
    fn reservation_is_exclusive_and_released_on_drop() {
        let sessions = Arc::new(Sessions::default());
        let reservation = sessions.reserve().unwrap();
        assert!(sessions.is_busy());
        assert!(sessions.reserve().is_err());
        drop(reservation);
        assert!(!sessions.is_busy());
        assert!(sessions.reserve().is_ok());
    }

    #[test]
    fn self_and_invalid_windows_cannot_be_candidates() {
        assert!(!candidate(
            unsafe { GetDesktopWindow() },
            std::process::id()
        ));
        assert!(!candidate(std::ptr::null_mut(), 1));
        assert_eq!(unique_window(std::process::id()), None);
    }

    #[test]
    fn disabled_launch_preparation_releases_its_reservation() {
        let sessions = Arc::new(Sessions::default());
        let absent =
            std::env::temp_dir().join(format!("totem-exit-disabled-{}", std::process::id()));
        let prepared = prepare(&sessions, &absent).unwrap();
        assert!(matches!(prepared, Prepared::Off(_)));
        drop(prepared);
        assert!(!sessions.is_busy());
    }

    #[test]
    #[ignore = "Uses disposable WinForms windows and requires a foreground Windows desktop"]
    fn live_window_close_respects_ownership_cancellation_and_process_exit() {
        use std::{
            os::windows::process::CommandExt,
            process::{Command, Stdio},
        };

        fn thread_cpu_ms() -> f64 {
            use windows_sys::Win32::{
                Foundation::FILETIME,
                System::Threading::{GetCurrentThread, GetThreadTimes},
            };
            let [mut created, mut exited, mut kernel, mut user] = [FILETIME::default(); 4];
            let ok = unsafe {
                GetThreadTimes(
                    GetCurrentThread(),
                    &mut created,
                    &mut exited,
                    &mut kernel,
                    &mut user,
                )
            };
            assert_ne!(ok, 0);
            let ticks = |time: FILETIME| {
                (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
            };
            (ticks(kernel) + ticks(user)) as f64 / 10_000.0
        }

        fn fixture() -> Child {
            let script =
                Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/Test-EmulatorExitWindow.ps1");
            let system_root = std::env::var_os("SystemRoot").unwrap();
            Command::new(
                Path::new(&system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe"),
            )
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-STA",
                "-File",
            ])
            .arg(script)
            .args(["-CancelFirst", "-MultipleWindows"])
            .stdin(Stdio::null())
            .creation_flags(0x08000000)
            .spawn()
            .unwrap()
        }

        fn wait_for<T>(mut get: impl FnMut() -> Option<T>) -> T {
            let until = Instant::now() + Duration::from_secs(5);
            loop {
                if let Some(value) = get() {
                    return value;
                }
                assert!(
                    Instant::now() < until,
                    "The disposable foreground window or process state was unavailable"
                );
                thread::sleep(Duration::from_millis(20));
            }
        }

        fn foreground(pid: u32) -> HWND {
            wait_for(|| {
                let window = unique_window(pid)?;
                if unsafe { GetForegroundWindow() } != window {
                    // Windows can deny activation. The test must observe real focus.
                    unsafe { SetForegroundWindow(window) };
                }
                (unsafe { GetForegroundWindow() } == window).then_some(window)
            })
        }

        let mut child = fixture();
        let mut initial_windows = Vec::new();
        for title in [
            "Totem disposable primary gameplay window",
            "Totem disposable second gameplay window",
        ] {
            let title: Vec<_> = title.encode_utf16().chain([0]).collect();
            initial_windows.push(wait_for(|| {
                let hwnd = unsafe { FindWindowW(std::ptr::null(), title.as_ptr()) };
                candidate(hwnd, child.id()).then_some(hwnd)
            }));
        }
        assert_eq!(unique_window(child.id()), None);
        assert!(request_close(
            &mut child,
            initial_windows[0],
            CloseRequest::Window,
            super::super::WindowPolicy::UniqueForeground,
            |_| panic!("An ambiguous window must never reach the pre-close hook"),
        )
        .is_err());
        let target = foreground(child.id());
        let identity = window_identity(target).unwrap();
        let connected_slot = sole_slot(read_buttons);
        let sessions = Arc::new(Sessions::default());
        let mut monitor = Session::new(
            sessions.reserve().unwrap(),
            connected_slot.unwrap_or(3),
            Settings {
                enabled: true,
                hold_ms: 3000,
                ..Settings::default()
            },
            Profile::default(),
        )
        .unwrap();
        let clock = Instant::now();
        let cpu = thread_cpu_ms();
        for _ in 0..40 {
            assert_eq!(unsafe { GetForegroundWindow() }, target);
            assert!(matches!(
                monitor.poll(
                    &mut child,
                    |_| panic!("A short sample cannot request close"),
                    |_| {}
                ),
                Poll::Running
            ));
            thread::sleep(monitor.interval());
        }
        eprintln!(
            "40 monitor samples, {:.0} ms elapsed, {:.2} ms test-thread CPU time, sole XInput slot {:?}",
            clock.elapsed().as_secs_f64() * 1000.0,
            thread_cpu_ms() - cpu,
            connected_slot,
        );
        let wrong = unsafe { GetDesktopWindow() };
        assert!(verified_target(&mut child, wrong, identity, None).is_err());
        assert!(request_close(
            &mut child,
            wrong,
            CloseRequest::System,
            super::super::WindowPolicy::UniqueForeground,
            |_| panic!("An unrelated HWND must never reach the pre-close hook"),
        )
        .is_err());

        // The fixture now has an in-window pause menu. Controller samples still
        // reach the monitor independently of the foreground UI.
        monitor.settings.hold_ms = 500;
        assert!(matches!(
            monitor.poll_with_buttons(&mut child, |_| Ok(None), |_| {}, |_| Some(0)),
            Poll::Running
        ));
        let chord = shortcut_mask(monitor.settings.shortcut);
        wait_for(|| {
            assert!(matches!(
                monitor.poll_with_buttons(&mut child, |_| Ok(None), |_| {}, |_| Some(chord)),
                Poll::Running
            ));
            monitor.progress.pending_since
        });
        wait_for(|| {
            let mut title = [0u16; 128];
            let len = unsafe { GetWindowTextW(target, title.as_mut_ptr(), title.len() as i32) };
            String::from_utf16_lossy(&title[..len as usize])
                .ends_with("(cancelled)")
                .then_some(())
        });
        assert!(matches!(
            monitor.poll(&mut child, |_| Ok(None), |_| {}),
            Poll::Running
        ));
        assert!(child.try_wait().unwrap().is_none());

        // The system close command addresses the same verified HWND, and
        // cleanup waits for the process handle to report actual termination.
        request_close(
            &mut child,
            target,
            CloseRequest::System,
            super::super::WindowPolicy::UniqueForeground,
            |_| Ok(None),
        )
        .unwrap();
        let status = wait_for(|| match monitor.poll(&mut child, |_| Ok(None), |_| {}) {
            Poll::Exited { status, .. } => Some(status),
            Poll::Running => None,
            Poll::Stopped => panic!("Unexpected monitor shutdown"),
        });
        assert!(status.success());
        sessions.stop();
        assert!(matches!(
            monitor.poll(&mut child, |_| Ok(None), |_| {}),
            Poll::Stopped
        ));
        assert!(verified_target(&mut child, target, identity, None).is_err());
    }
}
