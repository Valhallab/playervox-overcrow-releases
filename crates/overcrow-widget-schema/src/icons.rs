//! The closed icon set (ADR 0001, D12): every icon of the pinned
//! `egui-lucide` crate, which is the host's only icon source, and nothing
//! else. The same set serves the `icon` element and `wrapper.menu` rows; a
//! widget never supplies SVG or icon images. Within API v1 the set may grow
//! with a crate update but never loses or renames a name.
//!
//! `icons_generated.rs` is written by `scripts/generate-widget-icons.py` from
//! the crate's own name table.

#[path = "icons_generated.rs"]
mod generated;

pub use generated::{ICON_CRATE, ICONS, LUCIDE_VERSION};

pub fn is_icon(name: &str) -> bool {
    ICONS.binary_search(&name).is_ok()
}
