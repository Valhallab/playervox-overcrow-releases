//! Strict JSON for hashed and signed documents: manifests, ledgers, compiled
//! views, locale files and catalogs. Two parsers must never read the same
//! bytes differently, so a byte-order mark, a duplicate object key or trailing
//! data rejects the document. Nesting is bounded by `serde_json`'s recursion
//! limit.

use std::fmt;

use serde::Deserialize;
use serde::de::{self, Deserializer, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Number, Value};

use crate::model::Field;

/// Parses `bytes` as one strict JSON document of at most `maximum` bytes.
pub fn parse_strict(bytes: &[u8], maximum: u64) -> Option<Value> {
    if bytes.len() as u64 > maximum || bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return None;
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue::deserialize(&mut deserializer).ok()?;
    deserializer.end().ok()?;
    Some(value.0)
}

struct StrictValue(Value);

impl<'de> Deserialize<'de> for StrictValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(StrictVisitor).map(StrictValue)
    }
}

struct StrictVisitor;

impl<'de> Visitor<'de> for StrictVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("strict JSON")
    }

    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Value, E> {
        Ok(Value::Number(value.into()))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<Value, E> {
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite number"))
    }

    fn visit_str<E>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }

    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(StrictValue(value)) = sequence.next_element()? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut object = Map::new();
        while let Some(key) = map.next_key::<String>()? {
            let StrictValue(value) = map.next_value()?;
            if object.insert(key, value).is_some() {
                return Err(de::Error::custom("duplicate object key"));
            }
        }
        Ok(Value::Object(object))
    }
}

/// Every key is declared by one of `sets` and every required field present.
pub(crate) fn has_exact_fields(object: &Map<String, Value>, sets: &[&[Field]]) -> bool {
    let fields = || sets.iter().flat_map(|set| set.iter());
    fields().all(|field| !field.required || object.contains_key(field.name))
        && object
            .keys()
            .all(|key| fields().any(|field| field.name == key))
}

/// A JSON integer within `min..=max`; fractions, exponents that do not land
/// on an integer and out-of-range values are rejected.
pub(crate) fn integer_in(value: &Value, min: i64, max: i64) -> Option<i64> {
    value.as_i64().filter(|value| (min..=max).contains(value))
}

/// Non-empty text without control characters, at most `maximum` bytes.
pub(crate) fn plain_text(value: &Value, maximum: u64) -> Option<&str> {
    value.as_str().filter(|text| {
        !text.is_empty() && text.len() as u64 <= maximum && !text.chars().any(char::is_control)
    })
}
