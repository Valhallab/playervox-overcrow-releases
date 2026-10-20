// Steam achievements: the achievements of the game you play on Steam, read
// through PlayerVox OverCrow's integrated Steam service. The widget never sees
// the key: the host adds it to the routes that name the `steam` account.
// Only `GET` routes of the player and game interfaces; never a trade route.
//
// Rhythm: one timer a minute, never two requests of one route less than a
// minute apart, nothing while hidden. Values never disappear: a failed read
// keeps what was shown and says how old it is.
import {
  account,
  formatNumber,
  host,
  http,
  initState,
  onHost,
  onMenu,
  option,
  storage,
  t,
  timers,
  type JsonValue,
} from "@overcrow/sdk";

// ---------------------------------------------------------------------------
// Routes

export const API = "https://api.steampowered.com";
export const ROUTES = {
  vanity: `${API}/ISteamUser/ResolveVanityURL/v1/`,
  summary: `${API}/ISteamUser/GetPlayerSummaries/v2/`,
  recent: `${API}/IPlayerService/GetRecentlyPlayedGames/v1/`,
  player: `${API}/ISteamUserStats/GetPlayerAchievements/v1/`,
  schema: `${API}/ISteamUserStats/GetSchemaForGame/v2/`,
  rarity: `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/`,
} as const;
export type Route = keyof typeof ROUTES;
/** Images: the path Steam gives, set on a host the manifest declares. */
export const ICON_ORIGIN = "https://cdn.akamai.steamstatic.com";


/** One minute, the least time between two requests of one route. */
export const MINUTE = 60_000;
const TICK_SLACK = 1000;
const OUT_OF_GAME_EVERY = 10 * MINUTE;
const RARITY_EVERY = 24 * 60 * MINUTE;
const NEW_FOR = MINUTE;
const IMAGE_RETRY_AFTER = 60 * MINUTE;
/** Backoff of a 5xx or a 429, minutes: then 10 min. */
const BACKOFF_MINUTES = [1, 2, 4, 8, 10] as const;

// ---------------------------------------------------------------------------
// Pure readers (unit-tested in tests/logic.test.mjs)

const STEAMID = /^7656119\d{10}$/;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

export type ProfileInput = { kind: "id"; steamid: string } | { kind: "vanity"; name: string };

/**
 * A profile link as people copy it: `steamcommunity.com/profiles/<id>`,
 * `steamcommunity.com/id/<name>`, a SteamID64 or a custom name alone, with
 * or without `https://`, `www.`, a final `/`, a query or a fragment.
 */
export function parseProfileInput(text: string): ProfileInput | null {
  let value = text.trim();
  if (value.length === 0 || value.length > 256) return null;
  if (STEAMID.test(value)) return { kind: "id", steamid: value };
  if (VANITY.test(value) && !/^\d+$/.test(value)) return { kind: "vanity", name: value };
  value = value.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const match = /^steamcommunity\.com\/(profiles|id)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(value);
  if (match === null) return null;
  const kind = (match[1] ?? "").toLowerCase();
  const tail = match[2] ?? "";
  if (kind === "profiles") return STEAMID.test(tail) ? { kind: "id", steamid: tail } : null;
  return VANITY.test(tail) ? { kind: "vanity", name: tail } : null;
}

type JsonObject = { readonly [key: string]: JsonValue };
function object(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}
function text(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}
function whole(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
/** A number Steam sends as a number or as text. */
function numeric(value: JsonValue | undefined): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

/** S1: the SteamID64 of a custom name, `notfound`, or `null` if unreadable. */
export function parseVanity(body: JsonValue): { steamid: string } | "notfound" | null {
  const response = object(object(body)?.["response"]);
  if (response === null) return null;
  const success = whole(response["success"]);
  const steamid = text(response["steamid"]);
  if (success === 1 && steamid !== null && STEAMID.test(steamid)) return { steamid };
  return success === 42 ? "notfound" : null;
}

export interface Summary {
  /** `communityvisibilitystate` 3: the profile is public. */
  visible: boolean;
  /** The game running now, only with public game details. */
  appid: number | null;
  gameName: string | null;
}

/** S2: the player of `steamid`; `notfound` when Steam lists nobody. */
export function parseSummary(body: JsonValue, steamid: string): Summary | "notfound" | null {
  const players = object(object(body)?.["response"])?.["players"];
  if (!Array.isArray(players)) return null;
  if (players.length === 0) return "notfound";
  const player = players.map((entry) => object(entry)).find((entry) => entry !== null && entry["steamid"] === steamid);
  if (player === undefined || player === null) return null;
  const visibility = whole(player["communityvisibilitystate"]);
  if (visibility === null) return null;
  const gameid = text(player["gameid"]);
  const appid = gameid !== null && /^\d{1,8}$/.test(gameid) ? Number(gameid) : null;
  return { visible: visibility === 3, appid: appid !== null && appid > 0 ? appid : null, gameName: appid === null ? null : text(player["gameextrainfo"]) };
}

export interface RecentGame { appid: number; name: string; icon: string }
export interface Recent {
  games: RecentGame[];
  /** No `total_count`: Steam hides the games (private game details). */
  hidden: boolean;
}

/** S3: the games played in the last two weeks, most recent first. */
export function parseRecent(body: JsonValue): Recent | null {
  const response = object(object(body)?.["response"]);
  if (response === null) return null;
  if (!("total_count" in response)) return { games: [], hidden: true };
  const games = response["games"] ?? [];
  if (!Array.isArray(games)) return null;
  const list: RecentGame[] = [];
  for (const entry of games) {
    const game = object(entry);
    const appid = whole(game?.["appid"]);
    const name = text(game?.["name"]);
    if (appid === null || appid === 0 || name === null) continue;
    const icon = text(game?.["img_icon_url"]) ?? "";
    list.push({ appid, name, icon: /^[0-9a-f]{40}$/.test(icon) ? icon : "" });
  }
  return { games: list, hidden: false };
}

/** The error text of a stats answer (`Requested app has no stats`…). */
function statsError(body: JsonValue): string | null {
  return text(object(object(body)?.["playerstats"])?.["error"]);
}
export function hasNoStats(body: JsonValue): boolean {
  return /no stats/i.test(statsError(body) ?? "");
}

/** One achievement of S4: `[apiname, unlocktime]` when unlocked. */
export function playerItem(entry: JsonValue): [string, number] | null {
  const item = object(entry);
  const api = text(item?.["apiname"]);
  if (api === null || whole(item?.["achieved"]) !== 1) return null;
  return [api, whole(item?.["unlocktime"]) ?? 0];
}

/** S4: unlock time (Unix seconds) of each unlocked achievement by API name. */
export function parsePlayerAchievements(body: JsonValue): Map<string, number> | null {
  const stats = object(object(body)?.["playerstats"]);
  if (stats === null || stats["success"] === false) return null;
  const list = stats["achievements"] ?? [];
  if (!Array.isArray(list)) return null;
  const unlocked = new Map<string, number>();
  for (const entry of list) {
    const pair = playerItem(entry);
    if (pair !== null) unlocked.set(pair[0], pair[1]);
  }
  return unlocked;
}

export interface SchemaAch {
  api: string;
  name: string;
  desc: string;
  hidden: boolean;
  /** File name of the icon (`<hash>.jpg`), `""` when unusable. */
  icon: string;
  iconGray: string;
}

// The name and `.jpg` within the route's `maxLength` (64).
const ICON_FILE = /\/steamcommunity\/public\/images\/apps\/(\d{1,8})\/([A-Za-z0-9_-]{1,60}\.jpg)$/;

/** The file name of an icon URL of `appid`, whatever host Steam named. */
export function iconFile(appid: number, url: string): string {
  const match = ICON_FILE.exec(url.replace(/^https?:\/\/[^/]+/i, ""));
  return match !== null && Number(match[1]) === appid ? (match[2] ?? "") : "";
}

/** One achievement of S5. */
export function schemaItem(entry: JsonValue, appid: number): SchemaAch | null {
  const item = object(entry);
  const api = text(item?.["name"]);
  if (api === null || api === "") return null;
  return {
    api,
    name: text(item?.["displayName"]) ?? api,
    desc: text(item?.["description"]) ?? "",
    hidden: item?.["hidden"] === 1,
    icon: iconFile(appid, text(item?.["icon"]) ?? ""),
    iconGray: iconFile(appid, text(item?.["icongray"]) ?? ""),
  };
}

/** S5: the achievements of a game; `[]` for a game without any. */
export function parseSchema(body: JsonValue, appid: number): SchemaAch[] | null {
  const game = object(object(body)?.["game"]);
  if (game === null) return null;
  const list = object(game["availableGameStats"])?.["achievements"] ?? [];
  if (!Array.isArray(list)) return null;
  const out: SchemaAch[] = [];
  for (const entry of list) {
    const item = schemaItem(entry, appid);
    if (item !== null) out.push(item);
  }
  return out;
}

/** S6: the share of players who unlocked each achievement, percent. */
export function parsePercentages(body: JsonValue): Map<string, number> {
  const list = object(object(body)?.["achievementpercentages"])?.["achievements"];
  const rarity = new Map<string, number>();
  if (!Array.isArray(list)) return rarity;
  for (const entry of list) {
    const pair = rarityItem(entry);
    if (pair !== null) rarity.set(pair[0], pair[1]);
  }
  return rarity;
}

/** One achievement of S6: `[name, percent]`. */
export function rarityItem(entry: JsonValue): [string, number] | null {
  const item = object(entry);
  const api = text(item?.["name"]);
  const percent = numeric(item?.["percent"]);
  return api !== null && percent !== null && percent >= 0 && percent <= 100 ? [api, percent] : null;
}

// ---------------------------------------------------------------------------
// Large answers

/** Answers up to this size are parsed at once; larger ones in slices. */
export const SLICE_FROM = 64 * 1024;
/** Characters scanned per VM turn (the turn budget is 50 ms, under a CPU ceiling). */
export const SLICE_CHARS = 16 * 1024;
const SLICE_PAUSE_MS = 100;

const QUOTE = 34;
const BACKSLASH = 92;
const OPEN_BRACE = 123;
const CLOSE_BRACE = 125;
const OPEN_BRACKET = 91;
const CLOSE_BRACKET = 93;
const COLON = 58;

/**
 * The items of the array `"<key>": […]` of a large answer, `SLICE_CHARS`
 * characters per step: a small JSON scanner (strings and depth) finds the
 * key, then cuts each item, whatever the spacing, and stops at the array's
 * own `]`, so what follows it (Steam's `stats`) is never read as items.
 * Each item is parsed by the engine's `JSON.parse`. A missing key is said
 * (`found`), an answer cut short throws.
 */
export class ItemReader {
  /** Whether the key was found. */
  found = false;
  private position = 0;
  private done = false;
  private inString = false;
  private escaped = false;
  private stringStart = -1;
  /** The last string closed was the key, then its colon was seen. */
  private keyClosedAt = -1;
  private afterColon = false;
  private depth = 0;
  private itemStart = -1;

  constructor(
    private readonly text: string,
    private readonly key: string,
  ) {}

  /** The next items; `null` once every item was read. Throws on a cut answer. */
  step(): JsonValue[] | null {
    const text = this.text;
    const items: JsonValue[] = [];
    const stop = Math.min(text.length, this.position + SLICE_CHARS);
    let i = this.position;
    while (!this.done && i < stop) {
      const c = text.charCodeAt(i);
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === BACKSLASH) this.escaped = true;
        else if (c === QUOTE) {
          this.inString = false;
          if (!this.found && text.slice(this.stringStart, i + 1) === `"${this.key}"`) this.keyClosedAt = i;
        }
      } else if (c === QUOTE) {
        this.inString = true;
        this.stringStart = i;
      } else if (!this.found) {
        // Seeking: `"key"`, spaces, `:`, spaces, `[`.
        if (c === COLON && this.keyClosedAt >= 0) this.afterColon = true;
        else if (c === OPEN_BRACKET && this.afterColon) {
          this.found = true;
          this.depth = 0;
        } else if (c > 32) {
          this.keyClosedAt = -1;
          this.afterColon = false;
        }
      } else if (c === OPEN_BRACE || c === OPEN_BRACKET) {
        if (this.depth === 0) this.itemStart = i;
        this.depth += 1;
      } else if (c === CLOSE_BRACE || c === CLOSE_BRACKET) {
        if (this.depth === 0) {
          // The array's own `]`.
          this.done = true;
          break;
        }
        this.depth -= 1;
        if (this.depth === 0) {
          items.push(JSON.parse(text.slice(this.itemStart, i + 1)) as JsonValue);
          this.itemStart = -1;
        }
      }
      i += 1;
    }
    this.position = i;
    if (!this.done && i >= text.length) {
      if (this.found) throw new Error("invalid answer");
      this.done = true;
    }
    return items.length === 0 && this.done ? null : items;
  }
}

function pause(): Promise<void> {
  return new Promise((resolve) => {
    timers.after(SLICE_PAUSE_MS, () => resolve());
  });
}

/**
 * Feeds every item of the list `key` of a large answer to `each`, one slice
 * per VM turn: `found` without the list, `invalid` for a cut answer.
 */
async function readItems(text: string, key: string, each: (item: JsonValue) => void): Promise<"read" | "found-none" | "invalid"> {
  const reader = new ItemReader(text, key);
  try {
    for (;;) {
      const items = reader.step();
      if (items === null) return reader.found ? "read" : "found-none";
      for (const item of items) each(item);
      await pause();
    }
  } catch {
    return "invalid";
  }
}

/** The icon of an achievement on the declared host; `""` without one. */
export function iconUrl(appid: number, file: string): string {
  return file === "" ? "" : `${ICON_ORIGIN}/steamcommunity/public/images/apps/${appid}/${file}`;
}
/** The game's icon (S3 hash). */
export function gameIconUrl(appid: number, hash: string): string {
  return /^[0-9a-f]{40}$/.test(hash) ? iconUrl(appid, `${hash}.jpg`) : "";
}
/** The store header of a game, on each declared host in turn. */
export function headerUrls(appid: number): string[] {
  return [
    `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
  ];
}

/** Backoff after `failures` 5xx or 429 in a row, milliseconds. */
export function backoff(failures: number): number {
  const index = Math.max(0, Math.min(BACKOFF_MINUTES.length - 1, failures - 1));
  return (BACKOFF_MINUTES[index] ?? 10) * MINUTE;
}

// ---------------------------------------------------------------------------
// Texts

export function num(value: number, digits = 0): string {
  return formatNumber(value, { maximumFractionDigits: digits });
}
/** `{count} min ago`… of an elapsed time in milliseconds. */
export function ago(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return t("ago-now");
  if (minutes < 60) return t("ago-min", { count: num(minutes) });
  if (minutes < 48 * 60) return t("ago-h", { count: num(Math.floor(minutes / 60)) });
  return t("ago-d", { count: num(Math.floor(minutes / 1440)) });
}
/** Age of the data in the warning: `5 min ago`… */
export function age(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / MINUTE);
  if (minutes < 1) return t("age-now");
  if (minutes < 60) return t("age-min", { count: num(minutes) });
  return t("age-h", { count: num(Math.floor(minutes / 60)) });
}
export function percentOf(unlocked: number, total: number): string {
  return t("percent", { value: num(total > 0 ? Math.floor((unlocked / total) * 100) : 0) });
}
function rarityValue(value: number): string {
  return num(value, value < 10 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// State

export type Layout = "line" | "compact" | "standard" | "full";
export type Phase = "loading" | "profile" | "nothing" | "private-empty" | "empty-unreachable" | "game";
export type Stale = "" | "unreachable" | "quota";

export interface GameView {
  appid: number;
  name: string;
  /** URLs; the view shows each once its image arrived. */
  icon: string;
  header: string;
  /** From a fresh S2 read with this `gameid`. */
  playing: boolean;
  /** Steam hides the game details. */
  privateGame: boolean;
  /** Steam answered 403 for this game's achievements (not owned…). */
  readable: boolean;
  /** The list of the game's achievements was read (else: still reading). */
  known: boolean;
  hasAch: boolean;
  unlocked: number;
  total: number;
}

export interface Ach {
  id: string;
  name: string;
  desc: string;
  icon: string;
  iconGray: string;
  achieved: boolean;
  /** Unix milliseconds of the unlock; 0 when unknown. */
  at: number;
  /** Percent of players; -1 when unknown. */
  rarity: number;
  hidden: boolean;
}

/**
 * What the view shows of the achievements: a game can have thousands, so
 * the full list stays out of the state and the view reads only these.
 */
export interface Lists {
  latest: Ach | null;
  tracked: Ach | null;
  /** Unlocked, newest first (7 at most: the latest and 6 rows). */
  recent: Ach[];
  /** Missing in the chosen order (13 at most: 12 rows and the tracked one). */
  missing: Ach[];
  /** The picker's list (50 at most), only while it is open. */
  pick: Ach[];
}

export interface Profile {
  status: "idle" | "checking" | "invalid" | "notfound";
  value: string;
  canCancel: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    phase: Phase;
    profile: Profile;
    game: GameView | null;
    /** The few achievements the view shows, chosen by `compute`. */
    lists: Lists;
    tracked: string;
    picking: boolean;
    stale: Stale;
    /** When the shown data was last read, Unix ms. */
    readAt: number;
    /** Achievements marked "New", by ID, until then (Unix ms). */
    fresh: Record<string, number>;
    /** Image handles by URL, once loaded. */
    images: Record<string, string>;
    now: number;
    narrow: boolean;
    wide: boolean;
    interactive: boolean;
    locale: string;
    optionsVersion: number;
    theme: string;
  }
}

export const state = initState({
  phase: "loading" as Phase,
  profile: { status: "idle", value: "", canCancel: false } as Profile,
  game: null as GameView | null,
  lists: { latest: null, tracked: null, recent: [], missing: [], pick: [] } as Lists,
  tracked: "",
  picking: false,
  stale: "" as Stale,
  readAt: 0,
  fresh: {} as Record<string, number>,
  images: {} as Record<string, string>,
  now: Date.now(),
  narrow: false,
  wide: false,
  interactive: host.mode === "interactive",
  locale: host.locale,
  optionsVersion: 0,
  theme: host.theme,
});

// ---------------------------------------------------------------------------
// Engine

interface SchemaEntry { list: SchemaAch[]; gameName: string }

/** Everything read from Steam, the view being built from it. */
const model = {
  connected: false,
  steamid: "",
  input: "",
  /** The game shown, and where it comes from. */
  appid: 0,
  gameName: "",
  iconHash: "",
  /** The game the snapshot's icon belongs to. */
  iconHashOf: 0,
  playing: false,
  privateGame: false,
  readable: true,
  noStats: false,
  /** The last S3 read hid the games (private game details). */
  recentHidden: false,
  unlocked: null as Map<string, number> | null,
  rarity: new Map<number, { at: number; values: Map<string, number> }>(),
  schemas: new Map<string, SchemaEntry>(),
  icons: new Map<number, string>(),
  tracked: { appid: 0, api: "" },
  /** Last request of each route (the schema: of each language). */
  lastCall: new Map<string, number>(),
  /** Last S4 and S3 reads of the shown game, Unix ms. */
  readPlayer: 0,
  readRecent: 0,
  failures: 0,
  retryAt: 0,
  busy: false,
  pending: false,
  /** The summary the profile step just read, used as the next read's. */
  checked: null as { steamid: string; at: number; body: JsonValue } | null,
  /** The profile shown before "Change Steam profile…". */
  previousPhase: "loading" as Phase,
};

const images = {
  failedAt: new Map<string, number>(),
  loading: new Set<string>(),
};

function measure(): void {
  state.narrow = host.viewport.width < 230;
  state.wide = host.viewport.width >= 440;
}
measure();

const language = (): "english" | "french" => (host.locale === "fr" ? "french" : "english");
const schemaKey = (appid: number, l: string): string => `${appid}:${l}`;

/** Whether `route` may be called now: never twice within a minute. */
export function canCall(route: Route | string, now: number, every = MINUTE): boolean {
  const last = model.lastCall.get(route);
  // Reads are stamped with their tick, which the host fires every minute
  // at a fixed rate; a second of slack absorbs its delivery jitter.
  return last === undefined || now - last >= every - TICK_SLACK;
}

type Outcome =
  /** `body` is the parsed answer, or `null` for a large one kept as `text`. */
  | { kind: "ok"; status: number; body: JsonValue; text: string }
  | { kind: "status"; status: number; body: JsonValue }
  | { kind: "unreachable" }
  | { kind: "quota" }
  | { kind: "server" }
  /** The host's own network budget is full (`busy`): no read happened. */
  | { kind: "busy" }
  | { kind: "stop" };

function query(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join("&");
}

async function call(
  route: Route,
  params: Record<string, string | number>,
  key: string = route,
  at: number = Date.now(),
): Promise<Outcome> {
  // Stamped with the read's own time, not when the request leaves: a slow
  // answer to the first route never pushes the others to the next minute.
  model.lastCall.set(key, at);
  try {
    // Text: a large answer is parsed in slices, never in one turn.
    const response = await http.fetch(`${ROUTES[route]}?${query(params)}`, { as: "text" });
    if (response.status === 429) return { kind: "quota" };
    const large = response.body.length > SLICE_FROM;
    let body: JsonValue = null;
    if (!large && response.body !== "") {
      try {
        body = JSON.parse(response.body) as JsonValue;
      } catch {
        if (response.status >= 200 && response.status < 300) return { kind: "server" };
      }
    }
    if (response.status >= 200 && response.status < 300) return { kind: "ok", status: response.status, body, text: large ? response.body : "" };
    return { kind: "status", status: response.status, body };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unavailable";
    // The host covers the content: nothing to say here.
    if (code === "account_refused" || code === "not_connected" || code === "permission_denied") return { kind: "stop" };
    if (code === "encoding_denied" || code === "content_type_denied") return { kind: "server" };
    if (code === "busy") return { kind: "busy" };
    return { kind: "unreachable" };
  }
}

/** A failed read: values stay, the warning names the cause. */
function failed(outcome: Outcome, now: number): void {
  if (outcome.kind === "stop") return;
  if (outcome.kind === "busy") {
    // Nothing was asked of Steam: the view stays as it is, next minute again.
    model.retryAt = now + MINUTE;
    return;
  }
  if (outcome.kind === "quota" || outcome.kind === "server" || (outcome.kind === "status" && outcome.status >= 500)) {
    model.failures += 1;
    model.retryAt = now + backoff(model.failures);
    state.stale = outcome.kind === "quota" ? "quota" : "unreachable";
  } else {
    model.retryAt = now + MINUTE;
    state.stale = "unreachable";
  }
  // "Playing now" only from a fresh read.
  model.playing = false;
  // Without a game shown, never "Play a Steam game" while Steam is down.
  if (state.phase === "loading" || state.phase === "nothing" || state.phase === "private-empty") state.phase = "empty-unreachable";
  render();
}

function succeeded(now: number): void {
  model.failures = 0;
  model.retryAt = 0;
  state.stale = "";
  state.readAt = now;
}

/** One read of Steam, under the rhythm rules; never two at once. */
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
  if (!host.visible || !model.connected || model.steamid === "" || state.phase === "profile") return;
  const checked = model.checked;
  model.checked = null;
  const fresh = checked !== null && checked.steamid === model.steamid && now - checked.at < MINUTE - TICK_SLACK;
  if (!fresh && (now < model.retryAt - TICK_SLACK || !canCall("summary", now))) return;
  const summaryAnswer: Outcome =
    fresh && checked !== null
      ? { kind: "ok", status: 200, body: checked.body, text: "" }
      : await call("summary", { steamids: model.steamid }, "summary", now);
  if (summaryAnswer.kind !== "ok") return failed(summaryAnswer, now);
  const summary = parseSummary(summaryAnswer.body, model.steamid);
  if (summary === null || summary === "notfound") return failed({ kind: "server" }, now);

  let appid = summary.appid ?? 0;
  model.playing = appid !== 0;
  model.privateGame = !summary.visible;
  // The running game's name, or none yet (S3 or S5 give it): never the
  // previous game's.
  if (appid !== 0 && (summary.gameName !== null || appid !== model.appid)) model.gameName = summary.gameName ?? "";

  const switched = appid !== 0 && appid !== model.appid;
  const recentDue = switched || (appid === 0 && (model.readRecent === 0 || now - model.readRecent >= OUT_OF_GAME_EVERY));
  if (recentDue && canCall("recent", now)) {
    const recentAnswer = await call("recent", { steamid: model.steamid, count: 5 }, "recent", now);
    if (recentAnswer.kind !== "ok") return failed(recentAnswer, now);
    const recent = parseRecent(recentAnswer.body);
    if (recent === null) return failed({ kind: "server" }, now);
    model.readRecent = now;
    model.recentHidden = recent.hidden;
    for (const game of recent.games) if (game.icon !== "") model.icons.set(game.appid, game.icon);
    if (appid === 0) {
      const last = recent.games[0];
      if (last !== undefined) {
        appid = last.appid;
        if (appid !== model.appid) model.gameName = last.name;
      }
    }
  }
  // Hidden games without a running one: the game details are private.
  if (appid === 0 && model.recentHidden) model.privateGame = true;
  if (appid === 0) appid = model.appid;
  if (appid === 0) {
    succeeded(now);
    state.phase = model.privateGame ? "private-empty" : "nothing";
    render();
    return;
  }
  if (appid !== model.appid) switchGame(appid);

  const lang = language();
  const found = await ensureSchema(appid, lang, now);
  if (found !== null && "kind" in found) return failed(found, now);
  // In another language, the English list serves until its own arrives.
  const schema = found ?? model.schemas.get(schemaKey(appid, "english"));
  if (schema === undefined) return;
  if (model.gameName === "" && schema.gameName !== "") model.gameName = schema.gameName;

  if (schema.list.length > 0 && !model.noStats && !model.privateGame) {
    // Not readable (403): asked again every 10 minutes, never in a loop.
    const playerEvery = model.playing && model.readable ? MINUTE : OUT_OF_GAME_EVERY;
    const playerDue = model.unlocked === null || now - model.readPlayer >= playerEvery - TICK_SLACK;
    if (playerDue && canCall("player", now)) {
      // Without `l`: names come from the schema, the answer stays small.
      const playerAnswer = await call("player", { steamid: model.steamid, appid }, "player", now);
      if (playerAnswer.kind === "status" && playerAnswer.status === 403) {
        // The key works (the host's probe passed): Steam does not show these
        // achievements (a borrowed game, or private details).
        model.readable = false;
      } else if (playerAnswer.kind !== "ok" && !(playerAnswer.kind === "status" && hasNoStats(playerAnswer.body))) {
        return failed(playerAnswer, now);
      } else if (playerAnswer.kind !== "ok" || hasNoStats(playerAnswer.body)) {
        model.noStats = true;
      } else {
        const unlocked = await unlockedOf(playerAnswer);
        if (unlocked === null) return failed({ kind: "server" }, now);
        markNew(unlocked, now);
        model.unlocked = unlocked;
        // An achievement the stored list does not know: the game was
        // updated; its list is read again.
        const known = new Set(schema.list.map((entry) => entry.api));
        if ([...unlocked.keys()].some((id) => !known.has(id))) forgetSchema(appid);
        model.readable = true;
      }
      model.readPlayer = now;
    }
  }

  const rarity = model.rarity.get(appid);
  if (schema.list.length > 0 && (rarity === undefined || now - rarity.at >= RARITY_EVERY) && canCall("rarity", now)) {
    const rarityAnswer = await call("rarity", { gameid: appid }, "rarity", now);
    if (rarityAnswer.kind === "ok") model.rarity.set(appid, { at: now, values: await rarityOf(rarityAnswer) });
    // Rarity is a detail: its failure never hides the rest.
  }

  succeeded(now);
  state.phase = "game";
  render();
  void saveSnapshot();
}

/**
 * The achievements of `appid` in `lang`: from memory, storage, or Steam
 * (once a minute at most); `null` when not read yet, or the failure.
 */
async function ensureSchema(appid: number, lang: string, now: number): Promise<SchemaEntry | null | Outcome> {
  const known = model.schemas.get(schemaKey(appid, lang)) ?? (await loadSchema(appid, lang));
  if (known !== null && known !== undefined) return known;
  // One list per game and language: another language is another request.
  if (!canCall(`schema:${lang}`, now)) return null;
  const answer = await call("schema", { appid, l: lang }, `schema:${lang}`, now);
  let schema: SchemaEntry;
  if (answer.kind === "status" && answer.status < 500) {
    // A game without stats can answer 400 (or 403) for its schema.
    schema = { list: [], gameName: "" };
  } else if (answer.kind !== "ok") {
    return answer;
  } else {
    const read = await schemaOf(answer, appid);
    if (read === null) return { kind: "server" };
    schema = read;
  }
  model.schemas.set(schemaKey(appid, lang), schema);
  // An error answer (4xx) is kept for the session only, never stored.
  if (answer.kind === "ok") void saveSchema(appid, lang, schema);
  return schema;
}

type Ok = Extract<Outcome, { kind: "ok" }>;

/** S5 at once, or in slices for a large game. */
async function schemaOf(answer: Ok, appid: number): Promise<SchemaEntry | null> {
  if (answer.text === "") {
    const list = parseSchema(answer.body, appid);
    const game = object(object(answer.body)?.["game"]);
    return list === null ? null : { list, gameName: text(game?.["gameName"]) ?? "" };
  }
  const name = /"gameName":("(?:[^"\\]|\\.)*")/.exec(answer.text.slice(0, 4096));
  const list: SchemaAch[] = [];
  // A game without achievements has no list: that is no achievement.
  const ok = (await readItems(answer.text, "achievements", (entry) => {
    const item = schemaItem(entry, appid);
    if (item !== null) list.push(item);
  })) !== "invalid";
  let gameName = "";
  try {
    gameName = name === null ? "" : String(JSON.parse(name[1] ?? '""'));
  } catch {
    gameName = "";
  }
  return ok ? { list, gameName } : null;
}

/** S4 at once, or in slices. */
async function unlockedOf(answer: Ok): Promise<Map<string, number> | null> {
  if (answer.text === "") return parsePlayerAchievements(answer.body);
  // `success` closes the answer, after the achievements.
  if (!/"success":\s*true/.test(answer.text.slice(-256))) return null;
  const unlocked = new Map<string, number>();
  const ok = (await readItems(answer.text, "achievements", (entry) => {
    const pair = playerItem(entry);
    if (pair !== null) unlocked.set(pair[0], pair[1]);
  })) === "read";
  return ok ? unlocked : null;
}

/** S6 at once, or in slices. */
async function rarityOf(answer: Ok): Promise<Map<string, number>> {
  if (answer.text === "") return parsePercentages(answer.body);
  const rarity = new Map<string, number>();
  await readItems(answer.text, "achievements", (entry) => {
    const pair = rarityItem(entry);
    if (pair !== null) rarity.set(pair[0], pair[1]);
  });
  return rarity;
}

function switchGame(appid: number): void {
  // Memory holds one game: a session of several large games stays within
  // the VM's heap (lists, rarity and images of the others are dropped).
  for (const key of [...model.schemas.keys()]) if (!key.startsWith(`${appid}:`)) model.schemas.delete(key);
  for (const key of [...model.rarity.keys()]) if (key !== appid) model.rarity.delete(key);
  state.images = Object.fromEntries(Object.entries(state.images).filter(([url]) => url.includes(`/apps/${appid}/`)));
  if (images.failedAt.size > 256) images.failedAt.clear();
  model.appid = appid;
  model.unlocked = null;
  model.readPlayer = 0;
  model.readable = true;
  model.noStats = false;
  state.fresh = {};
  state.picking = false;
}

/** Achievements unlocked since the last read of the same game are new. */
function markNew(unlocked: Map<string, number>, now: number): void {
  const before = model.unlocked;
  if (before === null) return;
  // Unlocked after the previous read (a margin for clocks): an unlock made
  // while the widget was closed, or on another computer, is not new.
  const since = (model.readPlayer || state.readAt) - 2 * MINUTE;
  const fresh = { ...state.fresh };
  let any = false;
  for (const [id, at] of unlocked) {
    if (!before.has(id) && at * 1000 >= since) {
      fresh[id] = now + NEW_FOR;
      any = true;
    }
  }
  if (any) {
    state.fresh = fresh;
    timers.after(NEW_FOR, () => {
      const at = Date.now();
      state.fresh = Object.fromEntries(Object.entries(state.fresh).filter(([, until]) => until > at));
      state.now = at;
    });
  }
}

/** Every achievement of the shown game: out of the state (see `Lists`). */
let achList: Ach[] = [];
/** The full list, for tests. */
export function achievements(): Ach[] {
  return achList;
}
/** Bumped when the names change (another schema): see `sortKeys`. */
let nameVersion = 0;
let namedFrom: SchemaEntry | undefined;

/** Builds the view from the model. */
function render(): void {
  const appid = model.appid;
  if (appid === 0) return;
  const schema = model.schemas.get(schemaKey(appid, language())) ?? model.schemas.get(schemaKey(appid, "english"));
  const list = schema?.list ?? [];
  const unlocked = model.unlocked ?? new Map<string, number>();
  const rarity = model.rarity.get(appid)?.values ?? new Map<string, number>();
  achList = list.map((entry) => {
    const at = unlocked.get(entry.api);
    return {
      id: entry.api,
      name: entry.name,
      desc: entry.desc,
      icon: iconUrl(appid, entry.icon),
      iconGray: iconUrl(appid, entry.iconGray || entry.icon),
      achieved: at !== undefined,
      at: (at ?? 0) * 1000,
      rarity: rarity.get(entry.api) ?? -1,
      hidden: entry.hidden,
    };
  });
  if (schema !== undefined && schema !== namedFrom) {
    namedFrom = schema;
    nameVersion += 1;
  }
  const hasAch = list.length > 0 && !model.noStats;
  state.game = {
    appid,
    name: model.gameName || schema?.gameName || "",
    icon: gameIconUrl(appid, model.icons.get(appid) ?? (appid === model.iconHashOf ? model.iconHash : "")),
    header: headerUrl(appid),
    playing: model.playing && state.stale === "",
    privateGame: model.privateGame,
    readable: model.readable,
    known: schema !== undefined,
    hasAch,
    unlocked: hasAch ? list.reduce((count, entry) => count + (unlocked.has(entry.api) ? 1 : 0), 0) : 0,
    total: hasAch ? list.length : 0,
  };
  state.tracked = model.tracked.appid === appid ? model.tracked.api : "";
  compute();
  void loadImages();
}

// ---------------------------------------------------------------------------
// Images

/** The header to show: the first declared host whose image did not fail. */
function headerUrl(appid: number): string {
  return headerUrls(appid).find((url) => !failedRecently(url)) ?? "";
}
function failedRecently(url: string): boolean {
  const at = images.failedAt.get(url);
  return at !== undefined && Date.now() - at < IMAGE_RETRY_AFTER;
}

/** The images the current view may show, most visible first. */
function wantedImages(): string[] {
  const game = state.game;
  if (game === null) return [];
  const wanted = [game.header, game.icon];
  const v = state.optionsVersion;
  const shown = [featured(state, v), tracked(state), ...recent(state, rows(v)), ...missing(state, rows(v) * 2, v), ...state.lists.pick];
  for (const a of shown) if (a !== null && hasIcon(a)) wanted.push(achIcon(a));
  return wanted.filter((url, index) => url !== "" && wanted.indexOf(url) === index);
}

/** Loads the wanted images two at a time, each once; a failure waits an hour. */
async function loadImages(): Promise<void> {
  // Nothing goes to Steam, images included, before Steam is connected or
  // while the widget is hidden.
  if (!model.connected || !host.visible) return;
  for (const url of wantedImages()) {
    if (url in state.images || images.loading.has(url) || failedRecently(url)) continue;
    if (images.loading.size >= 2) return;
    images.loading.add(url);
    void http
      .fetch(url, { as: "image" })
      .then(
        (response) => {
          if (response.status === 200) state.images = { ...state.images, [url]: response.asset };
          else images.failedAt.set(url, Date.now());
        },
        () => images.failedAt.set(url, Date.now()),
      )
      .finally(() => {
        images.loading.delete(url);
        // A failed header falls back to the next host, then to the icon.
        if (state.game !== null && url === state.game.header && !(url in state.images)) {
          state.game = { ...state.game, header: headerUrl(state.game.appid) };
        }
        void loadImages();
      });
  }
}

/** The `src` of an image: always a string, `""` until it arrived. */
export function imageSrc(url: string, loaded: Record<string, string>): string {
  return loaded[url] ?? "";
}

// ---------------------------------------------------------------------------
// Storage

/** Characters per stored part: at most 3 bytes each in UTF-8, ≤ 60 kB. */
const SCHEMA_PART_CHARS = 20_000;
/** A stored value's own limit (the host's: 64 KiB), with room for its quotes. */
const PART_MAX_BYTES = 63_000;
/**
 * Bytes the stored lists may take in all: the host's 256 KiB minus room
 * for the profile, the tracked achievement, the last view (48 kB) and the
 * index. A game beyond stays in memory only.
 */
const SCHEMA_STORE_BYTES = 180_000;
const SNAPSHOT_MAX = 48_000;

/** The UTF-8 size of a value as the host stores it (its JSON). */
export function storedBytes(value: JsonValue): number {
  const json = JSON.stringify(value);
  let bytes = 0;
  for (let i = 0; i < json.length; i += 1) {
    const c = json.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c < 0xdc00) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

interface SchemaIndex { key: string; chunks: number; bytes: number; at: number }

async function readIndex(): Promise<SchemaIndex[]> {
  const value = await storage.get({ key: "schemas" }).catch(() => null);
  return Array.isArray(value) ? (value as unknown as SchemaIndex[]).filter((entry) => typeof entry?.key === "string") : [];
}

async function loadSchema(appid: number, lang: string): Promise<SchemaEntry | null> {
  const key = schemaKey(appid, lang);
  const entry = (await readIndex()).find((item) => item.key === key);
  if (entry === undefined) return null;
  let textValue = "";
  for (let index = 0; index < entry.chunks; index += 1) {
    const part = await storage.get({ key: `schema:${key}:${index}` }).catch(() => null);
    if (typeof part !== "string") return null;
    textValue += part;
  }
  try {
    const parsed = JSON.parse(textValue) as { n: string; l: [string, string, string, number, string, string][] };
    const schema: SchemaEntry = {
      gameName: parsed.n,
      list: parsed.l.map(([api, name, desc, hidden, icon, iconGray]) => ({ api, name, desc, hidden: hidden === 1, icon, iconGray })),
    };
    model.schemas.set(key, schema);
    return schema;
  } catch {
    return null;
  }
}

/** Forgets a game's lists (memory and storage): the next read asks again. */
function forgetSchema(appid: number): void {
  for (const key of [...model.schemas.keys()]) if (key.startsWith(`${appid}:`)) model.schemas.delete(key);
  saving = saving.then(async () => {
    const index = await readIndex();
    const gone = index.filter((item) => item.key.startsWith(`${appid}:`));
    if (gone.length === 0) return;
    await storage.set({ key: "schemas", value: index.filter((item) => !gone.includes(item)) as unknown as JsonValue });
    for (const item of gone) for (let part = 0; part < item.chunks; part += 1) await storage.remove({ key: `schema:${item.key}:${part}` });
  }).catch(() => undefined);
}

/** Writes of lists, one after the other: two never race on the index. */
let saving: Promise<void> = Promise.resolve();
function saveSchema(appid: number, lang: string, schema: SchemaEntry): Promise<void> {
  saving = saving.then(() => saveSchemaNow(appid, lang, schema)).catch(() => undefined);
  return saving;
}

/**
 * Keeps a game's list for later sessions, within `SCHEMA_STORE_BYTES` in
 * all: the oldest lists make room; a list too large for that stays in
 * memory; a write that fails leaves nothing behind.
 */
async function saveSchemaNow(appid: number, lang: string, schema: SchemaEntry): Promise<void> {
  const key = schemaKey(appid, lang);
  // A list of thousands of achievements never fits: not even measured.
  if (schema.list.length > 2000) return;
  const textValue = JSON.stringify({ n: schema.gameName, l: schema.list.map((a) => [a.api, a.name, a.desc, a.hidden ? 1 : 0, a.icon, a.iconGray]) });
  if (textValue.length > SCHEMA_STORE_BYTES) return;
  const parts: string[] = [];
  for (let at = 0; at < textValue.length; at += SCHEMA_PART_CHARS) parts.push(textValue.slice(at, at + SCHEMA_PART_CHARS));
  // Measured one part per VM turn.
  const sizes: number[] = [];
  for (const part of parts) {
    sizes.push(storedBytes(part));
    await pause();
  }
  const bytes = sizes.reduce((sum, size) => sum + size, 0);
  if (bytes > SCHEMA_STORE_BYTES || sizes.some((size) => size > PART_MAX_BYTES)) return;
  let index = (await readIndex()).filter((item) => item.key !== key);
  const used = (): number => index.reduce((sum, item) => sum + (item.bytes ?? SCHEMA_STORE_BYTES), 0);
  while (index.length > 0 && used() + bytes > SCHEMA_STORE_BYTES) {
    const oldest = index.reduce((a, b) => (a.at <= b.at ? a : b));
    index = index.filter((item) => item !== oldest);
    await storage.set({ key: "schemas", value: index as unknown as JsonValue }).catch(() => null);
    for (let part = 0; part < oldest.chunks; part += 1) await storage.remove({ key: `schema:${oldest.key}:${part}` }).catch(() => null);
  }
  let written = 0;
  try {
    for (; written < parts.length; written += 1) {
      await storage.set({ key: `schema:${key}:${written}`, value: parts[written] ?? "" });
    }
    index.push({ key, chunks: parts.length, bytes, at: Date.now() });
    await storage.set({ key: "schemas", value: index as unknown as JsonValue });
  } catch {
    // Refused (full): nothing of this list stays behind; it lives in memory.
    for (let part = 0; part <= written; part += 1) await storage.remove({ key: `schema:${key}:${part}` }).catch(() => null);
  }
}

/** The last view, shown at once at the next start. */
async function saveSnapshot(): Promise<void> {
  const game = state.game;
  if (game === null) return;
  const unlocked = model.unlocked === null ? null : Object.fromEntries(model.unlocked);
  const rarity = model.rarity.get(game.appid);
  let snapshot: JsonValue = {
    appid: game.appid,
    name: game.name,
    icon: model.icons.get(game.appid) ?? "",
    readAt: state.readAt,
    unlocked,
    rarity: rarity === undefined ? null : Object.fromEntries(rarity.values),
    noStats: model.noStats,
  };
  if (JSON.stringify(snapshot).length > SNAPSHOT_MAX) snapshot = { ...snapshot, rarity: null };
  if (JSON.stringify(snapshot).length > SNAPSHOT_MAX) snapshot = { ...snapshot, unlocked: null };
  await storage.set({ key: "snapshot", value: snapshot }).catch(() => null);
}

async function restore(): Promise<void> {
  const profile = object(await storage.get({ key: "profile" }).catch(() => null));
  const steamid = text(profile?.["steamid"]);
  if (steamid === null || !STEAMID.test(steamid)) {
    state.phase = "profile";
    return;
  }
  model.steamid = steamid;
  model.input = text(profile?.["input"]) ?? steamid;
  const tracked = object(await storage.get({ key: "tracked" }).catch(() => null));
  model.tracked = { appid: whole(tracked?.["appid"]) ?? 0, api: text(tracked?.["api"]) ?? "" };
  const snapshot = object(await storage.get({ key: "snapshot" }).catch(() => null));
  const appid = whole(snapshot?.["appid"]);
  if (snapshot !== null && appid !== null && appid > 0) {
    model.appid = appid;
    model.gameName = text(snapshot["name"]) ?? "";
    model.iconHash = text(snapshot["icon"]) ?? "";
    model.iconHashOf = appid;
    model.noStats = snapshot["noStats"] === true;
    const unlocked = object(snapshot["unlocked"]);
    if (unlocked !== null) {
      model.unlocked = new Map(Object.entries(unlocked).flatMap(([id, at]) => (typeof at === "number" ? [[id, at] as [string, number]] : [])));
    }
    const rarity = object(snapshot["rarity"]);
    if (rarity !== null) {
      // Kept a day from the read the snapshot came from.
      const values = new Map(Object.entries(rarity).flatMap(([id, p]) => (typeof p === "number" ? [[id, p] as [string, number]] : [])));
      model.rarity.set(appid, { at: whole(snapshot["readAt"]) ?? 0, values });
    }
    await loadSchema(appid, language());
    state.readAt = whole(snapshot["readAt"]) ?? 0;
    if (model.schemas.has(schemaKey(appid, language())) || model.noStats) {
      state.phase = "game";
      render();
    }
  }
}

// ---------------------------------------------------------------------------
// Profile

export function profileTyped(value: string): void {
  state.profile = { ...state.profile, value, status: state.profile.status === "checking" ? "checking" : "idle" };
}

export async function submitProfile(): Promise<void> {
  // Enter twice, or Enter then Continue: one check.
  if (state.profile.status === "checking") return;
  const parsed = parseProfileInput(state.profile.value);
  if (parsed === null) {
    state.profile = { ...state.profile, status: "invalid" };
    return;
  }
  state.profile = { ...state.profile, status: "checking" };
  let steamid = parsed.kind === "id" ? parsed.steamid : "";
  if (parsed.kind === "vanity") {
    const answer = await call("vanity", { vanityurl: parsed.name });
    const resolved = answer.kind === "ok" ? parseVanity(answer.body) : null;
    if (resolved === "notfound") {
      state.profile = { ...state.profile, status: "notfound" };
      return;
    }
    if (resolved === null) {
      // Steam did not answer: say so where the user looks.
      state.profile = { ...state.profile, status: "idle" };
      state.stale = answer.kind === "quota" ? "quota" : "unreachable";
      return;
    }
    steamid = resolved.steamid;
  }
  // The profile must exist: S2 answers for it, and serves as the first read.
  const checkedAt = Date.now();
  const answer = await call("summary", { steamids: steamid }, "summary", checkedAt);
  const summary = answer.kind === "ok" ? parseSummary(answer.body, steamid) : null;
  if (summary === "notfound") {
    state.profile = { ...state.profile, status: "notfound" };
    return;
  }
  if (summary === null) {
    state.profile = { ...state.profile, status: "idle" };
    state.stale = answer.kind === "quota" ? "quota" : "unreachable";
    return;
  }
  const changed = steamid !== model.steamid;
  model.steamid = steamid;
  model.input = state.profile.value.trim();
  await storage.set({ key: "profile", value: { steamid, input: model.input } }).catch(() => null);
  if (changed) {
    model.appid = 0;
    model.unlocked = null;
    model.readRecent = 0;
    model.gameName = "";
    state.game = null;
    achList = [];
    compute();
    await storage.remove({ key: "snapshot" }).catch(() => null);
  }
  state.profile = { status: "idle", value: model.input, canCancel: false };
  state.stale = "";
  model.failures = 0;
  model.retryAt = 0;
  state.phase = model.appid === 0 ? "loading" : "game";
  // This summary is the read's own: no second request of the route.
  model.checked = { steamid, at: checkedAt, body: answer.kind === "ok" ? answer.body : null };
  void refresh();
}

export function cancelProfile(): void {
  if (!state.profile.canCancel) return;
  state.profile = { status: "idle", value: model.input, canCancel: false };
  state.phase = model.previousPhase;
}

function openProfile(): void {
  if (state.phase === "profile") return;
  model.previousPhase = state.phase;
  state.profile = { status: "idle", value: model.input, canCancel: model.steamid !== "" };
  state.picking = false;
  state.phase = "profile";
}

// ---------------------------------------------------------------------------
// Tracking

export function pick(id: string): void {
  const appid = state.game?.appid ?? 0;
  model.tracked = { appid: id === "" ? 0 : appid, api: id };
  state.tracked = id;
  state.picking = false;
  compute();
  void storage.set({ key: "tracked", value: { appid: model.tracked.appid, api: id } }).catch(() => null);
  void loadImages();
}
export function cancelPick(): void {
  state.picking = false;
}

// ---------------------------------------------------------------------------
// Host, menu, timer

onHost((changed) => {
  if (changed.includes("viewport")) measure();
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
    if (!state.interactive) state.picking = false;
  }
  if (changed.includes("theme")) state.theme = host.theme;
  if (changed.includes("options")) {
    state.optionsVersion += 1;
    compute();
    void loadImages();
  }
  if (changed.includes("locale")) {
    state.locale = host.locale;
    // Names and descriptions come in the user's language, at once.
    if (model.appid !== 0 && model.connected && host.visible) {
      void ensureSchema(model.appid, language(), Date.now()).then(() => render());
    }
  }
  if (changed.includes("visible") && host.visible) void refresh();
});

onMenu((row) => {
  if (row === "track" && state.game !== null && state.game.hasAch) {
    state.picking = true;
    compute();
    void loadImages();
  }
  if (row === "change-profile") openProfile();
});

account.subscribe({ id: "steam" }, (update) => {
  const connected = update.ok && update.value.state === "connected";
  const was = model.connected;
  model.connected = connected;
  if (connected && !was) {
    void loadImages();
    void refresh();
  }
});

timers.every(MINUTE, () => {
  state.now = Date.now();
  void refresh();
});

void restore().then(() => refresh());

// ---------------------------------------------------------------------------
// View helpers (the view's expressions)

export function layout(_v: number): Layout {
  const value = option("layout", "standard");
  return value === "line" || value === "compact" || value === "full" ? value : "standard";
}
export function rows(_v: number): number {
  return Math.max(1, Math.min(6, Math.round(option("rows", 3))));
}
export function missingOnly(_v: number): boolean {
  return option("missing-only", false);
}
export function showRarity(_v: number): boolean {
  return option("show-rarity", true);
}
function revealHidden(): boolean {
  return option("reveal-hidden", false);
}
function order(): string {
  return option("order", "easiest");
}

export function phase(s: typeof state): Phase {
  return s.phase;
}
export function concealed(a: Ach): boolean {
  return a.hidden && !a.achieved && !revealHidden();
}
export function achName(a: Ach): string {
  return concealed(a) ? t("hidden") : a.name;
}
export function achDesc(a: Ach): string {
  return concealed(a) ? t("hidden-hint") : a.desc;
}
export function achIcon(a: Ach): string {
  return a.achieved ? a.icon : a.iconGray;
}
export function hasIcon(a: Ach): boolean {
  return achIcon(a) !== "" && !concealed(a);
}
/** The image of an achievement once loaded; `""` shows the fallback. */
export function achSrc(a: Ach, loaded: Record<string, string>): string {
  return hasIcon(a) ? imageSrc(achIcon(a), loaded) : "";
}
export function rarity(a: Ach): string {
  return t("rarity", { value: rarityValue(a.rarity) });
}
export function rarityShort(a: Ach): string {
  return a.rarity < 0 ? "" : t("rarity-short", { value: rarityValue(a.rarity) });
}
export function meta(a: Ach, s: typeof state): string {
  const v = s.optionsVersion;
  const withRarity = showRarity(v) && a.rarity >= 0;
  if (!a.achieved) return withRarity ? rarity(a) : achDesc(a);
  const when = a.at > 0 ? ago(s.now - a.at) : "";
  if (!withRarity) return when;
  return when === "" ? rarity(a) : `${when} · ${rarity(a)}`;
}
export function done(g: GameView): boolean {
  return g.total > 0 && g.unlocked >= g.total;
}
export function hasAch(g: GameView): boolean {
  return g.hasAch && g.readable;
}
export function pct(g: GameView): string {
  return percentOf(g.unlocked, g.total);
}
export function countText(g: GameView, v: number): string {
  return missingOnly(v) ? t("missing-count", { count: num(g.total - g.unlocked) }) : "";
}
export function muted(g: GameView): string {
  if (!g.known) return t("loading");
  return g.readable ? t("no-achievements") : t("not-readable");
}

export function isStale(s: typeof state): boolean {
  return s.stale !== "";
}
export function eyebrow(s: typeof state): string {
  if (s.stale !== "") return t(`stale-${s.stale}`, { age: age(s.now - s.readAt) });
  if (s.game?.privateGame) return t("private-short");
  return s.game?.playing ? t("playing") : t("last-played");
}
export function eyebrowClass(s: typeof state): string {
  if (s.stale !== "") return "eyebrow warn stale";
  return s.game?.privateGame ? "eyebrow warn" : s.game?.playing ? "eyebrow live" : "eyebrow";
}
export function staleIcon(s: typeof state): string {
  return s.stale === "quota" ? "hourglass" : "cloud-off";
}
export function staleTip(s: typeof state): string {
  return s.stale === "" ? "" : t(`stale-${s.stale}-tip`);
}

/** A name as sorted by name: lowercase, without accents, œ and æ spelled out. */
export function sortKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae");
}

/** The sort keys by name, computed once per list of names and reveal option. */
let keys = { version: "", byId: new Map<string, string>() };
function sortKeys(): Map<string, string> {
  const version = `${nameVersion}|${revealHidden()}`;
  if (keys.version !== version) keys = { version, byId: new Map(achList.map((a) => [a.id, sortKey(achName(a))])) };
  return keys.byId;
}

/** The `k` best items of `items` by `before`, in order: one pass, never a full sort. */
export function best<T>(items: readonly T[], k: number, before: (a: T, b: T) => boolean): T[] {
  const out: T[] = [];
  if (k <= 0) return out;
  for (const item of items) {
    if (out.length === k && !before(item, out[k - 1] as T)) continue;
    let index = out.length;
    while (index > 0 && before(item, out[index - 1] as T)) index -= 1;
    out.splice(index, 0, item);
    if (out.length > k) out.pop();
  }
  return out;
}

/** Chooses what the view shows; after each read, option, choice or language. */
function compute(): void {
  const by = order();
  const names = by === "name" ? sortKeys() : null;
  const missingBefore = (a: Ach, b: Ach): boolean => {
    if (names !== null) return (names.get(a.id) ?? "") < (names.get(b.id) ?? "");
    // An unknown rarity sorts last in both orders.
    if ((a.rarity < 0) !== (b.rarity < 0)) return b.rarity < 0;
    return by === "rarest" ? a.rarity < b.rarity : a.rarity > b.rarity;
  };
  const unlockedList = achList.filter((a) => a.achieved);
  const missingList = achList.filter((a) => !a.achieved);
  const recentList = best(unlockedList, 7, (a, b) => a.at > b.at);
  state.lists = {
    latest: recentList[0] ?? null,
    tracked: state.tracked === "" ? null : (achList.find((a) => a.id === state.tracked) ?? null),
    recent: recentList,
    missing: best(missingList, 13, missingBefore),
    pick: state.picking ? best(missingList.filter((a) => a.id !== state.tracked), 50, missingBefore) : [],
  };
}

export function isNew(a: Ach, s: typeof state): boolean {
  return (s.fresh[a.id] ?? 0) > s.now;
}
export function latest(s: typeof state): Ach | null {
  return s.lists.latest;
}
export function anyNew(s: typeof state): boolean {
  return s.lists.recent.some((a) => isNew(a, s));
}
/** Unlocked ones, newest first, without the one already on its own card. */
export function recent(s: typeof state, n: number): Ach[] {
  const shown = tracked(s) ?? latest(s);
  return s.lists.recent.filter((a) => a.id !== shown?.id).slice(0, n);
}
export function missing(s: typeof state, n: number, _v: number): Ach[] {
  return s.lists.missing.filter((a) => a.id !== s.tracked).slice(0, n);
}
export function tracked(s: typeof state): Ach | null {
  return s.lists.tracked;
}
/** The second card of Standard: tracked, else next missing (missing only), else latest. */
export function featured(s: typeof state, v: number): Ach | null {
  return tracked(s) ?? (missingOnly(v) ? (missing(s, 1, v)[0] ?? null) : latest(s));
}
export function featuredTitle(s: typeof state, v: number): string {
  if (tracked(s)) return t("tracked");
  return missingOnly(v) ? t("next-one") : t("latest");
}
export function cardClass(a: Ach, s: typeof state): string {
  if (a.id === s.tracked) return a.achieved ? "feature tracked done" : "feature tracked";
  return isNew(a, s) ? "feature new" : "feature";
}
export function featureMeta(a: Ach, s: typeof state): string {
  if (a.id === s.tracked && a.achieved && a.at > 0) return t("tracked-done", { ago: ago(s.now - a.at) });
  return meta(a, s);
}
export function pickList(s: typeof state): Ach[] {
  return s.lists.pick;
}
export function rootClass(s: typeof state): string {
  return `root ${layout(s.optionsVersion)}${s.narrow ? " narrow" : ""}${s.wide ? " wide" : ""}`;
}
export function profileMessage(s: typeof state, short: boolean): string {
  const status = s.profile.status;
  if (status === "checking") return t("profile-checking");
  // Steam did not answer the check: say so, not the help again.
  if (s.stale !== "") return t("empty-unreachable");
  if (status === "invalid") return t(short ? "profile-invalid-short" : "profile-invalid");
  if (status === "notfound") return t(short ? "profile-notfound-short" : "profile-notfound");
  return t(short ? "profile-help-short" : "profile-help");
}
export function profileError(s: typeof state): boolean {
  return s.profile.status === "invalid" || s.profile.status === "notfound";
}
export function fallbackClass(cls: string): string {
  return `${cls} fallback`;
}
export function gameSrc(s: typeof state): string {
  return s.game === null ? "" : imageSrc(s.game.header, s.images);
}
export function iconSrc(s: typeof state): string {
  return s.game === null ? "" : imageSrc(s.game.icon, s.images);
}
export function hasHeader(s: typeof state): boolean {
  return gameSrc(s) !== "";
}

/**
 * The Steam symbol (owner decision of 2026-10-14, removed at once if Valve
 * asks): the only reference to the logo files. Emptying STEAM_LOGO (and
 * deleting the two files) leaves the word "Steam" in the same place.
 * White on the dark theme, black on the light one, as Valve's guide says.
 */
const STEAM_LOGO = { dark: "assets/steam-symbol-white-64.png", light: "assets/steam-symbol-black-64.png" };
export function steamLogo(_theme: string, _v: number): string {
  if (!option("show-logo", true)) return "";
  return host.theme === "light" ? STEAM_LOGO.light : STEAM_LOGO.dark;
}
