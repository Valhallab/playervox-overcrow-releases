//! `init`: writes a widget source project from a template of `templates/`,
//! embedded in the binary.

use std::fs;
use std::path::Path;

use overcrow_widget_schema::manifest::{is_reserved_id, valid_widget_id};

use crate::diag::Diagnostic;
use crate::sdk;

/// Files common to every template: (path in the project, content).
const SHARED: &[(&str, &str)] = &[
    ("LICENSE", include_str!("../../templates/shared/LICENSE")),
    (
        "package.json",
        include_str!("../../templates/shared/package.json"),
    ),
    (
        "tsconfig.json",
        include_str!("../../templates/shared/tsconfig.json"),
    ),
    (
        ".gitignore",
        include_str!("../../templates/shared/gitignore"),
    ),
];

/// Files of a template: (path in the project, content).
type Files = &'static [(&'static str, &'static str)];

/// The templates: (name, summary, files).
pub const TEMPLATES: &[(&str, &str, Files)] = &[
    (
        "blank",
        "a title and an empty state",
        &[
            (
                "manifest.json",
                include_str!("../../templates/blank/manifest.json"),
            ),
            ("view.ocml", include_str!("../../templates/blank/view.ocml")),
            (
                "style.ocss",
                include_str!("../../templates/blank/style.ocss"),
            ),
            ("logic.ts", include_str!("../../templates/blank/logic.ts")),
            (
                "locales/en.json",
                include_str!("../../templates/blank/locales/en.json"),
            ),
            (
                "locales/fr.json",
                include_str!("../../templates/blank/locales/fr.json"),
            ),
            (
                "tests/example.scenario.json",
                include_str!("../../templates/blank/tests/example.scenario.json"),
            ),
        ],
    ),
    (
        "counter",
        "a value and two buttons",
        &[
            (
                "manifest.json",
                include_str!("../../templates/counter/manifest.json"),
            ),
            (
                "view.ocml",
                include_str!("../../templates/counter/view.ocml"),
            ),
            (
                "style.ocss",
                include_str!("../../templates/counter/style.ocss"),
            ),
            ("logic.ts", include_str!("../../templates/counter/logic.ts")),
            (
                "locales/en.json",
                include_str!("../../templates/counter/locales/en.json"),
            ),
            (
                "locales/fr.json",
                include_str!("../../templates/counter/locales/fr.json"),
            ),
            (
                "tests/example.scenario.json",
                include_str!("../../templates/counter/tests/example.scenario.json"),
            ),
        ],
    ),
    (
        "list",
        "a keyed checklist with handlers taking arguments",
        &[
            (
                "manifest.json",
                include_str!("../../templates/list/manifest.json"),
            ),
            ("view.ocml", include_str!("../../templates/list/view.ocml")),
            (
                "style.ocss",
                include_str!("../../templates/list/style.ocss"),
            ),
            ("logic.ts", include_str!("../../templates/list/logic.ts")),
            (
                "locales/en.json",
                include_str!("../../templates/list/locales/en.json"),
            ),
            (
                "locales/fr.json",
                include_str!("../../templates/list/locales/fr.json"),
            ),
            (
                "tests/example.scenario.json",
                include_str!("../../templates/list/tests/example.scenario.json"),
            ),
        ],
    ),
    (
        "chart",
        "a live chart updated by a host timer",
        &[
            (
                "manifest.json",
                include_str!("../../templates/chart/manifest.json"),
            ),
            ("view.ocml", include_str!("../../templates/chart/view.ocml")),
            (
                "style.ocss",
                include_str!("../../templates/chart/style.ocss"),
            ),
            ("logic.ts", include_str!("../../templates/chart/logic.ts")),
            (
                "locales/en.json",
                include_str!("../../templates/chart/locales/en.json"),
            ),
            (
                "locales/fr.json",
                include_str!("../../templates/chart/locales/fr.json"),
            ),
            (
                "tests/example.scenario.json",
                include_str!("../../templates/chart/tests/example.scenario.json"),
            ),
        ],
    ),
];

/// Reference images of the templates' example scenarios: (template, path
/// in the project, PNG bytes). Written as they are; `blank` has none, since
/// its greeting shows the project's name. Regenerate them with the pinned
/// runtime (docs/widget-testing.md, "Maintaining the templates").
pub const REFERENCES: &[(&str, &str, &[u8])] = &[
    (
        "counter",
        "tests/reference/example/initial.png",
        include_bytes!("../../templates/counter/tests/reference/example/initial.png"),
    ),
    (
        "counter",
        "tests/reference/example/increased.png",
        include_bytes!("../../templates/counter/tests/reference/example/increased.png"),
    ),
    (
        "list",
        "tests/reference/example/initial.png",
        include_bytes!("../../templates/list/tests/reference/example/initial.png"),
    ),
    (
        "list",
        "tests/reference/example/french-light.png",
        include_bytes!("../../templates/list/tests/reference/example/french-light.png"),
    ),
    (
        "chart",
        "tests/reference/example/initial.png",
        include_bytes!("../../templates/chart/tests/reference/example/initial.png"),
    ),
    (
        "chart",
        "tests/reference/example/ten-seconds.png",
        include_bytes!("../../templates/chart/tests/reference/example/ten-seconds.png"),
    ),
];

pub struct Options<'a> {
    pub template: &'a str,
    pub id: Option<&'a str>,
    pub name: Option<&'a str>,
}

/// Writes the project into `directory`, which must be absent or empty.
/// Returns the paths written.
pub fn init(directory: &Path, options: &Options<'_>) -> Result<Vec<String>, Diagnostic> {
    let Some((_, _, files)) = TEMPLATES
        .iter()
        .find(|(name, _, _)| *name == options.template)
    else {
        let names: Vec<&str> = TEMPLATES.iter().map(|(name, _, _)| *name).collect();
        return Err(Diagnostic::error(
            "init.template",
            format!("there is no template `{}`", options.template),
        )
        .help(format!("templates: {}", names.join(", "))));
    };
    if directory.exists()
        && fs::read_dir(directory)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true)
    {
        return Err(Diagnostic::error(
            "init.not_empty",
            format!("{} exists and is not empty", directory.display()),
        )
        .help("choose a new directory; init never overwrites files"));
    }
    let slug = slug(directory);
    let id = match options.id {
        Some(id) => id.to_owned(),
        None => format!("com.example.{slug}"),
    };
    if !valid_widget_id(&id) || is_reserved_id(&id) {
        return Err(Diagnostic::error("init.id", format!("`{id}` is not a widget ID you can use"))
            .help("pass --id with a reverse-DNS ID you control, such as com.yourname.clock; com.playervox.* is reserved"));
    }
    let name = options.name.map_or_else(|| title(&slug), str::to_owned);
    if name.trim().is_empty() || name.chars().any(char::is_control) || name.len() > 64 {
        return Err(Diagnostic::error(
            "init.name",
            "the widget name must be 1 to 64 printable characters",
        ));
    }

    let mut written = Vec::new();
    for (path, content) in SHARED.iter().chain(files.iter()) {
        let json = path.ends_with(".json");
        let content = content
            .replace("{{id}}", &id)
            .replace("{{package}}", &slug)
            .replace("{{sdk}}", sdk::VERSION)
            .replace(
                "{{name}}",
                &if json { json_text(&name) } else { name.clone() },
            );
        let target = directory.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error(&target, error))?;
        }
        fs::write(&target, content).map_err(|error| io_error(&target, error))?;
        written.push((*path).to_owned());
    }
    for (_, path, bytes) in REFERENCES
        .iter()
        .filter(|(template, _, _)| *template == options.template)
    {
        let target = directory.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| io_error(&target, error))?;
        }
        fs::write(&target, bytes).map_err(|error| io_error(&target, error))?;
        written.push((*path).to_owned());
    }
    written.sort();
    Ok(written)
}

fn io_error(path: &Path, error: std::io::Error) -> Diagnostic {
    Diagnostic::error(
        "init.write",
        format!("cannot write {}: {error}", path.display()),
    )
}

/// The inside of a JSON string holding `text`.
fn json_text(text: &str) -> String {
    let quoted = serde_json::to_string(text).unwrap_or_default();
    quoted[1..quoted.len() - 1].to_owned()
}

/// A lowercase `[a-z0-9-]` label from the directory name, or `widget`.
fn slug(directory: &Path) -> String {
    let name = directory
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let mut slug = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    let slug: String = slug.chars().take(40).collect();
    let slug = slug.trim_end_matches('-').to_owned();
    if slug.is_empty() || slug.starts_with(|c: char| c.is_ascii_digit()) {
        format!(
            "widget{}",
            if slug.is_empty() {
                String::new()
            } else {
                format!("-{slug}")
            }
        )
    } else {
        slug
    }
}

/// `my-clock` -> `My clock`.
fn title(slug: &str) -> String {
    let text = slug.replace('-', " ");
    let mut chars = text.chars();
    chars
        .next()
        .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_package_names_and_titles() {
        assert_eq!(slug(Path::new("/tmp/My Clock!")), "my-clock");
        assert_eq!(slug(Path::new("42")), "widget-42");
        assert_eq!(slug(Path::new("")), "widget");
        assert_eq!(title("my-clock"), "My clock");
        assert_eq!(json_text("a \"b\""), "a \\\"b\\\"");
    }
}
