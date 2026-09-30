//! `load_assets` reads a scenario's images from the project only: plain
//! relative paths, no link on the way, PNG or JPEG files within the host's
//! image bounds.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use overcrow_widget_scenario::load_assets;
use overcrow_widget_schema::limits::{MAX_IMAGE_EDGE_PX, MAX_IMAGE_ENCODED_BYTES};

/// A project directory removed at the end of the test.
struct Project(PathBuf);

impl Project {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "overcrow-scenario-assets-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("tests/assets")).expect("project");
        Self(root)
    }

    fn write(&self, path: &str, bytes: &[u8]) {
        std::fs::write(self.0.join(path), bytes).expect("write");
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A PNG header of this size; the rest of the file does not matter here.
fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    bytes.extend_from_slice(&width.to_be_bytes());
    bytes.extend_from_slice(&height.to_be_bytes());
    bytes.extend_from_slice(&[8, 6, 0, 0, 0]);
    bytes
}

fn one(path: &str) -> BTreeMap<String, String> {
    BTreeMap::from([("cover".to_owned(), path.to_owned())])
}

fn error(project: &Path, path: &str) -> String {
    let error = load_assets(project, &one(path)).expect_err(path);
    assert_eq!(error.path, "assets.cover", "{path}");
    error.message
}

#[test]
fn images_of_the_project_are_read_by_name() {
    let project = Project::new("read");
    project.write("tests/assets/cover.png", &png(64, 64));
    let loaded = load_assets(&project.0, &one("tests/assets/cover.png")).expect("loaded");
    assert_eq!(loaded["cover"], png(64, 64));
    assert!(
        load_assets(&project.0, &BTreeMap::new())
            .expect("none")
            .is_empty()
    );
}

#[test]
fn missing_foreign_and_unbounded_files_are_refused() {
    let project = Project::new("refused");
    let edge = u32::try_from(MAX_IMAGE_EDGE_PX.value).expect("edge");
    project.write("tests/assets/wide.png", &png(edge + 1, 16));
    project.write("tests/assets/empty.png", &png(0, 16));
    project.write("tests/assets/cover.gif", b"GIF89a\x10\x00\x10\x00");
    let limit = usize::try_from(MAX_IMAGE_ENCODED_BYTES.value).expect("limit");
    let mut large = png(16, 16);
    large.resize(limit + 1, 0);
    project.write("tests/assets/large.png", &large);
    assert!(error(&project.0, "tests/assets/none.png").contains("does not exist"));
    assert!(error(&project.0, "tests/assets").contains("regular file"));
    assert!(error(&project.0, "tests/assets/wide.png").contains("MAX_IMAGE_EDGE_PX"));
    assert!(error(&project.0, "tests/assets/empty.png").contains("MAX_IMAGE_EDGE_PX"));
    assert!(error(&project.0, "tests/assets/cover.gif").contains("PNG or JPEG"));
    assert!(error(&project.0, "tests/assets/large.png").contains("MAX_IMAGE_ENCODED_BYTES"));
    assert!(error(&project.0, "../cover.png").contains("relative"));
}

#[cfg(unix)]
#[test]
fn links_are_refused_anywhere_on_the_path() {
    let project = Project::new("links");
    let outside = Project::new("outside");
    outside.write("tests/assets/cover.png", &png(16, 16));
    std::os::unix::fs::symlink(
        outside.0.join("tests/assets/cover.png"),
        project.0.join("tests/assets/link.png"),
    )
    .expect("file link");
    std::os::unix::fs::symlink(outside.0.join("tests"), project.0.join("elsewhere"))
        .expect("directory link");
    assert!(error(&project.0, "tests/assets/link.png").contains("links"));
    assert!(error(&project.0, "elsewhere/assets/cover.png").contains("links"));
}
