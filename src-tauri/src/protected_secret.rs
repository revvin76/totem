// Windows user-bound encryption. Neither plaintext credentials nor tokens are
// returned through IPC, written to logs, or included in the frontend bundle.
#[cfg(windows)]
pub fn transform(bytes: &[u8], decrypt: bool) -> Result<Vec<u8>, String> {
    use std::{ffi::c_void, ptr};
    #[repr(C)]
    struct Blob {
        length: u32,
        data: *mut u8,
    }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            input: *const Blob,
            description: *const u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
        fn CryptUnprotectData(
            input: *const Blob,
            description: *mut *mut u16,
            entropy: *const Blob,
            reserved: *mut c_void,
            prompt: *mut c_void,
            flags: u32,
            output: *mut Blob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    if bytes.is_empty() || bytes.len() > 16_384 {
        return Err("Invalid protected connection record.".into());
    }
    let input = Blob {
        length: bytes.len() as u32,
        data: bytes.as_ptr() as *mut u8,
    };
    let mut output = Blob {
        length: 0,
        data: ptr::null_mut(),
    };
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &input,
                ptr::null_mut(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                1,
                &mut output,
            )
        } else {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                1,
                &mut output,
            )
        }
    };
    if ok == 0 {
        return Err(
            "Windows could not protect/unlock this metadata connection for this user.".into(),
        );
    }
    let result =
        unsafe { std::slice::from_raw_parts(output.data, output.length as usize).to_vec() };
    unsafe {
        LocalFree(output.data as *mut c_void);
    }
    Ok(result)
}

#[cfg(not(windows))]
pub fn transform(_: &[u8], _: bool) -> Result<Vec<u8>, String> {
    Err("Protected metadata credentials require the Windows desktop app.".into())
}
