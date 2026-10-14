//! Integrated services (ADR 0009 §10): services PlayerVox defines once —
//! their origins, how the secret is sent, the key page or the OAuth client
//! of PlayerVox, the scopes a widget may ask for and the paths no widget may
//! reach. The user connects one of them once, in the Control Center, and
//! every widget that names it (`{ "service": "steam" }` in
//! `permissions.accounts`) and holds the permission `account:<service>`
//! uses that connection; the widget never sees the secret.
//!
//! In version 1 every integrated service is read-only for widgets: `GET`
//! routes only, read scopes only. The host's own capabilities (the Twitch
//! chat) are not routes and keep their scopes (`host_scopes`).
//!
//! Once a released application announces a service's feature
//! (`service-steam`…), what readers check is frozen: the ID, the origins,
//! the methods, the allowed and refused paths and the scopes. An addition
//! takes a new feature name; a path refused later is refused by the host
//! and the producers only, never by a manifest reader.

use crate::accounts::{AccountMode, Charset, KeyFormat, OAuthFlow, ScopeAccess, ScopeParam};

/// Feature a manifest naming the Steam service needs (catalog v2 `requires`).
pub const FEATURE_SERVICE_STEAM: &str = "service-steam";
/// Feature a manifest naming the Twitch service needs.
pub const FEATURE_SERVICE_TWITCH: &str = "service-twitch";

/// A text in each interface language.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Text {
    pub en: &'static str,
    pub fr: &'static str,
}

/// A header that carries a key: `<name>: [<scheme> ]<key>`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ServiceHeader {
    pub name: &'static str,
    pub scheme: Option<&'static str>,
}

/// A personal key the user pastes in the Control Center.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ServiceKey {
    pub format: KeyFormat,
    /// The service's page where a user gets a key; the host opens it on a
    /// click and nothing else.
    pub page: &'static str,
    /// The steps the Control Center shows above the key field.
    pub guide: &'static [Text],
    /// A short note under the field, when the service needs one.
    pub note: Option<Text>,
}

/// The public OAuth client of PlayerVox at the service.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ServiceOAuth {
    pub client_id: &'static str,
    pub flow: OAuthFlow,
    pub authorize: Option<&'static str>,
    pub token: &'static str,
    pub device: Option<&'static str>,
    pub verify: Option<&'static str>,
    pub revoke: Option<&'static str>,
    pub validate: Option<&'static str>,
    /// Seconds between two calls of `validate` while a widget runs.
    pub validate_every_seconds: Option<u32>,
    pub scope_param: ScopeParam,
    /// Header that also carries `client_id` on the routes of the service.
    pub client_id_header: Option<&'static str>,
    /// Scopes the host asks for its own capabilities; never a widget's.
    pub host_scopes: &'static [&'static str],
}

impl ServiceOAuth {
    /// Every endpoint: the host calls them, no route may.
    pub fn endpoints(&self) -> Vec<&'static str> {
        [
            self.authorize,
            Some(self.token),
            self.device,
            self.verify,
            self.revoke,
            self.validate,
        ]
        .into_iter()
        .flatten()
        .collect()
    }
}

/// A scope a widget may ask for, with what the user is told it reads.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ServiceScope {
    pub name: &'static str,
    pub access: ScopeAccess,
    pub label: Text,
}

#[derive(Debug, Eq, PartialEq)]
pub struct IntegratedService {
    pub id: &'static str,
    pub name: &'static str,
    pub feature: &'static str,
    pub mode: AccountMode,
    /// Origins that receive the secret, on the routes that name the service.
    pub secret_origins: &'static [&'static str],
    /// Other origins of the service (images): never the secret.
    pub origins: &'static [&'static str],
    /// Methods of the routes of a widget that names the service.
    pub methods: &'static [&'static str],
    /// Path prefixes, in literal segments and without case, that a route on
    /// a secret origin stays within.
    pub allowed_paths: &'static [&'static str],
    /// Path prefixes no route on a secret origin may reach.
    pub refused_paths: &'static [&'static str],
    /// Statuses by which the service refuses the secret.
    pub refused_status: &'static [u16],
    /// Key mode only.
    pub send: Option<ServiceHeader>,
    /// Key mode only.
    pub key: Option<ServiceKey>,
    /// OAuth mode only.
    pub oauth: Option<ServiceOAuth>,
    /// Scopes a widget may ask for (OAuth mode).
    pub scopes: &'static [ServiceScope],
}

const fn read(name: &'static str, en: &'static str, fr: &'static str) -> ServiceScope {
    ServiceScope {
        name,
        access: ScopeAccess::Read,
        label: Text { en, fr },
    }
}

/// Steam Web API with the user's own key (`X-WebAPI-Key`). The key can read
/// and cancel trade offers (`IEconService`): routes stay on the read
/// interfaces of the player and the games.
pub const STEAM: IntegratedService = IntegratedService {
    id: "steam",
    name: "Steam",
    feature: FEATURE_SERVICE_STEAM,
    mode: AccountMode::Key,
    secret_origins: &["https://api.steampowered.com"],
    // Not documented by Valve: measured during the real test of ACC.6
    // before the release that announces `service-steam`.
    origins: &[
        "https://avatars.steamstatic.com",
        "https://avatars.fastly.steamstatic.com",
        "https://avatars.akamai.steamstatic.com",
        "https://steamcdn-a.akamaihd.net",
        "https://cdn.akamai.steamstatic.com",
        "https://shared.akamai.steamstatic.com",
        "https://shared.fastly.steamstatic.com",
    ],
    methods: &["GET"],
    allowed_paths: &[
        "/ISteamUser/",
        "/IPlayerService/",
        "/ISteamUserStats/",
        "/ISteamApps/",
        "/ISteamNews/",
    ],
    refused_paths: &[
        "/IEconService/",
        "/IGameServersService/",
        "/IBroadcastService/",
        "/ISteamUserAuth/",
        "/IAuthenticationService/",
        "/ITwoFactorService/",
        "/IEconMarketService/",
        "/ISteamMicroTxn/",
        "/ISteamMicroTxnSandbox/",
    ],
    refused_status: &[401, 403],
    send: Some(ServiceHeader {
        name: "X-WebAPI-Key",
        scheme: None,
    }),
    key: Some(ServiceKey {
        format: KeyFormat {
            charset: Charset::Hex,
            min_length: 32,
            max_length: 32,
        },
        page: "https://steamcommunity.com/dev/apikey",
        // The "domain" field is undocumented for a person: ACC.6 confirms
        // `localhost` during the owner's real test.
        guide: &[
            Text {
                en: "Open the Steam key page and sign in.",
                fr: "Ouvrez la page de clé Steam et connectez-vous.",
            },
            Text {
                en: "In “Domain Name”, type localhost, accept the terms and register.",
                fr: "Dans « Nom de domaine », écrivez localhost, acceptez les conditions et validez.",
            },
            Text {
                en: "Copy the key shown, then paste it below.",
                fr: "Copiez la clé affichée, puis collez-la ci-dessous.",
            },
        ],
        note: Some(Text {
            en: "Steam gives no key to limited accounts (under $5 of purchases).",
            fr: "Steam ne donne pas de clé aux comptes limités (moins de 5 $ d’achats).",
        }),
    }),
    oauth: None,
    scopes: &[],
};

/// Twitch Helix with OverCrow's own Twitch connection: the public client of
/// PlayerVox, by device code. The chat of the host uses the same connection.
pub const TWITCH: IntegratedService = IntegratedService {
    id: "twitch",
    name: "Twitch",
    feature: FEATURE_SERVICE_TWITCH,
    mode: AccountMode::OAuth,
    secret_origins: &["https://api.twitch.tv"],
    origins: &["https://static-cdn.jtvnw.net"],
    methods: &["GET"],
    allowed_paths: &["/helix/"],
    refused_paths: &[
        // The broadcast key.
        "/helix/streams/key",
        // Extension secrets (`jwt/secrets`).
        "/helix/extensions/",
        // The host's own chat subscriptions.
        "/helix/eventsub/",
    ],
    refused_status: &[401],
    send: None,
    key: None,
    oauth: Some(ServiceOAuth {
        client_id: "4mnhecoh0nif054yubgwkkj2k7bma2",
        flow: OAuthFlow::Device,
        authorize: None,
        token: "https://id.twitch.tv/oauth2/token",
        device: Some("https://id.twitch.tv/oauth2/device"),
        verify: Some("https://www.twitch.tv/activate"),
        revoke: Some("https://id.twitch.tv/oauth2/revoke"),
        validate: Some("https://id.twitch.tv/oauth2/validate"),
        validate_every_seconds: Some(3600),
        scope_param: ScopeParam::Scopes,
        client_id_header: Some("Client-Id"),
        host_scopes: &["user:read:chat", "user:write:chat"],
    }),
    scopes: &[
        read("channel:read:goals", "your goals", "vos objectifs"),
        read(
            "moderator:read:followers",
            "your followers",
            "vos followers",
        ),
        read(
            "channel:read:hype_train",
            "your Hype Trains",
            "vos Hype Trains",
        ),
        read("channel:read:polls", "your polls", "vos sondages"),
        read(
            "channel:read:predictions",
            "your predictions",
            "vos prédictions",
        ),
        read(
            "channel:read:subscriptions",
            "your subscribers",
            "vos abonnés",
        ),
        read("bits:read", "your Bits", "vos Bits"),
        read(
            "channel:read:charity",
            "your charity campaigns",
            "vos collectes caritatives",
        ),
        read("channel:read:ads", "your ads", "vos publicités"),
        read("channel:read:vips", "your VIPs", "vos VIP"),
        read(
            "moderator:read:chatters",
            "your chatters",
            "les spectateurs de votre chat",
        ),
    ],
};

/// Every integrated service, in the order the Control Center lists them.
pub const INTEGRATED_SERVICES: &[IntegratedService] = &[STEAM, TWITCH];

/// The service `id`, if the table has it.
pub fn service_named(id: &str) -> Option<&'static IntegratedService> {
    INTEGRATED_SERVICES.iter().find(|service| service.id == id)
}

impl IntegratedService {
    /// Secret origins, then the other origins.
    pub fn all_origins(&self) -> impl Iterator<Item = &'static str> {
        self.secret_origins
            .iter()
            .chain(self.origins.iter())
            .copied()
    }

    /// The scope `name` a widget may ask for.
    pub fn scope(&self, name: &str) -> Option<&'static ServiceScope> {
        self.scopes.iter().find(|scope| scope.name == name)
    }

    /// Origins of the host's OAuth endpoints.
    pub fn endpoint_origins(&self) -> Vec<&'static str> {
        self.oauth
            .as_ref()
            .map(|oauth| {
                oauth
                    .endpoints()
                    .into_iter()
                    .filter_map(|url| {
                        crate::accounts::https_url(url, true).map(|(origin, _)| origin)
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Whether a declared route path (with `{name}` parameters), on a secret
    /// origin, stays within an allowed prefix and cannot reach a refused one.
    pub fn route_path_allowed(&self, path: &str) -> bool {
        let route = segments(path);
        self.allowed_paths
            .iter()
            .any(|prefix| within(&route, &segments(prefix)))
            && !self
                .refused_paths
                .iter()
                .any(|prefix| may_reach(&route, &segments(prefix)))
    }

    /// Whether a concrete request path the host is about to send, on a
    /// secret origin, is allowed: the host's own check, whatever the
    /// manifest said. The path must already be in the form the URL parser
    /// sends: literal segments only (no `.` or `..` segment, backslash,
    /// percent sign, query or fragment), no empty segment but a final `/`.
    pub fn request_path_allowed(&self, path: &str) -> bool {
        let Some(rest) = path.strip_prefix('/') else {
            return false;
        };
        let parts: Vec<&str> = rest.split('/').collect();
        let canonical = parts.iter().enumerate().all(|(index, part)| {
            crate::manifest::valid_literal_segment(part)
                || (part.is_empty() && index == parts.len() - 1)
        });
        let request = segments(path);
        canonical
            && self
                .allowed_paths
                .iter()
                .any(|prefix| within(&request, &segments(prefix)))
            && !self
                .refused_paths
                .iter()
                .any(|prefix| may_reach(&request, &segments(prefix)))
    }
}

/// Non-empty segments of a path.
fn segments(path: &str) -> Vec<&str> {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn is_placeholder(segment: &str) -> bool {
    segment.starts_with('{') && segment.ends_with('}')
}

/// The path starts with every literal segment of the prefix, without case.
fn within(path: &[&str], prefix: &[&str]) -> bool {
    path.len() >= prefix.len()
        && prefix.iter().zip(path).all(|(expected, segment)| {
            !is_placeholder(segment) && segment.eq_ignore_ascii_case(expected)
        })
}

/// The path may start with the prefix: each of its first segments is a
/// parameter (any value) or the prefix's literal, without case and without
/// final dots, which a server may drop (`key.` reads as `key`).
fn may_reach(path: &[&str], prefix: &[&str]) -> bool {
    path.len() >= prefix.len()
        && prefix.iter().zip(path).all(|(expected, segment)| {
            is_placeholder(segment) || segment.trim_end_matches('.').eq_ignore_ascii_case(expected)
        })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;
    use crate::accounts::{
        FORBIDDEN_SCOPE_WORDS, account_id_grammar, carrier_header, https_url, valid_scope_name,
    };
    use crate::catalog_v2::KNOWN_FEATURES;
    use crate::manifest::{canonical_https_origin, valid_literal_segment};

    #[test]
    fn every_service_reads_as_the_account_grammar() {
        let mut ids = BTreeSet::new();
        let mut features = BTreeSet::new();
        for service in INTEGRATED_SERVICES {
            assert!(account_id_grammar(service.id), "{}", service.id);
            assert!(ids.insert(service.id), "{}", service.id);
            assert!(features.insert(service.feature), "{}", service.feature);
            assert!(
                KNOWN_FEATURES.contains(&service.feature),
                "{}",
                service.feature
            );
            assert!(!service.name.is_empty());
            assert!(!service.methods.is_empty());
            assert!(
                service.methods.iter().all(|method| *method == "GET"),
                "read-only in version 1"
            );
            assert!(!service.refused_status.is_empty());
            assert!(
                service
                    .refused_status
                    .iter()
                    .all(|status| matches!(status, 401 | 403))
            );
        }
        assert_eq!(service_named("steam"), Some(&STEAM));
        assert_eq!(service_named("twitch"), Some(&TWITCH));
        assert_eq!(service_named("discord"), None);
    }

    #[test]
    fn origins_are_canonical_and_the_secret_goes_to_its_own_only() {
        for service in INTEGRATED_SERVICES {
            assert!(!service.secret_origins.is_empty(), "{}", service.id);
            let mut all = BTreeSet::new();
            for origin in service.all_origins() {
                assert!(canonical_https_origin(origin), "{origin}");
                assert!(all.insert(origin), "{origin} twice");
            }
        }
    }

    #[test]
    fn paths_are_literal_segments_and_refusals_are_not_allowed_whole() {
        for service in INTEGRATED_SERVICES {
            assert!(!service.allowed_paths.is_empty(), "{}", service.id);
            for prefix in service.allowed_paths.iter().chain(service.refused_paths) {
                assert!(prefix.starts_with('/'), "{prefix}");
                let parts = segments(prefix);
                assert!(!parts.is_empty(), "{prefix}");
                assert!(
                    parts.iter().all(|part| valid_literal_segment(part)),
                    "{prefix}"
                );
            }
            // A refused prefix never contains a whole allowed one: refusing
            // it would leave nothing of that interface.
            for refused in service.refused_paths {
                for allowed in service.allowed_paths {
                    assert!(
                        !within(&segments(allowed), &segments(refused)),
                        "{refused} covers {allowed}"
                    );
                }
            }
        }
    }

    #[test]
    fn scopes_follow_the_oauth_grammar_and_are_read_only() {
        for service in INTEGRATED_SERVICES {
            let mut names = BTreeSet::new();
            for scope in service.scopes {
                assert!(valid_scope_name(scope.name), "{}", scope.name);
                assert!(names.insert(scope.name), "{} twice", scope.name);
                assert_eq!(scope.access, ScopeAccess::Read, "{}", scope.name);
                let folded: String = scope
                    .name
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .map(|character| character.to_ascii_lowercase())
                    .collect();
                assert!(
                    !FORBIDDEN_SCOPE_WORDS
                        .iter()
                        .any(|word| folded.contains(word))
                );
                assert!(!scope.label.en.is_empty() && !scope.label.fr.is_empty());
            }
            match service.mode {
                AccountMode::Key => assert!(service.scopes.is_empty(), "{}", service.id),
                AccountMode::OAuth => assert!(!service.scopes.is_empty(), "{}", service.id),
            }
        }
    }

    #[test]
    fn the_mode_has_exactly_its_settings() {
        for service in INTEGRATED_SERVICES {
            match service.mode {
                AccountMode::Key => {
                    let send = service.send.expect("key mode sends a header");
                    assert!(carrier_header(send.name), "{}", send.name);
                    let key = service.key.expect("key mode has a key");
                    assert!(key.format.min_length <= key.format.max_length);
                    assert!(https_url(key.page, true).is_some(), "{}", key.page);
                    assert_eq!(key.guide.len(), 3, "three short steps");
                    for step in key.guide.iter().chain(key.note.iter()) {
                        assert!(!step.en.is_empty() && !step.fr.is_empty());
                        assert!(!step.en.contains("http") && !step.fr.contains("http"));
                    }
                    assert!(service.oauth.is_none());
                }
                AccountMode::OAuth => {
                    let oauth = service.oauth.expect("OAuth mode has a client");
                    assert!(service.send.is_none() && service.key.is_none());
                    for endpoint in oauth.endpoints() {
                        assert!(https_url(endpoint, false).is_some(), "{endpoint}");
                    }
                    match oauth.flow {
                        OAuthFlow::Device => {
                            assert!(oauth.device.is_some() && oauth.verify.is_some());
                        }
                        OAuthFlow::Loopback => assert!(oauth.authorize.is_some()),
                    }
                    // The endpoints that receive a secret are never a
                    // widget's origin: no route reaches them.
                    for origin in service.endpoint_origins() {
                        assert!(
                            !service.all_origins().any(|own| own == origin),
                            "{origin} is a widget origin"
                        );
                    }
                    if let Some(header) = oauth.client_id_header {
                        assert!(
                            carrier_header(header) && !header.eq_ignore_ascii_case("authorization")
                        );
                    }
                    for scope in oauth.host_scopes {
                        assert!(valid_scope_name(scope));
                        assert!(service.scope(scope).is_none(), "{scope} is the host's");
                    }
                }
            }
        }
    }

    #[test]
    fn route_paths_stay_within_the_allowed_interfaces() {
        for path in [
            "/ISteamUser/GetPlayerSummaries/v2/",
            "/isteamuser/getplayersummaries/v2/",
            "/ISteamUserStats/GetPlayerAchievements/v1/",
            "/IPlayerService/GetRecentlyPlayedGames/v1/",
        ] {
            assert!(STEAM.route_path_allowed(path), "{path}");
        }
        for path in [
            "/IStoreService/GetAppList/v1/",
            "/IEconService/GetTradeOffers/v1/",
            "/ieconservice/GetTradeOffers/v1/",
            "/{interface}/GetTradeOffers/v1/",
            "/IGameServersService/GetAccountList/v1/",
            "/",
        ] {
            assert!(!STEAM.route_path_allowed(path), "{path}");
        }
        for path in [
            "/helix/goals",
            "/helix/channels/followers",
            "/helix/streams",
        ] {
            assert!(TWITCH.route_path_allowed(path), "{path}");
        }
        for path in [
            "/helix/streams/key",
            "/HELIX/Streams/Key",
            "/helix/{x}/key",
            "/helix/streams/{x}",
            "/helix/eventsub/subscriptions",
            "/helix/extensions/jwt/secrets",
            "/kraken/streams",
            "/{version}/goals",
        ] {
            assert!(!TWITCH.route_path_allowed(path), "{path}");
        }
    }

    #[test]
    fn the_host_checks_the_path_it_sends() {
        assert!(STEAM.request_path_allowed("/ISteamUser/GetPlayerSummaries/v2/"));
        assert!(TWITCH.request_path_allowed("/helix/streams"));
        for path in [
            "/IEconService/CancelTradeOffer/v1/",
            "/IECONSERVICE/CancelTradeOffer/v1/",
            "/ISteamUser%2F../IEconService/x",
            "/{x}/GetPlayerSummaries/v2/",
        ] {
            assert!(!STEAM.request_path_allowed(path), "{path}");
        }
        assert!(!TWITCH.request_path_allowed("/helix/streams/key"));
    }

    /// The host checks the path the URL parser will send: a dot segment,
    /// a backslash (read as `/` for `https`) or an empty segment would be
    /// normalized away after the check.
    #[test]
    fn the_host_refuses_a_path_that_normalizes_elsewhere() {
        for path in [
            "/ISteamUser/../IEconService/CancelTradeOffer/v1/",
            "/ISteamUser/./GetPlayerSummaries/v2/",
            "/ISteamUser/x/../../IEconService/CancelTradeOffer/v1/",
            "/ISteamUser\\..\\IEconService/CancelTradeOffer/v1/",
            "/ISteamUser//GetPlayerSummaries/v2/",
            "//IEconService/CancelTradeOffer/v1/",
            "ISteamUser/GetPlayerSummaries/v2/",
            "/ISteamUser/GetPlayerSummaries/v2/?key=x",
            "/ISteamUser/GetPlayerSummaries/v2/#x",
            "/ISteamUser/Get PlayerSummaries/v2/",
            "",
        ] {
            assert!(!STEAM.request_path_allowed(path), "{path}");
        }
        assert!(STEAM.request_path_allowed("/ISteamUser/GetPlayerSummaries/v2"));
    }

    /// A server may drop the final dots of a segment (`key.` is `key`): a
    /// refused prefix is compared without them.
    #[test]
    fn final_dots_never_hide_a_refused_segment() {
        for path in [
            "/helix/streams/key.",
            "/helix/streams/key..",
            "/helix/eventsub./x",
        ] {
            assert!(!TWITCH.route_path_allowed(path), "route {path}");
            assert!(!TWITCH.request_path_allowed(path), "request {path}");
        }
    }
}
