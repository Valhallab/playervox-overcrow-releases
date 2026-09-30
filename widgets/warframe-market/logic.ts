// Warframe Market: searches the public PC item catalog of warframe.market,
// shows the best buy and sell offers of one item and copies a trade whisper
// on an explicit click. The catalog (about 3,900 items, 1.6 MB of JSON) is
// read once per catalog version, kept compact in host storage and searched
// in memory; its route declares `maxResponseBytes` because it exceeds the
// default 1 MiB bound.
import {
  clipboard,
  formatNumber,
  host,
  http,
  initState,
  onHost,
  storage,
  t,
  timers,
  type JsonValue,
  type Timer,
} from "@overcrow/sdk";

const API = "https://api.warframe.market";

/** The provider allows three requests per second: one starts every 400 ms at most. */
export const REQUEST_SPACING_MS = 400;
export const MAX_ITEMS = 8192;
export const MAX_RESULTS = 12;
export const MAX_QUERY_CHARS = 64;
const MAX_NAME_CHARS = 96;
const MAX_SLUG_BYTES = 96;
const MAX_VERSION_CHARS = 128;
const MAX_ORDERS_PER_SIDE = 5;
const MAX_ORDERS_IN_ANSWER = 256;
const MAX_PLATINUM = 900_000;
/** A catalog chunk stays below `MAX_STORAGE_VALUE_BYTES` (64 KiB) as JSON. */
export const CHUNK_BYTES = 60_000;
/** At most this many chunks: 180 KB of the 256 KiB quota. */
export const MAX_CHUNKS = 3;
/** The search text is saved this long after the last keystroke. */
const SAVE_DELAY_MS = 1000;
/**
 * Catalog rows handled in one VM turn. A turn must stay far below the
 * host's turn budget even under the VM's CPU ceiling (a quarter of one
 * core), so the 1.6 MB catalog is read, checked and stored in slices, one
 * host timer apart.
 */
export const SLICE_ITEMS = 250;
/** Stored lines read back in one turn: splitting and checking a line costs a fraction of parsing an item. */
export const DECODE_SLICE_LINES = 800;
const SLICE_PAUSE_MS = 100;

export interface Item {
  readonly slug: string;
  readonly name: string;
}

export type Side = "sell" | "buy";
export type Presence = "ingame" | "online" | "offline" | "unknown";

export interface Order {
  readonly id: string;
  readonly side: Side;
  readonly platinum: number;
  readonly trader: string;
  readonly presence: Presence;
  readonly perTrade: number;
  readonly rank?: number;
  readonly charges?: number;
  readonly amberStars?: number;
  readonly cyanStars?: number;
  readonly subtype?: string;
}

export interface Detail {
  readonly slug: string;
  readonly name: string;
  readonly sells: readonly Order[];
  readonly buys: readonly Order[];
}

export type Phase = "loading" | "ready" | "unavailable";
export type Failure = "catalog_unavailable" | "storage_unavailable" | "orders_unavailable";
export type CopyState = "pending" | "copied" | "failed";

export interface CopyFeedback {
  readonly side: Side;
  readonly id: string;
  readonly state: CopyState;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    phase: Phase;
    count: number;
    error: Failure | null;
    query: string;
    results: readonly Item[];
    detail: Detail | null;
    loadingOrders: boolean;
    copy: CopyFeedback | null;
    interactive: boolean;
  }
}

const state = initState({
  phase: "loading" as Phase,
  count: 0,
  error: null as Failure | null,
  query: "",
  results: [] as readonly Item[],
  detail: null as Detail | null,
  loadingOrders: false,
  copy: null as CopyFeedback | null,
  interactive: host.mode === "interactive",
});

/** The searchable catalog; outside `state`, so it never reaches the view. */
let items: Item[] = [];
let lowered: string[] = [];

// ---------------------------------------------------------------------------
// Validation of what the provider and the storage return.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const CONTROL = /[\u0000-\u001f\u007f]/;

function hasControl(text: string): boolean {
  return CONTROL.test(text);
}

export function safeSlug(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length >= 1
    && value.length <= MAX_SLUG_BYTES
    && /^[a-z0-9_-]+$/.test(value)
  );
}

/** A display name: trimmed, without control characters, cut to 96 characters. */
export function sanitizeName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || hasControl(trimmed)) {
    return null;
  }
  // UTF-16 units bound the characters: most names skip the split.
  if (trimmed.length <= MAX_NAME_CHARS) {
    return trimmed;
  }
  const characters = [...trimmed];
  return characters.length <= MAX_NAME_CHARS
    ? trimmed
    : `${characters.slice(0, MAX_NAME_CHARS - 1).join("")}…`;
}

/** The checked items of a catalog, fed row by row; a later row replaces an earlier one with its slug. */
export class CatalogBuilder {
  private readonly bySlug = new Map<string, Item>();
  private rows = 0;

  add(slug: unknown, name: unknown): void {
    this.rows += 1;
    if (this.rows > MAX_ITEMS) {
      throw new Error("invalid catalog");
    }
    const clean = sanitizeName(name);
    if (clean && safeSlug(slug)) {
      this.bySlug.set(slug, { slug, name: clean });
    }
  }

  finish(): Item[] {
    if (this.bySlug.size === 0) {
      throw new Error("invalid catalog");
    }
    return [...this.bySlug.values()];
  }
}

function addRow(builder: CatalogBuilder, row: unknown): void {
  const record = isObject(row) ? row : {};
  const i18n = isObject(record.i18n) ? record.i18n : {};
  const en = isObject(i18n.en) ? i18n.en : {};
  builder.add(record.slug, en.name);
}

/** The index of the quote that closes the JSON string opening at `start`. */
function stringEnd(text: string, start: number): number {
  let from = start + 1;
  for (;;) {
    const quote = text.indexOf('"', from);
    if (quote < 0) {
      throw new Error("invalid catalog");
    }
    let slashes = 0;
    while (text.charCodeAt(quote - 1 - slashes) === 0x5c) {
      slashes += 1;
    }
    if (slashes % 2 === 0) {
      return quote;
    }
    from = quote + 1;
  }
}

const STRUCTURE = /[{}[\]"]/g;
const MAX_DEPTH = 64;

/**
 * Reads the text of `GET /v2/items`, `{ …, "data": [ {…}, … ], … }`, a
 * slice at a time: it tracks the nesting and the strings, parses each item
 * of `data` alone with `JSON.parse` and feeds its slug and English name to
 * a builder. Unbalanced or misplaced brackets, a second `data`, a non-object
 * item or text after the root fail the catalog.
 */
export class CatalogScanner {
  private position = 0;
  private readonly open: string[] = [];
  private inData = false;
  private sawData = false;
  private closed = false;
  private itemStart = -1;
  private key = "";
  private keyEnd = -1;

  constructor(private readonly text: string, private readonly builder: CatalogBuilder) {}

  /** Reads up to `SLICE_ITEMS` items; `true` once the whole text is read. */
  step(): boolean {
    const text = this.text;
    const invalid = (): never => {
      throw new Error("invalid catalog");
    };
    let found = 0;
    while (found < SLICE_ITEMS) {
      STRUCTURE.lastIndex = this.position;
      const match = STRUCTURE.exec(text);
      if (!match) {
        if (!this.closed || !this.sawData || text.slice(this.position).trim()) {
          invalid();
        }
        return true;
      }
      const at = match.index;
      const token = match[0];
      if (this.closed) {
        invalid();
      }
      if (token === '"') {
        const end = stringEnd(text, at);
        if (this.open.length === 0) {
          invalid();
        }
        if (this.open.length === 1) {
          this.key = end - at <= 8 ? text.slice(at + 1, end) : "";
          this.keyEnd = end;
        }
        this.position = end + 1;
        continue;
      }
      if (token === "{" || token === "[") {
        const depth = this.open.length;
        if (depth === 0 && (token !== "{" || text.slice(this.position, at).trim())) {
          invalid();
        }
        if (depth >= MAX_DEPTH) {
          invalid();
        }
        if (this.inData && depth === 2) {
          if (token !== "{") {
            invalid();
          }
          this.itemStart = at;
        }
        if (depth === 1 && token === "[" && this.key === "data"
            && /^\s*:\s*$/.test(text.slice(this.keyEnd + 1, at))) {
          if (this.sawData) {
            invalid();
          }
          this.inData = true;
          this.sawData = true;
        }
        this.open.push(token);
      } else {
        const opened = this.open.pop();
        if (opened !== (token === "}" ? "{" : "[")) {
          invalid();
        }
        const depth = this.open.length;
        if (this.inData && depth === 2 && token === "}") {
          addRow(this.builder, JSON.parse(text.slice(this.itemStart, at + 1)));
          found += 1;
        } else if (this.inData && depth === 1) {
          this.inData = false;
        }
        this.closed = depth === 0;
      }
      this.position = at + 1;
    }
    return false;
  }
}

function pause(): Promise<void> {
  return new Promise((resolve) => {
    timers.after(SLICE_PAUSE_MS, () => resolve());
  });
}

/** Runs `step` once per VM turn, one host timer apart, until it returns `true`. */
async function sliced(step: () => boolean): Promise<void> {
  while (!step()) {
    await pause();
  }
}

/** The whole catalog of an answer, at once (tests and small answers). */
export function parseCatalogText(text: string): Item[] {
  const builder = new CatalogBuilder();
  const scanner = new CatalogScanner(text, builder);
  while (!scanner.step()) {
    // one slice after another
  }
  return builder.finish();
}

/** `GET /v2/items` as an object: `{ data: [{ slug, i18n: { en: { name } } }] }`. */
export function parseCatalog(payload: unknown): Item[] {
  return parseCatalogText(JSON.stringify(payload) ?? "");
}

/** `GET /v2/versions`: the catalog's version, `data.collections.items`. */
export function parseVersion(payload: unknown): string {
  const data = isObject(payload) ? payload.data : undefined;
  const collections = isObject(data) ? data.collections : undefined;
  const value = isObject(collections) ? collections.items : undefined;
  return typeof value === "string" && value.length <= MAX_VERSION_CHARS ? value : "";
}

function presence(status: unknown): Presence {
  return status === "ingame" || status === "online" || status === "offline" ? status : "unknown";
}

function sanitizeTrader(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const output = [...value]
    .filter((character) => !hasControl(character) && character !== "/" && character !== "\\")
    .slice(0, 32)
    .join("")
    .trim();
  return output || null;
}

function parseOrder(row: unknown, side: Side): Order | null {
  if (!isObject(row) || row.visible !== true || row.type !== side) {
    return null;
  }
  const user = isObject(row.user) ? row.user : null;
  if (!user || user.platform !== "pc") {
    return null;
  }
  const id = row.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,96}$/.test(id)) {
    return null;
  }
  const platinum = row.platinum;
  if (typeof platinum !== "number" || !Number.isInteger(platinum) || platinum < 1 || platinum > MAX_PLATINUM) {
    return null;
  }
  const trader = sanitizeTrader(user.ingameName);
  if (!trader) {
    return null;
  }
  const perTrade = row.perTrade ?? 1;
  if (typeof perTrade !== "number" || !Number.isInteger(perTrade) || perTrade < 1 || perTrade > 6) {
    return null;
  }
  const order: {
    -readonly [K in keyof Order]: Order[K];
  } = { id, side, platinum, trader, presence: presence(user.status), perTrade };
  for (const key of ["rank", "charges", "amberStars", "cyanStars"] as const) {
    const value = row[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
      return null;
    }
    order[key] = value;
  }
  if (row.subtype !== undefined && row.subtype !== null) {
    if (typeof row.subtype !== "string" || !/^[a-z0-9_-]{1,64}$/.test(row.subtype)) {
      return null;
    }
    order.subtype = row.subtype;
  }
  return order;
}

function parseSide(rows: unknown[], side: Side): Order[] {
  const accepted: Order[] = [];
  for (const row of rows) {
    const order = parseOrder(row, side);
    if (order) {
      accepted.push(order);
      if (accepted.length === MAX_ORDERS_PER_SIDE) {
        break;
      }
    }
  }
  return accepted;
}

/** `GET /v2/orders/item/{slug}/top`: at most five visible PC offers a side. */
export function parseOrders(payload: unknown): { sells: Order[]; buys: Order[] } {
  const data = isObject(payload) ? payload.data : undefined;
  if (
    !isObject(data)
    || !Array.isArray(data.sell)
    || !Array.isArray(data.buy)
    || data.sell.length > MAX_ORDERS_IN_ANSWER
    || data.buy.length > MAX_ORDERS_IN_ANSWER
  ) {
    throw new Error("invalid orders");
  }
  return { sells: parseSide(data.sell, "sell"), buys: parseSide(data.buy, "buy") };
}

// ---------------------------------------------------------------------------
// The compact stored catalog: one line per item, `name` when the slug
// derives from it, else `name<TAB>slug`, in chunks of at most 60 KB.

export function derivedSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

const ASCII = /^[\u0000-\u007f]*$/;
const ESCAPED = /["\\\t]/;

/** Bytes of `line` in compact JSON, with the separator that follows it. */
function storedBytes(line: string): number {
  let bytes = line.length + 2;
  if (!ASCII.test(line)) {
    for (let index = 0; index < line.length; index += 1) {
      const code = line.charCodeAt(index);
      // A surrogate pair is 4 bytes for 2 units; other units 2 or 3 bytes for 1.
      bytes += code < 0x80 ? 0 : code < 0x800 ? 1 : code >= 0xd800 && code <= 0xdbff ? 1 : 2;
    }
  }
  if (ESCAPED.test(line)) {
    for (let index = 0; index < line.length; index += 1) {
      const code = line.charCodeAt(index);
      if (code === 0x22 || code === 0x5c || code === 0x09) {
        bytes += 1;
      }
    }
  }
  return bytes;
}

/**
 * Encodes a catalog for storage, a slice at a time: one line per item,
 * `name` when the slug derives from it, else `name<TAB>slug`, in chunks of
 * at most `CHUNK_BYTES`.
 */
export class CatalogEncoder {
  private index = 0;
  private lines: string[] = [];
  private size = 2;
  private readonly done: string[] = [];

  constructor(private readonly catalog: readonly Item[]) {}

  step(): boolean {
    const end = Math.min(this.catalog.length, this.index + SLICE_ITEMS);
    for (; this.index < end; this.index += 1) {
      const item = this.catalog[this.index];
      if (!item) {
        continue;
      }
      const line = derivedSlug(item.name) === item.slug ? item.name : `${item.name}\t${item.slug}`;
      const cost = storedBytes(line);
      if (this.lines.length > 0 && this.size + cost > CHUNK_BYTES) {
        this.done.push(this.lines.join("\n"));
        this.lines = [];
        this.size = 2;
      }
      this.lines.push(line);
      this.size += cost;
    }
    if (this.index < this.catalog.length) {
      return false;
    }
    if (this.lines.length > 0) {
      this.done.push(this.lines.join("\n"));
      this.lines = [];
    }
    return true;
  }

  /** The chunks, or `null` when they would not fit `MAX_CHUNKS`. */
  chunks(): string[] | null {
    return this.done.length <= MAX_CHUNKS ? this.done : null;
  }
}

/** Reads stored chunks back, a slice of lines at a time, through the same checks as remote data. */
export class CatalogDecoder {
  private readonly lines: string[] = [];
  private index = 0;

  constructor(chunks: readonly unknown[], private readonly builder: CatalogBuilder) {
    for (const chunk of chunks) {
      if (typeof chunk !== "string" || chunk.length > CHUNK_BYTES) {
        throw new Error("invalid stored catalog");
      }
      for (const line of chunk.split("\n")) {
        this.lines.push(line);
      }
      if (this.lines.length > MAX_ITEMS) {
        throw new Error("invalid stored catalog");
      }
    }
  }

  step(): boolean {
    const end = Math.min(this.lines.length, this.index + DECODE_SLICE_LINES);
    for (; this.index < end; this.index += 1) {
      const [name, slug, extra] = (this.lines[this.index] ?? "").split("\t");
      if (extra !== undefined || name === undefined) {
        throw new Error("invalid stored catalog");
      }
      this.builder.add(slug ?? derivedSlug(name), name);
    }
    return this.index >= this.lines.length;
  }
}

/** Chunks of the catalog at once (tests), or `null` beyond `MAX_CHUNKS`. */
export function encodeCatalog(catalog: readonly Item[]): string[] | null {
  const encoder = new CatalogEncoder(catalog);
  while (!encoder.step()) {
    // one slice after another
  }
  return encoder.chunks();
}

/** Stored chunks back to items at once (tests). */
export function decodeCatalog(chunks: readonly unknown[]): Item[] {
  const builder = new CatalogBuilder();
  const decoder = new CatalogDecoder(chunks, builder);
  while (!decoder.step()) {
    // one slice after another
  }
  return builder.finish();
}

// ---------------------------------------------------------------------------
// Search.

/** The search text, or `""` when it is too long or holds control characters. */
export function normalizeQuery(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if ([...trimmed].length > MAX_QUERY_CHARS || hasControl(trimmed)) {
    return "";
  }
  return trimmed;
}

/** At most `MAX_RESULTS` items whose name or slug holds the query, in catalog order. */
export function searchItems(catalog: readonly Item[], names: readonly string[], query: string): Item[] {
  const needle = normalizeQuery(query).toLowerCase();
  if (!needle) {
    return [];
  }
  const hits: Item[] = [];
  for (let index = 0; index < catalog.length; index += 1) {
    const item = catalog[index];
    if (item && ((names[index] ?? "").includes(needle) || item.slug.includes(needle))) {
      hits.push(item);
      if (hits.length === MAX_RESULTS) {
        break;
      }
    }
  }
  return hits;
}

function useCatalog(catalog: Item[]): void {
  items = catalog;
  lowered = catalog.map((item) => item.name.toLowerCase());
  state.count = catalog.length;
  state.phase = "ready";
  state.results = searchItems(items, lowered, state.query);
}

// ---------------------------------------------------------------------------
// Requests, paced for the provider.

let nextStart = 0;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.after(ms, () => resolve());
  });
}

/** Milliseconds before the next request may start, reserving that start. */
function reserveStart(): number {
  const now = Date.now();
  const start = Math.max(now, nextStart);
  nextStart = start + REQUEST_SPACING_MS;
  return start - now;
}

async function getText(path: string): Promise<string> {
  const delay = reserveStart();
  if (delay > 0) {
    await wait(delay);
  }
  const response = await http.fetch(`${API}${path}`, { as: "text" });
  if (response.status !== 200) {
    throw new Error("request failed");
  }
  return response.body;
}

async function getJson(path: string): Promise<JsonValue> {
  const delay = reserveStart();
  if (delay > 0) {
    await wait(delay);
  }
  const response = await http.fetch(`${API}${path}`, { as: "json" });
  if (response.status !== 200) {
    throw new Error("request failed");
  }
  return response.body;
}

// ---------------------------------------------------------------------------
// Storage.

const STATE_KEY = "state";
const CATALOG_KEY = "catalog";
const chunkKey = (index: number): string => `catalog-${index}`;

async function readStored(key: string): Promise<JsonValue | undefined> {
  try {
    return await storage.get({ key });
  } catch {
    state.error = "storage_unavailable";
    return undefined;
  }
}

async function loadStoredCatalog(): Promise<string> {
  const meta = await readStored(CATALOG_KEY);
  if (!isObject(meta) || typeof meta.chunks !== "number" || !Number.isInteger(meta.chunks)
      || meta.chunks < 1 || meta.chunks > MAX_CHUNKS) {
    return "";
  }
  const chunks: JsonValue[] = [];
  for (let index = 0; index < meta.chunks; index += 1) {
    const chunk = await readStored(chunkKey(index));
    if (chunk === undefined) {
      return "";
    }
    chunks.push(chunk);
  }
  try {
    const builder = new CatalogBuilder();
    const decoder = new CatalogDecoder(chunks, builder);
    await sliced(() => decoder.step());
    useCatalog(builder.finish());
    return typeof meta.version === "string" && meta.version.length <= MAX_VERSION_CHARS
      ? meta.version
      : "";
  } catch {
    // An invalid stored catalog cannot authorize results or request paths.
    return "";
  }
}

async function storeCatalog(catalog: readonly Item[], version: string): Promise<void> {
  const encoder = new CatalogEncoder(catalog);
  await pause();
  await sliced(() => encoder.step());
  const chunks = encoder.chunks();
  try {
    // The index goes first and last: a crash in between leaves no index,
    // so the next start fetches again rather than reading mixed chunks.
    await storage.remove({ key: CATALOG_KEY });
    if (!chunks) {
      return;
    }
    for (const [index, chunk] of chunks.entries()) {
      await storage.set({ key: chunkKey(index), value: chunk });
    }
    for (let index = chunks.length; index < MAX_CHUNKS; index += 1) {
      await storage.remove({ key: chunkKey(index) });
    }
    await storage.set({ key: CATALOG_KEY, value: { version, chunks: chunks.length } });
  } catch {
    state.error = "storage_unavailable";
  }
}

let saveTimer: Timer | undefined;

function saveQuery(): void {
  saveTimer?.cancel();
  saveTimer = timers.after(SAVE_DELAY_MS, () => {
    saveTimer = undefined;
    storage.set({ key: STATE_KEY, value: { query: state.query } }).catch(() => {
      state.error = "storage_unavailable";
    });
  });
}

// ---------------------------------------------------------------------------
// Start: the saved search, the stored catalog, then the provider's version.

async function start(): Promise<void> {
  const saved = await readStored(STATE_KEY);
  state.query = normalizeQuery(isObject(saved) ? saved.query : "");
  const version = await loadStoredCatalog();
  let remote = "";
  try {
    remote = parseVersion(await getJson("/v2/versions"));
  } catch {
    // Without a version, a stored catalog stays in use.
  }
  if (items.length > 0 && (!remote || remote === version)) {
    return;
  }
  let catalog: Item[];
  try {
    const builder = new CatalogBuilder();
    const scanner = new CatalogScanner(await getText("/v2/items"), builder);
    await sliced(() => scanner.step());
    catalog = builder.finish();
  } catch {
    state.error = "catalog_unavailable";
    state.phase = items.length > 0 ? "ready" : "unavailable";
    return;
  }
  useCatalog(catalog);
  await storeCatalog(catalog, remote || version);
}

void start();

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
});

// ---------------------------------------------------------------------------
// Handlers.

let selection = 0;
let wanted: string | null = null;
let orderTimer: Timer | undefined;

/** `input` of the search field: results as the user types. */
export function search(detail: { value: unknown }): void {
  state.query = typeof detail.value === "string" ? detail.value : "";
  state.results = searchItems(items, lowered, state.query);
  state.detail = null;
  state.loadingOrders = false;
  state.copy = null;
  if (state.error === "orders_unavailable") {
    state.error = null;
  }
  selection += 1;
  saveQuery();
}

export function clear(): void {
  search({ value: "" });
}

/** Back to the results of the current search. */
export function back(): void {
  selection += 1;
  state.detail = null;
  state.loadingOrders = false;
  state.copy = null;
}

function fetchOrders(): void {
  const slug = wanted;
  const item = items.find((entry) => entry.slug === slug);
  if (!item) {
    state.loadingOrders = false;
    return;
  }
  const mine = selection;
  nextStart = Date.now() + REQUEST_SPACING_MS;
  // The slug passed `safeSlug`, the route's `slug` parameter grammar.
  http
    .fetch(`${API}/v2/orders/item/${item.slug}/top`, { as: "json" })
    .then((response) => {
      if (response.status !== 200) {
        throw new Error("request failed");
      }
      const orders = parseOrders(response.body);
      if (mine === selection) {
        state.detail = { slug: item.slug, name: item.name, ...orders };
        state.error = null;
      }
    })
    .catch(() => {
      if (mine === selection) {
        state.error = "orders_unavailable";
      }
    })
    .finally(() => {
      if (mine === selection) {
        state.loadingOrders = false;
      }
    });
}

/** `activate` of a result: its offers, one request at a time for the provider. */
export function select(slug: string): void {
  selection += 1;
  wanted = slug;
  state.detail = null;
  state.copy = null;
  state.loadingOrders = true;
  if (state.error === "orders_unavailable") {
    state.error = null;
  }
  if (orderTimer) {
    return; // the pending start takes the latest selection
  }
  const delay = Math.max(0, nextStart - Date.now());
  if (delay === 0) {
    fetchOrders();
    return;
  }
  orderTimer = timers.after(delay, () => {
    orderTimer = undefined;
    fetchOrders();
  });
}

/** The whisper pasted in Warframe chat; English, as the game's trade chat. */
export function whisperLine(order: Order, item: string): string {
  const intent = order.side === "sell" ? "WTB" : "WTS";
  const quantity = order.perTrade > 1 ? `${order.perTrade} x ` : "";
  const variant = variantLabel(order);
  return `/w ${order.trader} Hi, ${intent} ${quantity}${item}${variant ? ` (${variant})` : ""} for ${order.platinum}p${order.perTrade > 1 ? " total" : ""}`;
}

/** Rank, charges, stars and subtype, in the game's English terms. */
export function variantLabel(order: Order): string {
  const parts: string[] = [];
  if (order.rank !== undefined) parts.push(`Rank ${order.rank}`);
  if (order.charges !== undefined) parts.push(`${order.charges} charges`);
  if (order.amberStars !== undefined || order.cyanStars !== undefined) {
    parts.push(`${order.amberStars ?? 0} amber / ${order.cyanStars ?? 0} cyan stars`);
  }
  if (order.subtype) parts.push(order.subtype.replaceAll("_", " "));
  return parts.join(", ");
}

/** `activate` of a copy button: the user's gesture authorizes the write. */
export function copy(side: Side, id: string): void {
  const detail = state.detail;
  if (!detail || state.copy?.state === "pending") {
    return;
  }
  const order = (side === "sell" ? detail.sells : detail.buys).find((entry) => entry.id === id);
  if (!order) {
    return;
  }
  const mine = selection;
  state.copy = { side, id, state: "pending" };
  clipboard.writeText({ text: whisperLine(order, detail.name) }).then(
    () => {
      if (mine === selection) state.copy = { side, id, state: "copied" };
    },
    () => {
      if (mine === selection) state.copy = { side, id, state: "failed" };
    },
  );
}

// ---------------------------------------------------------------------------
// View helpers.

export function price(value: number): string {
  return `${formatNumber(value, { maximumFractionDigits: 2 })}p`;
}

/** The lowest sell and highest buy price per item, or `—`. */
export function unitPrice(orders: readonly Order[], lowest: boolean): string {
  if (orders.length === 0) {
    return "—";
  }
  const units = orders.map((order) => order.platinum / order.perTrade);
  return price(lowest ? Math.min(...units) : Math.max(...units));
}

export function orderCount(detail: Detail): string {
  return formatNumber(detail.sells.length + detail.buys.length);
}

export function statusText(
  phase: Phase,
  count: number,
  error: Failure | null,
  detail: Detail | null,
  loadingOrders: boolean,
): string {
  if (error === "catalog_unavailable") {
    return count > 0 ? t("status-catalog-stale") : t("status-catalog-unavailable");
  }
  if (error) {
    return t(`status-${error}`);
  }
  if (phase === "loading") {
    return t("status-loading");
  }
  if (phase === "unavailable" || count === 0) {
    return t("status-catalog-unavailable");
  }
  if (loadingOrders) {
    return t("status-loading-orders");
  }
  return t(detail ? "status-detail" : "status-ready", { count: formatNumber(count) });
}

export function statusClass(error: Failure | null): string {
  return error ? "status error" : "status";
}

export function searchHint(interactive: boolean): string {
  return t(interactive ? "hint-interactive" : "hint-passive");
}

export function emptyText(query: string, phase: Phase): string {
  if (phase === "loading") {
    return t("empty-loading");
  }
  if (phase === "unavailable") {
    return t("empty-unavailable");
  }
  return t(normalizeQuery(query) ? "empty-no-match" : "empty-start");
}

export function sideTitle(side: Side): string {
  return t(side === "sell" ? "sellers" : "buyers");
}

export function noOffers(side: Side): string {
  return t(side === "sell" ? "no-sell-offers" : "no-buy-offers");
}

export function shown(count: number): string {
  return t("shown", { count: formatNumber(count) });
}

export function presenceLabel(value: Presence): string {
  return t(`presence-${value}`);
}

export function presenceClass(value: Presence): string {
  return `presence ${value}`;
}

/** Quantity and variant under an offer: `1 item`, `3 items · total price · Rank 5`. */
export function orderDetail(order: Order): string {
  const quantity = order.perTrade > 1
    ? t("per-trade", { count: formatNumber(order.perTrade) })
    : t("one-item");
  const variant = variantLabel(order);
  return variant ? `${quantity} · ${variant}` : quantity;
}

function feedbackFor(copyState: CopyFeedback | null, side: Side, id: string): CopyState | null {
  return copyState && copyState.side === side && copyState.id === id ? copyState.state : null;
}

export function copyLabel(copyState: CopyFeedback | null, side: Side, id: string): string {
  const feedback = feedbackFor(copyState, side, id);
  return t(feedback ? `copy-${feedback}` : "copy");
}

export function copyClass(copyState: CopyFeedback | null, side: Side, id: string): string {
  const feedback = feedbackFor(copyState, side, id);
  return feedback ? `copy ${feedback}` : "copy";
}

export function copyBusy(copyState: CopyFeedback | null): boolean {
  return copyState?.state === "pending";
}

export function copyStatus(copyState: CopyFeedback | null): string {
  return t(copyState ? `copy-status-${copyState.state}` : "copy-status");
}

export function copyStatusClass(copyState: CopyFeedback | null): string {
  return copyState ? `copy-status ${copyState.state}` : "copy-status";
}
