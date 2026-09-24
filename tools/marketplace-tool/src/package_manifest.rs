// MIT License. Copyright (c) 2026 Valhallab SASU.
// Public package validation mirrors the closed Web API v1 manifest contract.
use std::collections::BTreeSet;

use serde::Deserialize;

#[cfg(test)]
mod boundary_tests {
    use super::valid_capabilities;

    #[test]
    fn packages_cannot_request_built_in_widget_access() {
        for capability in [
            "stopwatch.read",
            "stopwatch.control",
            "notes.read",
            "notes.write",
            "playervox.score.read",
            "playervox.rating.read",
            "playervox.rating.write",
            "playervox.reviews.read",
            "playervox.followed.read",
            "journal.local.read",
            "journal.cloud.read",
            "journal.notes.read",
            "journal.notes.write",
            "journal.delete",
            "twitch.chat.read",
            "twitch.chat.compose",
        ] {
            assert!(
                !valid_capabilities(&[capability.to_owned()], false),
                "{capability}"
            );
        }
    }
}

pub(super) fn valid_capabilities(capabilities: &[String], egress: bool) -> bool {
    let mut unique = BTreeSet::new();
    capabilities.iter().all(|capability| {
        let sensitive = match capability.as_str() {
            "telemetry.read" | "fps.read" => false,
            "media.read" | "media.control" => true,
            _ => return false,
        };
        unique.insert(capability) && !(sensitive && egress)
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WirePresentation {
    sizing: WireSizing,
    #[serde(default)]
    options: Vec<WireOption>,
}

impl WirePresentation {
    pub(super) fn is_valid(&self) -> bool {
        let mut ids = BTreeSet::new();
        self.sizing.is_valid()
            && self.options.len() <= 16
            && self
                .options
                .iter()
                .all(|option| option.is_valid() && ids.insert(option.identity().0))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireSizing {
    mode: WireSizingMode,
    preferred: WireDimensions,
    min: WireDimensions,
    max: WireDimensions,
}

impl WireSizing {
    fn is_valid(&self) -> bool {
        let _ = self.mode;
        self.preferred.is_valid()
            && self.min.is_valid()
            && self.max.is_valid()
            && self.min.width <= self.preferred.width
            && self.min.height <= self.preferred.height
            && self.preferred.width <= self.max.width
            && self.preferred.height <= self.max.height
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WireSizingMode {
    Intrinsic,
    AutoHeight,
    Manual,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireDimensions {
    width: u32,
    height: u32,
}

impl WireDimensions {
    fn is_valid(&self) -> bool {
        (1..=4096).contains(&self.width) && (1..=4096).contains(&self.height)
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireLabel {
    en: String,
    fr: String,
}

impl WireLabel {
    fn is_valid(&self) -> bool {
        [&self.en, &self.fr].iter().all(|value| {
            !value.is_empty()
                && value.trim() == value.as_str()
                && value.chars().count() <= 80
                && !value.chars().any(char::is_control)
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireChoice {
    value: String,
    label: WireLabel,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum WireOption {
    Boolean {
        id: String,
        label: WireLabel,
        default: bool,
    },
    Enum {
        id: String,
        label: WireLabel,
        default: String,
        choices: Vec<WireChoice>,
    },
    Number {
        id: String,
        label: WireLabel,
        default: f64,
        min: f64,
        max: f64,
        step: f64,
    },
}

impl WireOption {
    fn identity(&self) -> (&str, &WireLabel) {
        match self {
            Self::Boolean { id, label, .. }
            | Self::Enum { id, label, .. }
            | Self::Number { id, label, .. } => (id, label),
        }
    }

    fn is_valid(&self) -> bool {
        let (id, label) = self.identity();
        if !valid_identifier(id) || !label.is_valid() {
            return false;
        }
        match self {
            Self::Boolean { default, .. } => {
                let _ = default;
                true
            }
            Self::Enum {
                default, choices, ..
            } => {
                let mut unique = BTreeSet::new();
                (2..=16).contains(&choices.len())
                    && choices.iter().all(|choice| {
                        valid_identifier(&choice.value)
                            && choice.label.is_valid()
                            && unique.insert(choice.value.as_str())
                    })
                    && unique.contains(default.as_str())
            }
            Self::Number {
                default,
                min,
                max,
                step,
                ..
            } => {
                [default, min, max, step]
                    .iter()
                    .all(|value| value.is_finite() && value.abs() <= 1_000_000.0)
                    && min < max
                    && min <= default
                    && default <= max
                    && *step > 0.0
                    && *step <= max - min
            }
        }
    }
}

fn valid_identifier(value: &str) -> bool {
    (1..=48).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}
