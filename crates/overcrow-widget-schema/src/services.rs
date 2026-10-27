//! Host services reachable through `ServiceCall`, and the host-bound write
//! intents submitted by a `form`. The capability operations and result shapes
//! follow the P0.6 audit of the built-ins.
//!
//! Every timestamp is on one of two clocks: `at` fields use the host
//! monotonic clock in milliseconds, for durations extrapolated with the
//! `elapsed` element; `…At` fields are Unix milliseconds displayed in local
//! time with the `offsetMinutes` the host sends next to them.

use crate::limits::{
    MAX_ACCOUNT_ID_BYTES, MAX_CHAT_CHANNEL_BYTES, MAX_CHAT_MESSAGE_CHARS, MAX_CLIPBOARD_BYTES,
    MAX_LINK_URL_BYTES, MAX_NOTE_BODY_BYTES, MAX_NOTE_ITEMS, MAX_NOTE_TITLE_BYTES,
    MAX_OBJECT_ID_BYTES, MAX_REQUEST_URL_BYTES, MAX_REVIEW_CHARS, MAX_SERVICE_EVENTS,
    MAX_STEAMID_BYTES, MAX_STORAGE_KEY_BYTES, MIN_TIMER_INTERVAL_MS,
};
use crate::model::{Field, Status, ValueType};
use crate::results::Shape;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Requirement {
    None,
    Permission(&'static str),
    Capability(&'static str),
    /// A third-party account the manifest declares and the user granted
    /// (`account:<id>`), named by the call's `id` parameter.
    Account,
    /// The integrated service of this ID, named by the manifest and granted
    /// by the user (`account:<id>`).
    Service(&'static str),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ServiceKind {
    /// One `ServiceResult` with `final: true`.
    Call,
    /// `ServiceResult` updates with `final: false` until `subscription.cancel`,
    /// a failure or a retired generation; the host coalesces to the latest.
    Subscribe,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Service {
    pub name: &'static str,
    pub requires: Requirement,
    pub kind: ServiceKind,
    /// Accepted only while the VM handles a gesture event of the current
    /// Interactive epoch.
    pub gesture: bool,
    /// The host shows a native confirmation drawn in trusted chrome first.
    pub confirm: bool,
    pub params: &'static [Field],
    pub result: &'static str,
    /// Shape of the result value and of every subscription update.
    pub returns: Shape,
    pub status: Status,
}

impl Service {
    const fn returning(mut self, shape: Shape) -> Self {
        self.returns = shape;
        self
    }
}

const OBJECT_ID: ValueType = ValueType::Text(&MAX_OBJECT_ID_BYTES);
const STORAGE_KEY: ValueType = ValueType::Text(&MAX_STORAGE_KEY_BYTES);
const NONE: &[Field] = &[];
const MEDIA_PLAYER: &[Field] = &[Field::optional(
    "player",
    OBJECT_ID,
    "Player ID from `media.subscribe`; guards against a player change.",
)];
const ACCOUNT: &[Field] = &[Field::required(
    "id",
    ValueType::Identifier(&MAX_ACCOUNT_ID_BYTES),
    "`id` of an account the manifest declares, or of the integrated service it names, that the user granted.",
)];
const CURSOR: &[Field] = &[Field::optional(
    "cursor",
    OBJECT_ID,
    "Opaque page cursor; absent for the first page.",
)];

const fn call(
    name: &'static str,
    requires: Requirement,
    params: &'static [Field],
    result: &'static str,
    status: Status,
) -> Service {
    Service {
        name,
        requires,
        kind: ServiceKind::Call,
        gesture: false,
        confirm: false,
        params,
        result,
        returns: Shape::Json,
        status,
    }
}

const fn subscribe(
    name: &'static str,
    capability: &'static str,
    result: &'static str,
    status: Status,
) -> Service {
    Service {
        name,
        requires: Requirement::Capability(capability),
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: NONE,
        result,
        returns: Shape::Json,
        status,
    }
}

const fn gesture(mut service: Service) -> Service {
    service.gesture = true;
    service
}

const fn confirmed(mut service: Service) -> Service {
    service.gesture = true;
    service.confirm = true;
    service
}

const fn cap(name: &'static str) -> Requirement {
    Requirement::Capability(name)
}

pub const SERVICES: &[Service] = &[
    call(
        "subscription.cancel",
        Requirement::None,
        &[Field::required(
            "call",
            ValueType::Id,
            "`callId` of the subscription.",
        )],
        "`null`",
        Status::Fixed,
    )
    .returning(Shape::Null),
    call(
        "timer.start",
        Requirement::None,
        &[
            Field::required(
                "timer",
                ValueType::Id,
                "Widget-chosen timer ID, ≤ `MAX_TIMERS` active.",
            ),
            Field::required(
                "intervalMs",
                ValueType::Integer {
                    min: MIN_TIMER_INTERVAL_MS.value as i64,
                    max: 86_400_000,
                },
                "Period.",
            ),
            Field::required("repeat", ValueType::Bool, "Repeat until cancelled."),
        ],
        "`null`; ticks arrive as `timer` events, never while hidden",
        Status::Fixed,
    )
    .returning(Shape::Null),
    call(
        "timer.cancel",
        Requirement::None,
        &[Field::required("timer", ValueType::Id, "Timer ID.")],
        "`null`",
        Status::Fixed,
    )
    .returning(Shape::Null),
    call(
        "storage.get",
        Requirement::Permission("storage"),
        &[Field::required("key", STORAGE_KEY, "Key.")],
        "stored JSON value or `null`",
        Status::Fixed,
    )
    .returning(Shape::Json),
    call(
        "storage.set",
        Requirement::Permission("storage"),
        &[
            Field::required("key", STORAGE_KEY, "Key, ≤ `MAX_STORAGE_KEYS` keys."),
            Field::required(
                "value",
                ValueType::Json,
                "JSON value ≤ `MAX_STORAGE_VALUE_BYTES`.",
            ),
        ],
        "`null`; `quota_exceeded` beyond `STORAGE_QUOTA_BYTES`",
        Status::Fixed,
    )
    .returning(Shape::Null),
    call(
        "storage.remove",
        Requirement::Permission("storage"),
        &[Field::required("key", STORAGE_KEY, "Key.")],
        "`null`",
        Status::Fixed,
    )
    .returning(Shape::Null),
    call(
        "storage.keys",
        Requirement::Permission("storage"),
        NONE,
        "list of keys",
        Status::Fixed,
    )
    .returning(Shape::List(&Shape::Text)),
    call(
        "http.fetch",
        Requirement::Permission("network"),
        &[
            Field::required(
                "url",
                ValueType::Text(&MAX_REQUEST_URL_BYTES),
                "Original URL text matched against the declared rules.",
            ),
            Field::required(
                "method",
                ValueType::Keyword(&["GET", "POST", "PUT", "PATCH", "DELETE"]),
                "Method of the matching rule.",
            ),
            Field::optional(
                "contentType",
                ValueType::Keyword(&["application/json", "text/plain"]),
                "Type of the request body, sent as the raw payload ≤ `MAX_HTTP_REQUEST_BYTES`.",
            ),
            Field::required(
                "as",
                ValueType::Keyword(&["json", "text", "bytes", "image"]),
                "`image` decodes the body in the host and returns an `asset:` handle.",
            ),
        ],
        "`{ status, contentType, headers }` with the body as raw payload ≤ the rule's `maxResponseBytes` (`MAX_HTTP_RESPONSE_BYTES` when absent), or `{ status, asset, headers }` from a body ≤ `MAX_HTTP_RESPONSE_BYTES`; `headers` holds the response's headers of `RESPONSE_HEADERS` only; on a rule that names an account, `not_connected` while it is not connected and `account_refused` when the service refused its secret",
        Status::Fixed,
    )
    .returning(Shape::Named("HttpResponse")),
    gesture(call(
        "clipboard.writeText",
        Requirement::Permission("clipboardWrite"),
        &[Field::required(
            "text",
            ValueType::Text(&MAX_CLIPBOARD_BYTES),
            "Text.",
        )],
        "`null`",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    confirmed(call(
        "links.open",
        Requirement::Permission("links"),
        &[Field::required(
            "url",
            ValueType::Text(&MAX_LINK_URL_BYTES),
            "Absolute `https` address of a page a link rule allows.",
        )],
        "`null` once the host handed the address to the browser. The host shows the address and, the first time for its origin, asks the user, who may later take that back in the Control Center; `cancelled` when the user declines; `permission_denied` for an address no rule allows; `url_invalid` for one that is not a plain HTTPS address (credentials, a path with encoded or dot segments, beyond `MAX_LINK_URL_BYTES`); `busy` while a confirmation is open; `unavailable` when no browser could open it",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    Service {
        name: "gameEvents.subscribe",
        requires: Requirement::Permission("gameEvents"),
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: NONE,
        result: "`{ event, at }` for each declared event",
        returns: Shape::Json,
        status: Status::Fixed,
    }
    .returning(Shape::Named("GameEvent")),
    subscribe(
        "session.subscribe",
        "session.read",
        "`{ elapsedMs, at }` counted from the start of the game process, or `null` without an active game",
        Status::Fixed,
    )
    .returning(Shape::Nullable(&Shape::Named("Session"))),
    subscribe(
        "game.subscribe",
        "game.read",
        "`{ steamAppId, name }` of the active game, or `null` without one: `steamAppId` is the game's Steam app ID, `null` for a game outside the Steam store (a game added by hand, a non-Steam shortcut), and `name` the game's name in the user's game list, `null` when the host has none",
        Status::Fixed,
    )
    .returning(Shape::Nullable(&Shape::Named("Game"))),
    subscribe(
        "telemetry.subscribe",
        "telemetry.read",
        "`{ cpu, ram, cpuTemperature, gpuTemperature, sources }`, or `null` without an active game: `cpu` is the game's share of the whole machine in % (0–100), `ram` its resident bytes, temperatures are °C or `null`, `sources` `{ cpuTemperature, gpuTemperature }` says whether the host has each sensor",
        Status::Fixed,
    )
    .returning(Shape::Nullable(&Shape::Named("Telemetry"))),
    subscribe(
        "fps.subscribe",
        "fps.read",
        "`{ fps, stale, status }`: `fps` a number or `null`; the host sets `stale` 3 s after the last sample; `status` is `ready`, `waiting`, `unsupported`, `permission_denied`, `ambiguous`, `events_lost` or `unavailable`",
        Status::Fixed,
    )
    .returning(Shape::Named("Fps")),
    Service {
        name: "media.subscribe",
        requires: Requirement::Capability("media.read"),
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: &[Field::optional(
            "cover",
            ValueType::Bool,
            "Request the cover art; default `true`. `false` stops the host from loading it.",
        )],
        result: "`null` without a player, or `{ player, title, artists, playing, canPrevious, canPlayPause, canNext, cover }`: `player` an opaque ID, `artists` a list, `cover` an `asset:` handle of at most 512 px or `null`",
        returns: Shape::Json,
        status: Status::Fixed,
    }
    .returning(Shape::Nullable(&Shape::Named("Media"))),
    gesture(call(
        "media.previous",
        cap("media.control"),
        MEDIA_PLAYER,
        "`null`; `stale_context` when `player` is no longer current",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    gesture(call(
        "media.playPause",
        cap("media.control"),
        MEDIA_PLAYER,
        "`null`; `stale_context` when `player` is no longer current",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    gesture(call(
        "media.next",
        cap("media.control"),
        MEDIA_PLAYER,
        "`null`; `stale_context` when `player` is no longer current",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    subscribe(
        "stopwatch.subscribe",
        "stopwatch.read",
        "`{ running, elapsedMs, at, shortcuts }`, or `null` without an active game; `shortcuts` `{ toggle, reset, bound }` holds host-formatted key chords",
        Status::Fixed,
    )
    .returning(Shape::Nullable(&Shape::Named("Stopwatch"))),
    gesture(call(
        "stopwatch.toggle",
        cap("stopwatch.control"),
        NONE,
        "the new state, as in `stopwatch.subscribe`; `unavailable` when the host cannot act",
        Status::Fixed,
    ))
    .returning(Shape::Nullable(&Shape::Named("Stopwatch"))),
    gesture(call(
        "stopwatch.reset",
        cap("stopwatch.control"),
        NONE,
        "the new state, as in `stopwatch.subscribe`; `unavailable` when the host cannot act",
        Status::Fixed,
    ))
    .returning(Shape::Nullable(&Shape::Named("Stopwatch"))),
    subscribe(
        "notes.subscribe",
        "notes.read",
        "`{ active, notes }` of the user's single notes document; each note `{ id, title, body, items }`, each item `{ id, text, checked }`",
        Status::Fixed,
    )
    .returning(Shape::Named("Notes")),
    gesture(call(
        "notes.create",
        cap("notes.write"),
        NONE,
        "`{ note }`, a new empty active note titled `Note {n}` in the user's language; `quota_exceeded` beyond `MAX_NOTES`",
        Status::Fixed,
    ))
    .returning(Shape::Named("CreatedNote")),
    gesture(call(
        "notes.select",
        cap("notes.write"),
        &[Field::required("note", OBJECT_ID, "Note ID.")],
        "`null`; the host stores the active note",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    gesture(call(
        "notes.setItem",
        cap("notes.write"),
        &[
            Field::required("note", OBJECT_ID, "Note ID."),
            Field::required("item", OBJECT_ID, "Checklist item ID."),
            Field::required("checked", ValueType::Bool, "New state."),
        ],
        "`null`",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    confirmed(call(
        "notes.delete",
        cap("notes.write"),
        &[Field::required("note", OBJECT_ID, "Note ID.")],
        "`null`, or `cancelled` when the user declines",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    subscribe(
        "playervox.score.subscribe",
        "playervox.score.read",
        "`{ state, name, score, grade, ratingsCount, criteria }`: `state` is `idle`, `unsupported`, `loading`, `ready`, `no_ratings`, `not_found` or `unavailable`; `criteria` `{ gameplay, art, tech }`, each 0–100 or `null`",
        Status::Fixed,
    )
    .returning(Shape::Named("Score")),
    subscribe(
        "playervox.rating.subscribe",
        "playervox.rating.read",
        "`{ state, name, offline, rating }`: `state` is `idle`, `unsupported`, `loading`, `ready` or `unavailable`; `rating` is `null` before the user's first rating, or `{ gameplay, art, tech, review, publishedAt, offsetMinutes }`. Nothing is sent while the PlayerVox account is signed out, pending or expired. A published rating is sent again by the subscription. The host seeds the `playervox.rating.publish` controls from it",
        Status::Fixed,
    )
    .returning(Shape::Named("RatingState")),
    subscribe(
        "playervox.reviews.subscribe",
        "playervox.reviews.read",
        "`{ state, revision, offline }`: `state` is `idle`, `unsupported` or `ready`; `revision` changes whenever the reviews to read change (another game, another PlayerVox account, reviews changed on PlayerVox), so the widget reads its page again; `offline` while PlayerVox is unreachable. Nothing is sent while the PlayerVox account is signed out, pending or expired. Holding this subscription is what keeps the host's reviews source running",
        Status::Fixed,
    )
    .returning(Shape::Named("ReviewsState")),
    call(
        "playervox.reviews.page",
        cap("playervox.reviews.read"),
        &[
            Field::optional(
                "page",
                ValueType::Integer {
                    min: 1,
                    max: 100_000,
                },
                "Page number; default 1.",
            ),
            Field::optional(
                "followedOnly",
                ValueType::Bool,
                "Only reviews of followed players; default `false`.",
            ),
        ],
        "`{ gameName, items, page, totalPages, count }`: three reviews of the active game per page, in the language of the host's interface; a page past the end answers the last page; each item `{ id, author, grade, score, text, original, hidden, publishedAt, offsetMinutes }`, `text` translated when a translation exists, `original` the untranslated text of a translated review or `null`, both cut by the host to `MAX_NODE_TEXT_BYTES`. Each call reads its own page: the host keeps no page position or filter shared between widgets",
        Status::Fixed,
    )
    .returning(Shape::Named("ReviewsPage")),
    subscribe(
        "journal.subscribe",
        "journal.read",
        "`null` without an active game, or `{ revision, notice }`: `revision` changes whenever the merged journal of the active game changes (a session recorded or deleted, cloud sessions merged, the PlayerVox account or sync changed), so the widget reads its page again; `notice` is `null`, `offline`, `storage_unavailable`, `full`, `expired`, `busy` or `unavailable`. Holding this subscription is what keeps the host's journal source running",
        Status::Fixed,
    )
    .returning(Shape::Nullable(&Shape::Named("JournalState"))),
    call(
        "journal.page",
        cap("journal.read"),
        CURSOR,
        "`{ gameName, items, page, next, previous }`: five local and cloud sessions of the active game, merged and deduplicated, newest first; without `cursor`, the first page; each item `{ id, startedAt, offsetMinutes, durationMs, source }`; cursors are host handles that stay valid for the widget whatever other widgets read, and a cursor past the end answers the last page",
        Status::Fixed,
    )
    .returning(Shape::Named("JournalPage")),
    confirmed(call(
        "journal.delete",
        cap("journal.delete"),
        &[Field::required("session", OBJECT_ID, "Journal session ID.")],
        "`null`, or `cancelled` when the user declines; `not_connected` for a cloud session while PlayerVox is disconnected",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    subscribe(
        "twitch.chat.subscribe",
        "twitch.chat.read",
        "`{ account, channel, joinState, failure, favorites, canSend, generation, reset, messages, removed, skipped }`: `account` is `signed_out`, `pending`, `connected` or `expired` (sign-in is host chrome); `failure` is the fixed category of a `failed` join; messages arrive as deltas, at most one update per 100 ms, with `reset` after subscribing, a generation change or a show, and nothing while the widget is hidden; a faster chat is sampled, `skipped` counting the new messages left out; each message `{ id, author, color, badges, fragments, reply, deleted, receivedAt }` with at most `MAX_CHAT_FRAGMENTS` fragments, emotes and badges as `asset:` handles for the current theme and scale",
        Status::Fixed,
    )
    .returning(Shape::Named("TwitchChat")),
    gesture(call(
        "twitch.chat.join",
        cap("twitch.chat.read"),
        &[Field::required(
            "channel",
            ValueType::Text(&MAX_CHAT_CHANNEL_BYTES),
            "Channel login.",
        )],
        "`null`; the host remembers the channel and rejoins it when the widget starts",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    gesture(call(
        "twitch.chat.leave",
        cap("twitch.chat.read"),
        NONE,
        "`null`; the host forgets the channel",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    gesture(call(
        "twitch.chat.favorite",
        cap("twitch.chat.read"),
        &[
            Field::required(
                "channel",
                ValueType::Text(&MAX_CHAT_CHANNEL_BYTES),
                "Channel login.",
            ),
            Field::required("favorite", ValueType::Bool, "Add or remove."),
        ],
        "`null`; `quota_exceeded` beyond `MAX_CHAT_FAVORITES`",
        Status::Fixed,
    ))
    .returning(Shape::Null),
    Service {
        name: "account.subscribe",
        requires: Requirement::Account,
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: ACCOUNT,
        result: "`{ state }` at once, then at each change: `signed_out`, `pending` (a sign-in step is open), `connected`, `refused` (the service refused the key) or `expired` (the service asks to sign in again). The widget never sees the secret, the account's name or its scopes; with `required`, the host covers the content until the account is connected",
        returns: Shape::Named("AccountStatus"),
        status: Status::Fixed,
    },
    Service {
        name: "twitch.events.subscribe",
        requires: Requirement::Service("twitch"),
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: &[Field::optional(
            "types",
            ValueType::ListOf("event type", &MAX_SERVICE_EVENTS),
            "Distinct event types among the declaration's `events`; default all of them. A type it does not list fails with `permission_denied`.",
        )],
        result: "`{ state, reason, events }` at once, then at each change. `state` is `live` once the host has subscribed at Twitch, `off` otherwise, with `reason` `connecting`, `not_connected` (Twitch is not connected, or its connection lacks a declared scope) or `unavailable` (Twitch refused or cannot be reached; the host retries). Twitch replays nothing: at each `live`, read once by `http.fetch` what changed meanwhile, and keep reading while `off`. `events` repeats the latest `SERVICE_EVENT_WINDOW` events of the subscription, oldest first, each `{ seq, type, at, data }`: updates are coalesced, so take only those whose `seq` is above the last one seen; a gap in `seq` means events were missed (read again). `data` is the host's projection of Twitch's event: every field of the type's table, `null` where Twitch sent none",
        returns: Shape::Named("TwitchEvents"),
        status: Status::Fixed,
    },
    Service {
        name: "steam.events.subscribe",
        requires: Requirement::Service("steam"),
        kind: ServiceKind::Subscribe,
        gesture: false,
        confirm: false,
        params: &[
            Field::required(
                "steamid",
                ValueType::Text(&MAX_STEAMID_BYTES),
                "The SteamID64 of the account the widget follows: 17 digits, an individual account. Another value fails with `invalid_request`.",
            ),
            Field::optional(
                "types",
                ValueType::ListOf("event type", &MAX_SERVICE_EVENTS),
                "Distinct event types among the declaration's `events`; default all of them. A type it does not list fails with `permission_denied`.",
            ),
        ],
        result: "`{ state, reason, events }` at once, then at each change. `state` is `live` while the host watches the Steam client's stats on this computer, `off` otherwise, with `reason` `connecting`, `not_connected` (Steam is not connected) or `unavailable` (no Steam client found on this computer). Steam pushes nothing and the host replays nothing: the events only say when to read again by `http.fetch`, and the widget keeps reading at its own pace too (Steam may run on another computer). `events` repeats the latest `SERVICE_EVENT_WINDOW` events of the subscription, oldest first, each `{ seq, type, at, data }`: updates are coalesced, so take only those whose `seq` is above the last one seen; a gap in `seq` means events were missed (read again). `stats.saved`: the Steam client saved the stats of a game of that account, at each achievement unlocked and at other times; `data` is `{ appid }`, `at` the time of the save. At most one subscription per widget at a time: another fails with `busy`",
        returns: Shape::Named("SteamEvents"),
        status: Status::Fixed,
    },
    Service {
        name: "steam.achievements.local",
        requires: Requirement::Service("steam"),
        kind: ServiceKind::Call,
        gesture: false,
        confirm: false,
        params: &[
            Field::required(
                "steamid",
                ValueType::Text(&MAX_STEAMID_BYTES),
                "The SteamID64 of the account the widget follows: 17 digits, an individual account. Another value fails with `invalid_request`.",
            ),
            Field::required(
                "appid",
                ValueType::Integer {
                    min: 1,
                    max: 4_294_967_295,
                },
                "The game's Steam app ID.",
            ),
            Field::optional(
                "offset",
                ValueType::Integer {
                    min: 0,
                    max: 1_000_000,
                },
                "How many achievements of the order to skip, for the next page; default 0.",
            ),
        ],
        result: "`{ appid, total, achievements }`: the achievements of that game the Steam client of this computer saved as unlocked for that account, read-only from its own stats files, even before Steam publishes them online and whatever the game details' privacy. `total` counts them all; `achievements` gives at most `MAX_LOCAL_ACHIEVEMENTS` from `offset`, newest first, each `{ name, unlockedAt }`: the API name, as `GetSchemaForGame` and `GetPlayerAchievements` give it, and the unlock time in Unix milliseconds, `null` when Steam saved none. Nothing else of the files. An empty list: no achievement unlocked yet. Needs the declaration's `local: [\"achievements\"]` (`permission_denied` without), not a connected key. `unavailable` when the computer has no Steam client, no stats of that account and game, or files the host cannot read or does not know: keep reading Steam's Web API. One call per widget at a time: another fails with `busy`",
        returns: Shape::Named("SteamLocalAchievements"),
        status: Status::Fixed,
    },
    gesture(call(
        "account.connect",
        Requirement::Account,
        ACCOUNT,
        "`null`; the host shows its account panel for this account, in its current state: the widget's own button for an account that is not `required`",
        Status::Fixed,
    ))
    .returning(Shape::Null),
];

/// Closed failure codes of `ServiceResult`; network codes are the broker's.
pub const SERVICE_ERRORS: &[&str] = &[
    "invalid_request",
    "permission_denied",
    "gesture_required",
    "not_connected",
    "account_refused",
    "review_removed_by_moderation",
    "stale_context",
    "unavailable",
    "busy",
    "cancelled",
    "quota_exceeded",
    "unsupported",
    "url_invalid",
    "resolve_failed",
    "address_denied",
    "too_many_addresses",
    "peer_mismatch",
    "redirect_denied",
    "encoding_denied",
    "content_type_denied",
    "response_metadata_limit",
    "request_body_limit",
    "response_body_limit",
    "image_invalid",
    "timeout",
    "transport_failed",
];

/// A write whose text comes only from host-owned controls of a `form`
/// (ADR 0001, D1 amendment). Named fields not listed here are rejected.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WriteIntent {
    pub name: &'static str,
    pub capability: &'static str,
    /// Whether the form `target` attribute is required, optional or refused.
    pub target: Target,
    /// What plain Enter does in a `field` of the form.
    pub enter: Enter,
    pub fields: &'static [Field],
    pub status: Status,
}

/// Plain Enter in a single-line `field` of a form bound to the intent.
/// Ctrl+Enter in any text control and a `submit` button always submit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Enter {
    /// Submits the form.
    Submit,
    /// Moves the keyboard focus to the form's next text control and never
    /// submits: an editor of several fields (a note's title, body and
    /// checklist rows) is saved only on purpose.
    NextControl,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Target {
    Refused,
    Optional(&'static str),
    Required(&'static str),
}

pub const WRITE_INTENTS: &[WriteIntent] = &[
    WriteIntent {
        name: "notes.save",
        capability: "notes.write",
        target: Target::Required("note ID; the host seeds the bound controls from that note"),
        enter: Enter::NextControl,
        fields: &[
            Field::required(
                "title",
                ValueType::Text(&MAX_NOTE_TITLE_BYTES),
                "`field`; saved trimmed, and not empty.",
            ),
            Field::optional(
                "body",
                ValueType::Text(&MAX_NOTE_BODY_BYTES),
                "`textarea`; saved as written.",
            ),
            Field::optional(
                "item",
                ValueType::ListOf("NoteItem", &MAX_NOTE_ITEMS),
                "One `field` per checklist row, in order, each ≤ `MAX_NOTE_ITEM_BYTES`. The host remembers which item it seeded each field with: a row keeps that item's ID and check whichever rows the widget removes or moves, and a field that appeared since is a new, unchecked item. Rows are saved trimmed; an empty row is dropped. A note saved as it is stored is accepted without a write.",
            ),
        ],
        status: Status::Fixed,
    },
    WriteIntent {
        name: "playervox.rating.publish",
        capability: "playervox.rating.write",
        target: Target::Refused,
        enter: Enter::Submit,
        fields: &[
            Field::required(
                "gameplay",
                ValueType::Integer { min: 0, max: 100 },
                "`slider`; seeded from the user's rating, 50 before the first one.",
            ),
            Field::required(
                "art",
                ValueType::Integer { min: 0, max: 100 },
                "`slider`; seeded like `gameplay`.",
            ),
            Field::required(
                "tech",
                ValueType::Integer { min: 0, max: 100 },
                "`slider`; seeded like `gameplay`.",
            ),
            Field::optional(
                "review",
                ValueType::Chars(&MAX_REVIEW_CHARS),
                "`textarea`; seeded from the published review. An unchanged review is not sent again; an emptied one removes it.",
            ),
        ],
        status: Status::Fixed,
    },
    WriteIntent {
        name: "twitch.chat.send",
        capability: "twitch.chat.compose",
        target: Target::Optional("ID of the message replied to"),
        enter: Enter::Submit,
        fields: &[Field::required(
            "message",
            ValueType::Chars(&MAX_CHAT_MESSAGE_CHARS),
            "`field`; the host clears it after a successful send.",
        )],
        status: Status::Fixed,
    },
];

/// Names of [`WRITE_INTENTS`], usable in const attribute definitions.
pub const WRITE_INTENT_NAMES: &[&str] =
    &["notes.save", "playervox.rating.publish", "twitch.chat.send"];

pub fn service(name: &str) -> Option<&'static Service> {
    SERVICES.iter().find(|service| service.name == name)
}

pub fn write_intent(name: &str) -> Option<&'static WriteIntent> {
    WRITE_INTENTS.iter().find(|intent| intent.name == name)
}
