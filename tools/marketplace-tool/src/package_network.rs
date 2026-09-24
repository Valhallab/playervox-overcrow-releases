use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    marker::PhantomData,
};

use serde::{Deserialize, Deserializer, de};

// Ordered maps and sets make semantic duplicate detection independent of JSON
// key order, enum value order, and omitted optional false/empty fields.
#[derive(Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WireNetworkPermission {
    pub(super) origin: String,
    method: NetworkMethod,
    path: String,
    #[serde(default, deserialize_with = "deserialize_unique_map")]
    path_params: BTreeMap<String, PathConstraint>,
    #[serde(default, deserialize_with = "deserialize_unique_map")]
    query_params: BTreeMap<String, QueryConstraint>,
}

impl WireNetworkPermission {
    pub(super) fn is_valid(&self) -> bool {
        if self.path_params.len() > 8
            || self.query_params.len() > 16
            || !self
                .path_params
                .iter()
                .all(|(name, constraint)| valid_parameter_name(name) && constraint.is_valid())
            || !self
                .query_params
                .iter()
                .all(|(name, constraint)| valid_parameter_name(name) && constraint.is_valid())
            || !(2..=1024).contains(&self.path.len())
            || !self.path.starts_with('/')
            || !self.path.is_ascii()
            || self.path.contains("//")
        {
            return false;
        }
        let mut placeholders = BTreeSet::new();
        self.path[1..]
            .trim_end_matches('/')
            .split('/')
            .all(|segment| {
                if let Some(name) = segment
                    .strip_prefix('{')
                    .and_then(|value| value.strip_suffix('}'))
                {
                    valid_parameter_name(name)
                        && self.path_params.contains_key(name)
                        && placeholders.insert(name)
                } else {
                    valid_unreserved(segment)
                }
            })
            && placeholders.len() == self.path_params.len()
    }
}

#[derive(Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
enum NetworkMethod {
    #[serde(rename = "GET")]
    Get,
    #[serde(rename = "POST")]
    Post,
    #[serde(rename = "PUT")]
    Put,
    #[serde(rename = "PATCH")]
    Patch,
    #[serde(rename = "DELETE")]
    Delete,
}

#[derive(Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum PathConstraint {
    Integer {
        min: SafeInteger,
        max: SafeInteger,
    },
    Slug {
        #[serde(rename = "maxLength")]
        max_length: SafeInteger,
    },
    Enum {
        #[serde(deserialize_with = "deserialize_unique_values")]
        values: BTreeSet<String>,
    },
}

impl PathConstraint {
    fn is_valid(&self) -> bool {
        match self {
            Self::Integer { min, max } => min <= max,
            Self::Slug { max_length } => (1..=128).contains(&max_length.0),
            Self::Enum { values } => valid_enum(values),
        }
    }
}

#[derive(Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
enum QueryConstraint {
    Integer {
        min: SafeInteger,
        max: SafeInteger,
        #[serde(default)]
        required: bool,
    },
    Slug {
        #[serde(rename = "maxLength")]
        max_length: SafeInteger,
        #[serde(default)]
        required: bool,
    },
    Enum {
        #[serde(deserialize_with = "deserialize_unique_values")]
        values: BTreeSet<String>,
        #[serde(default)]
        required: bool,
    },
    String {
        #[serde(rename = "maxLength")]
        max_length: SafeInteger,
        #[serde(default)]
        required: bool,
    },
}

impl QueryConstraint {
    fn is_valid(&self) -> bool {
        match self {
            Self::Integer { min, max, .. } => min <= max,
            Self::Slug { max_length, .. } => (1..=128).contains(&max_length.0),
            Self::Enum { values, .. } => valid_enum(values),
            Self::String { max_length, .. } => (1..=256).contains(&max_length.0),
        }
    }
}

#[derive(Debug, Eq, Ord, PartialEq, PartialOrd)]
struct SafeInteger(u64);

impl<'de> Deserialize<'de> for SafeInteger {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        const MAXIMUM: u64 = 9_007_199_254_740_991;
        let number = serde_json::Number::deserialize(deserializer)?;
        // JSON's numeric spelling does not affect the schema: 1, 1.0, and 1e0
        // denote the same safe integer, as in the creator validator.
        if let Some(value) = number.as_u64() {
            if value <= MAXIMUM {
                return Ok(Self(value));
            }
        } else if let Some(value) = number.as_f64()
            && value.is_finite()
            && (0.0..=MAXIMUM as f64).contains(&value)
            && value.fract() == 0.0
        {
            return Ok(Self(value as u64));
        }
        Err(de::Error::custom("expected a nonnegative safe integer"))
    }
}

fn valid_parameter_name(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn valid_unreserved(value: &str) -> bool {
    !value.is_empty()
        && !matches!(value, "." | "..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~'))
}

fn valid_enum(values: &BTreeSet<String>) -> bool {
    (1..=32).contains(&values.len())
        && values
            .iter()
            .all(|value| value.len() <= 128 && valid_unreserved(value))
}

fn deserialize_unique_values<'de, D>(deserializer: D) -> Result<BTreeSet<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<String>::deserialize(deserializer)?;
    let mut unique = BTreeSet::new();
    for value in values {
        if !unique.insert(value) {
            return Err(de::Error::custom("duplicate enum value"));
        }
    }
    Ok(unique)
}

fn deserialize_unique_map<'de, D, T>(deserializer: D) -> Result<BTreeMap<String, T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct UniqueMap<T>(PhantomData<T>);

    impl<'de, T: Deserialize<'de>> de::Visitor<'de> for UniqueMap<T> {
        type Value = BTreeMap<String, T>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a parameter map with unique names")
        }

        fn visit_map<M: de::MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
            let mut unique = BTreeMap::new();
            while let Some((name, constraint)) = map.next_entry()? {
                if unique.insert(name, constraint).is_some() {
                    return Err(de::Error::custom("duplicate parameter name"));
                }
            }
            Ok(unique)
        }
    }

    deserializer.deserialize_map(UniqueMap(PhantomData))
}
