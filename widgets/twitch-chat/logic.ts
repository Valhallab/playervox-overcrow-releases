// Twitch chat: the chat of one public Twitch channel the user chooses.
// OverCrow holds the Twitch account, the connection, the chosen channel and
// the favorites, and sends the chat as deltas at a bounded pace. In
// Interactive mode the widget shows the channel selector, the history and a
// composer whose message field belongs to OverCrow: it keeps the text and
// sends it itself when the user submits. The logic only follows it. In
// Passive mode the last messages show and fade out.
import {
  hasGrant,
  host,
  initState,
  onHost,
  option,
  t,
  timers,
  twitch,
  type ChatMessage,
  type ServiceErrorCode,
  type ServiceErrorPayload,
  type Subscription,
  type Timer,
  type TwitchChat,
} from "@overcrow/sdk";

/** One run of a chat line: text, or an emote image with its name. */
export interface Part {
  key: string;
  text: string;
  /** The emote's image handle, or `""` for a text run. */
  emote: string;
}

/** One row of the history: a message, or the mark of messages left out. */
export interface Row {
  key: string;
  /** The message's ID; `""` for a gap. */
  id: string;
  /** Messages OverCrow left out here; 0 for a message. */
  gap: number;
  author: string;
  color: string | null;
  parts: Part[];
  /** "Author: text" of the message replied to, or `""`. */
  context: string;
  /** The reply icon's tooltip, "Reply to {name}". */
  tip: string;
  receivedAt: number;
  /** Scene nodes the row takes. */
  nodes: number;
  /** Style classes: the row's kind and, in Passive mode, its fade. */
  cls: string;
}

/** The message being replied to. */
export interface ReplyTarget {
  id: string;
  author: string;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The host answered the subscription at least once. */
    ready: boolean;
    /** The subscription ended with a failure; the widget asks again. */
    unavailable: boolean;
    account: TwitchChat["account"];
    channel: string | null;
    joinState: TwitchChat["joinState"];
    failure: TwitchChat["failure"];
    favorites: readonly string[];
    canSend: boolean;
    generation: number;
    /** The history, oldest first. */
    rows: Row[];
    /** What the list shows: the history, or the fading last messages. */
    shown: Row[];
    interactive: boolean;
    /** The channel selector is open over a joined channel. */
    selecting: boolean;
    /** The channel field as the user typed it. */
    channelDraft: string;
    /** The channel selector's key: a new one is a new, empty field. */
    selector: number;
    /** The list follows its end; the user scrolled away otherwise. */
    following: boolean;
    /** Messages received since the user scrolled away. */
    unread: number;
    reply: ReplyTarget | null;
    /** The message field as OverCrow last reported it. */
    draft: string;
    /** A message was submitted and OverCrow has not answered yet. */
    sending: boolean;
    /** Message key of the last send's failure, or `""`. */
    sendError: string;
    /** Message key of a failed channel or favorite change, or `""`. */
    notice: string;
  }
}

/** Messages kept in the history (the host's own ring). */
export const HISTORY_MAX = 200;
/** Messages shown in Passive mode. */
export const PASSIVE_MAX = 12;
/**
 * Scene nodes the history may take. A row takes 4 to 21 nodes; 200 rows
 * of the longest kind would pass `MAX_SCENE_NODES` (4096) with the rest of
 * the view, so the oldest rows leave first.
 */
export const ROW_NODE_BUDGET = 3600;
/** A subscription that ended is asked again this much later. */
export const RETRY_MS = 5_000;
/**
 * OverCrow answers a send; should no answer come at all, the composer is
 * given back after this long.
 */
export const ANSWER_MS = 40_000;
/** Opacity levels of the Passive fade (`fade-1` … `fade-32` in the style). */
export const FADE_LEVELS = 32;
/** Step durations the style has a transition for (`ease-100` …), in ms. */
export const FADE_STEPS_MS: readonly number[] = [100, 200, 400, 800, 1600];
/** `MAX_CHAT_CHANNEL_BYTES`. */
const CHANNEL_MAX = 25;
/** `MAX_CHAT_FAVORITES`. */
const FAVORITES_MAX = 20;
/** `MAX_LABEL_BYTES`. */
const LABEL_MAX = 256;

const canRead = hasGrant("twitch.chat.read");
const canWrite = hasGrant("twitch.chat.compose");

const state = initState({
  ready: false,
  unavailable: false,
  account: "connected" as TwitchChat["account"],
  channel: null as string | null,
  joinState: "idle" as TwitchChat["joinState"],
  failure: null as TwitchChat["failure"],
  favorites: [] as readonly string[],
  canSend: false,
  generation: 0,
  rows: [] as Row[],
  shown: [] as Row[],
  interactive: host.mode === "interactive",
  selecting: false,
  channelDraft: "",
  selector: 0,
  following: true,
  unread: 0,
  reply: null as ReplyTarget | null,
  draft: "",
  sending: false,
  sendError: "",
  notice: "",
});

/** What the view reads of the state. */
export interface View {
  ready: boolean;
  unavailable: boolean;
  account: TwitchChat["account"];
  channel: string | null;
  joinState: TwitchChat["joinState"];
  failure: TwitchChat["failure"];
  favorites: readonly string[];
  canSend: boolean;
  generation: number;
  shown: Row[];
  interactive: boolean;
  selecting: boolean;
  channelDraft: string;
  selector: number;
  following: boolean;
  unread: number;
  reply: ReplyTarget | null;
  draft: string;
  sending: boolean;
  sendError: string;
  notice: string;
}

// Text helpers.

/** Provider text on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** `text` cut to `limit` UTF-8 bytes on a character boundary. */
export function cutBytes(text: string, limit: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (bytes + size > limit) {
      return text.slice(0, end);
    }
    bytes += size;
    end += character.length;
  }
  return text;
}

/**
 * A channel login as Twitch writes it: trimmed, an optional `#` removed,
 * ASCII letters, digits and `_`, lowercased, 1 to 25 characters; `null`
 * for anything else.
 */
export function normalizeChannel(value: string): string | null {
  const trimmed = value.trim();
  const login = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (login.length === 0 || login.length > CHANNEL_MAX || !/^[A-Za-z0-9_]+$/.test(login)) {
    return null;
  }
  return login.toLowerCase();
}

// The history.

let gaps = 0;

/** The row of a delivered message. */
export function messageRow(message: ChatMessage): Row {
  const parts: Part[] = message.fragments.map((fragment, index) =>
    "emote" in fragment
      ? { key: `${index}`, text: cutBytes(fragment.alt, LABEL_MAX), emote: fragment.emote }
      : { key: `${index}`, text: fragment.text, emote: "" },
  );
  const context =
    message.reply === null
      ? ""
      : `${oneLine(message.reply.author)}: ${oneLine(message.reply.text)}`;
  return {
    key: `m:${message.id}`,
    id: message.id,
    gap: 0,
    author: `${message.author}: `,
    color: message.color,
    parts,
    context,
    tip: replyTip(message.author),
    receivedAt: message.receivedAt,
    // The row, its text, the author, the reply icon, then each run and the
    // reply context.
    nodes: 4 + parts.length + (context === "" ? 0 : 1),
    cls: context === "" ? "row" : "row replied",
  };
}

/** The mark of `count` messages OverCrow left out. */
export function gapRow(count: number, at: number): Row {
  gaps += 1;
  return {
    key: `g:${gaps}`,
    id: "",
    gap: count,
    author: "",
    color: null,
    parts: [],
    context: "",
    tip: "",
    receivedAt: at,
    nodes: 1,
    cls: "gap",
  };
}

/**
 * `rows` after a delta: the removed messages gone, the mark of the
 * messages left out, each delivered message appended or, when the history
 * already holds its ID, put in its place; then the oldest rows dropped
 * beyond `HISTORY_MAX` messages and `ROW_NODE_BUDGET` nodes. `appended`
 * counts what arrived, left out or not.
 */
export function applyDelta(
  rows: readonly Row[],
  update: Pick<TwitchChat, "reset" | "messages" | "removed" | "skipped">,
  now: number,
): { rows: Row[]; appended: number } {
  let next: Row[] = update.reset ? [] : rows.slice();
  if (update.removed.length > 0) {
    const removed = new Set(update.removed);
    next = next.filter((row) => !removed.has(row.id));
  }
  let appended = 0;
  if (!update.reset && update.skipped > 0) {
    const last = next[next.length - 1];
    if (last !== undefined && last.gap > 0) {
      // Two gaps in a row are one: nothing was shown between them.
      next[next.length - 1] = { ...last, gap: last.gap + update.skipped };
    } else {
      next.push(gapRow(update.skipped, now));
    }
    appended += update.skipped;
  }
  for (const message of update.messages) {
    const index = next.findIndex((row) => row.id === message.id);
    if (message.deleted) {
      if (index >= 0) {
        next.splice(index, 1);
      }
      continue;
    }
    const row = messageRow(message);
    if (index >= 0) {
      next[index] = row;
    } else {
      next.push(row);
      appended += 1;
    }
  }
  return { rows: trimmed(next), appended };
}

/** `rows` without its oldest rows beyond the history's two bounds. */
export function trimmed(rows: Row[]): Row[] {
  let messages = 0;
  let nodes = 0;
  let first = rows.length;
  while (first > 0) {
    const row = rows[first - 1];
    if (row === undefined) {
      break;
    }
    const counted = row.gap === 0 ? 1 : 0;
    if (messages + counted > HISTORY_MAX || nodes + row.nodes > ROW_NODE_BUDGET) {
      break;
    }
    messages += counted;
    nodes += row.nodes;
    first -= 1;
  }
  // A gap that would open the history marks nothing the user can see.
  while (first < rows.length && (rows[first]?.gap ?? 0) > 0) {
    first += 1;
  }
  return first === 0 ? rows : rows.slice(first);
}

// The Passive fade.

/** The fade's step: the longest the style has within 1/16 of the fade. */
export function fadeStepMs(lifetimeMs: number): number {
  const sixteenth = lifetimeMs / 3 / 16;
  let step = FADE_STEPS_MS[0] ?? 100;
  for (const candidate of FADE_STEPS_MS) {
    if (candidate <= sixteenth) {
      step = candidate;
    }
  }
  return step;
}

/**
 * The opacity level of a message of `ageMs`: 0 (opaque) until two thirds
 * of the lifetime, then linear up to `FADE_LEVELS` (gone) at the lifetime.
 */
export function fadeLevel(ageMs: number, lifetimeMs: number): number {
  const start = (lifetimeMs * 2) / 3;
  if (ageMs <= start) {
    return 0;
  }
  const level = Math.round(((ageMs - start) / (lifetimeMs - start)) * FADE_LEVELS);
  return Math.min(FADE_LEVELS, Math.max(1, level));
}

/**
 * The rows of Passive mode: the last `PASSIVE_MAX` messages younger than
 * the lifetime. Each aims at the opacity it has one step from now, which
 * the style's transition reaches in that time: the fade looks continuous.
 */
export function passiveRows(rows: readonly Row[], now: number, lifetimeMs: number): Row[] {
  const step = fadeStepMs(lifetimeMs);
  const recent = rows.filter((row) => row.gap === 0).slice(-PASSIVE_MAX);
  const shown: Row[] = [];
  for (const row of recent) {
    const age = now - row.receivedAt;
    if (age >= lifetimeMs) {
      continue;
    }
    const level = fadeLevel(age + step, lifetimeMs);
    shown.push(level === 0 ? row : { ...row, cls: `${row.cls} fade-${level} ease-${step}` });
  }
  return shown;
}

/**
 * How long until a row of Passive mode changes: one step while a message
 * fades or is about to, the time until the first fade starts otherwise;
 * `null` when nothing shows.
 */
export function nextFadeMs(rows: readonly Row[], now: number, lifetimeMs: number): number | null {
  const step = fadeStepMs(lifetimeMs);
  const start = (lifetimeMs * 2) / 3;
  let next: number | null = null;
  for (const row of rows) {
    const age = now - row.receivedAt;
    const wait = Math.max(step, start - step - age);
    next = next === null ? wait : Math.min(next, wait);
  }
  return next;
}

/** The lifetime of a message in Passive mode, in ms (menu row, 5 to 120 s). */
export function lifetimeMs(): number {
  const seconds = option("passive-lifetime", 30);
  return Math.min(120, Math.max(5, Number.isFinite(seconds) ? seconds : 30)) * 1000;
}

let fade: Timer | null = null;

/** Shows the history, or the fading last messages, and arms the fade. */
function show(): void {
  fade?.cancel();
  fade = null;
  if (state.interactive) {
    state.shown = state.rows;
    return;
  }
  const lifetime = lifetimeMs();
  const now = Date.now();
  state.shown = passiveRows(state.rows, now, lifetime);
  const wait = nextFadeMs(state.shown, now, lifetime);
  // Hidden, a timer waits; nothing ticks once the last message is gone.
  if (wait !== null) {
    fade = timers.after(wait, show);
  }
}

// What the view shows.

/**
 * `permission` without the grant, `unavailable` after the host's source
 * failed, `waiting` before its first answer, `signed-out` and `pending`
 * under the host's account panel, `no-channel`, or `chat`.
 */
export function phase(view: View): string {
  if (!canRead) {
    return "permission";
  }
  if (view.unavailable) {
    return "unavailable";
  }
  if (!view.ready) {
    return "waiting";
  }
  if (view.account === "pending") {
    return "pending";
  }
  if (view.account !== "connected") {
    return "signed-out";
  }
  return view.channel === null ? "no-channel" : "chat";
}

/** The header's title: the channel, or "Twitch". */
export function heading(view: View): string {
  return view.channel === null || phase(view) !== "chat" ? t("twitch") : `#${view.channel}`;
}

/** Message key of the connection's state. */
export function statusKey(view: View): string {
  if (phase(view) !== "chat" && phase(view) !== "no-channel") {
    return "inactive";
  }
  switch (view.joinState) {
    case "connecting":
      return "connecting";
    case "joined":
      return "connected";
    case "reconnecting":
      return "reconnecting";
    case "failed":
      switch (view.failure) {
        case "channel_unavailable":
          return "channel-unavailable";
        case "connection":
          return "connection-error";
        case "limit":
          return "limit";
        default:
          return "twitch-error";
      }
    default:
      return "disconnected";
  }
}

/** The status dot's classes: green joined, amber on its way, red failed. */
export function dotClass(view: View): string {
  switch (statusKey(view)) {
    case "connected":
      return "dot ok";
    case "connecting":
    case "reconnecting":
      return "dot warn";
    case "inactive":
    case "disconnected":
      return "dot";
    default:
      return "dot failed";
  }
}

/** Message key of a failed connection, shown under the header; or `""`. */
export function failureKey(view: View): string {
  return phase(view) === "chat" && view.joinState === "failed" ? statusKey(view) : "";
}

/** The channel selector shows: Interactive mode, no channel or a change. */
export function selecting(view: View): boolean {
  const current = phase(view);
  return view.interactive && (current === "no-channel" || (current === "chat" && view.selecting));
}

/**
 * The selector's key. Its field is the host's: the logic cannot empty it,
 * so a selector that starts over is a new one.
 */
export function selectors(view: View): number[] {
  return [view.selector];
}

/** The channel typed is one the host can join. */
export function canJoin(view: View): boolean {
  return normalizeChannel(view.channelDraft) !== null;
}

/** The current channel is a favorite. */
export function isFavorite(view: View): boolean {
  return view.channel !== null && view.favorites.includes(view.channel);
}

/** The star adds a favorite the host has no room for. */
export function favoriteFull(view: View): boolean {
  return !isFavorite(view) && view.favorites.length >= FAVORITES_MAX;
}

/** The star's accessible name: "Favorite #channel" or "Unfavorite #channel". */
export function favoriteLabel(view: View): string {
  return t(isFavorite(view) ? "unfavorite" : "favorite", { channel: view.channel ?? "" });
}

/** Message key of the star's tooltip. */
export function favoriteTip(view: View): string {
  if (favoriteFull(view)) {
    return "favorite-limit";
  }
  return isFavorite(view) ? "favorite-remove" : "favorite-add";
}

export function starClass(view: View): string {
  return isFavorite(view) ? "star on" : "star";
}

/** Message key of an empty history. */
export function emptyKey(view: View): string {
  return view.interactive ? "no-messages" : "no-recent";
}

/** "1 new message" or "{n} new messages". */
export function unreadText(count: number): string {
  return count === 1 ? t("new-message") : t("new-messages", { count });
}

/** "1 message not shown" or "{n} messages not shown". */
export function gapText(count: number): string {
  return count === 1 ? t("skipped-one") : t("skipped", { count });
}

/** The reply icon's tooltip: "Reply to {name}". */
export function replyTip(author: string): string {
  return cutBytes(t("reply-to", { name: author }), LABEL_MAX);
}

/** "Replying to {name}", above the composer. */
export function replyingTo(view: View): string {
  return view.reply === null ? "" : t("replying-to", { name: view.reply.author });
}

/** The ID the composer's form replies to; `null` without a reply. */
export function replyTarget(view: View): string | null {
  return view.reply === null ? null : view.reply.id;
}

/**
 * The composer's key: a new channel or account is a new form, so that the
 * text OverCrow held for the previous one is gone.
 */
export function composers(view: View): number[] {
  return [view.generation];
}

/** The composer shows: Interactive mode, a channel, the compose grant. */
export function composing(view: View): boolean {
  return view.interactive && canWrite && phase(view) === "chat";
}

export function composerClass(view: View): string {
  return composing(view) ? "composer" : "composer hidden";
}

/** Message key of the message field's placeholder. */
export function composerHint(view: View): string {
  return view.canSend ? "send-hint" : "waiting-hint";
}

/** A message can be submitted: joined, something typed, nothing in flight. */
export function canSubmit(view: View): boolean {
  return composing(view) && view.canSend && !view.sending && view.draft.trim() !== "";
}

/** Message key beside the field: "sending…", "not sent", or `""`. */
export function sendMark(view: View): string {
  if (view.sending) {
    return "sending";
  }
  return view.sendError === "" ? "" : "not-sent";
}

export function sendMarkClass(view: View): string {
  return view.sending ? "pending" : "unsent";
}

/** Message key of a refused send. */
export function sendErrorKey(code: ServiceErrorCode | null): string {
  switch (code) {
    case "busy":
      return "error-too-fast";
    case "permission_denied":
      return "error-restricted";
    case "cancelled":
      return "error-not-sent";
    default:
      // `unavailable`, `not_connected`, `stale_context`, `invalid_request`,
      // `timeout` and the rest.
      return "error-not-accepted";
  }
}

/** Message key of a refused channel or favorite change; `""` for none. */
export function noticeKey(code: ServiceErrorCode | null): string {
  switch (code) {
    case "busy":
      return "error-busy";
    case "quota_exceeded":
      return "error-favorite-limit";
    case "not_connected":
    case "stale_context":
      // The account or the channel changed meanwhile: the state says so.
      return "";
    default:
      return "error-settings";
  }
}

// The subscription.

/** Drops what belonged to the previous channel or account. */
function forget(): void {
  state.reply = null;
  state.unread = 0;
  state.following = true;
  state.sending = false;
  state.sendError = "";
  state.draft = "";
  state.notice = "";
  state.selecting = false;
  restartSelector();
  answer?.cancel();
  answer = null;
}

/** Takes an update of the host: the chat's state and a delta of messages. */
function apply(update: TwitchChat): void {
  const moved = state.ready && update.generation !== state.generation;
  if (moved) {
    forget();
  }
  state.ready = true;
  state.account = update.account;
  state.channel = update.channel;
  state.joinState = update.joinState;
  state.failure = update.failure;
  state.favorites = update.favorites;
  state.canSend = update.canSend;
  state.generation = update.generation;
  const delta = applyDelta(moved ? [] : state.rows, update, Date.now());
  state.rows = delta.rows;
  if (update.reset) {
    state.following = true;
    state.unread = 0;
  } else if (!state.following) {
    state.unread = Math.min(HISTORY_MAX, state.unread + delta.appended);
  }
  const reply = state.reply;
  if (reply !== null && !state.rows.some((row) => row.id === reply.id)) {
    state.reply = null;
  }
  show();
}

let subscription: Subscription | null = null;

function subscribe(): void {
  const current = twitch.chat.subscribe((update) => {
    if (update.ok) {
      state.unavailable = false;
      apply(update.value);
      return;
    }
    // The subscription ended: the host's source failed. Say so and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.unavailable = true;
      timers.after(RETRY_MS, subscribe);
    }
  });
  subscription = current;
}

// The user's gestures.

/** A new, empty channel field. */
function restartSelector(): void {
  state.channelDraft = "";
  state.selector += 1;
}

function refused(error: unknown): void {
  const code = (error as { code?: ServiceErrorCode } | null)?.code ?? null;
  state.notice = noticeKey(code);
}

/** The channel field's text. */
export function channelTyped(value: string): void {
  state.channelDraft = value;
}

function joinChannel(channel: string): void {
  state.notice = "";
  twitch.chat.join({ channel }).then(() => {
    // The selector leaves once the host publishes the channel; what was
    // typed stays in its field until then.
    state.selecting = false;
  }, refused);
}

/** Enter in the channel field, or "Join chat". */
export function join(): void {
  const channel = normalizeChannel(state.channelDraft);
  if (channel !== null) {
    joinChannel(channel);
  }
}

/** A favorite's chip joins its channel. */
export function joinFavorite(channel: string): void {
  joinChannel(channel);
}

/** "Change channel" opens the selector; the chat stays until a choice. */
export function toggleSelector(): void {
  state.selecting = !state.selecting;
  restartSelector();
}

/** "Disconnect channel": the host forgets the channel. */
export function leave(): void {
  state.notice = "";
  twitch.chat.leave().catch(refused);
}

/** The star adds the current channel to the favorites, or removes it. */
export function toggleFavorite(): void {
  const channel = state.channel;
  if (channel === null || favoriteFull(state)) {
    return;
  }
  state.notice = "";
  twitch.chat.favorite({ channel, favorite: !isFavorite(state) }).catch(refused);
}

/** The list left its end, or came back to it, under the user's scroll. */
export function stuck(atEnd: boolean): void {
  state.following = atEnd;
  if (atEnd) {
    state.unread = 0;
  }
}

/** "N new messages": back to the latest message. */
export function latest(): void {
  state.following = true;
  state.unread = 0;
}

/** The reply icon of a message: the next send answers it. */
export function replyTo(id: string): void {
  const row = state.rows.find((each) => each.id === id);
  if (row !== undefined && row.gap === 0) {
    state.reply = { id, author: row.author.slice(0, -2) };
  }
}

export function cancelReply(): void {
  state.reply = null;
}

/** The message field's text, as OverCrow holds it. */
export function drafted(value: string): void {
  state.draft = value;
}

let answer: Timer | null = null;

/** OverCrow is sending the form: the composer waits for the outcome. */
function sending(): void {
  if (!canSubmit(state)) {
    return;
  }
  state.sending = true;
  state.sendError = "";
  answer?.cancel();
  answer = timers.after(ANSWER_MS, () => {
    answer = null;
    if (state.sending) {
      state.sending = false;
      state.sendError = "error-not-accepted";
    }
  });
}

/** The Send button: OverCrow submits the form on the same gesture. */
export function sendPressed(): void {
  sending();
}

/** Enter in the message field submits the form too. */
export function keyed(key: string): void {
  if (key === "Enter") {
    sending();
  }
}

/**
 * The outcome of a message OverCrow sent: the form's `submit` event, with
 * the failure's code when it was refused. OverCrow empties the field once
 * the message is accepted and keeps it otherwise.
 */
export function submitted(outcome: string, error: ServiceErrorPayload | undefined): void {
  const awaited = state.sending;
  state.sending = false;
  answer?.cancel();
  answer = null;
  if (outcome === "accepted") {
    state.sendError = "";
    state.draft = "";
    state.reply = null;
  } else if (awaited || state.draft.trim() !== "") {
    // Enter on an empty field is refused too: nothing to say about it.
    state.sendError = sendErrorKey(outcome === "cancelled" ? "cancelled" : (error?.code ?? null));
  }
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
  if (changed.includes("locale")) {
    // The tooltips of the rows are written in the interface's language.
    state.rows = state.rows.map((row) =>
      row.gap === 0 ? { ...row, tip: replyTip(row.author.slice(0, -2)) } : row,
    );
  }
  if (
    changed.includes("mode") ||
    changed.includes("options") ||
    changed.includes("visible") ||
    changed.includes("locale")
  ) {
    show();
  }
});

// Without the grant the host would refuse the subscription: say so instead
// of asking.
if (canRead) {
  subscribe();
}
