// Live goals: your Twitch channel's goal, followers and Hype Train, read
// through PlayerVox OverCrow's integrated Twitch service. The widget never
// sees the token: the host adds it to the routes that name the `twitch`
// account, and only for the three read scopes the manifest asks.
// Only `GET` routes; nothing is written to Twitch.
//
// Rhythm: one timer a minute, each route at most once per tick, nothing
// while hidden, and no route whose data is not shown. Values never
// disappear: a failed read keeps what was shown and says how old it is.
// Nothing of Twitch is stored: values live in memory (Twitch allows a
// cache of 24 hours at most), the channel is read again at each connection.
import {
  account,
  formatDuration,
  formatNumber,
  host,
  http,
  initState,
  onHost,
  option,
  t,
  timers,
  type IconName,
  type JsonValue,
  type Timer,
} from "@overcrow/sdk";

// ---------------------------------------------------------------------------
// Routes

export const API = "https://api.twitch.tv";
export const ROUTES = {
  user: `${API}/helix/users`,
  goals: `${API}/helix/goals`,
  followers: `${API}/helix/channels/followers`,
  hype: `${API}/helix/hypetrain/status`,
} as const;
export type Route = keyof typeof ROUTES;

/** One minute, the least time between two requests of one route. */
export const MINUTE = 60_000;
const TICK_SLACK = 1000;
/** How long a new follower lights the followers card. */
export const NEW_FOLLOWER_FOR = 10_000;
/** Backoff of a 5xx or a 429, minutes: then 10 min. */
const BACKOFF_MINUTES = [1, 2, 4, 8, 10] as const;
/** A goal's description is 40 characters on Twitch; more is cut. */
const DESC_MAX = 100;

// ---------------------------------------------------------------------------
// Pure readers (unit-tested in tests/logic.test.mjs)

type JsonObject = { readonly [key: string]: JsonValue };
function object(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}
function list(value: JsonValue | undefined): readonly JsonValue[] | null {
  return Array.isArray(value) ? value : null;
}
function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}
/** A whole number ≥ 0, sent as a number or as text. */
function whole(value: JsonValue | undefined): number | null {
  const n = typeof value === "string" && /^\d{1,15}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}
function time(value: JsonValue | undefined): number | null {
  const at = Date.parse(text(value) ?? "");
  return Number.isFinite(at) ? at : null;
}
const USER_ID = /^\d{1,32}$/;

/** T1: the ID of the token's user, the channel every other route reads. */
export function parseUser(body: JsonValue): string | null {
  const id = text(object(list(object(body)?.["data"])?.[0])?.["id"]);
  return id !== null && USER_ID.test(id) ? id : null;
}

export type GoalType =
  | "follower"
  | "subscription"
  | "subscription_count"
  | "new_subscription"
  | "new_subscription_count"
  | "new_bit"
  | "new_cheerer"
  | "other";
const GOAL_TYPES: readonly string[] = [
  "follower",
  "subscription",
  "subscription_count",
  "new_subscription",
  "new_subscription_count",
  "new_bit",
  "new_cheerer",
];
export interface Goal {
  id: string;
  type: GoalType;
  /** The streamer's description, `""` without one. */
  desc: string;
  current: number;
  target: number;
  /** Creation, Unix ms (0 if unknown). */
  created: number;
}

/** One goal of T2; `null` when unreadable. */
export function goalItem(entry: JsonValue): Goal | null {
  const o = object(entry);
  const id = text(o?.["id"]) ?? "";
  const current = whole(o?.["current_amount"]);
  const target = whole(o?.["target_amount"]);
  if (o === null || id === "" || current === null || target === null) return null;
  const type = text(o["type"]) ?? "";
  const desc = (text(o["description"]) ?? "").replace(/\s+/g, " ").trim().slice(0, DESC_MAX);
  return {
    id,
    type: (GOAL_TYPES.includes(type) ? type : "other") as GoalType,
    desc,
    current,
    target,
    created: time(o["created_at"]) ?? 0,
  };
}

/** T2: the active goals, newest first; `[]` without any, `null` if unreadable. */
export function parseGoals(body: JsonValue): Goal[] | null {
  const data = list(object(body)?.["data"]);
  if (data === null) return null;
  // Twitch does not document an order: the newest goal comes first.
  return data
    .map(goalItem)
    .filter((g): g is Goal => g !== null)
    .sort((a, b) => b.created - a.created || (a.id < b.id ? -1 : 1));
}

export interface Followers {
  total: number;
  /** The latest follower; `""` when Twitch lists nobody. */
  lastId: string;
  lastName: string;
  /** When they followed, Unix ms (0 if unknown). */
  lastAt: number;
}

/** T3 (`first=1`): the total and the latest follower, Twitch's first. */
export function parseFollowers(body: JsonValue): Followers | null {
  const o = object(body);
  const total = whole(o?.["total"]);
  if (total === null) return null;
  // Without the scope Twitch may send the total alone (API reference).
  const first = object(list(o?.["data"])?.[0]);
  const lastId = text(first?.["user_id"]) ?? "";
  if (lastId === "") return { total, lastId: "", lastName: "", lastAt: 0 };
  const display = text(first?.["user_name"]) ?? "";
  return {
    total,
    lastId,
    lastName: display !== "" ? display : (text(first?.["user_login"]) ?? ""),
    lastAt: time(first?.["followed_at"]) ?? 0,
  };
}

export interface Hype {
  id: string;
  level: number;
  /** Points toward the next level, of `goal`. */
  progress: number;
  goal: number;
  /** End, Unix ms; moved later at each new level. */
  expiresAt: number;
}

/**
 * T4: the running Hype Train; `null` without one (`current` null, or no
 * data, which the reference leaves open), `undefined` if unreadable.
 */
export function parseHype(body: JsonValue): Hype | null | undefined {
  const data = list(object(body)?.["data"]);
  if (data === null) return undefined;
  if (data.length === 0) return null;
  const first = object(data[0]);
  if (first === null) return undefined;
  const current = first["current"];
  if (current === null || current === undefined) return null;
  const c = object(current);
  const level = whole(c?.["level"]);
  const progress = whole(c?.["progress"]);
  const goal = whole(c?.["goal"]);
  const expiresAt = time(c?.["expires_at"]);
  if (level === null || progress === null || goal === null || goal === 0 || expiresAt === null) return undefined;
  return { id: text(c?.["id"]) ?? "", level, progress, goal, expiresAt };
}

/** Backoff after `failures` 5xx or 429 in a row, milliseconds. */
export function backoff(failures: number): number {
  const index = Math.max(1, Math.min(BACKOFF_MINUTES.length, failures)) - 1;
  return (BACKOFF_MINUTES[index] ?? 10) * MINUTE;
}

// ---------------------------------------------------------------------------
// Texts

export function num(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}
/** `{count} min ago`… of an elapsed time in milliseconds. */
export function ago(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return t("ago-now");
  if (minutes < 60) return t("ago-min", { count: num(minutes) });
  if (minutes < 48 * 60) return t("ago-h", { count: num(Math.floor(minutes / 60)) });
  return t("ago-d", { count: num(Math.floor(minutes / 1440)) });
}
/** Age of the data in the warning: the same words. */
export const age = ago;
export function percentOf(current: number, target: number): string {
  return t("percent", { value: num(target > 0 ? Math.min(100, Math.floor((current / target) * 100)) : 0) });
}
export function reached(g: { current: number; target: number }): boolean {
  return g.target > 0 && g.current >= g.target;
}

// ---------------------------------------------------------------------------
// State

export type Layout = "line" | "compact" | "standard" | "full";
export type Phase = "loading" | "ready" | "empty";
/** Why values are old: no answer (every minute), Twitch failing (5xx, unreadable: backoff), its limit, its refusal. */
export type Stale = "" | "unreachable" | "server" | "quota" | "refused";

declare module "@overcrow/sdk" {
  interface WidgetState {
    phase: Phase;
    goals: Goal[] | null;
    followers: Followers | null;
    hype: Hype | null;
    stale: Stale;
    readAt: number;
    now: number;
    newUntil: number;
    narrow: boolean;
    locale: string;
    optionsVersion: number;
    theme: string;
  }
}

export const state = initState({
  phase: "loading" as Phase,
  /** Every active goal, newest first; `null` until read. */
  goals: null as Goal[] | null,
  followers: null as Followers | null,
  hype: null as Hype | null,
  /** The most serious cause among the routes that failed, `""` when none. */
  stale: "" as Stale,
  /** The oldest data shown by a failing route, Unix ms: the warning's age. */
  readAt: 0,
  now: Date.now(),
  /** The followers card is lit until then (a new follower). */
  newUntil: 0,
  narrow: false,
  locale: host.locale,
  optionsVersion: 0,
  theme: host.theme,
});

// ---------------------------------------------------------------------------
// Engine

/** Each route on its own: one failing never holds the others back. */
interface RouteState {
  /** Last request, Unix ms; 0 never. */
  lastCall: number;
  /** Last answer used. */
  okAt: number;
  /** First failure since then. */
  failAt: number;
  /** 5xx or 429 in a row, for the backoff. */
  failures: number;
  /** Refusals in a row while the token is valid. */
  refusals: number;
  retryAt: number;
  stale: Stale;
}
const fresh = (): RouteState => ({ lastCall: 0, okAt: 0, failAt: 0, failures: 0, refusals: 0, retryAt: 0, stale: "" });
const routes: Record<Route, RouteState> = { user: fresh(), goals: fresh(), followers: fresh(), hype: fresh() };
type DataRoute = Exclude<Route, "user">;
const DATA_ROUTES: readonly DataRoute[] = ["goals", "followers", "hype"];

const model = {
  connected: false,
  /** Bumped at each connection: an answer of an older one is dropped. */
  generation: 0,
  /** The channel read by T1 for this connection; `""` reads it again. */
  userId: "",
  /** The channel the values shown belong to. */
  owner: "",
  /** The latest follower of the last read, to see a new one. */
  lastFollower: "",
  lastFollowerAt: 0,
  busy: false,
  pending: false,
};

let countdown: Timer | null = null;
let unlight: Timer | null = null;

function measure(): void {
  state.narrow = host.viewport.width < 230;
}
measure();

/** Whether `r` may be asked now: once per tick of the timer, after its backoff. */
function due(r: RouteState, now: number): boolean {
  // The host fires the timer every minute at a fixed rate; a second of
  // slack absorbs its delivery jitter.
  return (r.lastCall === 0 || now - r.lastCall >= MINUTE - TICK_SLACK) && now >= r.retryAt - TICK_SLACK;
}

const SUB_GOALS: readonly GoalType[] = ["subscription", "subscription_count", "new_subscription", "new_subscription_count"];
/** Whether the options show goals of `type` (unknown types always). */
export function goalTypeShown(type: GoalType): boolean {
  if (SUB_GOALS.includes(type)) return option("goal-subs", true);
  if (type === "follower") return option("goal-followers", true);
  if (type === "new_bit") return option("goal-bits", true);
  if (type === "new_cheerer") return option("goal-cheerers", true);
  return true;
}
/** The routes whose data the options show: the others are not called. */
export function wanted(): Record<DataRoute, boolean> {
  return {
    goals: option("goal-subs", true) || option("goal-followers", true) || option("goal-bits", true) || option("goal-cheerers", true),
    followers: option("show-followers", true) || option("show-last-follower", true),
    hype: option("show-hype", true),
  };
}

type Outcome =
  | { kind: "ok"; body: JsonValue }
  /** A 401/403 while the host's `validate` passes: the token is good. */
  | { kind: "refused" }
  | { kind: "unreachable" }
  | { kind: "quota" }
  | { kind: "server" }
  /** The host's own network budget is full: nothing was asked. */
  | { kind: "busy" }
  /** The account changed during the call. */
  | { kind: "changed" }
  /** The account is not connected (the host covers the content). */
  | { kind: "stop" };

const SERVER_ERRORS: readonly string[] = ["encoding_denied", "content_type_denied", "response_body_limit", "response_metadata_limit", "redirect_denied"];

async function call(route: Route, query: string, now: number): Promise<Outcome> {
  routes[route].lastCall = now;
  try {
    const response = await http.fetch(query === "" ? ROUTES[route] : `${ROUTES[route]}?${query}`, { as: "text" });
    if (response.status === 429) return { kind: "quota" };
    if (response.status === 401 || response.status === 403) return { kind: "refused" };
    if (response.status < 200 || response.status >= 300) return { kind: "server" };
    try {
      return { kind: "ok", body: JSON.parse(response.body) as JsonValue };
    } catch {
      return { kind: "server" };
    }
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unavailable";
    if (code === "account_refused" || code === "not_connected" || code === "permission_denied") return { kind: "stop" };
    if (code === "busy") return { kind: "busy" };
    if (code === "stale_context") return { kind: "changed" };
    if (SERVER_ERRORS.includes(code)) return { kind: "server" };
    return { kind: "unreachable" };
  }
}

function succeeded(r: RouteState, now: number): void {
  Object.assign(r, { okAt: now, failAt: 0, failures: 0, refusals: 0, retryAt: 0, stale: "" });
}

/** A failed read of `r`: values stay, the warning names the cause. */
function failed(r: RouteState, outcome: Outcome, now: number): void {
  if (outcome.kind === "ok" || outcome.kind === "stop") return;
  if (outcome.kind === "busy") {
    // Nothing was asked of Twitch: no warning, next minute again.
    r.retryAt = now + MINUTE;
    return;
  }
  if (outcome.kind === "changed") {
    model.userId = "";
    return;
  }
  if (r.failAt === 0) r.failAt = now;
  if (outcome.kind === "refused") {
    r.refusals += 1;
    if (r.refusals === 1) {
      // Most likely another account is connected: read the channel again
      // at the next tick before saying anything.
      model.userId = "";
      return;
    }
    r.retryAt = now + MINUTE;
    r.stale = "refused";
  } else if (outcome.kind === "unreachable") {
    r.retryAt = now + MINUTE;
    r.stale = "unreachable";
  } else {
    r.failures += 1;
    r.retryAt = now + backoff(r.failures);
    r.stale = outcome.kind;
  }
}

const SEVERITY: readonly Stale[] = ["refused", "quota", "server", "unreachable"];
/** The warning: the most serious cause, the age of the oldest data it concerns. */
function summarize(): void {
  const want = wanted();
  const failing = [routes.user, ...DATA_ROUTES.filter((route) => want[route]).map((route) => routes[route])].filter((r) => r.stale !== "");
  state.stale = SEVERITY.find((kind) => failing.some((r) => r.stale === kind)) ?? "";
  state.readAt = failing.length === 0 ? 0 : Math.min(...failing.map((r) => r.okAt || r.failAt));
  if (state.phase === "loading" && failing.length > 0) state.phase = "empty";
}

/** Forgets the values of another channel. */
function forget(): void {
  state.goals = null;
  state.followers = null;
  setHype(null);
  state.newUntil = 0;
  state.phase = "loading";
  model.lastFollower = "";
  model.lastFollowerAt = 0;
  // Another channel: its routes are read at once.
  for (const route of DATA_ROUTES) routes[route] = fresh();
}

/** One read of Twitch, under the rhythm rules; never two at once. */
export async function refresh(): Promise<void> {
  if (model.busy) {
    model.pending = true;
    return;
  }
  model.busy = true;
  try {
    await read();
  } finally {
    model.busy = false;
  }
  if (model.pending) {
    model.pending = false;
    void refresh();
  }
}

async function read(): Promise<void> {
  const now = Date.now();
  state.now = now;
  // Hidden, the widget calls nothing (the host does not tick it either).
  if (!host.visible || !model.connected) return;
  const want = wanted();
  if (!want.goals && !want.followers && !want.hype) return;
  const generation = model.generation;
  if (model.userId === "") {
    if (!due(routes.user, now)) return;
    const outcome = await call("user", "", now);
    if (generation !== model.generation) return;
    const id = outcome.kind === "ok" ? parseUser(outcome.body) : null;
    if (id === null) {
      failed(routes.user, outcome.kind === "ok" ? { kind: "server" } : outcome, now);
      summarize();
      return;
    }
    succeeded(routes.user, now);
    if (model.owner !== "" && model.owner !== id) forget();
    model.userId = id;
    model.owner = id;
  }
  const channel = `broadcaster_id=${encodeURIComponent(model.userId)}`;
  // The three routes do not depend on each other: they leave together.
  const reads = DATA_ROUTES.filter((route) => want[route] && due(routes[route], now));
  const outcomes = await Promise.all(reads.map((route) => call(route, route === "followers" ? `${channel}&first=1` : channel, now)));
  if (generation !== model.generation) return;
  reads.forEach((route, index) => {
    const outcome = outcomes[index] as Outcome;
    if (outcome.kind === "ok" && apply(route, outcome.body, now)) succeeded(routes[route], now);
    else failed(routes[route], outcome.kind === "ok" ? { kind: "server" } : outcome, now);
  });
  summarize();
}

/** Puts a route's answer in the state; `false` when unreadable. */
function apply(route: DataRoute, body: JsonValue, now: number): boolean {
  if (route === "goals") {
    const goals = parseGoals(body);
    if (goals === null) return false;
    state.goals = goals;
  } else if (route === "followers") {
    const followers = parseFollowers(body);
    if (followers === null) return false;
    // A newer latest follower lights the card; never at the first read, and
    // never an older one coming back first after an unfollow.
    const newer = followers.lastId !== "" && followers.lastId !== model.lastFollower && followers.lastAt > model.lastFollowerAt;
    if (newer && model.lastFollower !== "") light(now);
    if (followers.lastId !== "") {
      model.lastFollower = followers.lastId;
      model.lastFollowerAt = Math.max(model.lastFollowerAt, followers.lastAt);
    }
    state.followers = followers;
  } else {
    const hype = parseHype(body);
    if (hype === undefined) return false;
    setHype(hype !== null && hype.expiresAt > now ? hype : null);
  }
  state.phase = "ready";
  return true;
}

function light(now: number): void {
  state.newUntil = now + NEW_FOLLOWER_FOR;
  unlight?.cancel();
  unlight = timers.after(NEW_FOLLOWER_FOR, () => {
    unlight = null;
    state.now = Date.now();
  });
}

/** Shows a Hype Train and counts it down each second, only while it runs and is shown. */
function setHype(hype: Hype | null): void {
  state.hype = hype;
  state.now = Date.now();
  const counting = hype !== null && option("show-hype", true);
  if (!counting) {
    countdown?.cancel();
    countdown = null;
    return;
  }
  // The countdown follows the clock's second, as a clock does; no request.
  countdown ??= timers.atEach("second", tick);
}

/** A second of the Hype Train: at zero the card leaves without waiting for Twitch. */
function tick(): void {
  state.now = Date.now();
  if (state.hype !== null && state.hype.expiresAt <= state.now) setHype(null);
}

// ---------------------------------------------------------------------------
// Host, account, timer

onHost((changed) => {
  if (changed.includes("viewport")) measure();
  if (changed.includes("locale")) state.locale = host.locale;
  if (changed.includes("theme")) state.theme = host.theme;
  // The user's number format: the view writes numbers again.
  if (changed.includes("options") || changed.includes("region")) state.optionsVersion += 1;
  if (changed.includes("options")) {
    setHype(state.hype);
    summarize();
    // A route the options show again is read at once (within its rhythm).
    void refresh();
  }
  if (changed.includes("visible") && host.visible) {
    tick();
    void refresh();
  }
});

account.subscribe({ id: "twitch" }, (update) => {
  const connected = update.ok && update.value.state === "connected";
  const was = model.connected;
  model.connected = connected;
  if (connected !== was) model.generation += 1;
  if (connected && !was) {
    // Each connection reads the channel again: it may be another account.
    // The values shown stay until then.
    model.userId = "";
    for (const route of DATA_ROUTES) Object.assign(routes[route], { refusals: 0, retryAt: 0 });
    // A new connection reads its channel at once.
    routes.user = fresh();
    void refresh();
  }
});

timers.every(MINUTE, () => {
  state.now = Date.now();
  void refresh();
});

// ---------------------------------------------------------------------------
// View helpers (the view's expressions)

export function layout(_v: number): Layout {
  const value = option("layout", "standard");
  return value === "line" || value === "compact" || value === "full" ? value : "standard";
}
export function showFollowers(_v: number): boolean {
  return option("show-followers", true);
}
export function showLast(_v: number): boolean {
  return option("show-last-follower", true);
}
/** Option "Twitch logo": off, the attribution is the word "Twitch". */
export function showLogo(_v: number): boolean {
  return option("show-logo", true);
}
export function goalType(g: Goal): string {
  return g.type === "other" ? t("type-other") : t(`type-${g.type}`);
}
/** The streamer's description, or the type when there is none: never both. */
export function goalTitle(g: Goal): string {
  if (g.desc !== "") return g.desc;
  return g.type === "other" ? t("goal") : t("goal-of", { type: goalType(g) });
}
export function typeIcon(g: Goal): IconName {
  if (reached(g)) return "circle-check";
  if (g.type === "follower") return "user-plus";
  if (g.type === "new_bit") return "gem";
  if (g.type === "new_cheerer") return "sparkles";
  if (g.type === "other") return "target";
  return "star";
}
/** The running Hype Train, if the options show it. */
export function hype(s: typeof state, _v: number): Hype | null {
  return option("show-hype", true) && s.hype !== null && s.hype.expiresAt > s.now ? s.hype : null;
}
function leftMs(h: Hype, now: number): number {
  return Math.max(0, h.expiresAt - now);
}
export function hypeLeft(h: Hype, s: typeof state): string {
  return t("hype-left", { time: formatDuration(leftMs(h, s.now)) });
}
export function hypeTime(h: Hype, s: typeof state): string {
  return formatDuration(leftMs(h, s.now));
}
export function hypeLevel(h: Hype, short: boolean): string {
  return t(short ? "hype-level-short" : "hype-level", { level: num(h.level) });
}
export interface ShownGoal extends Goal {
  /** The Glitch's file when this card carries the attribution, else `""`. */
  mark: string;
}
/** The goals the options show: one, three in Full. */
function shown(s: typeof state, v: number): Goal[] {
  return (s.goals ?? []).filter((g) => goalTypeShown(g.type)).slice(0, layout(v) === "full" ? 3 : 1);
}
export function goals(s: typeof state, v: number): ShownGoal[] {
  const first = firstCard(s, v);
  return shown(s, v).map((g) => ({ ...g, mark: first === goalKey(g) ? glitch(s.theme) : "" }));
}
export function firstGoal(s: typeof state, v: number): Goal | null {
  return shown(s, v)[0] ?? null;
}
export function goalKey(g: Goal): string {
  return `goal:${g.id}`;
}
/** "No active goal": Twitch lists none, and the options show goals. */
export function noGoalCard(s: typeof state, v: number): boolean {
  return wanted().goals && s.goals !== null && s.goals.length === 0 && hype(s, v) === null && layout(v) !== "line";
}
/** Followers card: in Standard only without a Hype Train, always in Full. */
export function followersCard(s: typeof state, v: number): boolean {
  if (s.followers === null || (!showFollowers(v) && !showLast(v))) return false;
  if (!showFollowers(v) && s.followers.lastId === "") return false;
  const lay = layout(v);
  if (lay === "full") return true;
  if (lay === "standard") return hype(s, v) === null || firstGoal(s, v) === null;
  return lay === "compact" && firstGoal(s, v) === null && hype(s, v) === null && !noGoalCard(s, v);
}
/** What the widget shows: the options before anything else, then the data. */
export function screen(s: typeof state, v: number): "nothing" | "loading" | "empty" | "content" {
  const want = wanted();
  if (!want.goals && !want.followers && !want.hype) return "nothing";
  if (s.phase !== "ready") return s.phase;
  return nothingShown(s, v) ? "nothing" : "content";
}
export function nothingShown(s: typeof state, v: number): boolean {
  if (layout(v) === "line") return hype(s, v) === null && firstGoal(s, v) === null && !lineFollowers(s, v) && !lineNoGoal(s, v);
  return hype(s, v) === null && firstGoal(s, v) === null && !noGoalCard(s, v) && !followersCard(s, v);
}
/** One line: the followers when neither a train nor a goal is shown. */
export function lineFollowers(s: typeof state, v: number): boolean {
  return s.followers !== null && (showFollowers(v) || (showLast(v) && s.followers.lastId !== ""));
}
export function lineNoGoal(s: typeof state, v: number): boolean {
  return wanted().goals && s.goals !== null && s.goals.length === 0;
}
export function lineFollowersText(s: typeof state, v: number): string {
  const f = s.followers;
  if (f === null) return "";
  return showFollowers(v) ? num(f.total) : t("last-follower-short", { name: f.lastName });
}
export function lineFollowersUnit(_s: typeof state, v: number): string {
  return showFollowers(v) ? ` ${t("followers")}` : "";
}
export function isNewFollower(s: typeof state): boolean {
  return s.newUntil > s.now;
}
export function followersClass(s: typeof state): string {
  return isNewFollower(s) ? "followers new" : "followers";
}
export function lastFollower(s: typeof state, full: boolean): string {
  const f = s.followers;
  if (f === null || f.lastId === "") return "";
  if (full && f.lastAt > 0) return t("last-follower", { name: f.lastName, ago: ago(s.now - f.lastAt) });
  return t("last-follower-short", { name: f.lastName });
}
export function hasLast(s: typeof state, v: number): boolean {
  return showLast(v) && s.followers !== null && s.followers.lastName !== "";
}
export function isStale(s: typeof state): boolean {
  return s.stale !== "";
}
export function staleIcon(s: typeof state): IconName {
  if (s.stale === "quota") return "hourglass";
  return s.stale === "refused" ? "circle-alert" : "cloud-off";
}
/** "Unreachable · 5 min ago": Twitch failing reads as unreachable too. */
export function staleText(s: typeof state): string {
  if (s.stale === "") return "";
  return t(`stale-${s.stale === "server" ? "unreachable" : s.stale}`, { age: age(s.now - s.readAt) });
}
export function staleTip(s: typeof state): string {
  return s.stale === "" ? "" : t(`stale-${s.stale}-tip`);
}
/** The first load failed: why, and when the widget tries again. */
export function emptyText(s: typeof state): string {
  return t(`empty-${s.stale === "" ? "unreachable" : s.stale}`);
}
export function emptyIcon(s: typeof state): IconName {
  return staleIcon(s);
}
/** One line has no room for the Glitch: its icon's tooltip names the source. */
export function lineTip(what: string): string {
  return `${what} · ${t("source")}`;
}
export function rootClass(s: typeof state): string {
  return `root ${layout(s.optionsVersion)}${s.narrow ? " narrow" : ""}`;
}
/**
 * Twitch's Glitch, as attribution of the source (Twitch Developer Services
 * Agreement): the official file unchanged, white on the dark theme, Black
 * Ops on the light one, 16 px high with its clear space, on the first card
 * only, never in the title. Not in the one-line layout (no room for the
 * clear space). Always a string, as an image's `src` must be.
 */
export function glitch(_theme: string): string {
  return host.theme === "light" ? "assets/glitch-black-ops-64.png" : "assets/glitch-white-64.png";
}
/** The card that carries the attribution: "hype", "goal:<id>", "nogoal" or "followers". */
export function firstCard(s: typeof state, v: number): string {
  if (hype(s, v)) return "hype";
  const g = firstGoal(s, v);
  if (g) return goalKey(g);
  if (noGoalCard(s, v)) return "nogoal";
  return "followers";
}
/** The Glitch's file for the card `key`, or `""` when another card carries it. */
export function markFor(s: typeof state, v: number, key: string): string {
  return firstCard(s, v) === key ? glitch(s.theme) : "";
}
export function carries(mark: unknown): boolean {
  return typeof mark === "string" && mark !== "";
}
