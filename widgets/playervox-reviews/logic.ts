// Player reviews: what PlayerVox players think of the active game, three
// reviews per page, optionally from the players the user follows. OverCrow
// reads the reviews with the user's PlayerVox session, in the language of
// its interface, and owns the account's sign-in; the widget follows the
// reviews' revision, reads its own page with its own filter and lays it
// out.
import {
  draw,
  formatDate,
  formatNumber,
  hasGrant,
  host,
  initState,
  onHost,
  option,
  playervox,
  t,
  timers,
  type Color,
  type DrawCommand,
  type Review,
  type ReviewsPage,
  type ServiceError,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

/** What the widget shows in place of the reviews. */
export type Phase = "loading" | "idle" | "unsupported" | "ready" | "failed";

/** How the user reads one review of the page shown. */
export interface Reading {
  /** The whole text, past the three-line fold. */
  expanded: boolean;
  /** The untranslated text of a translated review. */
  original: boolean;
  /** A review the community hid, shown at the user's request. */
  revealed: boolean;
}

declare module "@overcrow/sdk" {
  interface WidgetState {
    /**
     * `loading` until the first page, `idle` without an active game,
     * `unsupported` for a game without a Steam app ID, `ready` with a
     * page, `failed` without one after a failure.
     */
    phase: Phase;
    /** The page shown; `null` until the first one. */
    page: ReviewsPage | null;
    /** The filter the page shown was read with. */
    followedOnly: boolean;
    /** Reading choices of the page shown, by review ID. */
    reading: Record<string, Reading>;
    /** Message key of the last failed read; `""` for none. */
    problem: string;
    /** PlayerVox is unreachable: nothing is read, the page shown stays. */
    offline: boolean;
    /** A read is in flight: the paging buttons wait. */
    busy: boolean;
    interactive: boolean;
  }
}

/**
 * After the host ends the subscription with a failure, the widget
 * subscribes again this much later.
 */
export const RETRY_MS = 5_000;

/** A read answered `busy` or `stale_context` is asked again this much later. */
export const REREAD_MS = 1_000;

/** Consecutive re-reads after `busy` or `stale_context`; the next revision reads again. */
export const MAX_REREADS = 3;

/** Reviews per page, as PlayerVox pages them: one badge canvas each. */
export const PAGE_SIZE = 3;

/**
 * A review longer than this, or of more than three lines, folds to three
 * lines behind "Read more": about three lines of the narrowest panel. The
 * host does not tell whether a text is cut, so a text close to the bound
 * may get the button without being cut.
 */
export const FOLD_CHARACTERS = 120;

/**
 * Characters of a folded review given to the host. Its three lines hold
 * fewer on the widest panel (about 140 per line at 900 px), and the host
 * lays out every character it is given, shown or not: an 8000-character
 * review folded costs the host as much as unfolded otherwise.
 */
export const FOLDED_CHARACTERS = 450;

/** `label` and `tooltip` bound (`MAX_LABEL_BYTES`). */
const MAX_LABEL_BYTES = 256;

// <shared:playervox-badge/badge.ts>
// The PlayerVox grade badge and mark, shared by the Score and Rating
// built-ins; the Journal draws the mark alone, and Player reviews the mark
// and a smaller badge per review. scripts/sync-shared-widgets.mjs
// copies this file, as is, into
// their logic.ts between the markers `// <shared:playervox-badge/badge.ts>`;
// edit it here, never in a copy. The copy relies on the widget importing
// the `Color` and `DrawCommand` types from @overcrow/sdk.

/** A PlayerVox grade, or `--` without a valid score. */
export type BadgeGrade = "S+" | "S" | "A" | "B" | "C" | "D" | "F" | "--";

/**
 * The grade of a 0–100 value with PlayerVox's thresholds, on the raw value
 * (89.6 is S, although it shows as 90); `--` for none or out of range. The
 * host grades the overall score itself; widgets grade the criteria.
 */
export function gradeOf(value: number | null): BadgeGrade {
  if (value === null || !Number.isFinite(value) || value < 0 || value > 100) {
    return "--";
  }
  if (value >= 90) return "S+";
  if (value >= 80) return "S";
  if (value >= 70) return "A";
  if (value >= 60) return "B";
  if (value >= 40) return "C";
  if (value >= 20) return "D";
  return "F";
}

/**
 * The grade colours of PlayerVox's site (its Tailwind palette in sRGB), in
 * both themes: the badge keeps its black face on a light panel too.
 */
export const GRADE_COLORS: Readonly<Record<BadgeGrade, Color>> = {
  "S+": "#9ae600",
  S: "#7ccf00",
  A: "#00d3f3",
  B: "#fdc700",
  C: "#fe9a00",
  D: "#e7000b",
  F: "#52525c",
  "--": "#52525c",
};

/** The style class of a grade's colour (`badge.ocss`): `grade-s-plus`… */
export function gradeClass(grade: BadgeGrade): string {
  return grade === "--" ? "grade-none" : `grade-${grade.toLowerCase().replace("+", "-plus")}`;
}

/**
 * Side of the badge canvas in logical px: the 56 px badge turned by 4°,
 * its 3 px border and the S+ glow, centred.
 */
export const BADGE_CANVAS = 76;

const BADGE_HALF = 28;
const BADGE_RADIUS = 12;
/** The letter's baseline below the centre: the capitals sit centred. */
const LETTER_BASELINE = 9;

/**
 * The neutral `--` badge per theme: a translucent face and a grey border
 * and text that keep their contrast on the panel. A graded badge keeps its
 * black face in both themes.
 */
const NEUTRAL: Readonly<Record<"dark" | "light", { face: Color; color: Color }>> = {
  dark: { face: "#27272a80", color: "#52525c" },
  light: { face: "#e4e4e780", color: "#71717a" },
};

/**
 * The badge of a grade: a rounded square with a black face and a border
 * of the grade's colour, turned by 4° with its letter (not `--`, which is
 * neutral and square), and a faint static glow for S+.
 */
export function badgeCommands(grade: BadgeGrade, theme: "dark" | "light"): DrawCommand[] {
  const neutral = grade === "--" ? NEUTRAL[theme] : null;
  const color = neutral?.color ?? GRADE_COLORS[grade];
  const centre = BADGE_CANVAS / 2;
  const square = (): DrawCommand => [
    "rect",
    -BADGE_HALF,
    -BADGE_HALF,
    BADGE_HALF * 2,
    BADGE_HALF * 2,
    BADGE_RADIUS,
  ];
  const commands: DrawCommand[] = [
    ["save"],
    ["translate", centre, centre],
    ["rotate", grade === "--" ? 0 : 4],
  ];
  if (grade === "S+") {
    // Eight widening rings of the accent at 2 % each: a soft halo.
    for (let ring = 8; ring >= 1; ring -= 1) {
      commands.push(square(), ["stroke", "#a3e63505", 3 + ring * 1.5]);
    }
  }
  commands.push(
    square(),
    ["fill", neutral?.face ?? "#000000"],
    square(),
    ["stroke", color, 3],
    ["text", 0, LETTER_BASELINE, grade, 26, color, "center", "display", "700"],
    ["restore"],
  );
  return commands;
}

/**
 * The badge's pulse class after `current` (`badge.ocss`): it alternates, so
 * that each new score restarts the host's animation.
 */
export function nextPulse(current: string): "pulse-a" | "pulse-b" {
  return current === "pulse-a" ? "pulse-b" : "pulse-a";
}

/** The accessible name of a badge: "Grade S+, 94/100". */
export function badgeLabel(grade: BadgeGrade, score: number | null, words: { grade: string; none: string }): string {
  if (grade === "--" || score === null) {
    return words.none;
  }
  return `${words.grade} ${grade}, ${roundHalfAway(score)}/100`;
}

/** Rounds half away from zero: 72.5 is 73 (parity sheet decision 6). */
export function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

// The PlayerVox mark: three rising bars, in unit coordinates of its box.
const MARK_BARS: readonly (readonly number[])[] = [
  [0.09403, 0.29375, 0.04806, 0.3068, 0.02098, 0.34, 0.01785, 0.38207, 0.01785, 0.42385, 0.01785, 0.46563, 0.01785, 0.50742, 0.01785, 0.5492, 0.01785, 0.59098, 0.01785, 0.63276, 0.01785, 0.67454, 0.01785, 0.71632, 0.01785, 0.75811, 0.01785, 0.79989, 0.01785, 0.84167, 0.01785, 0.88345, 0.01785, 0.92523, 0.01785, 0.96701, 0.04115, 0.96149, 0.07617, 0.93218, 0.11119, 0.90286, 0.14621, 0.87354, 0.18123, 0.84422, 0.21625, 0.8149, 0.25127, 0.78558, 0.28629, 0.75626, 0.31138, 0.72341, 0.31138, 0.68162, 0.31138, 0.63984, 0.31138, 0.59806, 0.31138, 0.55628, 0.31138, 0.5145, 0.31138, 0.47272, 0.31138, 0.43094, 0.31138, 0.38915, 0.30981, 0.34705, 0.28603, 0.31194, 0.24179, 0.29574, 0.19233, 0.29497, 0.14318, 0.29436],
  [0.43235, 0.1525, 0.38372, 0.16747, 0.35807, 0.20475, 0.35676, 0.24975, 0.35676, 0.29442, 0.35676, 0.33908, 0.35676, 0.38375, 0.35676, 0.42842, 0.35676, 0.47308, 0.35676, 0.51775, 0.35676, 0.56242, 0.35676, 0.60708, 0.35676, 0.65175, 0.35676, 0.69642, 0.3648, 0.73425, 0.41735, 0.73425, 0.4699, 0.73425, 0.52245, 0.73425, 0.575, 0.73425, 0.62755, 0.73425, 0.65059, 0.70917, 0.65059, 0.6645, 0.65059, 0.61983, 0.65059, 0.57517, 0.65059, 0.5305, 0.65059, 0.48583, 0.65059, 0.44117, 0.65059, 0.3965, 0.65059, 0.35183, 0.65059, 0.30717, 0.65059, 0.2625, 0.65059, 0.21783, 0.63377, 0.17623, 0.59039, 0.15382, 0.53745, 0.1525, 0.4849, 0.1525],
  [0.76765, 0.01375, 0.71253, 0.03393, 0.69206, 0.08189, 0.69206, 0.13433, 0.69206, 0.18678, 0.69206, 0.23922, 0.69206, 0.29167, 0.69206, 0.34411, 0.69206, 0.39656, 0.69206, 0.449, 0.69206, 0.50144, 0.69206, 0.55389, 0.69206, 0.60633, 0.69206, 0.65878, 0.69206, 0.71122, 0.7252, 0.7355, 0.7869, 0.7355, 0.84859, 0.7355, 0.91029, 0.7355, 0.97199, 0.7355, 0.98588, 0.69486, 0.98588, 0.64242, 0.98588, 0.58997, 0.98588, 0.53753, 0.98588, 0.48508, 0.98588, 0.43264, 0.98588, 0.38019, 0.98588, 0.32775, 0.98588, 0.27531, 0.98588, 0.22286, 0.98588, 0.17042, 0.98588, 0.11797, 0.98438, 0.06513, 0.95084, 0.02369, 0.89105, 0.01375, 0.82935, 0.01375],
];

/**
 * The PlayerVox mark, `height` px tall and 0.85 as wide, filled with
 * `color` and centred in a canvas `canvasWidth` px wide: give the canvas a
 * whole number of pixels, so that its texture is never resampled.
 */
export function markCommands(canvasWidth: number, height: number, color: Color): DrawCommand[] {
  const width = height * 0.85;
  const left = (canvasWidth - width) / 2;
  const commands: DrawCommand[] = [];
  for (const bar of MARK_BARS) {
    for (let index = 0; index + 1 < bar.length; index += 2) {
      const x = left + (bar[index] ?? 0) * width;
      const y = (bar[index + 1] ?? 0) * height;
      commands.push(index === 0 ? ["moveTo", x, y] : ["lineTo", x, y]);
    }
    commands.push(["close"], ["fill", color]);
  }
  return commands;
}
// </shared:playervox-badge/badge.ts>

const canRead = hasGrant("playervox.reviews.read");

const state = initState({
  phase: (canRead ? "loading" : "failed") as Phase,
  page: null as ReviewsPage | null,
  followedOnly: option("followed-only", false),
  reading: {} as Record<string, Reading>,
  problem: canRead ? "" : "no-permission",
  offline: false,
  busy: false,
  interactive: host.mode === "interactive",
});

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

/** The game's name, when PlayerVox gave one. */
export function gameName(page: ReviewsPage | null): string {
  return page === null ? "" : oneLine(page.gameName);
}

/**
 * A review's date in the local time it carries and the user's date order
 * ("09/20/2026", FR "20/09/2026"); an em dash for a timestamp outside the
 * calendar.
 */
export function dateText(review: Review): string {
  if (!Number.isFinite(review.publishedAt) || review.publishedAt < 0) {
    return "—";
  }
  return formatDate(review.publishedAt, { offsetMinutes: review.offsetMinutes });
}

/** A translated review carries its untranslated text. */
export function isTranslated(review: Review): boolean {
  return review.original !== null && review.original.trim() !== "";
}

/** The text a reading shows: the translation, or the original on request. */
export function shownText(review: Review, reading: Reading): string {
  const text = reading.original && isTranslated(review) ? review.original : review.text;
  return (text ?? "").trim();
}

/** Whether `text` folds: longer than three lines of the narrowest panel. */
export function folds(text: string): boolean {
  let characters = 0;
  let lines = 1;
  for (const character of text) {
    characters += 1;
    if (character === "\n") {
      lines += 1;
    }
    if (characters > FOLD_CHARACTERS || lines > 3) {
      return true;
    }
  }
  return false;
}

/**
 * The start of a folded review: `text` within `FOLDED_CHARACTERS`, with an
 * ellipsis when it was cut (the host adds its own where the third line
 * ends).
 */
export function foldedText(text: string): string {
  let characters = 0;
  let end = 0;
  for (const character of text) {
    if (characters === FOLDED_CHARACTERS) {
      return `${text.slice(0, graphemeStart(text, end))}…`;
    }
    characters += 1;
    end += character.length;
  }
  return text;
}

/** What continues the character before it: a combining mark, a variation selector, a joiner, a skin tone, a tag. */
const CONTINUES = /^[\p{M}\u200d\ufe00-\ufe0f\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
/** The two letters of a flag. */
const FLAG_LETTER = /^[\u{1f1e6}-\u{1f1ff}]/u;

/**
 * The cut at or before `end` (an index between two characters of `text`)
 * that leaves every grapheme whole: an accented letter keeps its
 * combining accent, an emoji sequence its joined parts and a flag its two
 * letters.
 */
export function graphemeStart(text: string, end: number): number {
  let cut = end;
  while (cut > 0 && insideGrapheme(text, cut)) {
    cut = before(text, cut);
  }
  return cut;
}

/** The index of the character that ends at `index`. */
function before(text: string, index: number): number {
  const low = text.charCodeAt(index - 1);
  const high = index > 1 ? text.charCodeAt(index - 2) : 0;
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? index - 2 : index - 1;
}

function insideGrapheme(text: string, index: number): boolean {
  const next = text.slice(index, index + 2);
  if (next === "") {
    return false;
  }
  if (CONTINUES.test(next) || text.charCodeAt(index - 1) === 0x200d) {
    return true;
  }
  if (!FLAG_LETTER.test(next)) {
    return false;
  }
  // Flag letters pair up from the first of their run: a cut after an odd
  // number of them falls inside a flag.
  let letters = 0;
  for (let at = index; at > 0; at = before(text, at)) {
    if (!FLAG_LETTER.test(text.slice(before(text, at), at))) {
      break;
    }
    letters += 1;
  }
  return letters % 2 === 1;
}

const UNREAD: Reading = { expanded: false, original: false, revealed: false };

/** One review as the view lays it out; every member is ready to show. */
export interface Row {
  id: string;
  author: string;
  /** The whole name, for a name the panel cuts. */
  authorTip: string;
  date: string;
  score: string;
  /** Accessible name of the badge: "Grade A, 74/100". */
  badge: string;
  /** Accessible name of the review: its author, date and score. */
  label: string;
  /** Hidden by the community and not revealed: no text. */
  masked: boolean;
  /** The text shown, cut short while folded; `""` for a review without text. */
  text: string;
  /** Style classes of the text: folded to three lines or whole. */
  textClass: string;
  /** "Read more" or "Show less" shows, with this label; `""` for none. */
  fold: string;
  /** The "Translated" mark shows: a translation is the text shown. */
  translated: boolean;
  /** "Show original" or "Show translation"; `""` for none. */
  language: string;
  /** The row of small buttons shows. */
  actions: boolean;
}

const NO_ROW: Row = {
  id: "",
  author: "",
  authorTip: "",
  date: "",
  score: "",
  badge: "",
  label: "",
  masked: false,
  text: "",
  textClass: "body",
  fold: "",
  translated: false,
  language: "",
  actions: false,
};

/** Whether the page shown has a review at `index`. */
export function has(page: ReviewsPage | null, index: number): boolean {
  return page !== null && index < Math.min(page.items.length, PAGE_SIZE);
}

/**
 * The review at `index` of the page shown. The buttons show in Interactive
 * mode only; in Passive mode a translation keeps its "Translated" mark.
 */
export function row(
  page: ReviewsPage | null,
  reading: Record<string, Reading>,
  interactive: boolean,
  index: number,
): Row {
  const review = has(page, index) ? page?.items[index] : undefined;
  if (review === undefined) {
    return NO_ROW;
  }
  const choice = reading[review.id] ?? UNREAD;
  const author = oneLine(review.author);
  const date = dateText(review);
  const score = String(roundHalfAway(review.score));
  const masked = review.hidden && !choice.revealed;
  const text = masked ? "" : shownText(review, choice);
  const long = folds(text);
  const translated = !masked && text !== "" && isTranslated(review);
  const fold = interactive && long ? t(choice.expanded ? "less" : "more") : "";
  const language = interactive && translated ? t(choice.original ? "translation" : "original") : "";
  return {
    id: review.id,
    author,
    authorTip: cutBytes(author, MAX_LABEL_BYTES),
    date,
    score,
    badge: badgeLabel(review.grade, review.score, { grade: t("grade"), none: t("no-grade") }),
    label: cutBytes(t("review", { author, date, score }), MAX_LABEL_BYTES),
    masked,
    text: long && !choice.expanded ? foldedText(text) : text,
    textClass: long && !choice.expanded ? "body folded" : "body",
    fold,
    translated: translated && !choice.original,
    language,
    actions: fold !== "" || language !== "",
  };
}

/** "1 review", "1,284 reviews" in the user's number format. */
export function countText(page: ReviewsPage): string {
  const count = Math.max(0, Math.floor(page.count));
  return t(count === 1 ? "count-one" : "count-other", {
    count: formatNumber(count, { maximumFractionDigits: 0 }),
  });
}

/** "2 / 3". */
export function pagerText(page: ReviewsPage): string {
  return t("pager", pageNumbers(page));
}

/** Accessible name of the pager: "Page 2 of 3". */
export function pagerLabel(page: ReviewsPage): string {
  return t("page-of", pageNumbers(page));
}

function pageNumbers(page: ReviewsPage): { page: string; total: string } {
  const total = Math.max(1, Math.floor(page.totalPages));
  return {
    page: String(Math.min(total, Math.max(1, Math.floor(page.page)))),
    total: String(total),
  };
}

/** The text shown without reviews: which list is empty. */
export function emptyText(followedOnly: boolean): string {
  return t(followedOnly ? "empty-followed" : "empty");
}

/** The paging buttons act with PlayerVox reachable and no read in flight. */
export function canTurn(
  page: ReviewsPage | null,
  direction: "previous" | "next",
  busy: boolean,
  offline: boolean,
): boolean {
  if (page === null || busy || offline) {
    return false;
  }
  return direction === "previous" ? page.page > 1 : page.page < page.totalPages;
}

/** The message key of a failed read. */
export function readProblem(code: string): string {
  switch (code) {
    case "not_connected":
      return "read-expired";
    case "busy":
      return "read-busy";
    default:
      return "read-failed";
  }
}

/** The line above the reviews: the last failed read; `""` for none. */
export function message(problem: string): string {
  return problem === "" ? "" : t(problem);
}

/** Number of the page shown, or to show; the first page after a reset. */
let pageNumber = 1;
/** The reviews revision the page shown was read for. */
let revision: number | null = null;
/** The revision changed while nothing could be read (offline). */
let stale = false;
let reading = false;
/** The reviews changed during a read: read once more after it. */
let again = false;
let rereads = 0;
let reread: Timer | null = null;
/** Bumped when the page to show changes: a read answered after it is dropped. */
let epoch = 0;

/** The badges of the page shown, one canvas per review. */
function drawBadges(): void {
  for (let index = 0; index < PAGE_SIZE; index += 1) {
    const review = state.page?.items[index];
    draw(
      `badge-${index}`,
      review === undefined ? [] : smallBadge(review.grade, host.theme),
    );
  }
}

/** Side of a review's badge canvas: the shared badge at 42 %. */
export const SMALL_BADGE = 32;

/** The shared badge scaled to a `SMALL_BADGE` canvas, centred. */
export function smallBadge(grade: BadgeGrade, theme: "dark" | "light"): DrawCommand[] {
  const scale = SMALL_BADGE / BADGE_CANVAS;
  return [["save"], ["scale", scale, scale], ...badgeCommands(grade, theme), ["restore"]];
}

/**
 * Keeps the reading choices of the reviews still on the page; another
 * page or filter starts unread.
 */
function show(page: ReviewsPage, same: boolean): void {
  const kept: Record<string, Reading> = {};
  if (same) {
    for (const review of page.items) {
      const choice = state.reading[review.id];
      if (choice !== undefined) {
        kept[review.id] = choice;
      }
    }
  }
  state.reading = kept;
  state.page = page;
  state.phase = "ready";
  drawBadges();
}

/** Reads page `number` with the widget's filter and shows it. */
function read(number: number): void {
  if (reading) {
    again = true;
    return;
  }
  reread?.cancel();
  reread = null;
  reading = true;
  state.busy = true;
  const started = epoch;
  const followedOnly = option("followed-only", false);
  playervox.reviews.page({ page: number, followedOnly }).then(
    (page) => {
      // The game, the filter or the language changed meanwhile: this
      // answer is no longer the widget's, and another read may be running.
      if (started !== epoch) {
        return;
      }
      reading = false;
      rereads = 0;
      const same =
        state.page !== null && state.followedOnly === followedOnly && state.page.page === page.page;
      // PlayerVox answers its last page for a page that no longer exists.
      pageNumber = Math.max(1, Math.floor(page.page));
      state.followedOnly = followedOnly;
      state.problem = "";
      show(page, same);
      finish();
    },
    (error: ServiceError) => {
      if (started !== epoch) {
        return;
      }
      reading = false;
      failed(error.code, number);
      finish();
    },
  );
}

function finish(): void {
  state.busy = reading;
  if (again) {
    again = false;
    read(pageNumber);
  }
}

function failed(code: string, number: number): void {
  if ((code === "busy" || code === "stale_context") && rereads < MAX_REREADS) {
    // The host was busy, or the game or account changed under the read:
    // ask again shortly, from the first page after a change.
    rereads += 1;
    const next = code === "busy" ? number : 1;
    reread = timers.after(REREAD_MS, () => {
      reread = null;
      read(next);
    });
    return;
  }
  // The page shown stays; the next change of the reviews reads again.
  state.problem = readProblem(code);
  if (state.page === null) {
    state.phase = "failed";
  }
}

/** Shows the previous or next page; one request at a time. */
export function turn(direction: "previous" | "next"): void {
  if (!state.interactive || !canTurn(state.page, direction, state.busy, state.offline)) {
    return;
  }
  state.problem = "";
  rereads = 0;
  read((state.page?.page ?? 1) + (direction === "next" ? 1 : -1));
}

function choose(id: string, change: Partial<Reading>): void {
  if (!state.interactive || id === "") {
    return;
  }
  state.reading = { ...state.reading, [id]: { ...(state.reading[id] ?? UNREAD), ...change } };
}

/** Unfolds or folds a long review. */
export function toggleFold(id: string): void {
  choose(id, { expanded: !(state.reading[id]?.expanded ?? false) });
}

/** Shows the untranslated text of a translated review, or its translation. */
export function toggleLanguage(id: string): void {
  choose(id, { original: !(state.reading[id]?.original ?? false) });
}

/** Shows a review the community hid. */
export function reveal(id: string): void {
  choose(id, { revealed: true });
}

/** Nothing of the last game, account or filter stays. */
function forget(): void {
  reread?.cancel();
  reread = null;
  epoch += 1;
  reading = false;
  again = false;
  rereads = 0;
  stale = false;
  pageNumber = 1;
  state.page = null;
  state.reading = {};
  state.busy = false;
  drawBadges();
}

function clear(phase: Phase, problem: string): void {
  forget();
  revision = null;
  state.problem = problem;
  state.phase = phase;
}

/**
 * The first page again, for another filter or language. Without reviews to
 * read (no game, no Steam app ID, no source, nothing published yet), there
 * is nothing to read again.
 */
function restart(): void {
  if (revision === null) {
    return;
  }
  forget();
  state.problem = "";
  state.phase = "loading";
  if (state.offline) {
    stale = true;
  } else {
    read(1);
  }
}

let subscription: Subscription | null = null;

function subscribe(): void {
  const current = playervox.reviews.subscribe((update) => {
    if (!update.ok) {
      // The subscription ended: the host's reviews source failed. Show it
      // and ask again later; hidden, the timer waits until the widget shows.
      if (subscription === current) {
        subscription = null;
        clear("failed", "source-failed");
        timers.after(RETRY_MS, subscribe);
      }
      return;
    }
    const value = update.value;
    state.offline = value.offline;
    if (value.state !== "ready") {
      clear(value.state === "idle" ? "idle" : "unsupported", "");
      return;
    }
    if (state.phase !== "ready" && state.phase !== "loading") {
      state.phase = "loading";
      state.problem = "";
    }
    // A new revision, or a page still missing after a failure: read the
    // page shown again. Offline nothing is read: the page shown stays
    // until PlayerVox is back.
    if (value.revision !== revision || state.page === null) {
      revision = value.revision;
      stale = true;
    }
    if (stale && !value.offline) {
      stale = false;
      rereads = 0;
      read(pageNumber);
    }
  });
  subscription = current;
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
  if (changed.includes("theme")) {
    // The neutral badge follows the theme; the mark's token does already.
    drawBadges();
  }
  // Another filter, or another language (the host reads the reviews in the
  // language of its interface): the first page, unread.
  if (
    (changed.includes("options") && option("followed-only", false) !== filter) ||
    (changed.includes("locale") && host.locale !== locale)
  ) {
    filter = option("followed-only", false);
    locale = host.locale;
    restart();
  }
});

let filter = option("followed-only", false);
let locale = host.locale;

draw("mark", markCommands(16, 18, "var(--color-text-muted)"));
// Without the grant the host would refuse the subscription: say so
// instead of asking.
if (canRead) {
  subscribe();
}
