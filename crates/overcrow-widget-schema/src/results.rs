//! Typed shapes of the values the host sends back: service results,
//! subscription updates and `ServiceError`. They are the contract of the
//! host's capability projections and the source of the SDK's result types;
//! [`Shape::matches`] checks a JSON value against one.
//!
//! Records are exact: every member is present (a nullable member as `null`)
//! and no other key is. Only a [`Shape::Fields`] object, whose members are
//! some of a closed list of names, has members that may be absent.

use serde_json::{Map, Value};

use crate::game_events::warframe;
use crate::limits::MAX_HTTP_HEADER_VALUE_BYTES;
use crate::services::SERVICE_ERRORS;

/// The type of one JSON value.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shape {
    Null,
    Bool,
    /// Any finite number.
    Number,
    /// An integer number below 2^53 in magnitude.
    Integer,
    Text,
    Keyword(&'static [&'static str]),
    /// An `asset:` image handle issued by the host.
    Asset,
    /// Any JSON value (stored widget data).
    Json,
    Nullable(&'static Shape),
    List(&'static Shape),
    Record(&'static [Member]),
    /// Exactly one of these shapes; records are told apart by their keys.
    OneOf(&'static [Shape]),
    /// An object whose members are some of these names, each of the shape:
    /// a member that does not apply is absent.
    Fields(&'static [&'static str], &'static Shape),
    /// A shape of [`SHAPES`], by name.
    Named(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Member {
    pub name: &'static str,
    pub shape: Shape,
    pub summary: &'static str,
}

/// A shape shared by several services, named in the reference and the SDK.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NamedShape {
    pub name: &'static str,
    pub shape: Shape,
    pub summary: &'static str,
}

const fn member(name: &'static str, shape: Shape, summary: &'static str) -> Member {
    Member {
        name,
        shape,
        summary,
    }
}

const fn named(name: &'static str, shape: Shape, summary: &'static str) -> NamedShape {
    NamedShape {
        name,
        shape,
        summary,
    }
}

const NULLABLE_TEXT: Shape = Shape::Nullable(&Shape::Text);
const NULLABLE_NUMBER: Shape = Shape::Nullable(&Shape::Number);
const NULLABLE_INTEGER: Shape = Shape::Nullable(&Shape::Integer);
const HOST_CLOCK: &str = "Host monotonic clock in ms at which `elapsedMs` was measured.";
const OFFSET: &str = "UTC offset in minutes to show the timestamp with.";
const FEATURE_STATUS: Shape = Shape::Keyword(crate::game_events::FEATURE_STATUSES);
const FEATURE_STATUS_SUMMARY: &str = "`available`, `unavailable` or `undeclared`.";
const SEQ: Member = member(
    "seq",
    Shape::Integer,
    "Order of the event in the subscription, from 1.",
);
const AT: Member = member(
    "at",
    Shape::Integer,
    "When it happened in the game, in Unix milliseconds.",
);

const WORD: &str = "Its name in the language of `glossary.language`.";

/// One text member per word of `list`, by its ID: a group of the glossary.
const fn words<const N: usize>(list: &'static [crate::game_events::Named]) -> [Member; N] {
    assert!(list.len() == N);
    let mut members = [member("", Shape::Text, WORD); N];
    let mut index = 0;
    while index < N {
        members[index] = member(list[index].id, Shape::Text, WORD);
        index += 1;
    }
    members
}

const SYMBOL: &str = "`asset:` handle of its symbol, `null` while PlayerVox OverCrow has none.";

/// One nullable image member per entry of `list`, by its ID.
const fn symbols<const N: usize>(list: &'static [crate::game_events::Named]) -> [Member; N] {
    assert!(list.len() == N);
    let mut members = [member("", Shape::Nullable(&Shape::Asset), SYMBOL); N];
    let mut index = 0;
    while index < N {
        members[index] = member(list[index].id, Shape::Nullable(&Shape::Asset), SYMBOL);
        index += 1;
    }
    members
}

const DAMAGE_WORDS: [Member; 13] = words(warframe::DAMAGE_TYPES);
const DAMAGE_SYMBOLS: [Member; 13] = symbols(warframe::DAMAGE_TYPES);
const ERA_WORDS: [Member; 6] = words(warframe::ERAS);
const FISSURE_WORDS: [Member; 6] = words(warframe::FISSURES);
const ACTIVITY_WORDS: [Member; 10] = words(warframe::ACTIVITIES);
const PLACE_WORDS: [Member; 17] = words(warframe::PLACES);
const EIDOLON_WORDS: [Member; 3] = words(warframe::EIDOLONS);
const FACTION_WORDS: [Member; 10] = words(warframe::FACTIONS);
const CYCLE_WORDS: [Member; 6] = words(warframe::CYCLE_STATES);
const TERM_WORDS: [Member; 3] = words(warframe::TERMS);

/// Grades of a PlayerVox score; `--` without a valid score.
pub const GRADES: &[&str] = &["S+", "S", "A", "B", "C", "D", "F", "--"];

pub const SHAPES: &[NamedShape] = &[
    named(
        "ServiceError",
        Shape::Record(&[member(
            "code",
            Shape::Keyword(SERVICE_ERRORS),
            "Failure code.",
        )]),
        "Failure of a call or of a subscription, and of a `submit` intent.",
    ),
    named(
        "HttpResponse",
        Shape::OneOf(&[
            Shape::Record(&[
                member("status", Shape::Integer, "HTTP status."),
                member(
                    "contentType",
                    NULLABLE_TEXT,
                    "Response media type; the body is the raw payload.",
                ),
                member(
                    "headers",
                    Shape::Named("HttpHeaders"),
                    "The response's headers of `RESPONSE_HEADERS`.",
                ),
            ]),
            Shape::Record(&[
                member("status", Shape::Integer, "HTTP status."),
                member(
                    "asset",
                    Shape::Asset,
                    "The decoded image (`as: \"image\"`).",
                ),
                member(
                    "headers",
                    Shape::Named("HttpHeaders"),
                    "The response's headers of `RESPONSE_HEADERS`.",
                ),
            ]),
        ]),
        "Answer of `http.fetch`.",
    ),
    named(
        "HttpHeaders",
        Shape::Fields(RESPONSE_HEADERS, &Shape::Text),
        "Headers of an `http.fetch` response, by lowercase name: only those of `RESPONSE_HEADERS` the response has, each printable ASCII of at most `MAX_HTTP_HEADER_VALUE_BYTES`; a repeated header is joined by `, `. Any other header never reaches the widget.",
    ),
    named(
        "Session",
        Shape::Record(&[
            member(
                "elapsedMs",
                Shape::Integer,
                "Time since the game process started.",
            ),
            member("at", Shape::Integer, HOST_CLOCK),
        ]),
        "Duration of the active game session.",
    ),
    named(
        "Game",
        Shape::Record(&[
            member(
                "steamAppId",
                NULLABLE_INTEGER,
                "Steam app ID, 1–2147483647, or `null` outside the Steam store.",
            ),
            member(
                "name",
                NULLABLE_TEXT,
                "Name in the user's game list, one line of at most 512 bytes, or `null`.",
            ),
        ]),
        "The active game.",
    ),
    named(
        "Telemetry",
        Shape::Record(&[
            member(
                "cpu",
                NULLABLE_NUMBER,
                "The game's share of the whole machine in %, 0–100.",
            ),
            member("ram", NULLABLE_INTEGER, "Resident bytes of the game."),
            member("cpuTemperature", NULLABLE_NUMBER, "°C."),
            member("gpuTemperature", NULLABLE_NUMBER, "°C."),
            member(
                "sources",
                Shape::Record(&[
                    member("cpuTemperature", Shape::Bool, "The host has a CPU sensor."),
                    member("gpuTemperature", Shape::Bool, "The host has a GPU sensor."),
                ]),
                "Sensors the host has.",
            ),
        ]),
        "Resource use of the active game.",
    ),
    named(
        "Fps",
        Shape::Record(&[
            member("fps", NULLABLE_INTEGER, "Frames per second."),
            member("stale", Shape::Bool, "No sample for 3 s."),
            member(
                "status",
                Shape::Keyword(&[
                    "ready",
                    "waiting",
                    "unsupported",
                    "permission_denied",
                    "ambiguous",
                    "events_lost",
                    "unavailable",
                ]),
                "Measurement state.",
            ),
        ]),
        "Frame rate of the active game.",
    ),
    named(
        "Stopwatch",
        Shape::Record(&[
            member("running", Shape::Bool, "Counting."),
            member("elapsedMs", Shape::Integer, "Elapsed time at `at`."),
            member("at", Shape::Integer, HOST_CLOCK),
            member(
                "shortcuts",
                Shape::Record(&[
                    member("toggle", Shape::Text, "Host-formatted key chord."),
                    member("reset", Shape::Text, "Host-formatted key chord."),
                    member("bound", Shape::Bool, "The shortcuts are active."),
                ]),
                "Stopwatch shortcuts.",
            ),
        ]),
        "The manual stopwatch.",
    ),
    named(
        "Media",
        Shape::Record(&[
            member("player", Shape::Text, "Opaque ID of the current player."),
            member("title", NULLABLE_TEXT, "Track title."),
            member("artists", Shape::List(&Shape::Text), "Artists."),
            member("playing", Shape::Bool, "Playing."),
            member("canPrevious", Shape::Bool, "The player supports previous."),
            member(
                "canPlayPause",
                Shape::Bool,
                "The player supports play/pause.",
            ),
            member("canNext", Shape::Bool, "The player supports next."),
            member(
                "cover",
                Shape::Nullable(&Shape::Asset),
                "Cover art, at most 512 px.",
            ),
        ]),
        "The current media player.",
    ),
    named(
        "NoteItem",
        Shape::Record(&[
            member("id", NULLABLE_TEXT, "Item ID."),
            member("text", Shape::Text, "Text."),
            member("checked", Shape::Bool, "Checked."),
        ]),
        "One checklist item.",
    ),
    named(
        "Note",
        Shape::Record(&[
            member("id", NULLABLE_TEXT, "Note ID."),
            member("title", Shape::Text, "Title."),
            member("body", Shape::Text, "Body text."),
            member(
                "items",
                Shape::List(&Shape::Named("NoteItem")),
                "Checklist.",
            ),
        ]),
        "One note.",
    ),
    named(
        "Notes",
        Shape::Record(&[
            member("active", NULLABLE_TEXT, "ID of the active note."),
            member("notes", Shape::List(&Shape::Named("Note")), "Notes."),
        ]),
        "The user's notes document.",
    ),
    named(
        "CreatedNote",
        Shape::Record(&[member("note", Shape::Named("Note"), "The new note.")]),
        "Answer of `notes.create`.",
    ),
    named(
        "Score",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(&[
                    "idle",
                    "unsupported",
                    "loading",
                    "ready",
                    "no_ratings",
                    "not_found",
                    "unavailable",
                ]),
                "Score state: `idle` without an active game, `unsupported` for a game without a Steam app ID, `loading` until the game's first answer (never the previous game's score), `ready` and `no_ratings` with the score, `not_found` for a game PlayerVox cannot match, `unavailable` while the host retries. Every state but `ready` and `no_ratings` has a `null` name and score, grade `--`, no ratings and `null` criteria.",
            ),
            member("name", NULLABLE_TEXT, "Game name."),
            member("score", NULLABLE_NUMBER, "0–100."),
            member("grade", Shape::Keyword(GRADES), "Grade of the score."),
            member("ratingsCount", Shape::Integer, "Number of ratings."),
            member(
                "criteria",
                Shape::Record(&[
                    member("gameplay", NULLABLE_NUMBER, "0–100."),
                    member("art", NULLABLE_NUMBER, "0–100."),
                    member("tech", NULLABLE_NUMBER, "0–100."),
                ]),
                "Criteria scores.",
            ),
        ]),
        "PlayerVox score of the active game.",
    ),
    named(
        "Rating",
        Shape::Record(&[
            member("gameplay", Shape::Integer, "0–100."),
            member("art", Shape::Integer, "0–100."),
            member("tech", Shape::Integer, "0–100."),
            member("review", NULLABLE_TEXT, "Review text."),
            member("publishedAt", NULLABLE_INTEGER, "Unix ms."),
            member("offsetMinutes", NULLABLE_INTEGER, OFFSET),
        ]),
        "The user's PlayerVox rating of the active game.",
    ),
    named(
        "RatingState",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(&["idle", "unsupported", "loading", "ready", "unavailable"]),
                "Rating state: `idle` without an active game, `unsupported` for a game without a Steam app ID, `loading` until the first answer for this game and account (never the previous game's rating), `ready` with the rating, `unavailable` while the host retries a failed read. Every state but `ready` has a `null` name and rating.",
            ),
            member("name", NULLABLE_TEXT, "Game name on PlayerVox."),
            member(
                "offline",
                Shape::Bool,
                "PlayerVox is unreachable: the rating is the last one read, and `playervox.rating.publish` answers `not_connected`.",
            ),
            member(
                "rating",
                Shape::Nullable(&Shape::Named("Rating")),
                "The user's rating; `null` before the first one.",
            ),
        ]),
        "The user's own rating of the active game, with its state.",
    ),
    named(
        "Review",
        Shape::Record(&[
            member("id", Shape::Text, "Review ID."),
            member("author", Shape::Text, "Author name."),
            member("grade", Shape::Keyword(GRADES), "Grade."),
            member("score", Shape::Integer, "0–100."),
            member(
                "text",
                NULLABLE_TEXT,
                "Text, translated when a translation exists.",
            ),
            member(
                "original",
                NULLABLE_TEXT,
                "Untranslated text when `text` is a translation; `null` otherwise.",
            ),
            member(
                "hidden",
                Shape::Bool,
                "Hidden by the community: show the text only once the user asks for it.",
            ),
            member("publishedAt", Shape::Integer, "Unix ms."),
            member("offsetMinutes", Shape::Integer, OFFSET),
        ]),
        "One player review.",
    ),
    named(
        "ReviewsState",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(&["idle", "unsupported", "ready"]),
                "`idle` without an active game, `unsupported` for a game without a Steam app ID, `ready` when `playervox.reviews.page` reads the game's reviews.",
            ),
            member(
                "revision",
                Shape::Integer,
                "Changes whenever the reviews to read change: another game, another PlayerVox account, or reviews changed on PlayerVox.",
            ),
            member(
                "offline",
                Shape::Bool,
                "PlayerVox is unreachable: `playervox.reviews.page` answers `not_connected`.",
            ),
        ]),
        "The player reviews of the active game: what to read, not the reviews.",
    ),
    named(
        "ReviewsPage",
        Shape::Record(&[
            member("gameName", Shape::Text, "Game name on PlayerVox."),
            member("items", Shape::List(&Shape::Named("Review")), "Reviews."),
            member("page", Shape::Integer, "Page number."),
            member("totalPages", Shape::Integer, "Number of pages."),
            member("count", Shape::Integer, "Number of reviews."),
        ]),
        "A page of player reviews.",
    ),
    named(
        "JournalSession",
        Shape::Record(&[
            member("id", Shape::Text, "Session ID."),
            member("startedAt", Shape::Integer, "Unix ms."),
            member("offsetMinutes", Shape::Integer, OFFSET),
            member("durationMs", Shape::Integer, "Duration."),
            member(
                "source",
                Shape::Keyword(&["local", "cloud"]),
                "Where the session is stored.",
            ),
        ]),
        "One journal session.",
    ),
    named(
        "JournalState",
        Shape::Record(&[
            member(
                "revision",
                Shape::Integer,
                "Changes whenever the merged journal of the active game changes.",
            ),
            member(
                "notice",
                Shape::Nullable(&Shape::Keyword(&[
                    "offline",
                    "storage_unavailable",
                    "full",
                    "expired",
                    "busy",
                    "unavailable",
                ])),
                "Journal condition to show above the sessions: `offline` sync is offline (local sessions remain), `storage_unavailable` the local journal cannot be read, `full` the local journal is full, `expired` the PlayerVox sign-in expired, `busy` PlayerVox asks to retry later, `unavailable` any other failure; `null` when none.",
            ),
        ]),
        "The journal of the active game.",
    ),
    named(
        "JournalPage",
        Shape::Record(&[
            member(
                "gameName",
                Shape::Text,
                "Active game; empty when the host has no name.",
            ),
            member(
                "items",
                Shape::List(&Shape::Named("JournalSession")),
                "Sessions, newest first.",
            ),
            member("page", Shape::Integer, "Page number, from 1."),
            member("next", NULLABLE_TEXT, "Cursor of the next page."),
            member("previous", NULLABLE_TEXT, "Cursor of the previous page."),
        ]),
        "A page of the game journal.",
    ),
    named(
        "ChatFragment",
        Shape::OneOf(&[
            Shape::Record(&[member("text", Shape::Text, "Text run.")]),
            Shape::Record(&[
                member("emote", Shape::Asset, "Emote image."),
                member("alt", Shape::Text, "Emote name."),
            ]),
        ]),
        "A text run or an emote of a chat message.",
    ),
    named(
        "ChatMessage",
        Shape::Record(&[
            member("id", Shape::Text, "Message ID."),
            member("author", Shape::Text, "Author name."),
            member("color", NULLABLE_TEXT, "Author colour `#rrggbb`."),
            member("badges", Shape::List(&Shape::Asset), "Badge images."),
            member(
                "fragments",
                Shape::List(&Shape::Named("ChatFragment")),
                "Content runs.",
            ),
            member(
                "reply",
                Shape::Nullable(&Shape::Record(&[
                    member("author", Shape::Text, "Author replied to."),
                    member("text", Shape::Text, "Text replied to."),
                ])),
                "The message replied to.",
            ),
            member("deleted", Shape::Bool, "Deleted by a moderator."),
            member(
                "receivedAt",
                Shape::Integer,
                "When the host received the message, in Unix milliseconds of the host's clock: compare it with `Date.now()` to age a message (the Passive fade), also after a `reset`.",
            ),
        ]),
        "One chat message.",
    ),
    named(
        "AccountStatus",
        Shape::Record(&[member(
            "state",
            Shape::Keyword(&["signed_out", "pending", "connected", "refused", "expired"]),
            "State of the account; connection is host chrome.",
        )]),
        "State of a third-party account the widget declares.",
    ),
    named(
        "TwitchChat",
        Shape::Record(&[
            member(
                "account",
                Shape::Keyword(&["signed_out", "pending", "connected", "expired"]),
                "Twitch account state; sign-in is host chrome.",
            ),
            member("channel", NULLABLE_TEXT, "Joined channel login."),
            member(
                "joinState",
                Shape::Keyword(&["idle", "connecting", "joined", "reconnecting", "failed"]),
                "Channel connection state.",
            ),
            member(
                "failure",
                Shape::Nullable(&Shape::Keyword(&[
                    "channel_unavailable",
                    "connection",
                    "provider",
                    "limit",
                ])),
                "Why `joinState` is `failed`, as a fixed category: the channel does not exist or refuses the account, the connection failed, Twitch answered something unexpected, or another widget holds the host's one chat connection (`limit`). `null` in every other state. An account failure is not here: the host draws it.",
            ),
            member("favorites", Shape::List(&Shape::Text), "Favorite channels."),
            member("canSend", Shape::Bool, "A message can be sent now."),
            member(
                "generation",
                Shape::Integer,
                "Changes with the channel or account.",
            ),
            member("reset", Shape::Bool, "`messages` replaces the whole list."),
            member(
                "messages",
                Shape::List(&Shape::Named("ChatMessage")),
                "Messages, oldest first: the whole list with `reset`; otherwise the new messages, to append, and the changed ones, which replace the message of the same `id` in place.",
            ),
            member(
                "removed",
                Shape::List(&Shape::Text),
                "IDs of removed messages.",
            ),
            member(
                "skipped",
                Shape::Integer,
                "New messages the host left out since the previous update, because the chat is faster than it delivers; 0 with `reset`. A removal is never left out.",
            ),
        ]),
        "Twitch chat state.",
    ),
    named(
        "TwitchEvent",
        Shape::Record(&[
            member(
                "seq",
                Shape::Integer,
                "Order of the event in the subscription, from 1, without gaps unless events were dropped.",
            ),
            member(
                "type",
                Shape::Keyword(crate::integrated::TWITCH_EVENT_TYPES),
                "The EventSub type, among those subscribed.",
            ),
            member(
                "at",
                Shape::Integer,
                "When the host received it, in Unix milliseconds of the host's clock.",
            ),
            member(
                "data",
                Shape::Json,
                "The host's projection of the event: the fields of the type's table under Twitch's names, `null` where Twitch sent none.",
            ),
        ]),
        "One live Twitch event.",
    ),
    named(
        "TwitchEvents",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(&["live", "off"]),
                "`live` while the host is subscribed at Twitch.",
            ),
            member(
                "reason",
                Shape::Nullable(&Shape::Keyword(&[
                    "connecting",
                    "not_connected",
                    "unavailable",
                ])),
                "Why the state is `off`; `null` when `live`.",
            ),
            member(
                "events",
                Shape::List(&Shape::Named("TwitchEvent")),
                "The latest events, oldest first.",
            ),
        ]),
        "Live Twitch events of the widget's declared types.",
    ),
    named(
        "SteamEvent",
        Shape::Record(&[
            member(
                "seq",
                Shape::Integer,
                "Order of the event in the subscription, from 1, without gaps unless events were dropped.",
            ),
            member(
                "type",
                Shape::Keyword(crate::integrated::STEAM_EVENT_TYPES),
                "The type, among those subscribed.",
            ),
            member(
                "at",
                Shape::Integer,
                "When the Steam client saved it, in Unix milliseconds of the host's clock, never later than the update.",
            ),
            member(
                "data",
                Shape::Json,
                "The fields of the type's table: `{ appid }` for `stats.saved`.",
            ),
        ]),
        "One local Steam event.",
    ),
    named(
        "SteamEvents",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(&["live", "off"]),
                "`live` while the host watches the Steam client's stats on this computer.",
            ),
            member(
                "reason",
                Shape::Nullable(&Shape::Keyword(&[
                    "connecting",
                    "not_connected",
                    "unavailable",
                ])),
                "Why the state is `off`; `null` when `live`.",
            ),
            member(
                "events",
                Shape::List(&Shape::Named("SteamEvent")),
                "The latest events, oldest first.",
            ),
        ]),
        "Local Steam events of the widget's declared types, for the account it names.",
    ),
    named(
        "SteamLocalAchievement",
        Shape::Record(&[
            member(
                "name",
                Shape::Text,
                "The achievement's API name, at most `MAX_ACHIEVEMENT_NAME_BYTES` of printable ASCII.",
            ),
            member(
                "unlockedAt",
                Shape::Nullable(&Shape::Integer),
                "When it was unlocked, in Unix milliseconds; `null` when Steam saved no time.",
            ),
        ]),
        "One achievement the Steam client of this computer saved as unlocked.",
    ),
    named(
        "SteamLocalAchievements",
        Shape::Record(&[
            member("appid", Shape::Integer, "The game asked for."),
            member(
                "total",
                Shape::Integer,
                "How many achievements of the game the files hold as unlocked.",
            ),
            member(
                "achievements",
                Shape::List(&Shape::Named("SteamLocalAchievement")),
                "A page of them, newest first (`null` times last, then by name).",
            ),
        ]),
        "The unlocked achievements of a game, read on this computer for the account the widget names.",
    ),
    named(
        "WarframeName",
        Shape::Record(&[
            member(
                "id",
                Shape::Text,
                "Our stable ID, in `snake_case`, listed in the game events page.",
            ),
            member(
                "name",
                NULLABLE_TEXT,
                "Its name in the game's language, one line of at most `MAX_GAME_EVENT_NAME_BYTES`; `null` when PlayerVox OverCrow has none yet.",
            ),
        ]),
        "Something of Warframe, named.",
    ),
    named(
        "WarframeNode",
        Shape::Record(&[
            member(
                "id",
                Shape::Text,
                "The game's own key of the node (`SolNode195`, `ClanNode…`, `SettlementNode…`), as public data such as drop tables and the world state name it.",
            ),
            member(
                "name",
                NULLABLE_TEXT,
                "Its name in the game's language, or `null` when PlayerVox OverCrow has none yet (new content).",
            ),
        ]),
        "A node of the star chart.",
    ),
    named(
        "WarframeEvents",
        Shape::Record(&[
            member(
                "playing",
                Shape::Bool,
                "Whether Warframe is the active game in PlayerVox OverCrow.",
            ),
            member(
                "session",
                Shape::Nullable(&Shape::Record(&[
                    member(
                        "startedAt",
                        Shape::Integer,
                        "When Warframe was launched, in Unix milliseconds.",
                    ),
                    member(
                        "language",
                        Shape::Nullable(&Shape::Keyword(warframe::LANGUAGES)),
                        "The game's language (`en`, `fr`, `de`…); `null` until the game says it.",
                    ),
                ])),
                "The Warframe session being followed, or `null` before any; a new launch is a new session.",
            ),
            member(
                "glossary",
                Shape::Named("WarframeGlossary"),
                "Words of the game in the game's language, whatever the features the widget follows.",
            ),
            member(
                "features",
                Shape::Named("WarframeFeatures"),
                "The status of each feature.",
            ),
            member(
                "info",
                Shape::Named("WarframeInfo"),
                "The state of each feature the widget follows.",
            ),
            member(
                "events",
                Shape::List(&Shape::Named("WarframeEvent")),
                "The latest events of the features the widget follows, oldest first.",
            ),
        ]),
        "Warframe's game events, for the features the widget lists.",
    ),
    named(
        "WarframeGlossary",
        Shape::Record(&[
            member(
                "language",
                Shape::Keyword(warframe::GLOSSARY_LANGUAGES),
                "The language of these words: the game's when PlayerVox OverCrow has them in it, English otherwise.",
            ),
            member(
                "damage",
                Shape::Record(&DAMAGE_WORDS),
                "The damage types, by our ID.",
            ),
            member("era", Shape::Record(&ERA_WORDS), "The Void Fissure eras."),
            member(
                "fissure",
                Shape::Record(&FISSURE_WORDS),
                "A Void Fissure of each era, by the era's ID.",
            ),
            member(
                "activity",
                Shape::Record(&ACTIVITY_WORDS),
                "Activities of the game.",
            ),
            member(
                "place",
                Shape::Record(&PLACE_WORDS),
                "The places that are not a node.",
            ),
            member("eidolon", Shape::Record(&EIDOLON_WORDS), "The Eidolons."),
            member("faction", Shape::Record(&FACTION_WORDS), "The factions."),
            member(
                "cycle",
                Shape::Record(&CYCLE_WORDS),
                "The states of the open worlds' cycles.",
            ),
            member(
                "term",
                Shape::Record(&TERM_WORDS),
                "Other words of the game.",
            ),
            member(
                "icons",
                Shape::Named("WarframeGlossaryIcons"),
                "The game's symbols, as images.",
            ),
        ]),
        "Words of the game a widget shows on their own, in the game's language, so that it never writes one itself.",
    ),
    named(
        "WarframeGlossaryIcons",
        Shape::Record(&[member(
            "damage",
            Shape::Record(&DAMAGE_SYMBOLS),
            "The damage types' symbols, by our ID: the official Warframe wiki's, 72 px square, the symbol 64 px in the middle; the pale ones (`impact`, `puncture`, `slash`, `radiation`) with a soft dark halo that keeps them readable on a light background.",
        )]),
        "The game's symbols, downloaded once by PlayerVox OverCrow on the player's computer; each `null` until then, or while the source cannot be reached.",
    ),
    named(
        "WarframeEarned",
        Shape::Record(&[
            member(
                "rotations",
                Shape::List(&Shape::Keyword(warframe::ROTATIONS)),
                "The rotations earned, in order, the latest `MAX_WARFRAME_EARNED`.",
            ),
            member(
                "totals",
                Shape::Record(&[
                    member("A", Shape::Integer, "Rotations A earned."),
                    member("B", Shape::Integer, "Rotations B earned."),
                    member("C", Shape::Integer, "Rotations C earned."),
                ]),
                "How many of each, all of them.",
            ),
        ]),
        "The rotations a mission earned.",
    ),
    named(
        "WarframeFeatures",
        Shape::Record(&[
            member("location", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("mission", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("progress", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("squad", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("eidolons", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("world", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
            member("rewards", FEATURE_STATUS, FEATURE_STATUS_SUMMARY),
        ]),
        "The status of each Warframe feature.",
    ),
    named(
        "WarframeInfo",
        Shape::Record(&[
            member(
                "location",
                Shape::Nullable(&Shape::Named("WarframeLocation")),
                "Where the player is; `null` while Warframe is not played.",
            ),
            member(
                "mission",
                Shape::Nullable(&Shape::Named("WarframeMission")),
                "The latest mission of the session.",
            ),
            member(
                "progress",
                Shape::Nullable(&Shape::Named("WarframeProgress")),
                "The progress of the latest mission.",
            ),
            member(
                "squad",
                Shape::Nullable(&Shape::Named("WarframeSquad")),
                "The squad.",
            ),
            member(
                "eidolons",
                Shape::Nullable(&Shape::Named("WarframeEidolons")),
                "The night on the Plains of Eidolon.",
            ),
            member(
                "world",
                Shape::Nullable(&Shape::Named("WarframeWorld")),
                "The world of the day and the week, whether Warframe is played or not.",
            ),
        ]),
        "The state of each Warframe feature; `null` for a feature the widget does not follow.",
    ),
    named(
        "WarframeLocation",
        Shape::Record(&[
            member(
                "kind",
                Shape::Keyword(warframe::LOCATION_KINDS),
                "What kind of place.",
            ),
            member(
                "place",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "Which one: a hub, a relay or an open world of our places, or the node of a mission; `null` when the game does not say.",
            ),
            member(
                "since",
                Shape::Integer,
                "When the player arrived, in Unix milliseconds.",
            ),
        ]),
        "Where the player is.",
    ),
    named(
        "WarframeMission",
        Shape::Record(&[
            member(
                "state",
                Shape::Keyword(warframe::MISSION_STATES),
                "`selected` on the star chart, `loading`, `in_progress` or `ended`.",
            ),
            member("node", Shape::Named("WarframeNode"), "The node."),
            member(
                "planet",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "Its planet or region.",
            ),
            member(
                "type",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "The mission type; `null` for one we do not know.",
            ),
            member(
                "faction",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "The enemy faction.",
            ),
            member(
                "enemyLevel",
                Shape::Nullable(&Shape::Record(&[
                    member("min", Shape::Integer, "Lowest enemy level."),
                    member("max", Shape::Integer, "Highest enemy level."),
                ])),
                "The enemy levels of the node.",
            ),
            member(
                "fissure",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "The era of a Void Fissure mission.",
            ),
            member(
                "modifiers",
                Shape::List(&Shape::Named("WarframeModifier")),
                "What changes the mission, at most `MAX_WARFRAME_MODIFIERS`.",
            ),
            member(
                "selectedAt",
                NULLABLE_INTEGER,
                "When it was chosen, in Unix milliseconds.",
            ),
            member("loadingAt", NULLABLE_INTEGER, "When it began to load."),
            member("startedAt", NULLABLE_INTEGER, "When play began."),
            member("endedAt", NULLABLE_INTEGER, "When it ended."),
            member(
                "result",
                Shape::Nullable(&Shape::Keyword(warframe::RESULTS)),
                "`succeeded`, `failed` or `aborted`; `null` before the end, or when the game did not say.",
            ),
            member(
                "durationSeconds",
                NULLABLE_NUMBER,
                "From the start of play to the end, in seconds to the millisecond.",
            ),
            member(
                "rewards",
                Shape::Nullable(&Shape::Named("WarframeRewards")),
                "What the mission can reward, for a widget that follows `warframe.rewards`; `null` otherwise, for a node without a reward table, or for a mission whose table is not public or not known yet.",
            ),
            member(
                "rewardsPending",
                Shape::Bool,
                "`true` while `rewards` is `null` for now: which table applies is not known yet (a node of the day's Sortie or Archon Hunt, chosen but not loaded; the world or the drop tables not read yet). `false` otherwise, `rewards` given or not.",
            ),
            member(
                "earned",
                Shape::Nullable(&Shape::Named("WarframeEarned")),
                "The rotations earned from the start, for a type with rotations; `null` otherwise or before the start.",
            ),
            member(
                "credits",
                NULLABLE_INTEGER,
                "The credits its end screen counts; `null` before the end, or when the game does not say (an aborted mission).",
            ),
        ]),
        "A Warframe mission.",
    ),
    named(
        "WarframeModifier",
        Shape::Record(&[
            member(
                "id",
                Shape::Keyword(warframe::MODIFIER_IDS),
                "Our ID of the modifier.",
            ),
            member("name", Shape::Text, "Its name in the game's language."),
            member(
                "stage",
                NULLABLE_INTEGER,
                "The stage of a Sortie or an Archon Hunt, 1 to 3, when PlayerVox OverCrow can tell it.",
            ),
        ]),
        "What changes a mission.",
    ),
    named(
        "WarframeProgress",
        Shape::Record(&[
            member(
                "wave",
                NULLABLE_INTEGER,
                "The current wave (Defense, Mirror Defense).",
            ),
            member(
                "waveEnemies",
                Shape::Nullable(&Shape::Record(&[
                    member("total", Shape::Integer, "The enemies the wave announced."),
                    member(
                        "left",
                        NULLABLE_INTEGER,
                        "Those left, as the game counts them once all have spawned; 0 once the wave is cleared; `null` before.",
                    ),
                ])),
                "The enemies of the current Defense wave; `null` before the first.",
            ),
            member(
                "round",
                NULLABLE_INTEGER,
                "Rounds done (Interception, Disruption).",
            ),
            member("rewards", Shape::Integer, "Rotation rewards given so far."),
            member(
                "rotation",
                Shape::Nullable(&Shape::Keyword(warframe::ROTATIONS)),
                "The rotation of the next reward; `null` for a type without rotations or one we cannot count.",
            ),
            member(
                "earned",
                Shape::Named("WarframeEarned"),
                "The rotations given so far.",
            ),
            member(
                "cycle",
                Shape::Nullable(&Shape::Record(&[
                    member("number", Shape::Integer, "1 for the first round."),
                    member(
                        "rotations",
                        Shape::List(&Shape::Keyword(warframe::ROTATIONS)),
                        "Its rotations, in order: `A`, `A`, `B`, `C`; an Arbitration's first `A`, `A`, `B`, `B`, then `C`, `C`, `C`, `C`.",
                    ),
                    member("earned", Shape::Integer, "How many of them were given."),
                ])),
                "The round of rotations of the next reward; `null` for a Disruption and a type without rotations.",
            ),
            member(
                "clock",
                Shape::Nullable(&Shape::Keyword(warframe::PROGRESS_CLOCKS)),
                "For a type paid on time (Survival): `waiting` until its clock starts, then `running`; `null` otherwise.",
            ),
            member(
                "nextRewardAt",
                NULLABLE_INTEGER,
                "When the next reward comes, in Unix milliseconds, for a type paid on time (Survival) once its clock runs.",
            ),
            member(
                "nextRewardWave",
                NULLABLE_INTEGER,
                "The wave of the next reward, for a type paid on waves (Defense: every 3; Mirror Defense: every 2).",
            ),
        ]),
        "The progress of a mission.",
    ),
    named(
        "WarframeSquadMember",
        Shape::Record(&[
            member(
                "name",
                Shape::Text,
                "The player's name, without the platform icon.",
            ),
            member("you", Shape::Bool, "Whether it is the user."),
        ]),
        "A member of the squad.",
    ),
    named(
        "WarframeSquad",
        Shape::Record(&[member(
            "members",
            Shape::List(&Shape::Named("WarframeSquadMember")),
            "The members, the user included, at most `MAX_WARFRAME_SQUAD`.",
        )]),
        "The squad.",
    ),
    named(
        "WarframeEidolonHunt",
        Shape::Record(&[
            member(
                "eidolon",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "Which Eidolon, told by the order of the hunt; `null` when it cannot be told.",
            ),
            member(
                "spawnedAt",
                Shape::Integer,
                "When it appeared, in Unix milliseconds.",
            ),
            member("weakpoints", Shape::Integer, "Weak points destroyed."),
            member("capturedAt", NULLABLE_INTEGER, "When it was captured."),
            member("killedAt", NULLABLE_INTEGER, "When it was killed."),
            member("fledAt", NULLABLE_INTEGER, "When it left at dawn."),
        ]),
        "One Eidolon of the night.",
    ),
    named(
        "WarframeEidolons",
        Shape::Record(&[
            member(
                "night",
                Shape::Nullable(&Shape::Bool),
                "Whether it is night on the Plains, as the player last saw it; `null` before.",
            ),
            member(
                "hunts",
                Shape::List(&Shape::Named("WarframeEidolonHunt")),
                "The Eidolons of the night, oldest first, at most `MAX_WARFRAME_HUNTS`.",
            ),
        ]),
        "The night on the Plains of Eidolon.",
    ),
    named(
        "WarframeEvent",
        Shape::OneOf(&[
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::MISSION_EVENTS),
                    "What happened.",
                ),
                member(
                    "mission",
                    Shape::Named("WarframeMission"),
                    "The mission then.",
                ),
            ]),
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::PROGRESS_EVENTS),
                    "What happened.",
                ),
                member(
                    "progress",
                    Shape::Named("WarframeProgress"),
                    "The progress then.",
                ),
            ]),
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::CYCLE_EVENTS),
                    "Night or day began on the Plains.",
                ),
            ]),
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::EIDOLON_EVENTS),
                    "What happened.",
                ),
                member(
                    "eidolon",
                    Shape::Named("WarframeEidolonHunt"),
                    "The Eidolon then.",
                ),
            ]),
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::SQUAD_EVENTS),
                    "What happened.",
                ),
                member("member", Shape::Named("WarframeSquadMember"), "Who."),
            ]),
            Shape::Record(&[
                SEQ,
                AT,
                member(
                    "type",
                    Shape::Keyword(warframe::LOCATION_EVENTS),
                    "What happened.",
                ),
                member(
                    "location",
                    Shape::Named("WarframeLocation"),
                    "The new place.",
                ),
            ]),
        ]),
        "One Warframe event; its type tells which state it carries.",
    ),
    named(
        "WarframeReward",
        Shape::Record(&[
            member(
                "id",
                Shape::Text,
                "Our ID: the item's English name in `snake_case` (`orokin_cell`).",
            ),
            member(
                "name",
                Shape::Text,
                "Its name in the game's language, or in English when PlayerVox OverCrow has no translation yet; never empty.",
            ),
            member("quantity", Shape::Integer, "How many at once."),
            member(
                "chance",
                Shape::Number,
                "The chance, from 0 to 1; the same item's entries of a table added together.",
            ),
            member(
                "icon",
                Shape::Nullable(&Shape::Asset),
                "`asset:` handle of the item's image, from Digital Extremes' public export, 48 px square; `null` while it downloads (`iconPending`) or when there is none.",
            ),
            member(
                "iconPending",
                Shape::Bool,
                "`true` while `icon` is `null` for now: the image may still come. `false` otherwise: `icon` given, or no image to come (the item has none, or the source cannot be reached); `icon` may still arrive later, never `iconPending` again.",
            ),
            member(
                "category",
                Shape::Keyword(warframe::REWARD_CATEGORIES),
                "What kind of item: `relic`, `mod`, `resource`, `blueprint`, `warframe_part`, `weapon_part`, `arcane`, `currency` or `other`.",
            ),
        ]),
        "An item a node can reward.",
    ),
    named(
        "WarframeRewardTable",
        Shape::Record(&[
            member(
                "kind",
                Shape::Keyword(warframe::REWARD_TABLE_KINDS),
                "`mission`, `caches` or `extra`.",
            ),
            member(
                "rotation",
                Shape::Nullable(&Shape::Keyword(warframe::ROTATIONS)),
                "The rotation, or `null` for a table without rotations.",
            ),
            member(
                "items",
                Shape::List(&Shape::Named("WarframeReward")),
                "The items, the rarest first (equal chances by English name), at most `MAX_WARFRAME_REWARD_ITEMS`.",
            ),
        ]),
        "One reward table of a node.",
    ),
    named(
        "WarframeRewards",
        Shape::Record(&[
            member(
                "source",
                Shape::Keyword(warframe::REWARD_SOURCES),
                "Whose tables: `node`, or the tables of their own that replace a node's: `arbitration` (every Arbitration's), `nightmare` (a Nightmare mission's reward, once, the rotation of its planet), `sortie` (a Sortie's, after its third mission).",
            ),
            member(
                "tables",
                Shape::List(&Shape::Named("WarframeRewardTable")),
                "The tables, at most `MAX_WARFRAME_REWARD_TABLES`. Source: Digital Extremes' drop tables, no guarantees.",
            ),
        ]),
        "What a mission can reward.",
    ),
    named(
        "WarframeWorldMission",
        Shape::Record(&[
            member("node", Shape::Named("WarframeNode"), "The node."),
            member(
                "planet",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "Its planet or region.",
            ),
            member(
                "type",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "The mission type.",
            ),
            member(
                "modifier",
                Shape::Nullable(&Shape::Named("WarframeName")),
                "The condition of a Sortie mission; `null` otherwise.",
            ),
        ]),
        "A mission of the Sortie or the Archon Hunt.",
    ),
    named(
        "WarframeCycle",
        Shape::Record(&[
            member(
                "state",
                Shape::Named("WarframeName"),
                "Day or night (Cetus), warm or cold (Orb Vallis), Fass or Vome (Cambion Drift).",
            ),
            member(
                "endsAt",
                Shape::Integer,
                "When it changes, in Unix milliseconds.",
            ),
        ]),
        "The cycle of an open world.",
    ),
    named(
        "WarframeWorld",
        Shape::Record(&[
            member(
                "updatedAt",
                Shape::Integer,
                "When PlayerVox OverCrow last read it, in Unix milliseconds.",
            ),
            member(
                "sortie",
                Shape::Nullable(&Shape::Record(&[
                    member("boss", Shape::Named("WarframeName"), "The boss."),
                    member(
                        "faction",
                        Shape::Nullable(&Shape::Named("WarframeName")),
                        "Its faction.",
                    ),
                    member("endsAt", Shape::Integer, "When it ends."),
                    member(
                        "missions",
                        Shape::List(&Shape::Named("WarframeWorldMission")),
                        "Its missions, in order.",
                    ),
                ])),
                "The Sortie of the day.",
            ),
            member(
                "archonHunt",
                Shape::Nullable(&Shape::Record(&[
                    member("boss", Shape::Named("WarframeName"), "The Archon."),
                    member("endsAt", Shape::Integer, "When it ends."),
                    member(
                        "missions",
                        Shape::List(&Shape::Named("WarframeWorldMission")),
                        "Its missions, in order.",
                    ),
                ])),
                "The Archon Hunt of the week.",
            ),
            member(
                "fissures",
                Shape::List(&Shape::Record(&[
                    member("node", Shape::Named("WarframeNode"), "The node."),
                    member(
                        "planet",
                        Shape::Nullable(&Shape::Named("WarframeName")),
                        "Its planet or region.",
                    ),
                    member(
                        "type",
                        Shape::Nullable(&Shape::Named("WarframeName")),
                        "The mission type.",
                    ),
                    member("era", Shape::Named("WarframeName"), "The era."),
                    member("steelPath", Shape::Bool, "A Steel Path fissure."),
                    member("voidStorm", Shape::Bool, "A Void Storm (Railjack)."),
                    member("endsAt", Shape::Integer, "When it closes."),
                ])),
                "The open Void Fissures, the soonest to close first, at most `MAX_WARFRAME_FISSURES`.",
            ),
            member(
                "cycles",
                Shape::Record(&[
                    member(
                        "cetus",
                        Shape::Nullable(&Shape::Named("WarframeCycle")),
                        "Day and night at Cetus and on the Plains.",
                    ),
                    member(
                        "vallis",
                        Shape::Nullable(&Shape::Named("WarframeCycle")),
                        "Warm and cold in the Orb Vallis.",
                    ),
                    member(
                        "cambion",
                        Shape::Nullable(&Shape::Named("WarframeCycle")),
                        "Fass and Vome in the Cambion Drift.",
                    ),
                ]),
                "The open worlds' cycles; `null` for one PlayerVox OverCrow cannot tell.",
            ),
            member(
                "resets",
                Shape::Record(&[
                    member(
                        "daily",
                        Shape::Integer,
                        "The next daily reset, 00:00 UTC, in Unix milliseconds.",
                    ),
                    member(
                        "weekly",
                        Shape::Integer,
                        "The next weekly reset, Monday 00:00 UTC.",
                    ),
                ]),
                "The next resets.",
            ),
            member(
                "voidTrader",
                Shape::Nullable(&Shape::Record(&[
                    member("arrivesAt", Shape::Integer, "When he arrives."),
                    member("leavesAt", Shape::Integer, "When he leaves."),
                    member(
                        "relay",
                        Shape::Nullable(&Shape::Named("WarframeName")),
                        "Where he comes.",
                    ),
                ])),
                "Baro Ki'Teer's next visit, or the current one.",
            ),
            member(
                "circuit",
                Shape::Nullable(&Shape::Record(&[
                    member(
                        "normal",
                        Shape::List(&Shape::Named("WarframeName")),
                        "The rewards of the week.",
                    ),
                    member(
                        "steelPath",
                        Shape::List(&Shape::Named("WarframeName")),
                        "The Steel Path rewards of the week.",
                    ),
                ])),
                "The Circuit's rewards of the week, when the world state gives them.",
            ),
        ]),
        "Warframe's world of the day and the week.",
    ),
];

/// Response headers `http.fetch` gives a widget, by lowercase name: how
/// long to wait (`retry-after`, the RateLimit fields of the IETF draft,
/// their earlier and `x-` forms), the server's clock to read them
/// (`date`), whether the data changed (`etag`, `last-modified`) and how
/// long it stays fresh (`cache-control`, `expires`, `age`). Nothing that
/// sets or names a session, an identity or a request (`set-cookie`,
/// `authorization`, request IDs), nor an address (`location`, `link`).
pub const RESPONSE_HEADERS: &[&str] = &[
    "retry-after",
    "ratelimit",
    "ratelimit-policy",
    "ratelimit-limit",
    "ratelimit-remaining",
    "ratelimit-reset",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
    "date",
    "etag",
    "last-modified",
    "cache-control",
    "expires",
    "age",
];

/// The `headers` of an `http.fetch` answer, from the response's header
/// fields (name in any case, raw value): each name of [`RESPONSE_HEADERS`]
/// the response has, its value trimmed, a repeated one joined by `, `. A
/// header with an empty occurrence, a byte outside printable ASCII, or a
/// value beyond `MAX_HTTP_HEADER_VALUE_BYTES` is left out whole.
pub fn response_headers<'a>(
    fields: impl IntoIterator<Item = (&'a str, &'a [u8])>,
) -> Map<String, Value> {
    let mut joined: Map<String, Value> = Map::new();
    let mut refused: Vec<&'static str> = Vec::new();
    for (name, value) in fields {
        let Some(name) = RESPONSE_HEADERS
            .iter()
            .find(|listed| listed.eq_ignore_ascii_case(name))
        else {
            continue;
        };
        let value = value.trim_ascii();
        let printable = !value.is_empty() && value.iter().all(|byte| (0x20..=0x7e).contains(byte));
        if !printable {
            refused.push(name);
            continue;
        }
        let value = String::from_utf8_lossy(value);
        match joined.get_mut(*name) {
            Some(Value::String(previous)) => {
                previous.push_str(", ");
                previous.push_str(&value);
            }
            _ => {
                joined.insert((*name).to_owned(), Value::String(value.into_owned()));
            }
        }
    }
    joined.retain(|name, value| {
        !refused.contains(&name.as_str())
            && value
                .as_str()
                .is_some_and(|value| value.len() as u64 <= MAX_HTTP_HEADER_VALUE_BYTES.value)
    });
    joined
}

pub fn shape(name: &str) -> Option<&'static NamedShape> {
    SHAPES.iter().find(|shape| shape.name == name)
}

/// Largest integer a JavaScript number holds exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

impl Shape {
    /// Whether `value` has this shape. An unknown [`Shape::Named`] never
    /// matches; a test checks that every name resolves.
    pub fn matches(&self, value: &Value) -> bool {
        match self {
            Self::Null => value.is_null(),
            Self::Bool => value.is_boolean(),
            Self::Number => value.as_f64().is_some_and(f64::is_finite),
            Self::Integer => match (value.as_i64(), value.as_u64(), value.as_f64()) {
                (Some(integer), _, _) => integer.unsigned_abs() <= MAX_SAFE_INTEGER,
                (_, Some(integer), _) => integer <= MAX_SAFE_INTEGER,
                (_, _, Some(number)) => {
                    number.fract() == 0.0 && number.abs() <= MAX_SAFE_INTEGER as f64
                }
                _ => false,
            },
            Self::Text => value.is_string(),
            Self::Keyword(words) => value.as_str().is_some_and(|word| words.contains(&word)),
            Self::Asset => value.as_str().is_some_and(crate::ipc::is_asset_handle),
            Self::Json => true,
            Self::Nullable(inner) => value.is_null() || inner.matches(value),
            Self::List(item) => value
                .as_array()
                .is_some_and(|items| items.iter().all(|entry| item.matches(entry))),
            Self::Record(members) => value.as_object().is_some_and(|object| {
                object.len() == members.len()
                    && members.iter().all(|member| {
                        object
                            .get(member.name)
                            .is_some_and(|entry| member.shape.matches(entry))
                    })
            }),
            Self::OneOf(shapes) => shapes.iter().filter(|shape| shape.matches(value)).count() == 1,
            Self::Fields(names, inner) => value.as_object().is_some_and(|object| {
                object
                    .iter()
                    .all(|(name, entry)| names.contains(&name.as_str()) && inner.matches(entry))
            }),
            Self::Named(name) => shape(name).is_some_and(|named| named.shape.matches(value)),
        }
    }

    /// Short Markdown form for the reference.
    pub fn describe(&self) -> String {
        match self {
            Self::Null => "`null`".into(),
            Self::Bool => "boolean".into(),
            Self::Number => "number".into(),
            Self::Integer => "integer".into(),
            Self::Text => "text".into(),
            Self::Keyword(words) => words
                .iter()
                .map(|word| format!("`{word}`"))
                .collect::<Vec<_>>()
                .join(" \\| "),
            Self::Asset => "`asset:` handle".into(),
            Self::Json => "JSON".into(),
            Self::Nullable(inner) => format!("{} or `null`", inner.describe()),
            Self::List(item) => format!("list of {}", item.describe()),
            Self::Record(members) => format!(
                "`{{ {} }}`",
                members
                    .iter()
                    .map(|member| member.name)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Self::OneOf(shapes) => shapes
                .iter()
                .map(Shape::describe)
                .collect::<Vec<_>>()
                .join(" or "),
            Self::Fields(names, _) => format!(
                "`{{ {} }}`",
                names
                    .iter()
                    .map(|name| format!("{name}?"))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            Self::Named(name) => format!("`{name}`"),
        }
    }
}
