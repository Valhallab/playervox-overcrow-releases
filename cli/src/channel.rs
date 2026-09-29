//! The CLI's end of the development channel (`docs/dev-channel.md`): it
//! finds this user's overlay, checks that the other end is this user's
//! process, says hello, then sends requests and reads what the overlay
//! sends, one message at a time, with a timeout.

use std::io::{self, Write as _};
use std::time::{Duration, Instant};

use overcrow_widget_devchannel::{
    ClientMessage, FrameError, Platform, ServerMessage, write_client_frame,
};

/// Why the CLI could not talk to an overlay.
#[derive(Debug)]
pub enum ConnectError {
    /// No overlay listens: it is not running, or development is off.
    Absent,
    /// Something is there that is not this user's overlay.
    Untrusted(&'static str),
    /// The overlay speaks other protocol versions.
    Incompatible(Vec<u32>),
    /// The overlay refused the session (`too_many_sessions`…).
    Refused(String),
    Io(io::Error),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Absent => {
                formatter.write_str("no OverCrow overlay with development installs is running")
            }
            Self::Untrusted(what) => write!(
                formatter,
                "the development channel is not this user's overlay ({what})"
            ),
            Self::Incompatible(versions) => write!(
                formatter,
                "the overlay speaks development channel version(s) {versions:?}, this CLI speaks {}",
                overcrow_widget_devchannel::PROTOCOL_VERSION
            ),
            Self::Refused(code) => write!(formatter, "the overlay refused the session ({code})"),
            Self::Io(error) => write!(formatter, "the development channel failed: {error}"),
        }
    }
}

/// What the overlay said in its `welcome`.
#[derive(Clone, Debug)]
pub struct Overlay {
    pub name: String,
    pub platform: Platform,
}

pub struct Client {
    stream: transport::Stream,
    pub overlay: Overlay,
    next_request: u64,
}

impl Client {
    /// Connects to this user's overlay and says hello.
    pub fn connect() -> Result<Self, ConnectError> {
        let mut stream = transport::connect()?;
        write_client_frame(
            &mut stream,
            &ClientMessage::Hello {
                protocol: overcrow_widget_devchannel::PROTOCOL_VERSION,
                client: format!("overcrow-widget {}", env!("CARGO_PKG_VERSION")),
            },
            None,
        )
        .map_err(ConnectError::Io)?;
        let welcome = stream
            .receive(overcrow_widget_devchannel::HELLO_TIMEOUT * 2)
            .map_err(|error| ConnectError::Io(frame_error(error)))?;
        match welcome {
            Some(ServerMessage::Welcome {
                overlay, platform, ..
            }) => Ok(Self {
                stream,
                overlay: Overlay {
                    name: overlay,
                    platform,
                },
                next_request: 1,
            }),
            Some(ServerMessage::Refused {
                supported: Some(versions),
                ..
            }) => Err(ConnectError::Incompatible(versions)),
            Some(ServerMessage::Refused { code, .. }) => Err(ConnectError::Refused(code)),
            _ => Err(ConnectError::Untrusted("no welcome")),
        }
    }

    /// A new request number.
    pub fn request(&mut self) -> u64 {
        let request = self.next_request;
        self.next_request += 1;
        request
    }

    pub fn send(&mut self, message: &ClientMessage, package: Option<&[u8]>) -> io::Result<()> {
        write_client_frame(&mut self.stream, message, package)?;
        self.stream.flush()
    }

    /// The next message within `timeout`; `Ok(None)` when none came.
    /// `Err(FrameError::Closed)` once the overlay closed the channel.
    pub fn receive(&mut self, timeout: Duration) -> Result<Option<ServerMessage>, FrameError> {
        self.stream.receive(timeout)
    }
}

fn frame_error(error: FrameError) -> io::Error {
    match error {
        FrameError::Io(kind) => kind.into(),
        FrameError::Closed => io::ErrorKind::ConnectionAborted.into(),
        other => io::Error::new(io::ErrorKind::InvalidData, format!("{other:?}")),
    }
}

/// Waits for `ready` until `timeout`, in steps.
fn wait(
    timeout: Duration,
    mut ready: impl FnMut(Duration) -> io::Result<bool>,
) -> io::Result<bool> {
    let deadline = Instant::now() + timeout;
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if ready(left)? {
            return Ok(true);
        }
        if left.is_zero() {
            return Ok(false);
        }
    }
}

#[cfg(unix)]
mod transport {
    use std::io::{self, Read, Write};
    use std::os::fd::AsRawFd as _;
    use std::os::unix::fs::{FileTypeExt as _, MetadataExt as _};
    use std::os::unix::net::UnixStream;
    use std::path::PathBuf;
    use std::time::Duration;

    use overcrow_widget_devchannel::{FrameError, SOCKET_NAME, ServerMessage, read_server_message};

    use super::{ConnectError, wait};

    pub struct Stream(UnixStream);

    fn euid() -> u32 {
        // SAFETY: `geteuid` has no preconditions and cannot fail.
        unsafe { libc::geteuid() }
    }

    /// The socket of this user's overlay: in `$XDG_RUNTIME_DIR`, a socket
    /// (not a link) owned by this user, and its peer this user's process.
    pub fn connect() -> Result<Stream, ConnectError> {
        let directory = std::env::var_os("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or(ConnectError::Absent)?;
        let path = directory.join(SOCKET_NAME);
        let metadata = match std::fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Err(ConnectError::Absent);
            }
            Err(error) => return Err(ConnectError::Io(error)),
        };
        if !metadata.file_type().is_socket() || metadata.uid() != euid() {
            return Err(ConnectError::Untrusted("socket owner"));
        }
        let stream = match UnixStream::connect(&path) {
            Ok(stream) => stream,
            // A socket an overlay left behind.
            Err(error) if error.kind() == io::ErrorKind::ConnectionRefused => {
                return Err(ConnectError::Absent);
            }
            Err(error) => return Err(ConnectError::Io(error)),
        };
        if peer_uid(&stream) != Some(euid()) {
            return Err(ConnectError::Untrusted("peer user"));
        }
        Ok(Stream(stream))
    }

    fn peer_uid(stream: &UnixStream) -> Option<u32> {
        let mut credentials = libc::ucred {
            pid: 0,
            uid: 0,
            gid: 0,
        };
        let mut length = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        // SAFETY: the buffer and its length describe a live `ucred`.
        let result = unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                (&raw mut credentials).cast(),
                &raw mut length,
            )
        };
        (result == 0).then_some(credentials.uid)
    }

    impl Stream {
        pub fn receive(&mut self, timeout: Duration) -> Result<Option<ServerMessage>, FrameError> {
            let fd = self.0.as_raw_fd();
            let ready = wait(timeout, |left| {
                let mut poll = libc::pollfd {
                    fd,
                    events: libc::POLLIN,
                    revents: 0,
                };
                let ms = left.as_millis().min(100) as libc::c_int;
                // SAFETY: one live `pollfd`.
                match unsafe { libc::poll(&raw mut poll, 1, ms) } {
                    -1 if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted => {
                        Ok(false)
                    }
                    -1 => Err(io::Error::last_os_error()),
                    ready => Ok(ready > 0),
                }
            })?;
            if !ready {
                return Ok(None);
            }
            // A message that started arrives whole, within the frame delay.
            self.0
                .set_read_timeout(Some(overcrow_widget_devchannel::FRAME_TIMEOUT))?;
            read_server_message(&mut self.0).map(Some)
        }
    }

    impl Read for Stream {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.0.read(buffer)
        }
    }

    impl Write for Stream {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.0.write(buffer)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.0.flush()
        }
    }
}

#[cfg(windows)]
mod transport {
    use std::fs::File;
    use std::io::{self, Read, Write};
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};
    use std::ptr::{null, null_mut};
    use std::time::{Duration, Instant};

    use overcrow_widget_devchannel::{
        FRAME_TIMEOUT, FrameError, PIPE_PREFIX, ServerMessage, read_server_message,
    };
    use windows_sys::Win32::Foundation::{
        ERROR_ACCESS_DENIED, ERROR_FILE_NOT_FOUND, ERROR_PIPE_BUSY, GENERIC_READ, GENERIC_WRITE,
        HANDLE, INVALID_HANDLE_VALUE, LocalFree,
    };
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;
    use windows_sys::Win32::Security::{
        EqualSid, GetLengthSid, GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation,
        IsTokenRestricted, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TOKEN_USER, TokenIntegrityLevel,
        TokenIsAppContainer, TokenUser,
    };
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, OPEN_EXISTING, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT,
    };
    use windows_sys::Win32::System::Pipes::{
        GetNamedPipeServerProcessId, PeekNamedPipe, WaitNamedPipeW,
    };
    use windows_sys::Win32::System::Threading::{
        GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    use super::{ConnectError, wait};

    /// `SECURITY_MANDATORY_MEDIUM_RID`.
    const MEDIUM_INTEGRITY: u32 = 0x2000;
    /// How long to wait for a free pipe instance.
    const BUSY_WAIT_MS: u32 = 2_000;

    pub struct Stream {
        file: File,
        /// Reads fail with `TimedOut` past this instant.
        deadline: Option<Instant>,
    }

    /// The pipe of this user's overlay, whose server process runs as this
    /// user at medium integrity or above, neither AppContainer nor
    /// restricted: the checks the overlay makes of its clients. The
    /// overlay may identify this client, never impersonate it.
    pub fn connect() -> Result<Stream, ConnectError> {
        let own = process_token(None).ok_or(ConnectError::Untrusted("user"))?;
        let sid = token_user_sid(own.as_raw_handle()).ok_or(ConnectError::Untrusted("user"))?;
        let name = format!(
            "{PIPE_PREFIX}{}",
            sid_string(&sid).ok_or(ConnectError::Absent)?
        );
        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
        let open = || {
            // SAFETY: a NUL-terminated name; the handle is owned below.
            unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    null(),
                    OPEN_EXISTING,
                    SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                    null_mut(),
                )
            }
        };
        let mut handle = open();
        if handle == INVALID_HANDLE_VALUE
            && io::Error::last_os_error().raw_os_error() == Some(ERROR_PIPE_BUSY as i32)
        {
            // Between two instances: wait for the next one, once.
            // SAFETY: a NUL-terminated name.
            if unsafe { WaitNamedPipeW(wide.as_ptr(), BUSY_WAIT_MS) } != 0 {
                handle = open();
            }
        }
        if handle == INVALID_HANDLE_VALUE {
            let error = io::Error::last_os_error();
            return Err(match error.raw_os_error().map(|code| code as u32) {
                Some(ERROR_FILE_NOT_FOUND) => ConnectError::Absent,
                Some(ERROR_PIPE_BUSY) => ConnectError::Refused("busy".into()),
                Some(ERROR_ACCESS_DENIED) => ConnectError::Untrusted("pipe access"),
                _ => ConnectError::Io(error),
            });
        }
        // SAFETY: a new handle.
        let file = unsafe { File::from_raw_handle(handle) };
        let mut server = 0u32;
        // SAFETY: a connected pipe handle.
        if unsafe { GetNamedPipeServerProcessId(file.as_raw_handle(), &mut server) } == 0 {
            return Err(ConnectError::Untrusted("server process"));
        }
        let token = process_token(Some(server)).ok_or(ConnectError::Untrusted("server process"))?;
        let server_sid = token_user_sid(token.as_raw_handle())
            .ok_or(ConnectError::Untrusted("server process"))?;
        // SAFETY: two valid SIDs of their own buffers.
        let same_user = unsafe {
            EqualSid(
                server_sid.as_ptr().cast_mut().cast(),
                sid.as_ptr().cast_mut().cast(),
            )
        } != 0;
        if !same_user {
            return Err(ConnectError::Untrusted("server user"));
        }
        if !token_trusted(token.as_raw_handle()) {
            return Err(ConnectError::Untrusted("server integrity"));
        }
        Ok(Stream {
            file,
            deadline: None,
        })
    }

    /// The token of this process (`None`) or of process `pid`.
    fn process_token(pid: Option<u32>) -> Option<OwnedHandle> {
        let process = match pid {
            None => None,
            Some(pid) => {
                // SAFETY: query-only access; the handle is owned below.
                let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
                if handle.is_null() {
                    return None;
                }
                // SAFETY: a new handle.
                Some(unsafe { OwnedHandle::from_raw_handle(handle) })
            }
        };
        // SAFETY: the pseudo-handle of this process needs no closing.
        let raw = process.as_ref().map_or_else(
            || unsafe { GetCurrentProcess() },
            |process| process.as_raw_handle(),
        );
        let mut token: HANDLE = null_mut();
        // SAFETY: a process handle with query access.
        if unsafe { OpenProcessToken(raw, TOKEN_QUERY, &mut token) } == 0 {
            return None;
        }
        // SAFETY: a new handle.
        Some(unsafe { OwnedHandle::from_raw_handle(token) })
    }

    fn token_information(token: HANDLE, class: i32) -> Option<Vec<u8>> {
        let mut size = 0u32;
        // SAFETY: a size query.
        unsafe { GetTokenInformation(token, class, null_mut(), 0, &mut size) };
        if size == 0 || size > 4096 {
            return None;
        }
        let mut buffer = vec![0u8; size as usize];
        // SAFETY: a buffer of `size` bytes.
        (unsafe { GetTokenInformation(token, class, buffer.as_mut_ptr().cast(), size, &mut size) }
            != 0)
            .then_some(buffer)
    }

    fn token_user_sid(token: HANDLE) -> Option<Vec<u8>> {
        let buffer = token_information(token, TokenUser)?;
        if buffer.len() < std::mem::size_of::<TOKEN_USER>() {
            return None;
        }
        // SAFETY: the buffer holds a TOKEN_USER whose SID points into it.
        let user: TOKEN_USER = unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast()) };
        if user.User.Sid.is_null() {
            return None;
        }
        // SAFETY: a valid SID.
        let length = unsafe { GetLengthSid(user.User.Sid) } as usize;
        if length == 0 || length > 256 {
            return None;
        }
        // SAFETY: `length` bytes of that SID.
        Some(unsafe { std::slice::from_raw_parts(user.User.Sid.cast::<u8>(), length) }.to_vec())
    }

    /// Medium integrity or above, not an AppContainer, not restricted.
    fn token_trusted(token: HANDLE) -> bool {
        let mut app_container = 1u32;
        let mut length = 0;
        // SAFETY: a u32 buffer of its size.
        let queried = unsafe {
            GetTokenInformation(
                token,
                TokenIsAppContainer,
                (&raw mut app_container).cast(),
                4,
                &mut length,
            )
        } != 0;
        // SAFETY: a token handle with query access.
        let restricted = unsafe { IsTokenRestricted(token) } != 0;
        queried
            && app_container == 0
            && !restricted
            && integrity(token).is_some_and(|rid| rid >= MEDIUM_INTEGRITY)
    }

    fn integrity(token: HANDLE) -> Option<u32> {
        let buffer = token_information(token, TokenIntegrityLevel)?;
        if buffer.len() < std::mem::size_of::<TOKEN_MANDATORY_LABEL>() {
            return None;
        }
        // SAFETY: the buffer holds a TOKEN_MANDATORY_LABEL whose SID points
        // into it.
        let label: TOKEN_MANDATORY_LABEL =
            unsafe { std::ptr::read_unaligned(buffer.as_ptr().cast()) };
        let sid = label.Label.Sid;
        if sid.is_null() {
            return None;
        }
        // SAFETY: a valid SID of the token's answer.
        let count = unsafe { *GetSidSubAuthorityCount(sid) };
        if count == 0 {
            return None;
        }
        // SAFETY: the last sub-authority of that SID.
        Some(unsafe { *GetSidSubAuthority(sid, u32::from(count) - 1) })
    }

    fn sid_string(sid: &[u8]) -> Option<String> {
        let mut text = null_mut();
        // SAFETY: a valid SID; the string is freed below.
        if unsafe { ConvertSidToStringSidW(sid.as_ptr().cast_mut().cast(), &mut text) } == 0 {
            return None;
        }
        // SAFETY: a NUL-terminated wide string from the conversion.
        let length = (0..)
            .take_while(|&at| unsafe { *text.add(at) } != 0)
            .count();
        // SAFETY: `length` characters of it.
        let value = String::from_utf16(unsafe { std::slice::from_raw_parts(text, length) }).ok();
        // SAFETY: allocated by the conversion.
        unsafe { LocalFree(text.cast()) };
        value
    }

    impl Stream {
        /// Bytes waiting in the pipe; `None` once the overlay closed it.
        fn available(&self) -> Option<u32> {
            let mut available = 0u32;
            // SAFETY: a peek of the byte count only.
            let ok = unsafe {
                PeekNamedPipe(
                    self.file.as_raw_handle(),
                    null_mut(),
                    0,
                    null_mut(),
                    &mut available,
                    null_mut(),
                )
            };
            (ok != 0).then_some(available)
        }

        pub fn receive(&mut self, timeout: Duration) -> Result<Option<ServerMessage>, FrameError> {
            let ready = wait(timeout, |left| {
                if self.available().is_none_or(|available| available > 0) {
                    return Ok(true);
                }
                std::thread::sleep(left.min(Duration::from_millis(20)));
                Ok(false)
            })?;
            if !ready {
                return Ok(None);
            }
            // A message that started arrives whole, within the frame delay:
            // reads never ask for more than the pipe holds, so a stalled
            // overlay cannot block them.
            self.deadline = Some(Instant::now() + FRAME_TIMEOUT);
            let message = read_server_message(self).map(Some);
            self.deadline = None;
            message
        }
    }

    impl Read for Stream {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            loop {
                let Some(available) = self.available() else {
                    // The overlay closed the pipe.
                    return Ok(0);
                };
                if available > 0 {
                    let length = buffer.len().min(available as usize);
                    return match self.file.read(&mut buffer[..length]) {
                        Err(error) if error.kind() == io::ErrorKind::BrokenPipe => Ok(0),
                        other => other,
                    };
                }
                if self
                    .deadline
                    .is_some_and(|deadline| Instant::now() >= deadline)
                {
                    return Err(io::ErrorKind::TimedOut.into());
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        }
    }

    impl Write for Stream {
        fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
            self.file.write(buffer)
        }

        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod transport {
    use std::io;
    use std::time::Duration;

    use overcrow_widget_devchannel::{FrameError, ServerMessage};

    use super::ConnectError;

    pub struct Stream;

    pub fn connect() -> Result<Stream, ConnectError> {
        Err(ConnectError::Absent)
    }

    impl Stream {
        pub fn receive(&mut self, _timeout: Duration) -> Result<Option<ServerMessage>, FrameError> {
            Err(FrameError::Closed)
        }
    }

    impl io::Read for Stream {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Ok(0)
        }
    }

    impl io::Write for Stream {
        fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
            Err(io::ErrorKind::Unsupported.into())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
}
