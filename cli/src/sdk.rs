//! The `@overcrow/sdk` sources this CLI links into every `logic.js`: the
//! TypeScript of `sdk/src/` at the revision the CLI is built from, so a
//! bundle depends only on the widget's sources and the CLI version, offline
//! and reproducibly. `node_modules/@overcrow/sdk` only gives the types to
//! `tsc`; `check` warns when its version differs from this one.

/// Version of the embedded SDK (`sdk/package.json`).
pub const VERSION: &str = "1.0.0";

/// The courtesy line at the top of every bundle. The SDK is MIT-0, so its
/// copies need no notice; the line names the linked version for reviewers
/// and for `inspect`.
pub const NOTICE: &str = "/*! @overcrow/sdk 1.0.0 | MIT-0 | Copyright (c) 2026 Valhallab SASU */";

/// The SDK entry module.
pub const ENTRY: &str = "index.ts";

/// Every module of `sdk/src/`, by path relative to it.
pub const MODULES: &[(&str, &str)] = &[
    ("draw.ts", include_str!("../../sdk/src/draw.ts")),
    ("format.ts", include_str!("../../sdk/src/format.ts")),
    (
        "generated/icons.ts",
        include_str!("../../sdk/src/generated/icons.ts"),
    ),
    (
        "generated/limits.ts",
        include_str!("../../sdk/src/generated/limits.ts"),
    ),
    (
        "generated/schema.ts",
        include_str!("../../sdk/src/generated/schema.ts"),
    ),
    (
        "generated/services.ts",
        include_str!("../../sdk/src/generated/services.ts"),
    ),
    ("host.ts", include_str!("../../sdk/src/host.ts")),
    ("http.ts", include_str!("../../sdk/src/http.ts")),
    ("i18n.ts", include_str!("../../sdk/src/i18n.ts")),
    ("index.ts", include_str!("../../sdk/src/index.ts")),
    ("log.ts", include_str!("../../sdk/src/log.ts")),
    ("menu.ts", include_str!("../../sdk/src/menu.ts")),
    ("runtime.ts", include_str!("../../sdk/src/runtime.ts")),
    ("services.ts", include_str!("../../sdk/src/services.ts")),
    ("state.ts", include_str!("../../sdk/src/state.ts")),
    ("timers.ts", include_str!("../../sdk/src/timers.ts")),
    ("view.ts", include_str!("../../sdk/src/view.ts")),
];

pub fn module(path: &str) -> Option<&'static str> {
    MODULES
        .iter()
        .find(|(name, _)| *name == path)
        .map(|(_, source)| *source)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn sdk_root() -> PathBuf {
        PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("run by cargo")).join("../sdk")
    }

    #[test]
    fn every_source_module_is_embedded() {
        let mut found = Vec::new();
        let mut stack = vec![sdk_root().join("src")];
        while let Some(directory) = stack.pop() {
            for entry in std::fs::read_dir(&directory).expect("sdk/src") {
                let path = entry.expect("entry").path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.extension().is_some_and(|extension| extension == "ts") {
                    let relative = path.strip_prefix(sdk_root().join("src")).expect("inside");
                    found.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        found.sort();
        let embedded: Vec<&str> = MODULES.iter().map(|(path, _)| *path).collect();
        assert_eq!(
            found, embedded,
            "regenerate the MODULES table of cli/src/sdk.rs"
        );
    }

    #[test]
    fn version_and_notice_match_the_package() {
        let package: serde_json::Value = serde_json::from_slice(
            &std::fs::read(sdk_root().join("package.json")).expect("package.json"),
        )
        .expect("JSON");
        assert_eq!(package["version"], VERSION);
        assert!(
            module("runtime.ts")
                .is_some_and(|source| source.contains(&format!("SDK_VERSION = \"{VERSION}\"")))
        );
        let license = std::fs::read_to_string(sdk_root().join("LICENSE")).expect("LICENSE");
        let copyright = license
            .lines()
            .find(|line| line.starts_with("Copyright"))
            .expect("copyright line");
        assert!(NOTICE.contains(&format!("@overcrow/sdk {VERSION}")));
        assert!(NOTICE.contains(package["license"].as_str().expect("license")));
        assert!(NOTICE.contains(copyright), "{copyright}");
    }
}
