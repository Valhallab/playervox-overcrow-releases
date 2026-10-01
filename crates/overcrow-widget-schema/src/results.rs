//! Typed shapes of the values the host sends back: service results,
//! subscription updates and `ServiceError`. They are the contract of the
//! host's capability projections and the source of the SDK's result types;
//! [`Shape::matches`] checks a JSON value against one.
//!
//! Records are exact: every member is present (a nullable member as `null`)
//! and no other key is. A member that may be absent does not exist in v1.

use serde_json::Value;

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
            ]),
            Shape::Record(&[
                member("status", Shape::Integer, "HTTP status."),
                member(
                    "asset",
                    Shape::Asset,
                    "The decoded image (`as: \"image\"`).",
                ),
            ]),
        ]),
        "Answer of `http.fetch`.",
    ),
    named(
        "GameEvent",
        Shape::Record(&[
            member("event", Shape::Text, "A declared game event."),
            member("at", Shape::Integer, "Host monotonic clock in ms."),
        ]),
        "One game event.",
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
            member("original", NULLABLE_TEXT, "Untranslated text."),
            member("publishedAt", Shape::Integer, "Unix ms."),
            member("offsetMinutes", Shape::Integer, OFFSET),
        ]),
        "One player review.",
    ),
    named(
        "ReviewsPage",
        Shape::Record(&[
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
        ]),
        "One chat message.",
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
                "Messages, oldest first.",
            ),
            member(
                "removed",
                Shape::List(&Shape::Text),
                "IDs of removed messages.",
            ),
        ]),
        "Twitch chat state.",
    ),
];

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
            Self::Named(name) => format!("`{name}`"),
        }
    }
}
