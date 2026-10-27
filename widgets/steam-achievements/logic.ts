// Steam achievements: the achievements of the game you play on Steam, read
// through PlayerVox OverCrow's integrated Steam service. The widget never sees
// the key: the host adds it to the routes that name the `steam` account.
// Only `GET` routes of the player and game interfaces; never a trade route.
//
// Rhythm: one timer a minute, never two requests of one route less than a
// minute apart, nothing while hidden. When the Steam client of this computer
// saves the stats of a game (an achievement unlocked), PlayerVox OverCrow
// says so (`steam.events`): that game's achievements are read at once on
// this computer (`steam.achievements.local`), where they are the moment they
// unlock, whatever the game details' privacy; without them, from Steam,
// never twice within 5 seconds. Values never disappear: a failed read keeps
// what was shown and says how old it is.
import {
  account,
  formatNumber,
  game,
  host,
  http,
  initState,
  onHost,
  onMenu,
  option,
  steam,
  storage,
  t,
  timers,
  type JsonValue,
  type SteamLocalAchievements,
  type Subscription,
  type Timer,
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
/**
 * Icons: the file Steam names, on the one path that serves every game (the
 * older `/steamcommunity/public/images/apps/` path misses recent games).
 */
export const ICON_ORIGIN = "https://shared.akamai.steamstatic.com";
const ICON_PATH = "/community_assets/images/apps";


/** One minute, the least time between two requests of one route. */
export const MINUTE = 60_000;
const TICK_SLACK = 1000;
const OUT_OF_GAME_EVERY = 10 * MINUTE;
const RARITY_EVERY = 24 * 60 * MINUTE;
const NEW_FOR = MINUTE;
const IMAGE_RETRY_AFTER = 60 * MINUTE;
/** Achievements tracked at once in one game. */
export const MAX_TRACKED = 3;
/** Games whose tracked achievements are kept, the most recently changed. */
export const TRACKED_GAMES = 20;
/** Rows the checklist adds at a time. */
export const PICK_PAGE = 50;
/**
 * Missing rows the checklist shows at most: about ten elements a row, well
 * within the view's 4,096; a search reaches the others.
 */
export const PICK_MAX = 200;
/**
 * Least time between two reads of one route that a local Steam save asks:
 * Steam writes a game's stats several times for one achievement, and
 * dozens of games at its start; a large game's list is megabytes. Twelve
 * reads a minute at most, far below Steam's daily quota, and still at once
 * to the player.
 */
export const EVENT_FLOOR = 5_000;
/**
 * After a save whose read shows nothing new (Steam's Web API lags behind
 * its client by a few seconds), the looks again, from the save: then the
 * minute.
 */
export const EVENT_LOOKS = [10_000, 30_000] as const;
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

/**
 * Why Steam refused the achievements of a game, from S4's status and body:
 * - `hidden`: 403 `Profile is not public`. Steam answers so when the game
 *   details are not Public (Friends Only included), even to the account's
 *   own key, and also for a game the player does not own: the caller tells
 *   them apart (see `read`).
 * - `unreadable`: Steam names no stats for this player (`Requested app has
 *   no stats`, `success: false`).
 * - `null`: not a refusal (a server failure, or an answer to read).
 */
export function refusal(status: number, body: JsonValue): "hidden" | "unreadable" | null {
  const error = statsError(body) ?? "";
  if (status === 403 || /not public/i.test(error)) return "hidden";
  const stats = object(object(body)?.["playerstats"]);
  if (status >= 400 && status < 500 && error !== "") return "unreadable";
  if (status >= 200 && status < 300 && stats !== null && stats["success"] === false) return "unreadable";
  return null;
}

/** One achievement of S4: `[apiname, unlocktime]` when unlocked. */
export function playerItem(entry: JsonValue): [string, number] | null {
  const item = object(entry);
  const api = text(item?.["apiname"]);
  if (api === null || whole(item?.["achieved"]) !== 1) return null;
  return [api, whole(item?.["unlocktime"]) ?? 0];
}

/** One achievement of S4 asked with `l`: its name and description, as a list entry. */
export function namedItem(entry: JsonValue): SchemaAch | null {
  const item = object(entry);
  const api = text(item?.["apiname"]);
  if (api === null || api === "") return null;
  // Steam says neither which are hidden nor their icons here.
  return { api, name: text(item?.["name"]) || api, desc: text(item?.["description"]) ?? "", hidden: false, icon: "", iconGray: "" };
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
const FILE = /^[A-Za-z0-9_-]{1,60}\.jpg$/;
// Steam names either path, on any of its hosts.
const ICON_FILE = /^\/(?:steamcommunity\/public|community_assets)\/images\/apps\/(\d{1,8})\/([^/]+)$/;

/**
 * The file name of an icon of `appid` as Steam gives it: a full URL, whatever
 * host and path Steam named, or the file name alone.
 */
export function iconFile(appid: number, value: string): string {
  if (FILE.test(value)) return value;
  const match = ICON_FILE.exec(value.replace(/^https?:\/\/[^/]+/i, ""));
  const file = match?.[2] ?? "";
  return match !== null && Number(match[1]) === appid && FILE.test(file) ? file : "";
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
  return file === "" ? "" : `${ICON_ORIGIN}${ICON_PATH}/${appid}/${file}`;
}
/** The game's icon (S3 hash). */
export function gameIconUrl(appid: number, hash: string): string {
  return /^[0-9a-f]{40}$/.test(hash) ? iconUrl(appid, `${hash}.jpg`) : "";
}
/**
 * The store header of a game, on each declared host in turn. A recent game
 * keeps it only under a hashed path that only the store's API names: both
 * fail, and the view shows the game's icon instead.
 */
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
export type Phase = "loading" | "profile" | "nothing" | "hidden" | "empty-unreachable" | "game";
/** What Steam hides: the whole profile, or the game details only. */
export type Hidden = "" | "profile" | "details";
export type Stale = "" | "unreachable" | "quota";

export interface GameView {
  appid: number;
  name: string;
  /** URLs; the view shows each once its image arrived. */
  icon: string;
  header: string;
  /** From a fresh S2 read with this `gameid`. */
  playing: boolean;
  /** Steam names no achievements of this player for this game (not owned…). */
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
  /** Tracked, in the order they were added, the unlocked ones last. */
  tracked: Ach[];
  /** Unlocked, newest first (9 at most: 6 rows, and the latest or the tracked ones). */
  recent: Ach[];
  /** Missing in the chosen order (15 at most: 12 rows and the tracked ones). */
  missing: Ach[];
  /** The picker's list, only while it is open: the tracked ones, then the missing ones shown so far. */
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
    /** What Steam hides, in the `hidden` phase. */
    hidden: Hidden;
    profile: Profile;
    game: GameView | null;
    /** The few achievements the view shows, chosen by `compute`. */
    lists: Lists;
    /** IDs tracked in the shown game, in the order they were added. */
    tracked: string[];
    picking: boolean;
    /** Missing ones the checklist could still add. */
    pickLeft: number;
    /** The checklist shows its most rows: a search reaches the others. */
    pickCapped: boolean;
    /** The checklist's search, and whether it has one (more than a page missing). */
    pickQuery: string;
    pickSearch: boolean;
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
  hidden: "" as Hidden,
  profile: { status: "idle", value: "", canCancel: false } as Profile,
  game: null as GameView | null,
  lists: { latest: null, tracked: [], recent: [], missing: [], pick: [] } as Lists,
  tracked: [] as string[],
  picking: false,
  pickLeft: 0,
  pickCapped: false,
  pickQuery: "",
  pickSearch: false,
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
  readable: true,
  /** What Steam hides; `""` once a read shows the game details. */
  hidden: "" as Hidden,
  /** `hidden` is the stored value. */
  hiddenSaved: true,
  /** The last S3 read hid the games (private game details). */
  recentHidden: false,
  /**
   * The game details of `steamid` are public: S4 answered for a game, or
   * Steam's presence named one. A refusal of the host's game is then the
   * game itself (not owned), not hidden details. Kept in storage.
   */
  publicDetails: false,
  /** The shown game is the one Steam's presence names. */
  named: false,
  /** The shown game came from the host: running, or the last one. */
  fromHost: false,
  unlocked: null as Map<string, number> | null,
  rarity: new Map<number, { at: number; values: Map<string, number> }>(),
  schemas: new Map<string, SchemaEntry>(),
  /**
   * Games whose list exceeded the schema route's bound, and when: their
   * names come from S4 asked with `l`; the schema is tried again a day later.
   */
  tooLarge: new Map<number, number>(),
  /** Achievements S4 listed for the shown game, while its list is not read. */
  playerTotal: 0,
  /** Their API names, the last resort for names. */
  playerIds: [] as string[],
  icons: new Map<number, string>(),
  /** Tracked IDs by game, the most recently changed game last. */
  tracked: new Map<number, string[]>(),
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

/**
 * The game PlayerVox OverCrow says is running (`game.subscribe`): first,
 * even when Steam's presence names none (Invisible, offline). `0` without
 * one, outside the Steam store, or with an older PlayerVox OverCrow.
 */
const active = { appid: 0, name: "", last: 0, lastName: "" };

/**
 * The achievements the Steam client of this computer saved for a game of
 * the followed account (`steam.achievements.local`), by API name, in Unix
 * seconds (0 without a time): there the moment they unlock, while Steam's
 * Web API publishes them seconds to minutes later, and whatever the game
 * details' privacy. `null` when this computer has none (Steam on another
 * computer, a game never played here).
 */
const local = {
  appid: 0,
  steamid: "",
  unlocked: null as Map<string, number> | null,
  readAt: 0,
  busy: false,
  /** Another read was asked meanwhile, and whether of every page. */
  again: false,
  againFull: false,
  /** Refused or unknown (an older PlayerVox OverCrow): never asked again. */
  off: false,
  /**
   * The game and account this computer had nothing of: asked again only at
   * a save of that game (Steam writes the file then) or for another game.
   */
  missing: { appid: 0, steamid: "" },
};

/** This computer's achievements of `appid`, read for the followed account. */
function localOf(appid: number): Map<string, number> | null {
  return local.appid === appid && local.steamid === model.steamid ? local.unlocked : null;
}

/** Unlocked by Steam's answer or on this computer; Steam's time first. */
function merged(api: Map<string, number> | null, here: Map<string, number> | null): Map<string, number> | null {
  if (here === null) return api;
  const all = new Map(here);
  for (const [id, at] of api ?? []) all.set(id, at);
  return all;
}

/**
 * Reads this computer's achievements of `appid`: every page the first time
 * (thousands of achievements, a page after another), the first page after
 * a save (the newest come first). One read at a time; hidden, none.
 * `inRead`: asked by a read of Steam, which shows the result itself.
 */
async function readLocal(appid: number, full: boolean, inRead = false): Promise<void> {
  if (local.off || appid === 0 || model.steamid === "" || !host.visible) return;
  if (inRead && local.missing.appid === appid && local.missing.steamid === model.steamid) return;
  if (local.busy) {
    local.again = true;
    local.againFull ||= full;
    return;
  }
  local.busy = true;
  const steamid = model.steamid;
  const known = localOf(appid);
  try {
    const found = new Map<string, number>();
    const add = (page: SteamLocalAchievements): void => {
      for (const item of page.achievements) found.set(item.name, item.unlockedAt === null ? 0 : Math.floor(item.unlockedAt / 1000));
    };
    const first = await steam.achievements.local({ steamid, appid });
    add(first);
    if (first.total > found.size) {
      if (full || known === null) {
        while (found.size < first.total) {
          await pause();
          const next = await steam.achievements.local({ steamid, appid, offset: found.size });
          if (next.achievements.length === 0) break;
          add(next);
        }
      } else {
        for (const [id, at] of known) if (!found.has(id)) found.set(id, at);
      }
    }
    // Another game or profile meanwhile: this answer is not its.
    if (steamid !== model.steamid || appid !== model.appid) return;
    const now = Date.now();
    markNew(merged(model.unlocked, known), merged(model.unlocked, found) ?? found, now);
    local.appid = appid;
    local.steamid = steamid;
    local.unlocked = found;
    local.readAt = now;
    local.missing = { appid: 0, steamid: "" };
    if (state.phase === "game") render();
    // Found here for the first time (Steam said the details hidden): read
    // again, to show the game (never twice within 5 seconds).
    else if (known === null && !inRead) {
      events.summary = true;
      events.player = true;
      if (!armFloor()) void refresh();
    }
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "unsupported" || code === "permission_denied") local.off = true;
    // Nothing on this computer: Steam's Web API alone, as before.
    if (local.appid === appid) local.unlocked = null;
    local.missing = { appid, steamid };
  } finally {
    local.busy = false;
  }
  if (local.again) {
    const again = local.againFull;
    local.again = false;
    local.againFull = false;
    void readLocal(model.appid, again);
  }
}

/** Whether the game details of the account are proven public, and stored. */
function setPublicDetails(proven: boolean): void {
  if (model.publicDetails === proven) return;
  model.publicDetails = proven;
  if (proven) void storage.set({ key: "publicDetails", value: model.steamid }).catch(() => null);
  else void storage.remove({ key: "publicDetails" }).catch(() => null);
}

/** What the local Steam events ask (`steam.events`). */
const events = {
  subscription: null as Subscription | null,
  /** The account the subscription names. */
  steamid: "",
  lastSeq: 0,
  /** A read due: the summary (another game, a missed save), the shown game's achievements. */
  summary: false,
  player: false,
  /** The host's game changed: the new game's list too, whatever the route's minute. */
  schema: false,
  /** The save the looks again count from, and the next look. */
  savedAt: 0,
  look: EVENT_LOOKS.length as number,
  floorTimer: null as Timer | null,
  lookTimer: null as Timer | null,
};

/** How long `route` waits for the floor of a read a save asks. */
function floorLeft(route: Route | string, now: number): number {
  const last = model.lastCall.get(route);
  return last === undefined ? 0 : Math.max(0, last + EVENT_FLOOR - now);
}

/** A read a save asks of `route`, due now. */
function asked(route: "summary" | "player", now: number): boolean {
  return events[route] && floorLeft(route, now) === 0;
}

/** Listens for the followed account's saves; again for another account. */
function listen(): void {
  if (events.steamid === model.steamid) return;
  events.subscription?.cancel();
  events.subscription = null;
  events.steamid = model.steamid;
  events.lastSeq = 0;
  if (model.steamid === "") return;
  events.subscription = steam.events.subscribe({ steamid: model.steamid }, (update) => {
    // Refused or unknown (an older PlayerVox OverCrow): the minute.
    if (!update.ok) return;
    let saved = false;
    let here = false;
    for (const event of update.value.events) {
      if (event.seq <= events.lastSeq) continue;
      const missed = event.seq > events.lastSeq + 1;
      events.lastSeq = event.seq;
      const appid = whole(object(event.data)?.["appid"]) ?? 0;
      if (missed || appid !== model.appid) events.summary = true;
      if (missed || appid === model.appid) {
        // The game shown: read on this computer at once. Steam's Web API
        // only when this computer has nothing of it (yet).
        here = true;
        if (missed || localOf(model.appid) === null) events.player = true;
      }
      saved = true;
    }
    if (here) void readLocal(model.appid, false);
    if (!saved || !(events.summary || events.player)) return;
    events.savedAt = Date.now();
    events.look = 0;
    events.lookTimer?.cancel();
    events.lookTimer = null;
    if (!armFloor()) void refresh();
  });
}

/**
 * Waits for the floor of the reads saves ask; `false` when they are due
 * now (or none is). Hidden, nothing: shown again, the widget reads.
 */
function armFloor(): boolean {
  events.floorTimer?.cancel();
  events.floorTimer = null;
  const now = Date.now();
  const waits = [events.summary ? floorLeft("summary", now) : Infinity, events.player ? floorLeft("player", now) : Infinity];
  const wait = Math.min(...waits);
  if (wait === Infinity || wait === 0) return false;
  events.floorTimer = timers.after(wait, () => {
    events.floorTimer = null;
    void refresh();
  });
  return true;
}

/**
 * A read of the shown game's achievements that a save asked: something new
 * ends the looks; nothing new plans the next one, if any is left.
 */
function looked(found: boolean): void {
  events.lookTimer?.cancel();
  events.lookTimer = null;
  if (found) {
    events.look = EVENT_LOOKS.length;
    return;
  }
  const next = EVENT_LOOKS[events.look];
  if (next === undefined) return;
  events.look += 1;
  events.lookTimer = timers.after(Math.max(0, events.savedAt + next - Date.now()), () => {
    events.lookTimer = null;
    events.player = true;
    if (!armFloor()) void refresh();
  });
}

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
  /** The answer is larger than the route's bound (`maxResponseBytes`). */
  | { kind: "too-large" }
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
    if (code === "response_body_limit") return { kind: "too-large" };
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
  if (outcome.kind === "quota" || outcome.kind === "server" || outcome.kind === "too-large" || (outcome.kind === "status" && outcome.status >= 500)) {
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
  if (state.phase === "loading" || state.phase === "nothing") state.phase = "empty-unreachable";
  render();
}

/**
 * Steam hides the game details (or the whole profile): said instead of a
 * game, since the running one cannot be known. Kept for the next start.
 */
function hide(hidden: Exclude<Hidden, "">, now: number): void {
  succeeded(now);
  model.playing = false;
  saveHidden(hidden);
  state.hidden = hidden;
  state.phase = "hidden";
}

/** A read showed the game details: no longer hidden (stored at the end of the read). */
function reveal(): void {
  if (model.hidden === "") return;
  model.hidden = "";
  model.hiddenSaved = false;
}

/** Stores what Steam hides, only when it changes. */
function saveHidden(hidden: Hidden): void {
  if (model.hidden === hidden && model.hiddenSaved) return;
  model.hidden = hidden;
  model.hiddenSaved = true;
  if (hidden === "") void storage.remove({ key: "hidden" }).catch(() => null);
  else void storage.set({ key: "hidden", value: hidden }).catch(() => null);
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
  } else if (events.summary || events.player) {
    // A save asked a read the floor delayed.
    armFloor();
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
  const waiting = now < model.retryAt - TICK_SLACK;
  if (!fresh && (waiting || !(canCall("summary", now) || asked("summary", now)))) {
    // This computer's achievements of the game shown, whatever Steam's
    // minute; then, for a save, Steam's.
    if (state.phase === "game") void readLocal(model.appid, false, true);
    if (!waiting && asked("player", now)) await lookAgain(now);
    return;
  }
  events.summary = false;
  const summaryAnswer: Outcome =
    fresh && checked !== null
      ? { kind: "ok", status: 200, body: checked.body, text: "" }
      : await call("summary", { steamids: model.steamid }, "summary", now);
  if (summaryAnswer.kind !== "ok") return failed(summaryAnswer, now);
  const summary = parseSummary(summaryAnswer.body, model.steamid);
  if (summary === null || summary === "notfound") return failed({ kind: "server" }, now);

  // A private profile hides everything, the running game first: nothing
  // else is asked until it is public.
  if (!summary.visible) return hide("profile", now);

  // The host's game first: Steam's presence names none while the status is
  // Invisible or offline.
  const presence = summary.appid ?? 0;
  let appid = active.appid !== 0 ? active.appid : presence;
  model.named = presence !== 0 && presence === appid;
  model.fromHost = active.appid !== 0;
  const name = model.named ? summary.gameName : active.name || null;
  // A game that stops being named: quit, or hidden since. Steam is asked at
  // once which, never a minute of guessing.
  const stopped = model.playing && appid === 0;
  model.playing = appid !== 0;
  // Steam names the running game only with public game details.
  if (presence !== 0) {
    reveal();
    setPublicDetails(true);
  }
  // The running game's name, or none yet (S3 or S5 give it): never the
  // previous game's.
  if (appid !== 0 && (name !== null || appid !== model.appid)) model.gameName = name ?? "";

  const switched = appid !== 0 && appid !== model.appid;
  const recentDue = switched || stopped || (appid === 0 && (model.readRecent === 0 || now - model.readRecent >= OUT_OF_GAME_EVERY));
  if (recentDue && canCall("recent", now)) {
    const recentAnswer = await call("recent", { steamid: model.steamid, count: 5 }, "recent", now);
    if (recentAnswer.kind !== "ok") return failed(recentAnswer, now);
    const recent = parseRecent(recentAnswer.body);
    if (recent === null) return failed({ kind: "server" }, now);
    model.readRecent = now;
    model.recentHidden = recent.hidden;
    // The games show again, none played lately: nothing left to say hidden.
    if (!recent.hidden && recent.games.length === 0) reveal();
    for (const game of recent.games) if (game.icon !== "") model.icons.set(game.appid, game.icon);
    if (appid === 0 && active.last === 0) {
      const last = recent.games[0];
      if (last !== undefined) {
        appid = last.appid;
        if (appid !== model.appid) model.gameName = last.name;
      }
    }
  }
  // The host's last game, before the recent list: the same game shown
  // keeps what is known of it.
  if (appid === 0 && active.last !== 0) {
    appid = active.last;
    model.fromHost = true;
    if (appid !== model.appid) model.gameName = active.lastName;
  }
  // Hidden games without a running one: the game details are private.
  if (appid === 0 && model.recentHidden) return hide("details", now);
  if (appid === 0) appid = model.appid;
  if (appid === 0) {
    succeeded(now);
    if (model.hidden !== "") return hide(model.hidden, now);
    state.phase = "nothing";
    render();
    return;
  }
  if (appid !== model.appid) switchGame(appid);
  // This computer's achievements first: the newest, whatever Steam says.
  await readLocal(appid, localOf(appid) === null, true);

  const lang = language();
  // A large list (thousands of achievements) takes a while to read in
  // slices: the player's achievements first, for the count and the bar.
  let early: "done" | "hidden" | Outcome = "done";
  const beforeSlices = async (): Promise<void> => {
    early = await playerStep(appid, now, stopped, null);
    if (early === "done" && (model.unlocked !== null || !model.readable)) showGame(now);
  };
  let found = await ensureSchema(appid, lang, now, beforeSlices);
  events.schema = false;
  // Beyond the schema's bound: the names from S4 asked with `l`, a large
  // answer too, after the count.
  if (found === TOO_LARGE) {
    if (model.unlocked === null) await beforeSlices();
    found = early === "done" ? await namedList(appid, lang, now) : null;
  }
  const step = early as "done" | "hidden" | Outcome;
  if (step === "hidden") return hide("details", now);
  if (step !== "done") return failed(step, now);
  if (found !== null && "kind" in found) return failed(found, now);
  // In another language, the English list serves until its own arrives.
  const schema = found ?? model.schemas.get(schemaKey(appid, "english"));
  if (schema === undefined) {
    // Not read yet (once a minute at most): what is known stays shown.
    if (state.phase === "game") render();
    return;
  }
  if (model.gameName === "" && schema.gameName !== "") model.gameName = schema.gameName;
  // The list is read: the API names kept as a last resort are no longer needed.
  model.playerIds = [];
  // A game without achievements: Steam's refusal of S4 says nothing more.
  if (schema.list.length === 0) model.readable = true;

  if (schema.list.length > 0) {
    const step = await playerStep(appid, now, stopped, schema);
    if (step === "hidden") return hide("details", now);
    if (step !== "done") return failed(step, now);
  }
  // Still hidden since the last refusal (asked again in 10 minutes).
  if (model.hidden !== "") return hide(model.hidden, now);

  const rarity = model.rarity.get(appid);
  if (schema.list.length > 0 && (rarity === undefined || now - rarity.at >= RARITY_EVERY) && canCall("rarity", now)) {
    const rarityAnswer = await call("rarity", { gameid: appid }, "rarity", now);
    if (rarityAnswer.kind === "ok") model.rarity.set(appid, { at: now, values: await rarityOf(rarityAnswer) });
    // Rarity is a detail: its failure never hides the rest.
  }

  succeeded(now);
  saveHidden("");
  state.hidden = "";
  state.phase = "game";
  render();
  void saveSnapshot();
}

/** The shown game's achievements, read again because a save asked. */
async function lookAgain(now: number): Promise<void> {
  const appid = model.appid;
  if (appid === 0 || state.phase !== "game") {
    events.player = false;
    return;
  }
  const schema = model.schemas.get(schemaKey(appid, language())) ?? model.schemas.get(schemaKey(appid, "english")) ?? null;
  const step = await playerStep(appid, now, false, schema);
  if (step === "hidden") return hide("details", now);
  if (step !== "done") return failed(step, now);
  succeeded(now);
  render();
  void saveSnapshot();
}

/** Shows the game as known so far: the count and the bar before the names. */
function showGame(now: number): void {
  succeeded(now);
  if (model.hidden !== "") return;
  state.phase = "game";
  render();
}

/**
 * S4 of the shown game when due: the unlocked achievements, or Steam's
 * refusal. `schema` is the game's list, `null` while it is not read.
 */
async function playerStep(appid: number, now: number, stopped: boolean, schema: SchemaEntry | null): Promise<"done" | "hidden" | Outcome> {
  // Refused (hidden details, not readable): asked again every 10 minutes,
  // never in a loop; the first read of a game at once.
  const playerEvery = model.playing && model.readable && model.hidden === "" ? MINUTE : OUT_OF_GAME_EVERY;
  const save = asked("player", now);
  const playerDue = save || stopped || model.readPlayer === 0 || now - model.readPlayer >= playerEvery - TICK_SLACK;
  if (!playerDue || !(save || canCall("player", now))) return "done";
  events.player = false;
  // Without `l`: names come from the schema, the answer stays small.
  const playerAnswer = await call("player", { steamid: model.steamid, appid }, "player", now);
  const refused = playerAnswer.kind === "ok" || playerAnswer.kind === "status" ? refusal(playerAnswer.status, playerAnswer.body) : null;
  // The key works (S2 just answered). Steam named this game as running,
  // which it does only with public game details: the game itself is not
  // readable (not owned…). A game guessed from the last ones played is
  // one the player owns: Steam hides the game details (no longer proven
  // public), and the game is not shown, since it may not be the one
  // running. The host's game that Steam does not name (Invisible,
  // offline): hidden details, unless they are proven public.
  const fromRecent = !model.playing && !model.fromHost;
  if (refused === "hidden" && fromRecent) setPublicDetails(false);
  // The host's game, whose achievements this computer has: shown from
  // here, whatever Steam hides (the player's own, on their own screen).
  if (refused !== null && !fromRecent && localOf(appid) !== null) {
    model.readPlayer = now;
    model.readable = true;
    reveal();
    return "done";
  }
  if (refused === "hidden" && (fromRecent || (!model.named && !model.publicDetails))) {
    model.readPlayer = now;
    return "hidden";
  }
  if (refused !== null) {
    model.readable = false;
  } else if (playerAnswer.kind !== "ok") {
    return playerAnswer;
  } else {
    const read = await playerOf(playerAnswer, schema === null);
    if (read === null) return { kind: "server" };
    setPublicDetails(true);
    const before = model.unlocked;
    const found = [...read.unlocked.keys()].some((id) => before?.has(id) !== true);
    // A save's read plans the next look; any read that finds something ends them.
    if (save || found) looked(found);
    const here = localOf(appid);
    markNew(merged(model.unlocked, here), merged(read.unlocked, here) ?? read.unlocked, now);
    model.unlocked = read.unlocked;
    if (schema === null) {
      model.playerTotal = read.total;
      model.playerIds = read.ids;
    } else {
      // An achievement the stored list does not know: the game was
      // updated; its list is read again.
      const known = new Set(schema.list.map((entry) => entry.api));
      if ([...read.unlocked.keys()].some((id) => !known.has(id))) forgetSchema(appid);
    }
    model.readable = true;
  }
  reveal();
  model.readPlayer = now;
  return "done";
}

/**
 * The list of a game beyond the schema's bound, from S4 asked with `l`
 * (names and descriptions, no icons, nothing said hidden); beyond its own
 * bound, the API names S4 gave. Kept in memory for the session.
 */
async function namedList(appid: number, lang: string, now: number): Promise<SchemaEntry | null | Outcome> {
  const key = `player:${lang}`;
  if (!canCall(key, now)) return null;
  const answer = await call("player", { steamid: model.steamid, appid, l: lang }, key, now);
  let list: SchemaAch[] | null = null;
  if (answer.kind === "ok") {
    list = [];
    const into = list;
    const ok = answer.text === ""
      ? Array.isArray(object(object(answer.body)?.["playerstats"])?.["achievements"])
      : (await readItems(answer.text, "achievements", (entry) => {
          const item = namedItem(entry);
          if (item !== null) into.push(item);
        })) === "read";
    if (answer.text === "") {
      const items = object(object(answer.body)?.["playerstats"])?.["achievements"];
      if (Array.isArray(items)) for (const entry of items) {
        const item = namedItem(entry);
        if (item !== null) into.push(item);
      }
    }
    if (!ok) list = null;
  } else if (answer.kind === "too-large" && model.playerIds.length > 0) {
    list = model.playerIds.map((api) => ({ api, name: api, desc: "", hidden: false, icon: "", iconGray: "" }));
  } else if (answer.kind === "status" && answer.status < 500) {
    // Refused: S4 without `l` says why, at its next read.
    return null;
  } else if (answer.kind !== "too-large") {
    return answer;
  }
  if (list === null) return answer.kind === "too-large" ? null : { kind: "server" };
  const schema: SchemaEntry = { list, gameName: "" };
  model.schemas.set(schemaKey(appid, lang), schema);
  model.playerIds = [];
  return schema;
}

/** A game whose list exceeded the schema's bound within a day. */
const TOO_LARGE = "too-large";
function knownTooLarge(appid: number, now: number): boolean {
  const at = model.tooLarge.get(appid);
  return at !== undefined && now - at < RARITY_EVERY - TICK_SLACK;
}

/**
 * The achievements of `appid` in `lang`: from memory, storage, or Steam
 * (once a minute at most); `null` when not read yet, `TOO_LARGE` beyond the
 * route's bound (tried again a day later, never said), or the failure.
 */
async function ensureSchema(appid: number, lang: string, now: number, beforeSlices?: () => Promise<void>): Promise<SchemaEntry | null | Outcome | typeof TOO_LARGE> {
  const known = model.schemas.get(schemaKey(appid, lang)) ?? (await loadSchema(appid, lang));
  if (known !== null && known !== undefined) return known;
  if (knownTooLarge(appid, now)) return TOO_LARGE;
  // One list per game and language: another language is another request.
  // The host's new game: at once, never twice within 5 seconds.
  const switched = events.schema && floorLeft(`schema:${lang}`, now) === 0;
  if (!canCall(`schema:${lang}`, now) && !switched) return null;
  events.schema = false;
  const answer = await call("schema", { appid, l: lang }, `schema:${lang}`, now);
  if (answer.kind === "too-large") {
    // A handful of games at most: the oldest goes past 32.
    model.tooLarge.delete(appid);
    model.tooLarge.set(appid, now);
    if (model.tooLarge.size > 32) model.tooLarge.delete(model.tooLarge.keys().next().value ?? 0);
    return TOO_LARGE;
  }
  model.tooLarge.delete(appid);
  let schema: SchemaEntry;
  if (answer.kind === "status" && answer.status < 500) {
    // A game without stats can answer 400 (or 403) for its schema.
    schema = { list: [], gameName: "" };
  } else if (answer.kind !== "ok") {
    return answer;
  } else {
    if (answer.text !== "" && beforeSlices !== undefined) await beforeSlices();
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

interface PlayerRead { unlocked: Map<string, number>; total: number; ids: string[] }

/** S4 at once, or in slices: the unlocked ones, and all of them when `withIds`. */
async function playerOf(answer: Ok, withIds: boolean): Promise<PlayerRead | null> {
  const read: PlayerRead = { unlocked: new Map(), total: 0, ids: [] };
  const each = (entry: JsonValue): void => {
    const api = text(object(entry)?.["apiname"]);
    if (api === null) return;
    read.total += 1;
    if (withIds) read.ids.push(api);
    const pair = playerItem(entry);
    if (pair !== null) read.unlocked.set(pair[0], pair[1]);
  };
  if (answer.text === "") {
    const unlocked = parsePlayerAchievements(answer.body);
    if (unlocked === null) return null;
    const list = object(object(answer.body)?.["playerstats"])?.["achievements"];
    if (Array.isArray(list)) for (const entry of list) each(entry);
    return read;
  }
  // `success` closes the answer, after the achievements.
  if (!/"success":\s*true/.test(answer.text.slice(-256))) return null;
  return (await readItems(answer.text, "achievements", each)) === "read" ? read : null;
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
  model.playerTotal = 0;
  model.playerIds = [];
  model.readPlayer = 0;
  model.readable = true;
  state.fresh = {};
  state.picking = false;
}

/**
 * Achievements unlocked since the last read of the same game, Steam's or
 * this computer's, are new: `before` is what was known (`null` for a first
 * read), `unlocked` what is now.
 */
function markNew(before: Map<string, number> | null, unlocked: Map<string, number>, now: number): void {
  if (before === null) return;
  // Unlocked after the previous read (a margin for clocks): an unlock made
  // while the widget was closed, or on another computer, is not new.
  const since = (Math.max(model.readPlayer, local.appid === model.appid ? local.readAt : 0) || state.readAt) - 2 * MINUTE;
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
  const unlocked = merged(model.unlocked, localOf(appid)) ?? new Map<string, number>();
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
  // Not read yet: the count S4 gave, names to come.
  const total = list.length > 0 ? list.length : schema === undefined ? model.playerTotal : 0;
  const hasAch = total > 0;
  state.game = {
    appid,
    name: model.gameName || schema?.gameName || "",
    icon: gameIconUrl(appid, model.icons.get(appid) ?? (appid === model.iconHashOf ? model.iconHash : "")),
    header: headerUrl(appid),
    playing: model.playing && state.stale === "",
    readable: model.readable,
    known: schema !== undefined,
    hasAch,
    unlocked: list.length > 0 ? list.reduce((count, entry) => count + (unlocked.has(entry.api) ? 1 : 0), 0) : hasAch ? unlocked.size : 0,
    total,
  };
  // An achievement the game no longer lists is no longer tracked.
  const ids = model.tracked.get(appid) ?? [];
  if (list.length > 0 && ids.some((id) => !list.some((entry) => entry.api === id))) {
    setTracked(appid, ids.filter((id) => list.some((entry) => entry.api === id)));
  }
  state.tracked = model.tracked.get(appid) ?? [];
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
  const shown = [featured(state, v), ...state.lists.tracked, ...recent(state, rows(v)), ...missing(state, rows(v) * 2, v), ...state.lists.pick];
  for (const a of shown) if (a !== null && hasIcon(a)) wanted.push(achIcon(a));
  return wanted.filter((url, index) => url !== "" && wanted.indexOf(url) === index);
}

/** Loads the wanted images two at a time, each once; a failure waits an hour. */
async function loadImages(): Promise<void> {
  // Nothing goes to Steam, images included, before Steam is connected or
  // while the widget is hidden; and only for the game shown.
  if (!model.connected || !host.visible || state.phase !== "game") return;
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
 * for the profile, the tracked achievements, the last view (48 kB) and the
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
  model.tracked = parseTracked(await storage.get({ key: "tracked" }).catch(() => null));
  const snapshot = object(await storage.get({ key: "snapshot" }).catch(() => null));
  const appid = whole(snapshot?.["appid"]);
  if (snapshot !== null && appid !== null && appid > 0) {
    model.appid = appid;
    model.gameName = text(snapshot["name"]) ?? "";
    model.iconHash = text(snapshot["icon"]) ?? "";
    model.iconHashOf = appid;
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
    if (model.schemas.has(schemaKey(appid, language()))) {
      state.phase = "game";
      render();
    }
  }
  model.publicDetails = (await storage.get({ key: "publicDetails" }).catch(() => null)) === steamid;
  // Hidden at the last read: said at once, never a game that may be stale.
  const hidden = await storage.get({ key: "hidden" }).catch(() => null);
  if (hidden === "profile" || hidden === "details") {
    model.hidden = hidden;
    state.hidden = hidden;
    state.phase = "hidden";
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
  if (changed) setPublicDetails(false);
  model.steamid = steamid;
  listen();
  // Another profile, or the same one checked again: the next read says.
  saveHidden("");
  state.hidden = "";
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

/** The stored tracked achievements: `[{ appid, ids }]`, anything else dropped. */
export function parseTracked(value: JsonValue): Map<number, string[]> {
  const tracked = new Map<number, string[]>();
  if (!Array.isArray(value)) return tracked;
  for (const entry of value.slice(-TRACKED_GAMES)) {
    const appid = whole(object(entry)?.["appid"]);
    const list = object(entry)?.["ids"];
    if (appid === null || appid === 0 || !Array.isArray(list)) continue;
    const ids = [...new Set(list.filter((id): id is string => typeof id === "string" && id !== "" && id.length <= 128))].slice(0, MAX_TRACKED);
    if (ids.length > 0) tracked.set(appid, ids);
  }
  return tracked;
}

/** Sets the tracked IDs of a game, newest game last, and keeps them. */
function setTracked(appid: number, ids: string[]): void {
  model.tracked.delete(appid);
  if (ids.length > 0) model.tracked.set(appid, ids);
  for (const key of model.tracked.keys()) {
    if (model.tracked.size <= TRACKED_GAMES) break;
    model.tracked.delete(key);
  }
  const value = [...model.tracked].map(([game, list]) => ({ appid: game, ids: list }));
  void storage.set({ key: "tracked", value }).catch(() => null);
}

/** Ticks or unticks an achievement of the shown game: at most `MAX_TRACKED`. */
export function toggleTrack(id: string): void {
  const appid = state.game?.appid ?? 0;
  if (appid === 0 || id === "") return;
  const ids = model.tracked.get(appid) ?? [];
  if (!ids.includes(id) && ids.length >= MAX_TRACKED) return;
  const next = ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];
  setTracked(appid, next);
  state.tracked = next;
  compute();
  void loadImages();
}
/** Opens the checklist: the tracked ones, then the first `PICK_PAGE` missing. */
export function openPick(): void {
  if (state.game === null || !state.game.hasAch || !state.game.known) return;
  pickOrder = null;
  pickRows = PICK_PAGE;
  state.pickQuery = "";
  state.pickSearch = state.game.total - state.game.unlocked > PICK_PAGE;
  state.picking = true;
  compute();
  void loadImages();
}
/** `PICK_PAGE` more missing rows at the end of the checklist. */
export function showMorePicks(): void {
  if (!state.picking || state.pickLeft === 0 || pickMissing >= PICK_MAX) return;
  pickRows += PICK_PAGE;
  compute();
  void loadImages();
}
export function closePick(): void {
  state.picking = false;
}
/** The checklist's search: names as sorted by name, accents and case aside. */
export function pickTyped(value: string): void {
  if (!state.picking) return;
  state.pickQuery = value.slice(0, 64);
  pickOrder = null;
  pickRows = PICK_PAGE;
  compute();
  void loadImages();
}
function pickMatcher(): (a: Ach) => boolean {
  const query = sortKey(state.pickQuery.trim());
  if (query === "") return () => true;
  // A hidden achievement matches by what is shown of it, never its name.
  const keys = sortKeys();
  return (a) => (keys.get(a.id) ?? sortKey(achName(a))).includes(query);
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
      void ensureSchema(model.appid, language(), Date.now()).then(() => {
        if (state.phase === "game") render();
      });
    }
  }
  if (changed.includes("visible") && host.visible) void refresh();
});

onMenu((row) => {
  if (row === "track") openPick();
  if (row === "change-profile") openProfile();
});

// The host's game (`game.read`). Refused, unknown (an older PlayerVox
// OverCrow) or ended: Steam's presence, as before. A change reads at once
// (never twice within 5 seconds); hidden, when shown again.
game.subscribe((update) => {
  const value = update.ok ? update.value : null;
  const appid = value?.steamAppId ?? 0;
  active.name = value?.name ?? "";
  if (appid === active.appid) return;
  active.appid = appid;
  // Out of the game (focus elsewhere, or quit), the host's last game is
  // the last one played: Steam's recent list lags behind it.
  if (appid !== 0) {
    active.last = appid;
    active.lastName = active.name;
  }
  // The summary says the rest; the new game's achievements come with it,
  // whatever the route's minute.
  events.summary = true;
  events.player = true;
  events.schema = true;
  if (!armFloor()) void refresh();
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

void restore().then(() => {
  listen();
  return refresh();
});

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
  if (!g.readable) return t("not-readable");
  return g.known ? t("no-achievements") : t("loading");
}
/** Achievements refused: where to check the game details, where there is room. */
export function showFix(g: GameView, v: number): boolean {
  const shown = layout(v);
  return !g.readable && (shown === "standard" || shown === "full");
}

/** The hidden state's texts: what Steam hides, and where to make it public. */
export function hiddenTitle(s: typeof state): string {
  return t(s.hidden === "profile" ? "hidden-profile-title" : "hidden-details-title");
}
export function hiddenBody(s: typeof state): string {
  return t(s.hidden === "profile" ? "hidden-profile" : "hidden-details");
}
/** Where the setting is in Steam, then the setting itself. */
export function hiddenPath(_s: typeof state): string {
  return t("hidden-path");
}
export function hiddenSetting(s: typeof state): string {
  return t(s.hidden === "profile" ? "hidden-profile-setting" : "hidden-details-setting");
}
/** One line has room for the title only: the rest in its tooltip. */
export function hiddenTip(s: typeof state): string {
  return `${hiddenBody(s)} ${hiddenPath(s)} › ${hiddenSetting(s)}`;
}

export function isStale(s: typeof state): boolean {
  return s.stale !== "";
}
export function eyebrow(s: typeof state): string {
  if (s.stale !== "") return t(`stale-${s.stale}`, { age: age(s.now - s.readAt) });
  return s.game?.playing ? t("playing") : t("last-played");
}
export function eyebrowClass(s: typeof state): string {
  if (s.stale !== "") return "eyebrow warn stale";
  return s.game?.playing ? "eyebrow live" : "eyebrow";
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

/** The tracked achievements in the order they were added, the unlocked ones last. */
function trackedOf(ids: readonly string[]): Ach[] {
  const list = ids.flatMap((id) => achList.find((a) => a.id === id) ?? []);
  return [...list.filter((a) => !a.achieved), ...list.filter((a) => a.achieved)];
}

/**
 * The picker's rows: the tracked ones, then the 50 first missing. Their
 * order is set when it opens and holds while it is open: a ticked row stays
 * under the pointer.
 */
let pickOrder: string[] | null = null;
/** Missing rows wanted: `PICK_PAGE`, as many more at each "more", `PICK_MAX` at most. */
let pickRows = PICK_PAGE;
/** Missing rows already in `pickOrder`. */
let pickMissing = 0;
function pickOf(missingList: Ach[], before: (a: Ach, b: Ach) => boolean, matches: (a: Ach) => boolean): Ach[] {
  if (pickOrder === null) {
    pickOrder = trackedOf(state.tracked).filter(matches).map((a) => a.id);
    pickMissing = 0;
  }
  const kept = new Set(pickOrder);
  const rest = missingList.filter((a) => !kept.has(a.id) && !state.tracked.includes(a.id) && matches(a));
  const want = Math.min(pickRows, PICK_MAX) - pickMissing;
  let added = 0;
  if (want > 0 && rest.length > 0) {
    // The rows already shown keep their place; the next ones follow.
    // `best` stays one pass for a window of `PICK_MAX` rows.
    const next = best(rest, want, before).map((a) => a.id);
    pickOrder = [...pickOrder, ...next];
    pickMissing += next.length;
    added = next.length;
  }
  state.pickLeft = rest.length - added;
  state.pickCapped = state.pickLeft > 0 && pickMissing >= PICK_MAX;
  const byId = new Map(achList.map((a) => [a.id, a]));
  return pickOrder.flatMap((id) => byId.get(id) ?? []);
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
  const recentList = best(unlockedList, 6 + MAX_TRACKED, (a, b) => a.at > b.at);
  state.lists = {
    latest: recentList[0] ?? null,
    tracked: trackedOf(state.tracked),
    recent: recentList,
    missing: best(missingList, 12 + MAX_TRACKED, missingBefore),
    pick: state.picking ? pickOf(missingList, missingBefore, pickMatcher()) : [],
  };
  if (!state.picking) {
    state.pickLeft = 0;
    state.pickCapped = false;
  }
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
/** Unlocked ones, newest first, without those already on a card. */
export function recent(s: typeof state, n: number): Ach[] {
  const shown = hasTracked(s) ? s.tracked : [latest(s)?.id ?? ""];
  return s.lists.recent.filter((a) => !shown.includes(a.id)).slice(0, n);
}
export function missing(s: typeof state, n: number, _v: number): Ach[] {
  return s.lists.missing.filter((a) => !s.tracked.includes(a.id)).slice(0, n);
}
export function isTracked(a: Ach, s: typeof state): boolean {
  return s.tracked.includes(a.id);
}
export function hasTracked(s: typeof state): boolean {
  return s.lists.tracked.length > 0;
}
/** The one tracked achievement, on its own card; `null` for none or several. */
export function tracked(s: typeof state): Ach | null {
  return s.lists.tracked.length === 1 ? (s.lists.tracked[0] ?? null) : null;
}
/** Several tracked: one card, a row each. */
export function trackedMany(s: typeof state): boolean {
  return s.lists.tracked.length > 1;
}
export function trackedList(s: typeof state): Ach[] {
  return s.lists.tracked;
}
/** The second card of Standard: the one tracked, else next missing (missing only), else latest; none for several tracked. */
export function featured(s: typeof state, v: number): Ach | null {
  if (trackedMany(s)) return null;
  return tracked(s) ?? (missingOnly(v) ? (missing(s, 1, v)[0] ?? null) : latest(s));
}
export function featuredTitle(s: typeof state, v: number): string {
  if (tracked(s)) return t("tracked");
  return missingOnly(v) ? t("next-one") : t("latest");
}
export function cardClass(a: Ach, s: typeof state): string {
  if (isTracked(a, s)) return a.achieved ? "feature tracked done" : "feature tracked";
  return isNew(a, s) ? "feature new" : "feature";
}
export function featureMeta(a: Ach, s: typeof state): string {
  if (isTracked(a, s) && a.achieved && a.at > 0) return t("tracked-done", { ago: ago(s.now - a.at) });
  return meta(a, s);
}
export function pickList(s: typeof state): Ach[] {
  return s.lists.pick;
}
/** Missing ones left to show in the checklist: its "more" row. */
export function pickMore(s: typeof state): boolean {
  return s.picking && s.pickLeft > 0 && !s.pickCapped;
}
/** Nothing matches the checklist's search. */
export function pickNone(s: typeof state): boolean {
  return s.picking && s.pickQuery.trim() !== "" && s.lists.pick.length === 0;
}
export function pickMoreText(s: typeof state): string {
  return t("pick-more", { count: num(Math.min(PICK_PAGE, s.pickLeft)) });
}
/** Tracking is full: the other rows of the picker wait. */
export function pickFull(s: typeof state): boolean {
  return s.tracked.length >= MAX_TRACKED;
}
export function pickCount(s: typeof state): string {
  return t("pick-count", { count: num(s.tracked.length), max: num(MAX_TRACKED) });
}
export function pickDisabled(a: Ach, s: typeof state): boolean {
  return pickFull(s) && !isTracked(a, s);
}
export function pickRowClass(a: Ach, s: typeof state): string {
  if (isTracked(a, s)) return "pick-row on";
  return pickFull(s) ? "pick-row off" : "pick-row";
}
/** The row's accessible name says whether it is tracked. */
export function pickLabel(a: Ach, s: typeof state): string {
  return isTracked(a, s) ? t("pick-on", { name: achName(a) }) : achName(a);
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
