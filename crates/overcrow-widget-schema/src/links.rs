//! Web pages a widget opens in the user's browser (`permissions.links`,
//! `links.open`). A rule names a site and, optionally, the part of it the
//! widget may open; the host opens an address only on the user's click,
//! shows it, and asks the user the first time for each site of each
//! widget.
//!
//! The host parses the address with its URL parser, then calls
//! [`link_allowed`] with the origin and the path the parser gives: this
//! crate fixes which canonical paths a rule allows, for the host and the
//! test runtime alike.

use std::collections::BTreeSet;

use serde_json::Value;

use crate::json::has_exact_fields;
use crate::limits::{MAX_LINK_PREFIX_BYTES, MAX_LINK_RULES};
use crate::manifest::{ManifestError, canonical_https_origin, valid_literal_segment};
use crate::model::{Field, ValueType};

/// A manifest with `permissions.links`: a reader that does not open links
/// skips the target.
pub const FEATURE_OPEN_LINKS: &str = "open-links";

/// One link rule.
pub const LINK_RULE_FIELDS: &[Field] = &[
    Field::required(
        "origin",
        ValueType::Record("origin"),
        "Canonical `https://host[:port]` origin, as in a network rule: no credentials, IP literal or local name.",
    ),
    Field::optional(
        "pathPrefix",
        ValueType::Text(&MAX_LINK_PREFIX_BYTES),
        "The part of the site the widget may open: `/` and literal segments (ASCII letters, digits, `.`, `_`, `~` and `-`; no `.` or `..` segment), with or without a final `/`. `/runs/` allows `/runs/` and what is below it; `/app` allows `/app` and what is below `/app/`, not `/apps`. Default `/`, the whole site.",
    ),
];

/// A validated link rule.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub struct LinkRule {
    /// `https://host[:port]`, canonical.
    pub origin: String,
    /// Starts with `/`; `/` for the whole site.
    pub path_prefix: String,
}

impl LinkRule {
    /// The rule's host, without its port.
    pub fn host(&self) -> &str {
        host_of(&self.origin)
    }

    /// Whether the rule allows a canonical path of its origin.
    fn admits(&self, path: &str) -> bool {
        covers(&self.path_prefix, path)
    }
}

/// The rule of `rules` that allows the address of this origin and path, if
/// any. `origin` is the parsed address's `https://host[:port]` (default
/// port omitted), `path` its path as the URL parser gives it; a path
/// [`canonical_link_path`] refuses is never allowed. Query and fragment
/// are free.
pub fn link_allowed<'a>(rules: &'a [LinkRule], origin: &str, path: &str) -> Option<&'a LinkRule> {
    if !canonical_link_path(path) {
        return None;
    }
    rules
        .iter()
        .find(|rule| rule.origin == origin && rule.admits(path))
}

/// A path in the form a URL parser gives and a rule can match: `/`, then
/// literal segments separated by `/`, the last one possibly empty (a final
/// `/`). No empty segment elsewhere, no `.` or `..` segment, no percent
/// sign, backslash, query or fragment.
pub fn canonical_link_path(path: &str) -> bool {
    let Some(rest) = path.strip_prefix('/') else {
        return false;
    };
    let parts: Vec<&str> = rest.split('/').collect();
    parts.iter().enumerate().all(|(index, part)| {
        valid_literal_segment(part) || (part.is_empty() && index == parts.len() - 1)
    })
}

/// Whether `prefix` allows `path`, both canonical: a prefix ending with `/`
/// allows what starts with it; any other allows itself and what is below
/// it.
fn covers(prefix: &str, path: &str) -> bool {
    if prefix.ends_with('/') {
        path.starts_with(prefix)
    } else {
        path == prefix
            || path
                .strip_prefix(prefix)
                .is_some_and(|rest| rest.starts_with('/'))
    }
}

fn host_of(origin: &str) -> &str {
    let authority = origin.strip_prefix("https://").unwrap_or(origin);
    authority.split(':').next().unwrap_or(authority)
}

/// `permissions.links`: distinct rules, at most `MAX_LINK_RULES`, none
/// that another of the same origin covers.
pub(crate) fn validate_links(value: Option<&Value>) -> Result<BTreeSet<LinkRule>, ManifestError> {
    let invalid = ManifestError::LinkRule;
    let Some(value) = value else {
        return Ok(BTreeSet::new());
    };
    let list = value.as_array().ok_or(ManifestError::Shape)?;
    if list.len() as u64 > MAX_LINK_RULES.value {
        return Err(invalid);
    }
    let mut rules = BTreeSet::new();
    for entry in list {
        let object = entry.as_object().ok_or(ManifestError::Shape)?;
        if !has_exact_fields(object, &[LINK_RULE_FIELDS]) {
            return Err(ManifestError::Shape);
        }
        let origin = object["origin"].as_str().ok_or(ManifestError::Shape)?;
        let prefix = match object.get("pathPrefix") {
            None => "/",
            Some(prefix) => prefix.as_str().ok_or(ManifestError::Shape)?,
        };
        if !canonical_https_origin(origin)
            || prefix.len() as u64 > MAX_LINK_PREFIX_BYTES.value
            || !canonical_link_path(prefix)
        {
            return Err(invalid);
        }
        let rule = LinkRule {
            origin: origin.to_owned(),
            path_prefix: prefix.to_owned(),
        };
        let overlaps = rules.iter().any(|other: &LinkRule| {
            other.origin == rule.origin
                && (covers(&other.path_prefix, &rule.path_prefix)
                    || covers(&rule.path_prefix, &other.path_prefix))
        });
        if overlaps {
            return Err(invalid);
        }
        rules.insert(rule);
    }
    Ok(rules)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn covers_whole_segments() {
        assert!(covers("/", "/"));
        assert!(covers("/", "/a"));
        assert!(covers("/a/", "/a/"));
        assert!(covers("/a/", "/a/b"));
        assert!(!covers("/a/", "/a"));
        assert!(covers("/a", "/a"));
        assert!(covers("/a", "/a/"));
        assert!(covers("/a", "/a/b"));
        assert!(!covers("/a", "/ab"));
        assert_eq!(host_of("https://a.example:8443"), "a.example");
        assert_eq!(host_of("https://a.example"), "a.example");
    }
}
