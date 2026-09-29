//! The shared test vectors of `vectors/v1.json`: every client frame and
//! server message is read as both ends of the channel read it.

use std::io::Cursor;
use std::path::PathBuf;

use overcrow_widget_devchannel::{
    ClientMessage, FrameError, LogLevel, MAX_CLIENT_HEADER_BYTES, MAX_LOG_TEXT_BYTES,
    MAX_SERVER_FRAME_BYTES, RequestBudget, ServerMessage, digest, encode_server_message,
    read_client_frame, read_server_message, write_client_frame,
};
use serde_json::Value;

fn vectors() -> Value {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let text = std::fs::read(root.join("vectors/v1.json")).expect("vectors");
    serde_json::from_slice(&text).expect("vectors JSON")
}

fn frame(case: &Value) -> Vec<u8> {
    if let Some(raw) = case["raw"].as_str() {
        return (0..raw.len())
            .step_by(2)
            .map(|at| u8::from_str_radix(&raw[at..at + 2], 16).expect("hex"))
            .collect();
    }
    let header = case["header"].as_str().expect("header");
    // A header of one char above U+007F stands for raw bytes (not UTF-8).
    let header: Vec<u8> = if header.is_ascii() {
        header.as_bytes().to_vec()
    } else {
        header.chars().map(|c| c as u32 as u8).collect()
    };
    let length = case["length"]
        .as_u64()
        .map_or(header.len() as u32, |length| length as u32);
    let mut bytes = length.to_be_bytes().to_vec();
    bytes.extend_from_slice(&header);
    if let Some(payload) = case["payload"].as_str() {
        bytes.extend_from_slice(payload.as_bytes());
    }
    bytes
}

fn outcome<T>(result: &Result<T, FrameError>) -> String {
    match result {
        Ok(_) => "ok".into(),
        Err(FrameError::Closed) => "closed".into(),
        Err(FrameError::Io(std::io::ErrorKind::UnexpectedEof)) => "eof".into(),
        Err(FrameError::Io(kind)) => format!("io:{kind:?}"),
        Err(FrameError::FrameSize) => "frameSize".into(),
        Err(FrameError::Malformed) => "malformed".into(),
        Err(FrameError::Invalid(what)) => format!("invalid:{what}"),
        Err(FrameError::Digest { .. }) => "digest".into(),
    }
}

#[test]
fn client_vectors() {
    let vectors = vectors();
    for case in vectors["client"].as_array().expect("client") {
        let bytes = frame(case);
        let mut input = Cursor::new(bytes.clone());
        let mut armed = false;
        let result = read_client_frame(&mut input, &mut |_| armed = true);
        let name = case["name"].as_str().expect("name");
        assert_eq!(outcome(&result), case["expect"], "{name}");
        if let Ok(read) = result {
            assert!(armed, "{name}: the deadline is armed once a frame starts");
            // Writing what was read gives the same bytes back.
            let mut written = Vec::new();
            write_client_frame(&mut written, &read.message, read.package.as_deref())
                .expect("rewrite");
            assert_eq!(written, bytes, "{name}");
        }
    }
}

#[test]
fn server_vectors() {
    let vectors = vectors();
    for case in vectors["server"].as_array().expect("server") {
        let bytes = frame(case);
        let result = read_server_message(&mut Cursor::new(bytes.clone()));
        let name = case["name"].as_str().expect("name");
        assert_eq!(outcome(&result), case["expect"], "{name}");
        if let Ok(message) = result {
            assert_eq!(
                encode_server_message(&message).expect("encode"),
                bytes,
                "{name}"
            );
        }
    }
}

#[test]
fn frames_follow_each_other_and_eof_between_them_is_a_close() {
    let mut stream = Vec::new();
    let package = b"package bytes".to_vec();
    write_client_frame(
        &mut stream,
        &ClientMessage::Install {
            request: 1,
            package_bytes: package.len() as u64,
            sha256: digest(&package),
        },
        Some(&package),
    )
    .expect("install");
    write_client_frame(&mut stream, &ClientMessage::Status { request: 2 }, None).expect("status");
    let mut input = Cursor::new(stream);
    let first = read_client_frame(&mut input, &mut |_| {}).expect("first");
    assert_eq!(first.package, Some(package));
    let second = read_client_frame(&mut input, &mut |_| {}).expect("second");
    assert_eq!(second.message, ClientMessage::Status { request: 2 });
    assert_eq!(
        read_client_frame(&mut input, &mut |_| {}),
        Err(FrameError::Closed)
    );
}

#[test]
fn a_digest_mismatch_leaves_the_stream_in_step() {
    let mut stream = Vec::new();
    let install = ClientMessage::Install {
        request: 4,
        package_bytes: 3,
        sha256: digest(b"abc"),
    };
    write_client_frame(&mut stream, &install, Some(b"abc")).expect("install");
    // Corrupt the package in transit.
    let last = stream.len() - 1;
    stream[last] = b'd';
    write_client_frame(&mut stream, &ClientMessage::Status { request: 5 }, None).expect("status");
    let mut input = Cursor::new(stream);
    let error = read_client_frame(&mut input, &mut |_| {}).expect_err("digest");
    assert_eq!(error, FrameError::Digest { request: 4 });
    assert!(error.recoverable());
    assert_eq!(
        read_client_frame(&mut input, &mut |_| {})
            .expect("next")
            .message,
        ClientMessage::Status { request: 5 }
    );
}

#[test]
fn the_writer_refuses_what_the_reader_would() {
    let mut sink = Vec::new();
    let install = ClientMessage::Install {
        request: 1,
        package_bytes: 3,
        sha256: digest(b"abc"),
    };
    assert!(write_client_frame(&mut sink, &install, None).is_err());
    assert!(write_client_frame(&mut sink, &install, Some(b"abcd")).is_err());
    assert!(
        write_client_frame(&mut sink, &ClientMessage::Status { request: 1 }, Some(b"x")).is_err()
    );
    assert!(
        write_client_frame(
            &mut sink,
            &ClientMessage::Remove {
                request: 1,
                id: "not an id".into()
            },
            None
        )
        .is_err()
    );
    assert!(sink.is_empty());
    let hello = ClientMessage::Hello {
        protocol: 1,
        client: "x".repeat(MAX_CLIENT_HEADER_BYTES as usize),
    };
    assert!(write_client_frame(&mut sink, &hello, None).is_err());
}

#[test]
fn the_longest_log_fits_a_server_frame() {
    // Every byte of the text escaped as \u00XX.
    let text = "\u{1}".repeat(MAX_LOG_TEXT_BYTES as usize);
    let frame = encode_server_message(&ServerMessage::Log {
        id: format!("com.example.{}", "a".repeat(60)),
        generation: u64::MAX,
        level: LogLevel::Error,
        text,
    })
    .expect("fits");
    assert!(frame.len() <= MAX_SERVER_FRAME_BYTES as usize + 4);
    let too_long = ServerMessage::Log {
        id: "com.example.clock".into(),
        generation: 1,
        level: LogLevel::Info,
        text: "x".repeat(MAX_LOG_TEXT_BYTES as usize + 1),
    };
    assert_eq!(
        encode_server_message(&too_long),
        Err(FrameError::Invalid("value"))
    );
}

#[test]
fn the_request_budget_allows_a_burst_then_the_rate() {
    let mut budget = RequestBudget::new(1_000);
    for _ in 0..20 {
        assert!(budget.take(1_000));
    }
    assert!(!budget.take(1_000));
    // 100 ms give one request back at 10 per second.
    assert!(budget.take(1_100));
    assert!(!budget.take(1_100));
    // A clock that goes back refills nothing and never underflows.
    assert!(!budget.take(0));
    // A long pause refills the burst, never more.
    for _ in 0..20 {
        assert!(budget.take(1_000_000));
    }
    assert!(!budget.take(1_000_000));
}
