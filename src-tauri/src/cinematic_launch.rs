//! A single opt-in session owns the direct child returned by the normal launcher.
//! The emulator is never killed, reconfigured, or relaunched by this module.
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{ipc::Response, State, WebviewWindow};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Start {
    emulator: String,
    session_id: Option<u32>,
    capture_available: bool,
    reason: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Discover,
    WaitForAudio,
    Handoff,
    Wait,
    ReturnFocus,
    Close,
    Cancel,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ControlResult {
    Complete,
    AudioStarted,
    Exit,
    Shortcut,
}

#[cfg(windows)]
mod native {
    use super::{Action, ControlResult, Start};
    use crate::cinematic_capture::{self, Apartment, Capture};
    use crate::universal_emulator_exit::windows as emulator_exit;
    use std::{
        path::Path,
        process::Child,
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc::{self, Receiver, RecvTimeoutError, SyncSender},
            Arc, Mutex,
        },
        thread,
        time::{Duration, Instant},
    };
    use tokio::sync::oneshot;
    use windows::{
        core::{Interface, BOOL},
        Win32::{
            Foundation::{HWND, LPARAM, RECT},
            Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
            Media::Audio::{
                eRender, Endpoints::IAudioMeterInformation, IAudioSessionControl2,
                IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
                DEVICE_STATE_ACTIVE,
            },
            System::Com::{CoCreateInstance, CLSCTX_ALL},
            UI::WindowsAndMessaging::*,
        },
    };

    const NO_SESSION: &str = "The cinematic session is no longer active.";
    const CHECK_INTERVAL: Duration = Duration::from_millis(200);
    const WINDOW_TIMEOUT: Duration = Duration::from_secs(6);
    const WINDOW_STABILITY: Duration = Duration::from_millis(650);
    const STARTUP_TIMEOUT: Duration = Duration::from_secs(80);
    const SNAPSHOT_TIMEOUT: Duration = Duration::from_millis(270);
    const EXIT_HANDOFF_TIMEOUT: Duration = Duration::from_millis(2400);
    // First submitted frame, two-second hold, fade and renderer timeout, plus IPC margin.
    const EXIT_TRANSITION_TIMEOUT: Duration = Duration::from_millis(4500);

    type Reply<T> = oneshot::Sender<Result<T, String>>;

    enum Request {
        Control(Action, Reply<ControlResult>),
        Frame {
            return_snapshot: bool,
            reply: Reply<Vec<u8>>,
        },
    }

    struct Session {
        id: u32,
        pid: u32,
        sender: SyncSender<Request>,
        canceled: Arc<AtomicBool>,
        finished: Arc<AtomicBool>,
        foreground: Arc<ForegroundHold>,
        audio_done: Arc<AtomicBool>,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            self.canceled.store(true, Ordering::Relaxed);
            self.foreground.release();
        }
    }

    struct ForegroundHold {
        locked: AtomicBool,
        raised: AtomicBool,
        totem: isize,
    }

    impl ForegroundHold {
        fn acquire(totem: isize) -> Self {
            let window = HWND(totem as *mut _);
            // This only succeeds while Totem has foreground input. Windows
            // releases the lock automatically when the user switches windows.
            let locked = unsafe {
                GetForegroundWindow() == window && LockSetForegroundWindow(LSFW_LOCK).is_ok()
            };
            // Keep transient emulator windows behind a foreground Totem while
            // leaving the gameplay window visible and eligible for capture.
            let raised = unsafe {
                GetForegroundWindow() == window
                    && GetWindowLongW(window, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 == 0
                    && set_totem_z_order(window, HWND_TOPMOST).is_ok()
            };
            Self {
                locked: AtomicBool::new(locked),
                raised: AtomicBool::new(raised),
                totem,
            }
        }

        fn release(&self) {
            if self.raised.swap(false, Ordering::AcqRel) {
                let window = HWND(self.totem as *mut _);
                if window_pid(window) == std::process::id() {
                    let _ = set_totem_z_order(window, HWND_NOTOPMOST);
                }
            }
            if self.locked.swap(false, Ordering::AcqRel) {
                let _ = unsafe { LockSetForegroundWindow(LSFW_UNLOCK) };
            }
        }

        fn maintain(&self, game_pid: u32) {
            let foreground = unsafe { GetForegroundWindow() };
            if foreground.is_invalid() || foreground.0 as isize == self.totem {
                return;
            }
            if window_pid(foreground) != game_pid {
                self.release();
            } else if self.locked.load(Ordering::Relaxed) || self.raised.load(Ordering::Relaxed) {
                let totem = HWND(self.totem as *mut _);
                if window_pid(totem) == std::process::id() {
                    let _ = activate(totem, foreground);
                }
            }
        }
    }

    impl Drop for ForegroundHold {
        fn drop(&mut self) {
            self.release();
        }
    }

    #[derive(Default)]
    pub struct Sessions(Mutex<(u32, Option<Session>)>);

    pub fn capability() -> bool {
        Apartment::open().is_ok_and(|_apartment| cinematic_capture::supported())
    }

    impl Sessions {
        pub fn start(
            &self,
            root: &Path,
            platform: &str,
            path: &Path,
            totem: isize,
            window: tauri::WebviewWindow,
            exit_sessions: &Arc<emulator_exit::Sessions>,
        ) -> Result<Start, String> {
            let mut slot = self.0.lock().map_err(|_| NO_SESSION)?;
            if slot
                .1
                .as_ref()
                .is_some_and(|session| !session.finished.load(Ordering::Acquire))
            {
                return Err("A cinematic game launch is already active.".into());
            }
            slot.1 = None;
            let prepared = emulator_exit::prepare(exit_sessions, root)?;
            let (emulator, child, (foreground, capture_available, exit)) =
                crate::emulators::spawn_game(root, platform, path, |record| {
                    (
                        Arc::new(ForegroundHold::acquire(totem)),
                        capability(),
                        prepared.attach(record, &window),
                    )
                })?;
            let mut result = Start {
                emulator,
                session_id: None,
                capture_available,
                reason: None,
            };
            let (sender, receiver) = mpsc::sync_channel(4);
            let pid = child.id();
            let canceled = Arc::new(AtomicBool::new(false));
            let worker_cancel = canceled.clone();
            let finished = Arc::new(AtomicBool::new(false));
            let worker_finished = finished.clone();
            let worker_foreground = foreground.clone();
            let started = thread::Builder::new()
                .name("totem-cinematic-session".into())
                .spawn(move || {
                    run(
                        child,
                        totem,
                        receiver,
                        worker_cancel,
                        &worker_foreground,
                        capture_available,
                        exit.map(|session| (session, window)),
                    );
                    worker_foreground.release();
                    worker_finished.store(true, Ordering::Release);
                });
            if started.is_ok() {
                slot.0 = slot.0.wrapping_add(1);
                let id = slot.0;
                slot.1 = Some(Session {
                    id,
                    pid,
                    sender,
                    canceled,
                    finished,
                    foreground,
                    audio_done: Arc::new(AtomicBool::new(false)),
                });
                result.session_id = Some(id);
            } else {
                result.reason = Some("The cinematic session worker could not start.".into());
            }
            Ok(result)
        }

        pub fn cancel(&self, id: u32) {
            if let Ok(mut slot) = self.0.lock() {
                if slot.1.as_ref().is_some_and(|session| session.id == id) {
                    slot.1 = None;
                }
            }
        }

        fn sender(&self, id: u32) -> Result<SyncSender<Request>, String> {
            let slot = self.0.lock().map_err(|_| NO_SESSION)?;
            slot.1
                .as_ref()
                .filter(|session| session.id == id)
                .map(|session| session.sender.clone())
                .ok_or_else(|| NO_SESSION.into())
        }

        pub async fn control(&self, id: u32, action: Action) -> Result<ControlResult, String> {
            if matches!(action, Action::Cancel) {
                self.cancel(id);
                return Ok(ControlResult::Complete);
            }
            if matches!(action, Action::WaitForAudio | Action::Handoff) {
                let (pid, done, canceled, finished) = {
                    let slot = self.0.lock().map_err(|_| NO_SESSION)?;
                    let session = slot.1.as_ref().filter(|s| s.id == id).ok_or(NO_SESSION)?;
                    (
                        session.pid,
                        session.audio_done.clone(),
                        session.canceled.clone(),
                        session.finished.clone(),
                    )
                };
                if matches!(action, Action::WaitForAudio) {
                    return tauri::async_runtime::spawn_blocking(move || {
                        wait_for_audio(pid, || {
                            done.load(Ordering::Relaxed)
                                || canceled.load(Ordering::Relaxed)
                                || finished.load(Ordering::Acquire)
                        })
                    })
                    .await
                    .map_err(|_| "The audio monitor failed.".to_owned())?;
                }
                done.store(true, Ordering::Relaxed);
            }
            let sender = self.sender(id)?;
            let (reply, result) = oneshot::channel();
            if let Err(error) = sender.try_send(Request::Control(action, reply)) {
                // Exit may occur between foreground transfer and the wait registration.
                return match error {
                    mpsc::TrySendError::Disconnected(_) if matches!(action, Action::Wait) => {
                        Ok(ControlResult::Exit)
                    }
                    _ => Err(NO_SESSION.into()),
                };
            }
            match result.await {
                Ok(result) => result,
                Err(_) if matches!(action, Action::Wait) => Ok(ControlResult::Exit),
                Err(_) => Err(NO_SESSION.into()),
            }
        }

        pub async fn frame(&self, id: u32, return_snapshot: bool) -> Result<Vec<u8>, String> {
            let (reply, result) = oneshot::channel();
            self.sender(id)?
                .try_send(Request::Frame {
                    return_snapshot,
                    reply,
                })
                .map_err(|_| NO_SESSION)?;
            result.await.map_err(|_| NO_SESSION.to_owned())?
        }
    }

    fn wait_for_audio(pid: u32, stopped: impl Fn() -> bool) -> Result<ControlResult, String> {
        let _apartment = Apartment::open().map_err(|error| error.to_string())?;
        let managers = unsafe {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| e.to_string())?;
            let endpoints = devices
                .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                .map_err(|e| e.to_string())?;
            (0..endpoints.GetCount().map_err(|e| e.to_string())?)
                .filter_map(|index| {
                    endpoints
                        .Item(index)
                        .ok()?
                        .Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                        .ok()
                })
                .collect::<Vec<_>>()
        };
        let deadline = Instant::now() + STARTUP_TIMEOUT;
        let mut consecutive = 0;
        while !stopped() && !managers.is_empty() && Instant::now() < deadline {
            let mut has_audio = false;
            for manager in &managers {
                // An active session alone can carry silence. Check the per-session
                // peak and only accept the exact emulator process launched by Totem.
                let audible = unsafe {
                    let Ok(sessions) = manager.GetSessionEnumerator() else {
                        continue;
                    };
                    (0..sessions.GetCount().unwrap_or(0)).any(|index| {
                        let Ok(control) = sessions.GetSession(index) else {
                            return false;
                        };
                        control
                            .cast::<IAudioSessionControl2>()
                            .and_then(|session| session.GetProcessId())
                            .ok()
                            == Some(pid)
                            && control.cast::<ISimpleAudioVolume>().is_ok_and(|volume| {
                                volume.GetMute().is_ok_and(|muted| !muted.as_bool())
                                    && volume.GetMasterVolume().is_ok_and(|level| level > 0.0)
                            })
                            && control
                                .cast::<IAudioMeterInformation>()
                                .and_then(|meter| meter.GetPeakValue())
                                .is_ok_and(|peak| peak > 0.005)
                    })
                };
                if audible {
                    has_audio = true;
                    break;
                }
            }
            // Require sustained output instead of a single startup pop.
            consecutive = if has_audio { consecutive + 1 } else { 0 };
            if consecutive >= 3 {
                return Ok(ControlResult::AudioStarted);
            }
            thread::sleep(Duration::from_millis(40));
        }
        Ok(ControlResult::Complete)
    }

    fn alive(child: &mut Child) -> Result<(), String> {
        match child.try_wait() {
            Ok(None) => Ok(()),
            Ok(Some(status)) => Err(format!("The launched emulator exited ({status}).")),
            Err(error) => Err(format!("Could not check the emulator process. {error}")),
        }
    }

    fn window_pid(window: HWND) -> u32 {
        let mut pid = 0;
        unsafe { GetWindowThreadProcessId(window, Some(&mut pid)) };
        pid
    }

    fn usable_window(window: HWND, pid: u32) -> bool {
        if pid == std::process::id() || window_pid(window) != pid {
            return false;
        }
        let mut client = RECT::default();
        let mut cloaked = 0_u32;
        // Each HWND is checked again before use. The retained Child handle is
        // checked independently, so an exited child cannot authorize a reused PID.
        unsafe {
            IsWindowVisible(window).as_bool()
                && !IsIconic(window).as_bool()
                && GetWindowLongW(window, GWL_EXSTYLE) as u32
                    & (WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0)
                    == 0
                && GetClientRect(window, &mut client).is_ok()
                && client.right - client.left >= 320
                && client.bottom - client.top >= 200
                && DwmGetWindowAttribute(
                    window,
                    DWMWA_CLOAKED,
                    (&mut cloaked as *mut u32).cast(),
                    4,
                )
                .is_ok()
                && cloaked == 0
        }
    }

    fn gameplay_window(pid: u32) -> Option<HWND> {
        struct Search {
            pid: u32,
            windows: Vec<HWND>,
        }
        unsafe extern "system" fn visit(window: HWND, context: LPARAM) -> BOOL {
            // EnumWindows calls synchronously with the live Search supplied below.
            let search = unsafe { &mut *(context.0 as *mut Search) };
            if usable_window(window, search.pid) {
                search.windows.push(window);
            }
            BOOL(1)
        }
        let mut search = Search {
            pid,
            windows: Vec::new(),
        };
        unsafe { EnumWindows(Some(visit), LPARAM((&mut search as *mut Search) as isize)).ok()? };
        // Emulators can keep a manager window open alongside gameplay.
        // Prefer the largest client area; ties retain enumeration Z-order.
        search
            .windows
            .into_iter()
            .fold(None, |best, window| {
                let mut rect = RECT::default();
                if unsafe { GetClientRect(window, &mut rect) }.is_err() {
                    return best;
                }
                let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
                match best {
                    Some((_, largest)) if largest >= area => best,
                    _ => Some((window, area)),
                }
            })
            .map(|(window, _)| window)
    }

    fn discover(
        child: &mut Child,
        canceled: &AtomicBool,
        foreground: &ForegroundHold,
    ) -> Result<HWND, String> {
        let start = Instant::now();
        let mut candidate = None;
        let mut stable_since = start;
        while start.elapsed() < WINDOW_TIMEOUT && !canceled.load(Ordering::Relaxed) {
            alive(child)?;
            foreground.maintain(child.id());
            let window = gameplay_window(child.id());
            if window != candidate {
                candidate = window;
                stable_since = Instant::now();
            } else if let Some(window) =
                window.filter(|_| stable_since.elapsed() >= WINDOW_STABILITY)
            {
                return Ok(window);
            }
            thread::sleep(Duration::from_millis(80));
        }
        Err("No unique, stable gameplay window appeared for the launched process.".into())
    }

    fn handoff(totem: HWND, target: HWND, pid: u32) -> Result<(), String> {
        if !usable_window(target, pid) {
            return Err("The gameplay window closed, changed, or minimized.".into());
        }
        unsafe {
            let foreground = GetForegroundWindow();
            if foreground == target {
                return Ok(());
            }
            if foreground != totem && window_pid(foreground) != pid {
                return Err("Totem lost foreground focus before the handoff.".into());
            }
            if !activate(target, foreground) {
                return Err("Windows did not transfer focus to the emulator.".into());
            }
        }
        Ok(())
    }

    fn prepare_capture(totem: HWND, target: HWND) -> Result<(), String> {
        if !activate(totem, target) {
            return Err("Windows did not leave Totem in the foreground for the transition.".into());
        }
        // A newly shown emulator window may be above the foreground Totem
        // window. Reassert Totem's place in its existing Z-order group once.
        set_totem_z_order(totem, HWND_TOP).map_err(|error| {
            format!("Windows could not keep the Totem transition visible. {error}")
        })
    }

    fn set_totem_z_order(totem: HWND, order: HWND) -> windows::core::Result<()> {
        unsafe {
            SetWindowPos(
                totem,
                Some(order),
                0,
                0,
                0,
                0,
                SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOOWNERZORDER,
            )
        }
    }

    fn activate(window: HWND, allowed_foreground: HWND) -> bool {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground == window {
            return true;
        }
        if foreground != allowed_foreground || !unsafe { SetForegroundWindow(window) }.as_bool() {
            return false;
        }
        // Win32 activates a window in another input queue asynchronously.
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(200) {
            let foreground = unsafe { GetForegroundWindow() };
            if foreground == window {
                return true;
            }
            if !foreground.is_invalid() && foreground != allowed_foreground {
                return false;
            }
            thread::sleep(Duration::from_millis(10));
        }
        false
    }

    fn exit_snapshot(target: HWND, pid: u32, canceled: &AtomicBool) -> Option<Vec<u8>> {
        if canceled.load(Ordering::Relaxed)
            || unsafe { GetForegroundWindow() } != target
            || !usable_window(target, pid)
        {
            return None;
        }
        let _apartment = Apartment::open().ok()?;
        if !cinematic_capture::supported() {
            return None;
        }
        let mut capture = Capture::open(target).ok()?;
        let deadline = Instant::now() + SNAPSHOT_TIMEOUT;
        while !canceled.load(Ordering::Relaxed) && unsafe { GetForegroundWindow() } == target {
            if let Some(frame) = capture.frame().ok()? {
                return Some(frame);
            }
            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(12));
        }
        None
    }

    fn prepare_shortcut_exit(
        target: HWND,
        pid: u32,
        totem: HWND,
        requests: &Receiver<Request>,
        canceled: &AtomicBool,
        waiter: &mut Option<Reply<ControlResult>>,
    ) -> Result<Option<HWND>, String> {
        let Some(waiter) = waiter.take() else {
            return Ok(None);
        };
        if waiter.send(Ok(ControlResult::Shortcut)).is_err() {
            return Ok(None);
        }
        let mut deadline = Instant::now() + EXIT_HANDOFF_TIMEOUT;
        let mut focused = false;
        let mut snapshot_taken = false;
        while !canceled.load(Ordering::Relaxed) {
            match requests.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                Ok(Request::Frame {
                    return_snapshot: true,
                    reply,
                }) if !snapshot_taken && !focused => {
                    snapshot_taken = true;
                    let _ =
                        reply.send(Ok(exit_snapshot(target, pid, canceled).unwrap_or_default()));
                }
                Ok(Request::Control(Action::ReturnFocus, reply)) if !focused => {
                    focused = window_pid(totem) == std::process::id() && activate(totem, target);
                    let result = if focused {
                        let _ = set_totem_z_order(totem, HWND_TOP);
                        deadline = Instant::now() + EXIT_TRANSITION_TIMEOUT;
                        Ok(ControlResult::Complete)
                    } else {
                        Err("Windows did not transfer focus back to Totem.".into())
                    };
                    let _ = reply.send(result);
                }
                Ok(Request::Control(Action::Close, reply)) => {
                    let _ = reply.send(Ok(ControlResult::Complete));
                    break;
                }
                Ok(Request::Control(_, reply)) => {
                    let _ = reply.send(Err(NO_SESSION.into()));
                }
                Ok(Request::Frame { reply, .. }) => {
                    let _ = reply.send(Err(NO_SESSION.into()));
                }
                Err(_) => break,
            }
            if Instant::now() >= deadline {
                break;
            }
        }
        if canceled.load(Ordering::Relaxed) {
            return Err(NO_SESSION.into());
        }
        Ok(focused.then_some(totem))
    }

    fn run(
        mut child: Child,
        totem: isize,
        requests: Receiver<Request>,
        canceled: Arc<AtomicBool>,
        foreground_hold: &ForegroundHold,
        capture_available: bool,
        mut exit: Option<(emulator_exit::Session, tauri::WebviewWindow)>,
    ) {
        let mut apartment = None;
        let totem = HWND(totem as *mut _);
        let started = Instant::now();
        let mut window = None;
        let mut capture = None;
        let mut handed_off = false;
        let mut snapshot_taken = false;
        let mut was_game_foreground = false;
        let mut window_missing_since = None;
        let mut waiter: Option<Reply<ControlResult>> = None;
        while !canceled.load(Ordering::Relaxed) {
            if !handed_off {
                foreground_hold.maintain(child.id());
            }
            if handed_off {
                if let Some((session, window)) = exit.as_mut() {
                    let pid = child.id();
                    match session.poll(
                        &mut child,
                        |target| {
                            prepare_shortcut_exit(
                                HWND(target),
                                pid,
                                totem,
                                &requests,
                                &canceled,
                                &mut waiter,
                            )
                            .map(|foreground| foreground.map(|window| window.0))
                        },
                        |message| emulator_exit::notice(window, message),
                    ) {
                        emulator_exit::Poll::Running => {}
                        emulator_exit::Poll::Exited { restore, status } => {
                            if let Some((session, window)) = exit.take() {
                                session.finish(window, restore, status);
                            }
                            break;
                        }
                        emulator_exit::Poll::Stopped => {
                            exit = None;
                            break;
                        }
                    }
                }
            }
            if (!handed_off || exit.is_none()) && alive(&mut child).is_err() {
                if handed_off && was_game_foreground {
                    unsafe {
                        // Respect a foreground change to a third application.
                        if GetForegroundWindow().is_invalid() {
                            let _ = SetForegroundWindow(totem);
                        }
                    }
                }
                break;
            }
            if handed_off {
                if window.is_some_and(|hwnd| window_pid(hwnd) == child.id()) {
                    window_missing_since = None;
                } else if let Some(replacement) = gameplay_window(child.id()) {
                    window = Some(replacement);
                    window_missing_since = None;
                } else if window_missing_since
                    .get_or_insert_with(Instant::now)
                    .elapsed()
                    >= WINDOW_STABILITY
                    && exit.is_none()
                {
                    break;
                }
                was_game_foreground = window == Some(unsafe { GetForegroundWindow() });
            } else if started.elapsed() >= STARTUP_TIMEOUT {
                break;
            }
            let interval = exit
                .as_ref()
                .filter(|_| handed_off)
                .map_or(CHECK_INTERVAL, |(session, _)| session.interval());
            match requests.recv_timeout(interval) {
                Ok(Request::Control(Action::Discover, reply)) => {
                    let result =
                        discover(&mut child, &canceled, foreground_hold).and_then(|target| {
                            window = Some(target);
                            if canceled.load(Ordering::Relaxed) {
                                return Err(NO_SESSION.into());
                            }
                            prepare_capture(totem, target)
                        });
                    let _ = reply.send(result.map(|()| ControlResult::Complete));
                }
                Ok(Request::Control(Action::Handoff, reply)) => {
                    foreground_hold.release();
                    capture = None;
                    let result = if canceled.load(Ordering::Relaxed) {
                        Err(NO_SESSION.into())
                    } else {
                        alive(&mut child)
                            .and_then(|()| {
                                gameplay_window(child.id())
                                    .or(window.filter(|&target| usable_window(target, child.id())))
                                    .inspect(|&target| window = Some(target))
                                    .ok_or_else(|| "No owned gameplay window is available.".into())
                            })
                            .and_then(|target| handoff(totem, target, child.id()))
                    };
                    handed_off = result.is_ok();
                    was_game_foreground = handed_off;
                    if handed_off {
                        if let Some((_, window)) = exit.as_ref() {
                            emulator_exit::publish(window, "active", "");
                        }
                    }
                    let _ = reply.send(result.map(|()| ControlResult::Complete));
                }
                Ok(Request::Control(Action::Wait, reply)) if handed_off && waiter.is_none() => {
                    waiter = Some(reply);
                }
                Ok(Request::Control(_, reply)) => {
                    let _ = reply.send(Err("The cinematic action is unavailable.".into()));
                }
                Ok(Request::Frame {
                    return_snapshot,
                    reply,
                }) => {
                    let result = (|| {
                        if !capture_available
                            || handed_off != return_snapshot
                            || canceled.load(Ordering::Relaxed)
                        {
                            return Err(NO_SESSION.to_owned());
                        }
                        alive(&mut child)?;
                        if !return_snapshot {
                            if let Some(target) = gameplay_window(child.id()) {
                                if window != Some(target) {
                                    window = Some(target);
                                    capture = None;
                                }
                            }
                        }
                        let target = window
                            .filter(|&target| usable_window(target, child.id()))
                            .ok_or("The capture window closed, changed, or minimized.")?;
                        let foreground = unsafe { GetForegroundWindow() };
                        if return_snapshot {
                            if snapshot_taken || foreground != totem {
                                return Err(NO_SESSION.to_owned());
                            }
                            snapshot_taken = true;
                        }
                        if foreground != target && foreground != totem {
                            return Err("Totem and the emulator lost foreground focus.".into());
                        }
                        if capture.is_none() {
                            apartment
                                .get_or_insert_with(Apartment::open)
                                .as_ref()
                                .map_err(|error| error.to_string())?;
                            capture =
                                Some(Capture::open(target).map_err(|error| error.to_string())?);
                        }
                        let deadline = Instant::now() + SNAPSHOT_TIMEOUT;
                        loop {
                            let frame = capture
                                .as_mut()
                                .unwrap()
                                .frame()
                                .map_err(|error| error.to_string())?;
                            if frame.is_some()
                                || !return_snapshot
                                || Instant::now() >= deadline
                                || canceled.load(Ordering::Relaxed)
                            {
                                break Ok(frame.unwrap_or_default());
                            }
                            thread::sleep(Duration::from_millis(12));
                            alive(&mut child)?;
                            if unsafe { GetForegroundWindow() } != totem
                                || !usable_window(target, child.id())
                            {
                                return Err(NO_SESSION.to_owned());
                            }
                        }
                    })();
                    if return_snapshot || result.is_err() {
                        capture = None;
                    }
                    let _ = reply.send(result);
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        foreground_hold.release();
        drop(capture);
        if let Some(reply) = waiter {
            let _ = reply.send(Ok(ControlResult::Exit));
        }
        if let Some((session, window)) = exit {
            // A focus return, skipped transition, or capture failure can end the
            // visuals while the original game process is still running.
            session.watch(child, window);
        }
    }
}

#[cfg(windows)]
pub use native::Sessions;

#[cfg(not(windows))]
#[derive(Default)]
pub struct Sessions;

#[tauri::command]
pub async fn cinematic_capability() -> bool {
    #[cfg(windows)]
    return tauri::async_runtime::spawn_blocking(native::capability)
        .await
        .unwrap_or(false);
    #[cfg(not(windows))]
    false
}

#[tauri::command]
pub async fn cinematic_start(
    game_id: String,
    window: WebviewWindow,
    sessions: State<'_, Arc<Sessions>>,
    library: State<'_, Arc<crate::library_index::Service>>,
) -> Result<Start, String> {
    #[cfg(windows)]
    {
        use tauri::Manager;
        let totem = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let exit_sessions = window
            .state::<Arc<crate::universal_emulator_exit::windows::Sessions>>()
            .inner()
            .clone();
        let sessions = sessions.inner().clone();
        let library = library.inner().clone();
        return tauri::async_runtime::spawn_blocking(move || {
            let (platform, path) = library.game_launch_target(&game_id)?;
            sessions.start(
                std::path::Path::new(crate::library_settings::ROOT),
                &platform,
                &path,
                totem,
                window,
                &exit_sessions,
            )
        })
        .await
        .map_err(|_| "The game launcher worker failed.".to_owned())?;
    }
    #[cfg(not(windows))]
    {
        let _ = (game_id, window, sessions, library);
        Err("Cinematic launch is available on Windows.".into())
    }
}

#[tauri::command]
pub async fn cinematic_control(
    session_id: u32,
    action: Action,
    sessions: State<'_, Arc<Sessions>>,
) -> Result<ControlResult, String> {
    #[cfg(windows)]
    return sessions.control(session_id, action).await;
    #[cfg(not(windows))]
    {
        let _ = (session_id, action, sessions);
        Err("Cinematic launch is available on Windows.".into())
    }
}

#[tauri::command]
pub async fn cinematic_frame(
    session_id: u32,
    return_snapshot: Option<bool>,
    sessions: State<'_, Arc<Sessions>>,
) -> Result<Response, String> {
    #[cfg(windows)]
    return sessions
        .frame(session_id, return_snapshot.unwrap_or(false))
        .await
        .map(Response::new);
    #[cfg(not(windows))]
    {
        let _ = (session_id, return_snapshot, sessions);
        Err("Cinematic launch is available on Windows.".into())
    }
}
