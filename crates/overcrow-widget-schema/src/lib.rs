//! Single source of truth for widget API v1 (ADR 0001, D8): view elements,
//! style subset, design tokens, icons, the manifest and its `wrapper.menu`
//! section, permissions, capabilities, services, IPC messages, the package
//! and catalog formats (P0.5) and every numeric bound.
//!
//! The tables are plain `const` data compiled unchanged into the host, the
//! creator CLI and the Studio WebAssembly bundle. `reference::markdown`
//! renders them as `docs/widget-schema-v1.md`. Anything absent from these
//! tables is rejected; values marked provisional await the named lot.

pub mod catalog;
pub mod compiled_view;
pub mod icons;
pub mod ipc;
pub mod json;
pub mod limits;
pub mod manifest;
pub mod model;
pub mod package;
pub mod permissions;
pub mod reference;
pub mod results;
pub mod services;
pub mod style;
pub mod tokens;
pub mod typescript;
pub mod version;
pub mod view;
pub mod wrapper;

pub use model::{Field, Limit, Status, Unit, ValueType};

/// The only widget API version. `apiVersion` selects the schema; any other
/// value, including a legacy Web manifest, is rejected.
pub const API_VERSION: u64 = 1;

pub const fn is_supported_api_version(version: u64) -> bool {
    version == API_VERSION
}
