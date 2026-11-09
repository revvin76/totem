//! Windows Graphics Capture for the opt-in Game Chooser transition.
//! The session, pool and immediate context stay on one COM-initialized worker.
use std::{
    thread,
    time::{Duration, Instant},
};
use windows::{
    core::{factory, Interface, Result},
    Graphics::{
        Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession},
        DirectX::{Direct3D11::IDirect3DDevice, DirectXPixelFormat},
        SizeInt32,
    },
    Win32::{
        Foundation::{E_FAIL, E_POINTER, HMODULE, HWND, POINT, RECT},
        Graphics::{
            Direct3D::D3D_DRIVER_TYPE_HARDWARE,
            Direct3D11::*,
            Dwm::{DwmGetWindowAttribute, DWMWA_EXTENDED_FRAME_BOUNDS},
            Dxgi::{Common::*, IDXGIDevice, DXGI_ERROR_WAS_STILL_DRAWING},
            Gdi::ClientToScreen,
        },
        System::{
            Performance::{QueryPerformanceCounter, QueryPerformanceFrequency},
            WinRT::{
                Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess},
                Graphics::Capture::IGraphicsCaptureItemInterop,
                RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
            },
        },
        UI::WindowsAndMessaging::GetClientRect,
    },
};

const PIXEL_FORMAT: DirectXPixelFormat = DirectXPixelFormat::B8G8R8A8UIntNormalized;
const POOL_SIZE: i32 = 2;
const HEADER_SIZE: usize = 20;

pub struct Apartment;

impl Apartment {
    pub fn open() -> Result<Self> {
        // The worker owns the apartment and balances each successful initialization.
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        Ok(Self)
    }
}

impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

pub fn supported() -> bool {
    GraphicsCaptureSession::IsSupported().unwrap_or(false)
}

pub struct Capture {
    session: GraphicsCaptureSession,
    pool: Direct3D11CaptureFramePool,
    winrt_device: IDirect3DDevice,
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    staging: Option<ID3D11Texture2D>,
    size: SizeInt32,
    window: HWND,
    staging_size: (u32, u32),
    clock_frequency: i64,
}

fn check_size(size: SizeInt32) -> Result<()> {
    if size.Width < 2
        || size.Height < 2
        || size.Width > 1920
        || size.Height > 1920
        || size.Width * size.Height > 1920 * 1080
    {
        return Err(windows::core::Error::new(
            E_FAIL,
            "Window exceeds the cinematic capture size limit (up to 1920 × 1080 pixels).",
        ));
    }
    Ok(())
}

impl Capture {
    pub fn open(window: HWND) -> Result<Self> {
        let item: GraphicsCaptureItem = unsafe {
            factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>()?
                .CreateForWindow(window)?
        };
        let size = item.Size()?;
        check_size(size)?;
        let mut device = None;
        let mut context = None;
        let mut clock_frequency = 0;
        // No device or context pointer is sent across threads. WGC operates through
        // its WinRT device wrapper and gives this worker completed frames to copy.
        unsafe {
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                None,
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
            QueryPerformanceFrequency(&mut clock_frequency)?;
        }
        let device: ID3D11Device = device.ok_or(E_POINTER)?;
        let context = context.ok_or(E_POINTER)?;
        let multithread: ID3D11Multithread = context.cast()?;
        let _ = unsafe { multithread.SetMultithreadProtected(true) };
        let dxgi: IDXGIDevice = device.cast()?;
        let winrt_device: IDirect3DDevice =
            unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi)? }.cast()?;
        let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
            &winrt_device,
            PIXEL_FORMAT,
            POOL_SIZE,
            size,
        )?;
        let session = pool.CreateCaptureSession(&item)?;
        let _ = session.SetIsCursorCaptureEnabled(false);
        let capture = Self {
            session,
            pool,
            winrt_device,
            device,
            context,
            staging: None,
            size,
            window,
            staging_size: (0, 0),
            clock_frequency,
        };
        capture.session.StartCapture()?;
        Ok(capture)
    }

    pub fn frame(&mut self) -> Result<Option<Vec<u8>>> {
        // Drain at most the pool's capacity so work stays bounded even when the
        // compositor is producing faster than the WebView can consume.
        let mut latest = None;
        for _ in 0..POOL_SIZE {
            match self.pool.TryGetNextFrame() {
                Ok(frame) => latest = Some(frame),
                // The windows crate represents a null WinRT result from an
                // empty pool as an Error carrying the original S_OK.
                Err(error) if error.code().is_ok() => break,
                Err(error) => return Err(error),
            }
        }
        let Some(frame) = latest else { return Ok(None) };
        let size = frame.ContentSize()?;
        check_size(size)?;
        if size != self.size {
            drop(frame);
            self.pool
                .Recreate(&self.winrt_device, PIXEL_FORMAT, POOL_SIZE, size)?;
            self.size = size;
            self.staging = None;
            return Ok(None);
        }
        let access: IDirect3DDxgiInterfaceAccess = frame.Surface()?.cast()?;
        let source: ID3D11Texture2D = unsafe { access.GetInterface()? };
        let frame_ticks = frame.SystemRelativeTime()?.Duration;
        self.read_frame(&source, frame_ticks)
    }

    fn read_frame(
        &mut self,
        source: &ID3D11Texture2D,
        frame_ticks: i64,
    ) -> Result<Option<Vec<u8>>> {
        let box_ = client_box(self.window, self.size);
        let width = box_.right - box_.left;
        let height = box_.bottom - box_.top;
        if self.staging.is_none() || self.staging_size != (width, height) {
            let desc = D3D11_TEXTURE2D_DESC {
                Width: width,
                Height: height,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                ..Default::default()
            };
            unsafe {
                self.device
                    .CreateTexture2D(&desc, None, Some(&mut self.staging))?
            };
            self.staging_size = (width, height);
        }
        let staging = self.staging.as_ref().ok_or(E_POINTER)?;
        let scale = (640.0 / f64::from(width))
            .min(480.0 / f64::from(height))
            .min(1.0);
        let out_width = (f64::from(width) * scale).round().max(1.0) as u32;
        let out_height = (f64::from(height) * scale).round().max(1.0) as u32;
        let started = Instant::now();
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        // Copy a bounded rectangle and drop the frame if the staging resource
        // stays busy. This worker never requests a blocking GPU map.
        unsafe {
            self.context
                .CopySubresourceRegion(staging, 0, 0, 0, 0, source, 0, Some(&box_));
            self.context.Flush();
        }
        let mut bytes = vec![0; HEADER_SIZE + (out_width * out_height * 4) as usize];
        unsafe {
            loop {
                match self.context.Map(
                    staging,
                    0,
                    D3D11_MAP_READ,
                    D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                    Some(&mut mapped),
                ) {
                    Ok(()) => break,
                    Err(error) if error.code() == DXGI_ERROR_WAS_STILL_DRAWING => {
                        if started.elapsed() >= Duration::from_millis(20) {
                            return Ok(None);
                        }
                        thread::sleep(Duration::from_millis(1));
                    }
                    Err(error) => return Err(error),
                }
            }
            for y in 0..out_height {
                let row = mapped
                    .pData
                    .cast::<u8>()
                    .add(((out_height - 1 - y) * height / out_height * mapped.RowPitch) as usize);
                let dest = &mut bytes[HEADER_SIZE + (y * out_width * 4) as usize..];
                for (x, pixel) in dest
                    .chunks_exact_mut(4)
                    .take(out_width as usize)
                    .enumerate()
                {
                    let offset = x * width as usize / out_width as usize * 4;
                    let bgra = row.add(offset);
                    pixel.copy_from_slice(&[*bgra.add(2), *bgra.add(1), *bgra, 255]);
                }
            }
            self.context.Unmap(staging, 0);
        }
        let mut now_ticks = 0;
        unsafe { QueryPerformanceCounter(&mut now_ticks)? };
        let age_us = (now_ticks as i128 * 1_000_000 / self.clock_frequency as i128
            - frame_ticks as i128 / 10)
            .clamp(0, u32::MAX as i128) as u32;
        let fields = [
            out_width,
            out_height,
            age_us,
            started.elapsed().as_micros() as u32,
            (self.size.Width * self.size.Height * 8) as u32 + width * height * 4,
        ];
        for (index, field) in fields.iter().enumerate() {
            bytes[index * 4..(index + 1) * 4].copy_from_slice(&field.to_le_bytes());
        }
        Ok(Some(bytes))
    }
}

fn client_box(window: HWND, size: SizeInt32) -> D3D11_BOX {
    let mut bounds = RECT::default();
    let mut client = RECT::default();
    let mut origin = POINT::default();
    let matches_capture = unsafe {
        DwmGetWindowAttribute(
            window,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&mut bounds as *mut RECT).cast(),
            std::mem::size_of::<RECT>() as u32,
        )
        .is_ok()
            && bounds.right - bounds.left == size.Width
            && bounds.bottom - bounds.top == size.Height
            && GetClientRect(window, &mut client).is_ok()
            && ClientToScreen(window, &mut origin).as_bool()
    };
    let x = origin.x - bounds.left;
    let y = origin.y - bounds.top;
    if matches_capture
        && x >= 0
        && y >= 0
        && client.right > 0
        && client.bottom > 0
        && x + client.right <= size.Width
        && y + client.bottom <= size.Height
    {
        return D3D11_BOX {
            left: x as u32,
            top: y as u32,
            right: (x + client.right) as u32,
            bottom: (y + client.bottom) as u32,
            back: 1,
            ..Default::default()
        };
    }
    D3D11_BOX {
        right: size.Width as u32,
        bottom: size.Height as u32,
        back: 1,
        ..Default::default()
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        let _ = self.session.Close();
        let _ = self.pool.Close();
    }
}

#[cfg(test)]
#[test]
#[ignore = "requires an interactive Windows desktop and hardware capture"]
fn animated_window_capture_fixture() {
    use std::{process::Command, thread, time::Duration};
    use windows::Win32::UI::WindowsAndMessaging::FindWindowW;

    let _apartment = Apartment::open().unwrap();
    assert!(supported());
    let mut fixture = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-File",
            "../tools/Test-CinematicCaptureWindow.ps1",
        ])
        .spawn()
        .unwrap();
    let check = std::panic::catch_unwind(|| {
        let started = Instant::now();
        let window = loop {
            if let Ok(window) =
                unsafe { FindWindowW(None, windows::core::w!("Totem Cinematic Capture Fixture")) }
            {
                break window;
            }
            assert!(
                started.elapsed() < Duration::from_secs(10),
                "fixture window never appeared"
            );
            thread::sleep(Duration::from_millis(25));
        };
        for cycle in 1..=2 {
            let start = Instant::now();
            let mut capture = Capture::open(window).unwrap();
            let mut samples = Vec::new();
            let mut previous = Vec::new();
            let mut changed = 0;
            while samples.len() < 20 && start.elapsed() < Duration::from_secs(3) {
                if let Some(frame) = capture.frame().unwrap() {
                    let field = |i: usize| {
                        u32::from_le_bytes(frame[i * 4..(i + 1) * 4].try_into().unwrap())
                    };
                    assert_eq!(
                        frame.len(),
                        HEADER_SIZE + (field(0) * field(1) * 4) as usize
                    );
                    if previous != frame[HEADER_SIZE..] {
                        changed += 1;
                    }
                    if samples.is_empty() {
                        println!("cycle {cycle}: first frame {:?}, output {}x{}, capture surfaces {} bytes",
                            start.elapsed(), field(0), field(1), field(4));
                    }
                    previous = frame[HEADER_SIZE..].to_vec();
                    samples.push((field(2), field(3)));
                }
                thread::sleep(Duration::from_millis(67));
            }
            assert_eq!(samples.len(), 20);
            assert!(changed >= 10, "capture did not contain animated output");
            let mut ages: Vec<_> = samples.iter().map(|s| s.0).collect();
            let mut readbacks: Vec<_> = samples.iter().map(|s| s.1).collect();
            ages.sort_unstable();
            readbacks.sort_unstable();
            println!(
                "cycle {cycle}: frame age p50/p95 {}/{} us, readback p50/p95 {}/{} us",
                ages[9], ages[18], readbacks[9], readbacks[18]
            );
        }
    });
    // The test owns this disposable fixture process.
    let _ = fixture.kill();
    let _ = fixture.wait();
    check.unwrap();
}
