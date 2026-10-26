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
//!
//! A service may also list live events (`events`): Twitch's EventSub, which
//! the host subscribes to on the user's own channel, and Steam's local
//! client, whose stats files of the account a widget names the host
//! watches on the user's computer. The host sends a widget each event of
//! the types it declares, as a closed projection. The list, each type's
//! version, scope and fields are frozen with the release that announces
//! the service's events feature (`twitch-events`, `steam-events`) in the
//! same way.

use serde_json::{Map, Value};

use crate::accounts::{AccountMode, Charset, KeyFormat, OAuthFlow, ScopeAccess, ScopeParam};
use crate::limits::MAX_SERVICE_EVENT_BYTES;

/// Feature a manifest naming the Steam service needs (catalog v2 `requires`).
pub const FEATURE_SERVICE_STEAM: &str = "service-steam";
/// Feature a manifest naming the Twitch service needs.
pub const FEATURE_SERVICE_TWITCH: &str = "service-twitch";
/// Feature a manifest needs when its Twitch declaration lists `events`.
pub const FEATURE_TWITCH_EVENTS: &str = "twitch-events";
/// Feature a manifest needs when its Steam declaration lists `events`.
pub const FEATURE_STEAM_EVENTS: &str = "steam-events";

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
    /// A request of the host alone, on a secret origin, that only a refused
    /// key fails: a 401 or 403 a widget's route gets (a private profile, a
    /// bad parameter) never marks the shared key refused unless this probe
    /// fails too.
    pub probe: Option<&'static str>,
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

/// A path a route on a secret origin may take.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ServicePath {
    /// Literal segments, compared without case.
    pub path: &'static str,
    /// `true`: the route is exactly this path; `false`: it starts with it.
    pub exact: bool,
    /// The scope the widget must ask for itself. The token is shared by the
    /// widgets of the service: a widget never reaches what only another
    /// widget's scope opens.
    pub scope: Option<&'static str>,
}

const fn prefix(path: &'static str) -> ServicePath {
    ServicePath {
        path,
        exact: false,
        scope: None,
    }
}

const fn endpoint(path: &'static str, scope: Option<&'static str>) -> ServicePath {
    ServicePath {
        path,
        exact: true,
        scope,
    }
}

impl ServicePath {
    /// Whether the route's segments take this path.
    fn admits(&self, route: &[&str]) -> bool {
        let own = segments(self.path);
        within(route, &own) && (!self.exact || route.len() == own.len())
    }
}

/// Where the host takes the events: at Twitch, on the user's own channel,
/// as broadcaster, and as moderator too where the type needs one; or from
/// the service's client on the user's computer, for the account the widget
/// names.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventCondition {
    Broadcaster,
    BroadcasterAndModerator,
    LocalClient,
}

/// The value of one field of an event, as the host projects it. Anything
/// else (absent, another type, an invalid identifier or time) is `null`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventValue {
    /// Text cut to this many characters, control characters as spaces,
    /// hidden characters removed as from display text
    /// ([`crate::text::strip_hidden`]).
    Text(usize),
    /// An identifier or keyword: ASCII letters, digits and `_-.:`, at most
    /// 64 bytes.
    Id,
    /// An integer below 2^53 in magnitude.
    Integer,
    Bool,
    /// An RFC 3339 time as Twitch writes it, at most 40 bytes.
    Time,
    Object(&'static [EventField]),
    /// A list of objects, cut to its first items.
    List(usize, &'static [EventField]),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EventField {
    pub name: &'static str,
    pub value: EventValue,
}

/// A live event a widget may receive.
#[derive(Debug, Eq, PartialEq)]
pub struct ServiceEvent {
    /// The service's own name of the type (`channel.goal.progress`).
    pub kind: &'static str,
    /// The version the host subscribes to.
    pub version: &'static str,
    /// The read scope a widget must declare itself to receive it; `None`
    /// for a service without scopes (a key).
    pub scope: Option<&'static str>,
    pub condition: EventCondition,
    /// The fields the widget receives, under the service's names; a field
    /// the service does not send for this type is `null`.
    pub fields: &'static [EventField],
}

const fn field(name: &'static str, value: EventValue) -> EventField {
    EventField { name, value }
}

const NAME_CHARS: usize = 64;
const TITLE_CHARS: usize = 120;
const CHOICE_CHARS: usize = 60;
const DESCRIPTION_CHARS: usize = 200;

const USER: [EventField; 3] = [
    field("user_id", EventValue::Id),
    field("user_login", EventValue::Id),
    field("user_name", EventValue::Text(NAME_CHARS)),
];
const BROADCASTER: [EventField; 3] = [
    field("broadcaster_user_id", EventValue::Id),
    field("broadcaster_user_login", EventValue::Id),
    field("broadcaster_user_name", EventValue::Text(NAME_CHARS)),
];

const GOAL_FIELDS: &[EventField] = &[
    field("id", EventValue::Id),
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("type", EventValue::Id),
    field("description", EventValue::Text(DESCRIPTION_CHARS)),
    field("current_amount", EventValue::Integer),
    field("target_amount", EventValue::Integer),
    field("started_at", EventValue::Time),
    field("is_achieved", EventValue::Bool),
    field("ended_at", EventValue::Time),
];

const FOLLOW_FIELDS: &[EventField] = &[
    USER[0],
    USER[1],
    USER[2],
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("followed_at", EventValue::Time),
];

const CONTRIBUTION: &[EventField] = &[
    USER[0],
    USER[1],
    USER[2],
    field("type", EventValue::Id),
    field("total", EventValue::Integer),
];

const PARTICIPANT: &[EventField] = &[BROADCASTER[0], BROADCASTER[1], BROADCASTER[2]];

const HYPE_TRAIN_FIELDS: &[EventField] = &[
    field("id", EventValue::Id),
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("type", EventValue::Id),
    field("level", EventValue::Integer),
    field("total", EventValue::Integer),
    field("progress", EventValue::Integer),
    field("goal", EventValue::Integer),
    field("top_contributions", EventValue::List(10, CONTRIBUTION)),
    field(
        "shared_train_participants",
        EventValue::List(10, PARTICIPANT),
    ),
    field("is_shared_train", EventValue::Bool),
    field("all_time_high_level", EventValue::Integer),
    field("all_time_high_total", EventValue::Integer),
    field("started_at", EventValue::Time),
    field("expires_at", EventValue::Time),
    field("ended_at", EventValue::Time),
    field("cooldown_ends_at", EventValue::Time),
];

// What viewers write with a cheer or a resubscription (`message`) is chat
// text: Helix does not give it under `bits:read` or
// `channel:read:subscriptions`, and a widget with an account may not read
// the chat (a sensitive capability). It is never part of an event.
const CHEER_FIELDS: &[EventField] = &[
    field("is_anonymous", EventValue::Bool),
    USER[0],
    USER[1],
    USER[2],
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("bits", EventValue::Integer),
];

const SUBSCRIPTION_FIELDS: &[EventField] = &[
    USER[0],
    USER[1],
    USER[2],
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("tier", EventValue::Id),
    field("is_gift", EventValue::Bool),
    field("is_anonymous", EventValue::Bool),
    field("total", EventValue::Integer),
    field("cumulative_total", EventValue::Integer),
    field("cumulative_months", EventValue::Integer),
    field("streak_months", EventValue::Integer),
    field("duration_months", EventValue::Integer),
];

const VOTING: &[EventField] = &[
    field("is_enabled", EventValue::Bool),
    field("amount_per_vote", EventValue::Integer),
];

const CHOICE: &[EventField] = &[
    field("id", EventValue::Id),
    field("title", EventValue::Text(CHOICE_CHARS)),
    field("bits_votes", EventValue::Integer),
    field("channel_points_votes", EventValue::Integer),
    field("votes", EventValue::Integer),
];

const POLL_FIELDS: &[EventField] = &[
    field("id", EventValue::Id),
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("title", EventValue::Text(TITLE_CHARS)),
    field("choices", EventValue::List(10, CHOICE)),
    field("bits_voting", EventValue::Object(VOTING)),
    field("channel_points_voting", EventValue::Object(VOTING)),
    field("status", EventValue::Id),
    field("started_at", EventValue::Time),
    field("ends_at", EventValue::Time),
    field("ended_at", EventValue::Time),
];

const PREDICTOR: &[EventField] = &[
    USER[0],
    USER[1],
    USER[2],
    field("channel_points_won", EventValue::Integer),
    field("channel_points_used", EventValue::Integer),
];

const OUTCOME: &[EventField] = &[
    field("id", EventValue::Id),
    field("title", EventValue::Text(CHOICE_CHARS)),
    field("color", EventValue::Id),
    field("users", EventValue::Integer),
    field("channel_points", EventValue::Integer),
    field("top_predictors", EventValue::List(5, PREDICTOR)),
];

const PREDICTION_FIELDS: &[EventField] = &[
    field("id", EventValue::Id),
    BROADCASTER[0],
    BROADCASTER[1],
    BROADCASTER[2],
    field("title", EventValue::Text(TITLE_CHARS)),
    field("outcomes", EventValue::List(10, OUTCOME)),
    field("winning_outcome_id", EventValue::Id),
    field("status", EventValue::Id),
    field("started_at", EventValue::Time),
    field("locks_at", EventValue::Time),
    field("locked_at", EventValue::Time),
    field("ended_at", EventValue::Time),
];

const fn on_channel(
    kind: &'static str,
    version: &'static str,
    scope: &'static str,
    fields: &'static [EventField],
) -> ServiceEvent {
    ServiceEvent {
        kind,
        version,
        scope: Some(scope),
        condition: EventCondition::Broadcaster,
        fields,
    }
}

const GOALS: &str = "channel:read:goals";
const HYPE_TRAINS: &str = "channel:read:hype_train";
const SUBSCRIPTIONS: &str = "channel:read:subscriptions";
const POLLS: &str = "channel:read:polls";
const PREDICTIONS: &str = "channel:read:predictions";

/// Twitch's EventSub types a widget may receive, version 1 of the list
/// (`twitch-events`): each on the user's own channel, each read by a scope
/// the table already offers.
pub const TWITCH_EVENTS: &[ServiceEvent] = &[
    on_channel("channel.goal.begin", "1", GOALS, GOAL_FIELDS),
    on_channel("channel.goal.progress", "1", GOALS, GOAL_FIELDS),
    on_channel("channel.goal.end", "1", GOALS, GOAL_FIELDS),
    ServiceEvent {
        kind: "channel.follow",
        version: "2",
        scope: Some("moderator:read:followers"),
        condition: EventCondition::BroadcasterAndModerator,
        fields: FOLLOW_FIELDS,
    },
    on_channel(
        "channel.hype_train.begin",
        "2",
        HYPE_TRAINS,
        HYPE_TRAIN_FIELDS,
    ),
    on_channel(
        "channel.hype_train.progress",
        "2",
        HYPE_TRAINS,
        HYPE_TRAIN_FIELDS,
    ),
    on_channel(
        "channel.hype_train.end",
        "2",
        HYPE_TRAINS,
        HYPE_TRAIN_FIELDS,
    ),
    on_channel("channel.cheer", "1", "bits:read", CHEER_FIELDS),
    on_channel("channel.subscribe", "1", SUBSCRIPTIONS, SUBSCRIPTION_FIELDS),
    on_channel(
        "channel.subscription.gift",
        "1",
        SUBSCRIPTIONS,
        SUBSCRIPTION_FIELDS,
    ),
    on_channel(
        "channel.subscription.message",
        "1",
        SUBSCRIPTIONS,
        SUBSCRIPTION_FIELDS,
    ),
    on_channel("channel.poll.begin", "1", POLLS, POLL_FIELDS),
    on_channel("channel.poll.progress", "1", POLLS, POLL_FIELDS),
    on_channel("channel.poll.end", "1", POLLS, POLL_FIELDS),
    on_channel(
        "channel.prediction.begin",
        "1",
        PREDICTIONS,
        PREDICTION_FIELDS,
    ),
    on_channel(
        "channel.prediction.progress",
        "1",
        PREDICTIONS,
        PREDICTION_FIELDS,
    ),
    on_channel(
        "channel.prediction.lock",
        "1",
        PREDICTIONS,
        PREDICTION_FIELDS,
    ),
    on_channel(
        "channel.prediction.end",
        "1",
        PREDICTIONS,
        PREDICTION_FIELDS,
    ),
];

/// The names of [`TWITCH_EVENTS`], in the same order.
pub const TWITCH_EVENT_TYPES: &[&str] = &[
    "channel.goal.begin",
    "channel.goal.progress",
    "channel.goal.end",
    "channel.follow",
    "channel.hype_train.begin",
    "channel.hype_train.progress",
    "channel.hype_train.end",
    "channel.cheer",
    "channel.subscribe",
    "channel.subscription.gift",
    "channel.subscription.message",
    "channel.poll.begin",
    "channel.poll.progress",
    "channel.poll.end",
    "channel.prediction.begin",
    "channel.prediction.progress",
    "channel.prediction.lock",
    "channel.prediction.end",
];

const STATS_FIELDS: &[EventField] = &[EventField {
    name: "appid",
    value: EventValue::Integer,
}];

/// Steam's local types a widget may receive, version 1 of the list
/// (`steam-events`). `stats.saved`: the Steam client of this computer saved
/// the stats of a game of the account the widget names, which it does at
/// each achievement unlocked and at other times (a game's start, Steam's
/// own sync). The host sees it by the date of the account's stats file of
/// that game and reads nothing in it.
pub const STEAM_EVENTS: &[ServiceEvent] = &[ServiceEvent {
    kind: "stats.saved",
    version: "1",
    scope: None,
    condition: EventCondition::LocalClient,
    fields: STATS_FIELDS,
}];

/// The names of [`STEAM_EVENTS`], in the same order.
pub const STEAM_EVENT_TYPES: &[&str] = &["stats.saved"];

/// The projection of an event's payload (`payload.event`) a widget
/// receives: every field of the type, `null` where Twitch sent none or
/// something else, nothing more. `None` when the payload is not an object
/// or the projection exceeds `MAX_SERVICE_EVENT_BYTES`.
pub fn project_event(event: &ServiceEvent, raw: &Value) -> Option<Value> {
    let projected = project_object(event.fields, raw.as_object()?);
    let bytes = serde_json::to_vec(&projected).ok()?.len() as u64;
    (bytes <= MAX_SERVICE_EVENT_BYTES.value).then_some(projected)
}

fn project_object(fields: &[EventField], raw: &Map<String, Value>) -> Value {
    let mut object = Map::new();
    for field in fields {
        let value = raw
            .get(field.name)
            .map_or(Value::Null, |value| project_value(field.value, value));
        object.insert(field.name.to_owned(), value);
    }
    Value::Object(object)
}

fn project_value(kind: EventValue, value: &Value) -> Value {
    const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;
    match kind {
        EventValue::Text(max) => value.as_str().map_or(Value::Null, |text| {
            Value::String(
                crate::text::strip_hidden(text)
                    .chars()
                    .take(max)
                    .map(|character| {
                        if character.is_control() {
                            ' '
                        } else {
                            character
                        }
                    })
                    .collect(),
            )
        }),
        EventValue::Id => value
            .as_str()
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-.:".contains(&byte))
            })
            .map_or(Value::Null, |id| Value::String(id.to_owned())),
        EventValue::Integer => match (value.as_i64(), value.as_u64()) {
            (Some(integer), _) if integer.unsigned_abs() <= MAX_SAFE_INTEGER => value.clone(),
            (_, Some(integer)) if integer <= MAX_SAFE_INTEGER => value.clone(),
            _ => Value::Null,
        },
        EventValue::Bool => value.as_bool().map_or(Value::Null, Value::Bool),
        EventValue::Time => value
            .as_str()
            .filter(|time| {
                (20..=40).contains(&time.len())
                    && time
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || b"TZ:.+-".contains(&byte))
            })
            .map_or(Value::Null, |time| Value::String(time.to_owned())),
        EventValue::Object(fields) => value
            .as_object()
            .map_or(Value::Null, |object| project_object(fields, object)),
        EventValue::List(max, fields) => value.as_array().map_or(Value::Null, |items| {
            Value::Array(
                items
                    .iter()
                    .filter_map(Value::as_object)
                    .take(max)
                    .map(|object| project_object(fields, object))
                    .collect(),
            )
        }),
    }
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
    /// The registrable domains of the service: a declared account never
    /// uses an address under them (origins, key page, OAuth endpoints).
    pub domains: &'static [&'static str],
    /// Methods of the routes of a widget that names the service.
    pub methods: &'static [&'static str],
    /// The paths a route on a secret origin may take.
    pub allowed_paths: &'static [ServicePath],
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
    /// Live events a widget may receive; empty for a service without.
    pub events: &'static [ServiceEvent],
    /// The feature a manifest that lists `events` needs.
    pub events_feature: Option<&'static str>,
    /// The pages a widget that names the service may open
    /// (`permissions.links`): exact origins and the path prefixes under
    /// them, none of which leads to a redirector to another site.
    pub links: &'static [ServiceLink],
}

/// Pages of a service's site a widget may open: a link rule of this origin
/// whose `pathPrefix` lies under one of these prefixes.
#[derive(Debug, Eq, PartialEq)]
pub struct ServiceLink {
    pub origin: &'static str,
    pub prefixes: &'static [&'static str],
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
    // Not documented by Valve: to be measured in a real test before release
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
    domains: &[
        "steampowered.com",
        "steamcommunity.com",
        "steamstatic.com",
        "steam-api.com",
        "steamgames.com",
        "steamcontent.com",
        "steamusercontent.com",
    ],
    methods: &["GET"],
    // The key has no scopes: every widget of the service reads the same.
    allowed_paths: &[
        prefix("/ISteamUser/"),
        prefix("/IPlayerService/"),
        prefix("/ISteamUserStats/"),
        prefix("/ISteamApps/"),
        prefix("/ISteamNews/"),
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
        // The "domain" field is undocumented for a person: a real test confirms
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
        // The interfaces this key reaches; a refused key gets 403. To
        // confirm in a real test before release.
        probe: Some("https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/"),
    }),
    oauth: None,
    scopes: &[],
    events: STEAM_EVENTS,
    events_feature: Some(FEATURE_STEAM_EVENTS),
    // The player's own pages (`/my/` is the signed-in player: privacy
    // settings, badges, inventory), profiles, game hubs and stats, and the
    // store's game pages; never `/linkfilter/`, Steam's redirector to any
    // address, nor the store's sign-in and its `redir`.
    links: &[
        ServiceLink {
            origin: "https://steamcommunity.com",
            prefixes: &["/my/", "/id/", "/profiles/", "/app/", "/stats/"],
        },
        ServiceLink {
            origin: "https://store.steampowered.com",
            prefixes: &["/app/"],
        },
    ],
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
    domains: &["twitch.tv", "jtvnw.net", "twitchcdn.net", "twitchsvc.net"],
    methods: &["GET"],
    // Each endpoint with the scope it reads: public data needs none.
    allowed_paths: &[
        endpoint("/helix/streams", None),
        endpoint("/helix/users", None),
        endpoint("/helix/channels", None),
        endpoint("/helix/games", None),
        endpoint("/helix/games/top", None),
        endpoint("/helix/clips", None),
        endpoint("/helix/videos", None),
        endpoint("/helix/schedule", None),
        endpoint("/helix/search/categories", None),
        endpoint("/helix/search/channels", None),
        endpoint("/helix/chat/emotes", None),
        endpoint("/helix/chat/emotes/global", None),
        endpoint("/helix/chat/badges", None),
        endpoint("/helix/chat/badges/global", None),
        endpoint("/helix/goals", Some("channel:read:goals")),
        endpoint(
            "/helix/channels/followers",
            Some("moderator:read:followers"),
        ),
        endpoint("/helix/hypetrain/status", Some("channel:read:hype_train")),
        endpoint("/helix/polls", Some("channel:read:polls")),
        endpoint("/helix/predictions", Some("channel:read:predictions")),
        endpoint("/helix/subscriptions", Some("channel:read:subscriptions")),
        endpoint("/helix/bits/leaderboard", Some("bits:read")),
        endpoint("/helix/charity/campaigns", Some("channel:read:charity")),
        endpoint("/helix/charity/donations", Some("channel:read:charity")),
        endpoint("/helix/channels/ads", Some("channel:read:ads")),
        endpoint("/helix/channels/vips", Some("channel:read:vips")),
        endpoint("/helix/chat/chatters", Some("moderator:read:chatters")),
    ],
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
    events: TWITCH_EVENTS,
    events_feature: Some(FEATURE_TWITCH_EVENTS),
    // The player's settings and their creator dashboard (goals, stream
    // manager).
    links: &[
        ServiceLink {
            origin: "https://www.twitch.tv",
            prefixes: &["/settings/"],
        },
        ServiceLink {
            origin: "https://dashboard.twitch.tv",
            prefixes: &["/u/"],
        },
    ],
};

/// What a manifest reader refuses of a declared account that imitates an
/// integrated service (`account_service`): its ID, a name that reads as one
/// of `names`, an address under `domains` or among `origins`, an OAuth
/// client of `client_ids`. Frozen with the first release that announces a
/// service's feature: a service or a domain added later joins only the
/// producers' checks (CLI, catalog-tool), never this list, so that a newer
/// reader never refuses a manifest an older one accepted.
#[derive(Debug, Eq, PartialEq)]
pub struct ServiceGuard {
    pub id: &'static str,
    /// Lowercase ASCII words; look-alike letters are folded before.
    pub names: &'static [&'static str],
    pub domains: &'static [&'static str],
    /// Origins outside `domains`.
    pub origins: &'static [&'static str],
    pub client_ids: &'static [&'static str],
}

/// The readers' guard of version 1 (`service-steam`, `service-twitch`).
pub const READER_GUARDS: &[ServiceGuard] = &[
    ServiceGuard {
        id: "steam",
        names: &["steam", "valve"],
        domains: &[
            "steampowered.com",
            "steamcommunity.com",
            "steamstatic.com",
            "steam-api.com",
            "steamgames.com",
            "steamcontent.com",
            "steamusercontent.com",
            "valvesoftware.com",
        ],
        origins: &["https://steamcdn-a.akamaihd.net"],
        client_ids: &[],
    },
    ServiceGuard {
        id: "twitch",
        names: &["twitch"],
        domains: &["twitch.tv", "jtvnw.net", "twitchcdn.net", "twitchsvc.net"],
        origins: &[],
        client_ids: &["4mnhecoh0nif054yubgwkkj2k7bma2"],
    },
];

impl ServiceGuard {
    /// Whether the lowercase `host` is under one of the domains or is one
    /// of the origins' hosts.
    pub fn owns_host(&self, host: &str) -> bool {
        self.domains.iter().any(|domain| {
            host == *domain
                || host
                    .strip_suffix(domain)
                    .is_some_and(|rest| rest.ends_with('.'))
        }) || self
            .origins
            .iter()
            .any(|origin| origin.strip_prefix("https://") == Some(host))
    }
}

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

    /// The live event type `kind` a widget may receive.
    pub fn event(&self, kind: &str) -> Option<&'static ServiceEvent> {
        self.events.iter().find(|event| event.kind == kind)
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

    /// Whether the host `host` (lowercase) is one of the service's domains or
    /// under one.
    pub fn owns_host(&self, host: &str) -> bool {
        self.domains.iter().any(|domain| {
            host == *domain
                || host
                    .strip_suffix(domain)
                    .is_some_and(|rest| rest.ends_with('.'))
        })
    }

    /// Whether `scopes`, the scopes a widget asked for, open this path.
    fn opens(&self, route: &[&str], scopes: &[&str]) -> bool {
        self.allowed_paths.iter().any(|allowed| {
            allowed.admits(route) && allowed.scope.is_none_or(|scope| scopes.contains(&scope))
        })
    }

    /// Whether a declared route path (with `{name}` parameters), on a secret
    /// origin, takes an allowed path that `scopes` (the widget's own) open,
    /// and cannot reach a refused one.
    pub fn route_path_allowed(&self, path: &str, scopes: &[&str]) -> bool {
        let route = segments(path);
        self.opens(&route, scopes)
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
    pub fn request_path_allowed(&self, path: &str, scopes: &[&str]) -> bool {
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
            && self.opens(&request, scopes)
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
            let allowed: Vec<&str> = service
                .allowed_paths
                .iter()
                .map(|allowed| allowed.path)
                .collect();
            for prefix in allowed.iter().chain(service.refused_paths) {
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
                for allowed in &allowed {
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
                    // The probe goes where the key goes, nowhere else.
                    let probe = key.probe.expect("a key service confirms a refusal");
                    let (origin, _) = https_url(probe, false).expect("a static HTTPS URL");
                    assert!(service.secret_origins.contains(&origin), "{probe}");
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

    /// Every scope Twitch offers, so that a path test is about the path.
    const ALL_TWITCH: &[&str] = &[
        "channel:read:goals",
        "moderator:read:followers",
        "channel:read:hype_train",
        "channel:read:polls",
        "channel:read:predictions",
        "channel:read:subscriptions",
        "bits:read",
        "channel:read:charity",
        "channel:read:ads",
        "channel:read:vips",
        "moderator:read:chatters",
    ];

    #[test]
    fn every_scope_opens_endpoints_and_every_endpoint_scope_is_offered() {
        assert_eq!(
            ALL_TWITCH,
            TWITCH
                .scopes
                .iter()
                .map(|scope| scope.name)
                .collect::<Vec<_>>()
        );
        for service in INTEGRATED_SERVICES {
            for allowed in service.allowed_paths {
                if let Some(scope) = allowed.scope {
                    assert!(service.scope(scope).is_some(), "{scope} is offered");
                    assert!(
                        allowed.exact,
                        "{}: a scoped path is one endpoint",
                        allowed.path
                    );
                }
            }
            for scope in service.scopes {
                assert!(
                    service
                        .allowed_paths
                        .iter()
                        .any(|allowed| allowed.scope == Some(scope.name)),
                    "{} opens an endpoint",
                    scope.name
                );
            }
        }
    }

    #[test]
    fn a_scoped_endpoint_needs_the_widgets_own_scope() {
        assert!(TWITCH.route_path_allowed("/helix/goals", &["channel:read:goals"]));
        assert!(!TWITCH.route_path_allowed("/helix/goals", &["moderator:read:followers"]));
        assert!(!TWITCH.route_path_allowed("/helix/goals", &[]));
        assert!(TWITCH.route_path_allowed("/helix/streams", &[]));
        assert!(
            !TWITCH.route_path_allowed("/helix/goals/{id}", ALL_TWITCH),
            "exact"
        );
        assert!(!TWITCH.route_path_allowed("/helix/moderation/banned", ALL_TWITCH));
        assert!(!TWITCH.request_path_allowed("/helix/subscriptions", &["bits:read"]));
        assert!(
            TWITCH.request_path_allowed("/helix/subscriptions", &["channel:read:subscriptions"])
        );
    }

    #[test]
    fn a_service_owns_its_domains_and_their_subdomains() {
        for host in [
            "steampowered.com",
            "api.steampowered.com",
            "store.steampowered.com",
            "partner.steam-api.com",
        ] {
            assert!(STEAM.owns_host(host), "{host}");
        }
        for host in [
            "notsteampowered.com",
            "steampowered.com.example",
            "example.com",
        ] {
            assert!(!STEAM.owns_host(host), "{host}");
        }
        assert!(TWITCH.owns_host("gql.twitch.tv"));
        assert!(!TWITCH.owns_host("mytwitch.tv"));
        // Every address of a service is its own: origins, pages, endpoints.
        for service in INTEGRATED_SERVICES {
            let mut urls: Vec<&str> = service.all_origins().collect();
            urls.extend(service.key.iter().map(|key| key.page));
            urls.extend(service.oauth.iter().flat_map(|oauth| oauth.endpoints()));
            for url in urls {
                let host = url
                    .trim_start_matches("https://")
                    .split(['/', ':'])
                    .next()
                    .unwrap_or_default();
                assert!(
                    service.owns_host(host) || service.all_origins().any(|origin| origin == url),
                    "{url}"
                );
            }
        }
    }

    #[test]
    fn route_paths_stay_within_the_allowed_interfaces() {
        // A parameter may take any value, a refused segment's included.
        let refused = segments("/IEconService/");
        assert!(may_reach(
            &segments("/{interface}/GetTradeOffers/v1/"),
            &refused
        ));
        assert!(!may_reach(&segments("/ISteamUser/{method}/v1/"), &refused));
        for path in [
            "/ISteamUser/GetPlayerSummaries/v2/",
            "/isteamuser/getplayersummaries/v2/",
            "/ISteamUserStats/GetPlayerAchievements/v1/",
            "/IPlayerService/GetRecentlyPlayedGames/v1/",
        ] {
            assert!(STEAM.route_path_allowed(path, &[]), "{path}");
        }
        for path in [
            "/IStoreService/GetAppList/v1/",
            "/IEconService/GetTradeOffers/v1/",
            "/ieconservice/GetTradeOffers/v1/",
            "/{interface}/GetTradeOffers/v1/",
            "/IGameServersService/GetAccountList/v1/",
            "/",
        ] {
            assert!(!STEAM.route_path_allowed(path, &[]), "{path}");
        }
        for path in [
            "/helix/goals",
            "/helix/channels/followers",
            "/helix/streams",
        ] {
            assert!(TWITCH.route_path_allowed(path, ALL_TWITCH), "{path}");
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
            assert!(!TWITCH.route_path_allowed(path, ALL_TWITCH), "{path}");
        }
    }

    #[test]
    fn the_host_checks_the_path_it_sends() {
        assert!(STEAM.request_path_allowed("/ISteamUser/GetPlayerSummaries/v2/", &[]));
        assert!(TWITCH.request_path_allowed("/helix/streams", &[]));
        for path in [
            "/IEconService/CancelTradeOffer/v1/",
            "/IECONSERVICE/CancelTradeOffer/v1/",
            "/ISteamUser%2F../IEconService/x",
            "/{x}/GetPlayerSummaries/v2/",
        ] {
            assert!(!STEAM.request_path_allowed(path, &[]), "{path}");
        }
        assert!(!TWITCH.request_path_allowed("/helix/streams/key", ALL_TWITCH));
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
            assert!(!STEAM.request_path_allowed(path, &[]), "{path}");
        }
        assert!(STEAM.request_path_allowed("/ISteamUser/GetPlayerSummaries/v2", &[]));
    }

    /// A server may drop the final dots of a segment (`key.` is `key`): a
    /// refused prefix is compared without them.
    #[test]
    fn final_dots_never_hide_a_refused_segment() {
        // The refused prefixes guard what an allowed prefix may still cover
        // (a path refused later, a future interface): checked directly.
        let refused = segments("/helix/streams/key");
        for path in [
            "/helix/streams/key.",
            "/helix/streams/KEY..",
            "/helix/streams/key/x",
        ] {
            assert!(may_reach(&segments(path), &refused), "{path}");
        }
        assert!(!may_reach(&segments("/helix/streams/keys"), &refused));
        for path in [
            "/helix/streams/key.",
            "/helix/streams/key..",
            "/helix/eventsub./x",
        ] {
            assert!(!TWITCH.route_path_allowed(path, ALL_TWITCH), "route {path}");
            assert!(
                !TWITCH.request_path_allowed(path, ALL_TWITCH),
                "request {path}"
            );
        }
    }

    /// A service whose allowed prefix covers its refused paths: only the
    /// refusals keep a route or a request from them (every real service's
    /// allow-list refuses first, which would hide a broken refusal).
    const WIDE: IntegratedService = IntegratedService {
        id: "wide",
        name: "Wide",
        feature: "service-wide",
        allowed_paths: &[prefix("/helix/")],
        refused_paths: &["/helix/streams/key", "/helix/extensions/"],
        ..TWITCH
    };

    #[test]
    fn refused_paths_hold_under_a_wide_allowed_prefix() {
        for path in ["/helix/streams", "/helix/goals", "/helix/streams/keys"] {
            assert!(WIDE.route_path_allowed(path, &[]), "route {path}");
            assert!(WIDE.request_path_allowed(path, &[]), "request {path}");
        }
        for path in [
            "/helix/streams/key",
            "/HELIX/Streams/Key",
            "/helix/streams/key.",
            "/helix/streams/key/x",
            "/helix/extensions/jwt/secrets",
        ] {
            assert!(!WIDE.route_path_allowed(path, &[]), "route {path}");
            assert!(!WIDE.request_path_allowed(path, &[]), "request {path}");
        }
        // A parameter may take the refused segment.
        for path in [
            "/helix/streams/{x}",
            "/helix/{kind}/key",
            "/helix/{kind}/jwt",
        ] {
            assert!(!WIDE.route_path_allowed(path, &[]), "route {path}");
        }
    }
}
