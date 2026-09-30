//! `inspect`: what a `.ocpkg` contains and asks for, in plain words, for its
//! author and for a reviewer. The package is validated first with the
//! host's reader; nothing is shown from a package it refuses.

use std::fmt::Write as _;

use overcrow_widget_schema::package::{Package, hex, sha256};
use overcrow_widget_schema::permissions::capability_named;
use serde_json::{Value, json};

/// The SDK version named by the notice of a bundle built by this CLI.
fn linked_sdk(package: &Package) -> Option<String> {
    let logic = package.file("logic.js")?;
    let first = logic.split(|byte| *byte == b'\n').next()?;
    let text = std::str::from_utf8(first).ok()?;
    let rest = text.strip_prefix("/*! @overcrow/sdk ")?;
    Some(rest.split_whitespace().next()?.to_owned())
}

fn text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// One network rule in words: `GET https://api.example.com/v1/{city}`,
/// with its parameter constraints.
fn network_rule(rule: &Value) -> String {
    let mut out = format!(
        "{} {}{}",
        text(&rule["method"]),
        text(&rule["origin"]),
        text(&rule["path"])
    );
    if let Some(bound) = rule.get("maxResponseBytes") {
        let _ = write!(out, "\n      responses up to {bound} bytes");
    }
    for (key, label) in [("pathParams", "path"), ("queryParams", "query")] {
        if let Some(params) = rule.get(key).and_then(Value::as_object) {
            for (name, constraint) in params {
                let _ = write!(out, "\n      {label} {name}: {}", constraint);
            }
        }
    }
    out
}

pub fn render(package: &Package, archive_len: usize) -> String {
    let manifest = &package.manifest;
    let value = &manifest.value;
    let mut out = String::new();
    let _ = writeln!(
        out,
        "{} {} - {} / {}",
        manifest.id,
        manifest.version,
        text(&value["name"]["en"]),
        text(&value["name"]["fr"])
    );
    let _ = writeln!(
        out,
        "archive   {archive_len} bytes, sha256 {}",
        hex(&package.digest)
    );
    let _ = writeln!(
        out,
        "SDK       {}",
        linked_sdk(package).map_or(
            "not built by overcrow-widget (no SDK notice)".to_owned(),
            |version| { format!("@overcrow/sdk {version}") }
        )
    );
    let _ = writeln!(
        out,
        "VM heap   {} MiB{}",
        manifest.heap_bytes / (1024 * 1024),
        if value.get("vm").is_some() {
            ""
        } else {
            " (default)"
        }
    );
    if manifest.has_reserved_id() {
        let _ = writeln!(
            out,
            "reserved  com.playervox.* ID: only PlayerVox-signed catalogs accept it"
        );
    }

    let permissions = &manifest.permissions;
    let _ = writeln!(out, "\nPermissions (what the widget may reach)");
    let network = value["permissions"]["network"].as_array();
    match network.filter(|rules| !rules.is_empty()) {
        Some(rules) => {
            let _ = writeln!(
                out,
                "  network         {} HTTPS route(s) through the host broker:",
                rules.len()
            );
            for rule in rules {
                let _ = writeln!(out, "    - {}", network_rule(rule));
            }
        }
        None => {
            let _ = writeln!(out, "  network         none");
        }
    }
    let _ = writeln!(
        out,
        "  storage         {}",
        if permissions.storage {
            if permissions.has_sensitive_capability() {
                "yes, for the process lifetime only (sensitive capability)"
            } else {
                "yes: host-managed storage for this widget"
            }
        } else {
            "no"
        }
    );
    let _ = writeln!(
        out,
        "  clipboardWrite  {}",
        if permissions.clipboard_write {
            "yes, on a user gesture"
        } else {
            "no"
        }
    );
    if permissions.game_events.is_empty() {
        let _ = writeln!(out, "  gameEvents      none");
    } else {
        let _ = writeln!(
            out,
            "  gameEvents      {}",
            permissions
                .game_events
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    let _ = writeln!(out, "\nCapabilities (each needs the user's consent)");
    if permissions.capabilities.is_empty() {
        let _ = writeln!(out, "  none");
    }
    for name in &permissions.capabilities {
        let capability = capability_named(name);
        let mut notes = Vec::new();
        if capability.is_some_and(|capability| capability.sensitive) {
            notes.push("sensitive".to_owned());
        }
        if let Some(account) = capability.and_then(|capability| capability.account) {
            notes.push(format!("needs a {account} account"));
        }
        let notes = if notes.is_empty() {
            String::new()
        } else {
            format!(" [{}]", notes.join(", "))
        };
        let _ = writeln!(
            out,
            "  {name}{notes}\n      {}",
            capability.map_or("", |capability| capability.summary)
        );
    }
    if let Some(menu) = value["wrapper"]["menu"].as_array() {
        let _ = writeln!(out, "\nMenu rows       {}", menu.len());
    }

    let _ = writeln!(out, "\nFiles (ledger: SHA-256 and size of every entry)");
    for path in package.paths() {
        let bytes = package.file(path).unwrap_or_default();
        let _ = writeln!(out, "  {:>8}  {}  {path}", bytes.len(), hex(&sha256(bytes)));
    }
    out
}

pub fn render_json(package: &Package, archive_len: usize) -> String {
    let files: Vec<Value> = package
        .paths()
        .map(|path| {
            let bytes = package.file(path).unwrap_or_default();
            json!({"path": path, "bytes": bytes.len(), "sha256": hex(&sha256(bytes))})
        })
        .collect();
    let permissions = &package.manifest.permissions;
    json!({
        "id": package.manifest.id,
        "version": package.manifest.version.to_string(),
        "archive": {"bytes": archive_len, "sha256": hex(&package.digest)},
        "sdk": linked_sdk(package),
        "heapBytes": package.manifest.heap_bytes,
        "permissions": {
            "network": package.manifest.value["permissions"]["network"].as_array().cloned().unwrap_or_default(),
            "storage": permissions.storage,
            "clipboardWrite": permissions.clipboard_write,
            "gameEvents": permissions.game_events,
            "capabilities": permissions.capabilities,
        },
        "manifest": package.manifest.value,
        "files": files,
    })
    .to_string()
}
