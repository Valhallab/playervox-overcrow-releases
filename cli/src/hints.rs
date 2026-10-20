//! Review hints of `admit`: warnings that point a maintainer at an account
//! or a route to look at closely. They refuse nothing, and they never
//! tighten what the host's reader accepts: a widget admitted yesterday stays
//! readable. Each one names what to look at, and its JSON pointer into
//! `manifest.json` (`/permissions/network/3`) says which permission it is
//! about.
//!
//! The codes are stable (the creator space shows them):
//!
//! - `review.service_key_format`: a declared key account whose format also
//!   accepts the keys of an integrated service (Steam: 32 hex characters).
//! - `review.service_name_in_host`: an address of a declared account whose
//!   host, folded to letters, reads as an integrated service.
//! - `review.address_in_key_page`: the static query of `key.page` carries an
//!   address (a redirect through a search engine or a link shortener).
//! - `review.same_route`: a rule on the route of an earlier one; the host
//!   allows what any of them allows.
//! - `review.path_and_query_name`: one name in `pathParams` and in
//!   `queryParams` of a rule; they are two separate constraints.
//! - `review.secret_route`: a route whose path, parameter names or `enum`
//!   values speak of keys, tokens or passwords (`secretHint` of the review).
//! - `review.service_label_name`: an account name that imitates a label of
//!   the host (integrated service, official, verified).

use std::collections::BTreeMap;

use overcrow_widget_schema::accounts::{Account, AccountMode, Charset, KeyFormat};
use overcrow_widget_schema::identifiers::reads_as_any;
use overcrow_widget_schema::integrated::{INTEGRATED_SERVICES, READER_GUARDS};
use overcrow_widget_schema::manifest::Manifest;
use serde_json::Value;

use crate::diag::Diagnostic;
use crate::sanitize;

/// The help every account hint ends with.
const ACCOUNT_HELP: &str = "open each page of the account and note its final address; refuse a widget that sends the player to an integrated service (reviewer manual, accounts)";

/// Words of a path, a parameter name or a value that speak of a secret,
/// split on separators and case changes (`oauth2/token`, `getSecret`).
const SECRET_WORDS: &[&str] = &[
    "authorize",
    "credential",
    "credentials",
    "introspect",
    "oauth",
    "oauth2",
    "passwd",
    "password",
    "passwords",
    "revoke",
    "secret",
    "secrets",
    "token",
    "tokens",
];

/// Compounds found in the letters and digits alone, whatever separates
/// their words (`stream_key`, `Access-Tokens`, `apikey`).
const SECRET_COMPOUNDS: &[&str] = &[
    "accesskey",
    "accesstoken",
    "apikey",
    "authtoken",
    "bearertoken",
    "clientsecret",
    "credential",
    "idtoken",
    "passwd",
    "password",
    "privatekey",
    "refreshtoken",
    "secretkey",
    "sessionkey",
    "sessiontoken",
    "signingkey",
    "streamkey",
];

/// Whole segments, parameter names or values that name keys.
const SECRET_SEGMENTS: &[&str] = &["key", "keys"];

/// Words of the host's own labels an account name must not imitate, as
/// [`reads_as_any`] folds them (`Intégré`, `0fficial`, `built-in`).
const HOST_LABEL_WORDS: &[&str] = &[
    "builtin",
    "certifie",
    "integrated",
    "integre",
    "official",
    "officiel",
    "verifie",
];

/// Check marks a name may use to look verified.
const CHECK_MARKS: &[char] = &['\u{2611}', '\u{2705}', '\u{2713}', '\u{2714}'];

/// Every hint of `manifest`, in the order of its permissions.
pub fn hints(manifest: &Manifest) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for (index, account) in manifest.accounts.iter().enumerate() {
        // An integrated service is PlayerVox's own definition.
        if account.service.is_none() {
            account_hints(account, index, &mut out);
        }
    }
    let rules = manifest.value["permissions"]["network"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut first_of_route: BTreeMap<String, usize> = BTreeMap::new();
    for (index, rule) in rules.iter().enumerate() {
        let pointer = format!("/permissions/network/{index}");
        let route = route_of(rule);
        if let Some(first) = first_of_route.get(&route) {
            out.push(hint(
                "review.same_route",
                &pointer,
                format!(
                    "network[{index}] is on the route of network[{first}] ({}): the host allows what either rule allows",
                    sanitize::line(&route)
                ),
                "review both rules, their parameters and response bounds, as one route",
            ));
        } else {
            first_of_route.insert(route.clone(), index);
        }
        let query = rule["queryParams"].as_object();
        for name in rule["pathParams"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(name, _)| name)
        {
            if query.is_some_and(|query| query.contains_key(name)) {
                out.push(hint(
                    "review.path_and_query_name",
                    &pointer,
                    format!(
                        "network[{index}] names `{}` in both pathParams and queryParams",
                        sanitize::line(name)
                    ),
                    "the path and the query constraints are separate: review each one",
                ));
            }
        }
        if secret_hint(rule) {
            let message = if rule["account"].is_string() {
                format!(
                    "network[{index}] ({}) may return keys or tokens, and it carries the account's secret",
                    sanitize::line(&route)
                )
            } else {
                format!(
                    "network[{index}] ({}) may return keys or tokens",
                    sanitize::line(&route)
                )
            };
            out.push(hint(
                "review.secret_route",
                &pointer,
                message,
                "check what this route answers: a widget never receives a key, a token or a password",
            ));
        }
    }
    out
}

/// `<METHOD> <origin><path>`: the route of a permission key.
fn route_of(rule: &Value) -> String {
    format!(
        "{} {}{}",
        rule["method"].as_str().unwrap_or_default(),
        rule["origin"].as_str().unwrap_or_default(),
        rule["path"].as_str().unwrap_or_default()
    )
}

fn hint(code: &str, pointer: &str, message: String, help: &str) -> Diagnostic {
    Diagnostic::warning(code, message)
        .in_file("manifest.json")
        .at_pointer(pointer)
        .help(help)
}

fn account_hints(account: &Account, index: usize, out: &mut Vec<Diagnostic>) {
    let pointer = format!("/permissions/accounts/{index}");
    let name = sanitize::line(&account.name);
    if let Some(key) = account
        .key
        .as_ref()
        .filter(|_| account.mode == AccountMode::Key)
    {
        for service in INTEGRATED_SERVICES {
            let Some(theirs) = service.key else { continue };
            if looks_like(&key.format, &theirs.format) {
                out.push(hint(
                    "review.service_key_format",
                    &pointer,
                    format!(
                        "the key of {name} has the format of {} keys ({})",
                        service.name,
                        format_text(&theirs.format)
                    ),
                    ACCOUNT_HELP,
                ));
            }
        }
        if let Some((_, query)) = key.page.split_once('?')
            && carries_an_address(query)
        {
            out.push(hint(
                "review.address_in_key_page",
                &pointer,
                format!(
                    "the key page of {name} carries an address in its query: {}",
                    sanitize::line(&key.page)
                ),
                ACCOUNT_HELP,
            ));
        }
    }
    let mut urls: Vec<&str> = account.origins.iter().map(String::as_str).collect();
    urls.extend(account.key.iter().map(|key| key.page.as_str()));
    if let Some(oauth) = &account.oauth {
        urls.extend(oauth.endpoints());
    }
    let mut seen = Vec::new();
    for url in urls {
        let host = host_of(url);
        if seen.contains(&host) {
            continue;
        }
        seen.push(host);
        if let Some(service) = service_read_in(host) {
            out.push(hint(
                "review.service_name_in_host",
                &pointer,
                format!(
                    "the address {} of {name} reads as {service}",
                    sanitize::line(host)
                ),
                ACCOUNT_HELP,
            ));
        }
    }
    let imitates = reads_as_any(&account.name, HOST_LABEL_WORDS)
        || account
            .name
            .chars()
            .any(|character| CHECK_MARKS.contains(&character));
    if imitates {
        out.push(hint(
            "review.service_label_name",
            &pointer,
            format!("the account name {name} imitates a label of OverCrow (integrated, official, verified)"),
            "ask for the service's plain name: OverCrow marks integrated services itself",
        ));
    }
}

/// Whether `declared` accepts the keys of `theirs`: its charset holds
/// theirs (hex is within letters and digits) and its lengths hold theirs.
/// Declaring a wider charset never hides a Steam key.
fn looks_like(declared: &KeyFormat, theirs: &KeyFormat) -> bool {
    (0..=127u8).all(|byte| !theirs.charset.allows(byte) || declared.charset.allows(byte))
        && declared.min_length <= theirs.min_length
        && declared.max_length >= theirs.max_length
}

fn format_text(format: &KeyFormat) -> String {
    let charset = match format.charset {
        Charset::Hex => "hex",
        Charset::Alnum => "letter and digit",
        Charset::Base64Url => "base64url",
        Charset::Base64 => "base64",
        Charset::Printable => "printable",
    };
    if format.min_length == format.max_length {
        format!("{} {charset} characters", format.min_length)
    } else {
        format!(
            "{} to {} {charset} characters",
            format.min_length, format.max_length
        )
    }
}

/// The lowercase host of an `https://` URL or origin.
fn host_of(url: &str) -> &str {
    url.strip_prefix("https://")
        .unwrap_or(url)
        .split(['/', ':', '?', '#'])
        .next()
        .unwrap_or_default()
}

/// The integrated service a host reads as, folded to letters and digits
/// with look-alikes (`steam-keys.example`, `api.tw1tch.example`).
fn service_read_in(host: &str) -> Option<&'static str> {
    INTEGRATED_SERVICES.iter().find_map(|service| {
        let mut words = vec![service.id];
        if let Some(guard) = READER_GUARDS.iter().find(|guard| guard.id == service.id) {
            words.extend(guard.names);
        }
        reads_as_any(host, &words).then_some(service.name)
    })
}

/// Whether a static query, once percent-decoded, carries an address: a `/`
/// or `:` (only escaped in a static query), `http`, `www.`, or a host of an
/// integrated service.
fn carries_an_address(query: &str) -> bool {
    let decoded = percent_decode(query).to_ascii_lowercase();
    if decoded.contains(['/', ':']) || decoded.contains("http") || decoded.contains("www.") {
        return true;
    }
    decoded.split(['&', '=']).any(|value| {
        READER_GUARDS.iter().any(|guard| guard.owns_host(value))
            || INTEGRATED_SERVICES
                .iter()
                .any(|service| service.owns_host(value))
    })
}

/// `%XX` decoded twice (a redirect may be escaped twice), as bytes read as
/// Latin-1 so that nothing is lost.
fn percent_decode(text: &str) -> String {
    let once = decode_once(text);
    decode_once(&once)
}

fn decode_once(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = String::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        let pair = bytes.get(index + 1..index + 3);
        match (
            bytes[index],
            pair.and_then(|pair| std::str::from_utf8(pair).ok()),
        ) {
            (b'%', Some(hex)) if u8::from_str_radix(hex, 16).is_ok() => {
                out.push(char::from(u8::from_str_radix(hex, 16).unwrap_or_default()));
                index += 3;
            }
            (byte, _) => {
                out.push(char::from(byte));
                index += 1;
            }
        }
    }
    out
}

/// Lowercase ASCII letters and digits of `text`: separators never hide a
/// compound (`stream_key`, `access-token`).
fn folded(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|character| character.to_ascii_lowercase())
        .collect()
}

/// The lowercase words of `text`: runs of letters and digits, split where a
/// lowercase letter or a digit meets an uppercase one (`liveStreams`).
fn words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    let mut previous_lower = false;
    for character in text.chars() {
        if !character.is_ascii_alphanumeric() {
            out.extend((!word.is_empty()).then(|| std::mem::take(&mut word)));
            previous_lower = false;
            continue;
        }
        if character.is_ascii_uppercase() && previous_lower {
            out.push(std::mem::take(&mut word));
        }
        previous_lower = character.is_ascii_lowercase() || character.is_ascii_digit();
        word.push(character.to_ascii_lowercase());
    }
    out.extend((!word.is_empty()).then_some(word));
    out
}

fn speaks_of_a_secret(text: &str) -> bool {
    let folded = folded(text);
    let words = words(text);
    SECRET_COMPOUNDS.iter().any(|compound| folded.contains(compound))
        || words.iter().any(|word| SECRET_WORDS.contains(&word.as_str()))
        // `api/keys`, `API-Key`, `getApiKey`.
        || words
            .windows(2)
            .any(|pair| pair[0] == "api" && SECRET_SEGMENTS.contains(&pair[1].as_str()))
        || SECRET_SEGMENTS.contains(&text.to_ascii_lowercase().as_str())
}

/// `secretHint`: whether a route may return keys or tokens, by its folded
/// path (each `enum` value in its place too), its segments, its parameter
/// names and its `enum` values.
pub fn secret_hint(rule: &Value) -> bool {
    let path = rule["path"].as_str().unwrap_or_default();
    let params = ["pathParams", "queryParams"]
        .iter()
        .flat_map(|params| rule[*params].as_object().into_iter().flatten());
    let mut texts: Vec<String> = vec![path.to_owned()];
    texts.extend(path.split('/').map(str::to_owned));
    for (name, constraint) in params {
        texts.push(name.clone());
        for value in constraint["values"].as_array().into_iter().flatten() {
            let value = value.as_str().unwrap_or_default();
            texts.push(value.to_owned());
            // The value in its place: `/v1/{kind}/keys` with `api`.
            texts.push(path.replace(&format!("{{{name}}}"), value));
        }
    }
    texts.iter().any(|text| speaks_of_a_secret(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn format(charset: Charset, min_length: usize, max_length: usize) -> KeyFormat {
        KeyFormat {
            charset,
            min_length,
            max_length,
        }
    }

    #[test]
    fn a_format_looks_like_a_services_when_it_holds_its_keys_alike() {
        let steam = format(Charset::Hex, 32, 32);
        for declared in [
            format(Charset::Hex, 32, 32),
            format(Charset::Hex, 16, 512),
            format(Charset::Alnum, 32, 32),
            format(Charset::Base64, 20, 64),
            format(Charset::Printable, 16, 512),
        ] {
            assert!(looks_like(&declared, &steam), "{declared:?}");
        }
        for declared in [
            format(Charset::Hex, 33, 64),
            format(Charset::Hex, 16, 31),
            format(Charset::Alnum, 40, 40),
            format(Charset::Printable, 16, 31),
        ] {
            assert!(!looks_like(&declared, &steam), "{declared:?}");
        }
        assert_eq!(format_text(&steam), "32 hex characters");
        assert_eq!(
            format_text(&format(Charset::Alnum, 16, 64)),
            "16 to 64 letter and digit characters"
        );
    }

    #[test]
    fn an_address_in_a_static_query_is_found_escaped_once_or_twice() {
        for query in [
            "q=https%3A%2F%2Fsteamcommunity.com%2Fdev%2Fapikey",
            "u=%252F%252Fexample.com",
            "to=steamcommunity.com",
            "to=store.steampowered.com",
            "to=www.example.com",
            "u=HTTP",
        ] {
            assert!(carries_an_address(query), "{query}");
        }
        for query in ["tab=api-keys&v=2", "a=%41", "x=steam", "lang=en"] {
            assert!(!carries_an_address(query), "{query}");
        }
        // A broken escape is kept as it is.
        assert_eq!(decode_once("%zz%4"), "%zz%4");
        assert_eq!(percent_decode("%2541"), "A");
    }

    #[test]
    fn a_host_reads_as_a_service_through_separators_and_look_alikes() {
        for (host, service) in [
            ("api.steam-tracker.example", "Steam"),
            ("st3am-keys.example", "Steam"),
            ("valve.tracker.example", "Steam"),
            ("api.tw1tch-tools.example", "Twitch"),
            ("tvvitch.example", "Twitch"),
        ] {
            assert_eq!(service_read_in(host), Some(service), "{host}");
        }
        for host in [
            "api.tracker.example",
            "upstream.example",
            "mainstream.example",
        ] {
            assert_eq!(service_read_in(host), None, "{host}");
        }
    }

    #[test]
    fn the_secret_hint_folds_words_and_reads_values() {
        let rule = |path: &str, params: Value| {
            let mut rule = json!({"path": path});
            for (name, value) in params.as_object().into_iter().flatten() {
                rule[name] = value.clone();
            }
            rule
        };
        assert!(secret_hint(&rule("/v1/Stream-Key", json!({}))));
        assert!(secret_hint(&rule("/v1/KEYS", json!({}))));
        assert!(secret_hint(&rule(
            "/v1/{a}",
            json!({"pathParams": {"a": {"type": "enum", "values": ["x", "apiKey"]}}})
        )));
        assert!(!secret_hint(&rule("/v1/turkey/monkeys", json!({}))));
        assert!(!secret_hint(&rule("/v1/tokenizer", json!({}))));
        assert!(!secret_hint(&rule("/v1/secretary/key-bindings", json!({}))));
        assert!(secret_hint(&rule("/v1/getApiKey", json!({}))));
        assert!(secret_hint(&rule("/oauth2/token", json!({}))));
        assert_eq!(
            words("/v1/liveStreams_x2Y"),
            ["v1", "live", "streams", "x2", "y"]
        );
        assert!(!secret_hint(&rule(
            "/v1/{a}",
            json!({"pathParams": {"a": {"type": "slug", "maxLength": 8}}})
        )));
    }
}
