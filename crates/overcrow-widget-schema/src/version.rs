//! Package versions: SemVer 2.0.0 without build metadata, in canonical form.
//!
//! Build metadata is rejected because SemVer ignores it for precedence: two
//! different packages would compare equal, and "never downgrade" could not be
//! decided. Numeric parts stay below 2^53 so that JavaScript reads them
//! exactly.

use std::cmp::Ordering;
use std::fmt;

use crate::limits::MAX_VERSION_BYTES;

const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Version {
    major: u64,
    minor: u64,
    patch: u64,
    pre: Vec<Identifier>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum Identifier {
    Numeric(u64),
    Alphanumeric(String),
}

impl Version {
    /// Parses `MAJOR.MINOR.PATCH[-PRERELEASE]`; anything else, including a
    /// leading `v`, leading zeros or `+build`, is rejected.
    pub fn parse(text: &str) -> Option<Self> {
        if text.is_empty() || text.len() as u64 > MAX_VERSION_BYTES.value {
            return None;
        }
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) => (core, Some(pre)),
            None => (text, None),
        };
        let mut parts = core.split('.');
        let major = numeric(parts.next()?)?;
        let minor = numeric(parts.next()?)?;
        let patch = numeric(parts.next()?)?;
        if parts.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(pre) => pre.split('.').map(identifier).collect::<Option<Vec<_>>>()?,
        };
        Some(Self {
            major,
            minor,
            patch,
            pre,
        })
    }
}

fn numeric(text: &str) -> Option<u64> {
    let canonical = !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'));
    canonical
        .then(|| text.parse().ok())
        .flatten()
        .filter(|value| *value <= MAX_SAFE_INTEGER)
}

fn identifier(text: &str) -> Option<Identifier> {
    if text.is_empty()
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return None;
    }
    if text.bytes().all(|byte| byte.is_ascii_digit()) {
        numeric(text).map(Identifier::Numeric)
    } else {
        Some(Identifier::Alphanumeric(text.to_owned()))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> Ordering {
        (self.major, self.minor, self.patch)
            .cmp(&(other.major, other.minor, other.patch))
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => self.pre.cmp(&other.pre),
            })
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Identifier {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self, other) {
            (Self::Numeric(a), Self::Numeric(b)) => a.cmp(b),
            (Self::Numeric(_), Self::Alphanumeric(_)) => Ordering::Less,
            (Self::Alphanumeric(_), Self::Numeric(_)) => Ordering::Greater,
            (Self::Alphanumeric(a), Self::Alphanumeric(b)) => a.cmp(b),
        }
    }
}

impl PartialOrd for Identifier {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl fmt::Display for Version {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}.{}.{}", self.major, self.minor, self.patch)?;
        for (index, part) in self.pre.iter().enumerate() {
            formatter.write_str(if index == 0 { "-" } else { "." })?;
            match part {
                Identifier::Numeric(value) => write!(formatter, "{value}")?,
                Identifier::Alphanumeric(value) => formatter.write_str(value)?,
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Version;

    #[test]
    fn precedence_follows_semver() {
        let ordered = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.1.0",
            "2.0.0",
        ];
        for pair in ordered.windows(2) {
            let (low, high) = (Version::parse(pair[0]), Version::parse(pair[1]));
            assert!(low.is_some() && high.is_some(), "{pair:?} parse");
            assert!(low < high, "{} < {}", pair[0], pair[1]);
        }
    }

    #[test]
    fn only_canonical_versions_parse() {
        for valid in [
            "0.0.0",
            "1.2.3",
            "10.20.30",
            "1.0.0-0.3.7",
            "1.0.0-x-y-z.--",
        ] {
            let version = Version::parse(valid).expect(valid);
            assert_eq!(version.to_string(), valid);
        }
        for invalid in [
            "",
            "1",
            "1.2",
            "1.2.3.4",
            "v1.2.3",
            "01.2.3",
            "1.02.3",
            "1.2.3-",
            "1.2.3-01",
            "1.2.3-a..b",
            "1.2.3+build",
            "1.2.3-a+b",
            " 1.2.3",
            "1.2.3-é",
            "9007199254740992.0.0",
        ] {
            assert_eq!(Version::parse(invalid), None, "{invalid:?}");
        }
    }
}
