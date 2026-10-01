// PlayerVox Rating: the user's own PlayerVox rating of the active Steam
// game. OverCrow reads the rating and follows PlayerVox's live updates; in
// Interactive mode the widget shows a form whose three sliders and review
// belong to OverCrow: it fills them, keeps the draft, and sends their
// values itself when the user publishes. The logic only follows them.
import {
  draw,
  hasGrant,
  host,
  initState,
  onHost,
  playervox,
  t,
  timers,
  type Color,
  type DrawCommand,
  type RatingState,
  type ServiceErrorCode,
  type ServiceErrorPayload,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

/** The three criteria of a rating, in the form's order. */
export type CriterionKey = "gameplay" | "art" | "tech";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest rating state; `null` until the host's first answer. */
    rating: RatingState | null;
    /** The form's sliders as the host last reported them. */
    gameplay: number | null;
    art: number | null;
    tech: number | null;
    /** The form's review as the host last reported it. */
    review: string;
    /** Publications sent and not answered yet. */
    pending: number;
    /** The last publication was stored and nothing changed since. */
    saved: boolean;
    /** Message key of the last publication's failure, or `""`. */
    error: string;
    /** The form takes input only in Interactive mode. */
    interactive: boolean;
    /** The badge canvas's classes, with its pulse. */
    badgeClass: string;
  }
}

/**
 * After the host ends the subscription with a failure, the widget
 * subscribes again this much later.
 */
export const RETRY_MS = 5_000;

/**
 * OverCrow answers a publication within 30 s (`timeout` beyond). Should no
 * answer come at all, the button is given back after this long.
 */
export const ANSWER_MS = 40_000;

/** `label` bound (`MAX_LABEL_BYTES`). */
const MAX_LABEL_BYTES = 256;

// <shared:playervox-badge/badge.ts>
// The PlayerVox grade badge and mark, shared by the Score and Rating
// built-ins; the Journal draws the mark alone. scripts/sync-shared-widgets.mjs
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

const canRead = hasGrant("playervox.rating.read");
const canWrite = hasGrant("playervox.rating.write");

const state = initState({
  rating: null as RatingState | null,
  gameplay: null as number | null,
  art: null as number | null,
  tech: null as number | null,
  review: "",
  pending: 0,
  saved: false,
  error: "",
  interactive: host.mode === "interactive",
  badgeClass: "badge",
});

/** What the view reads of the state. */
export interface View {
  rating: RatingState | null;
  gameplay: number | null;
  art: number | null;
  tech: number | null;
  review: string;
  pending: number;
  saved: boolean;
  error: string;
  interactive: boolean;
}

/** The rating is known: the game's name, the grade and the form show. */
export function ready(rating: RatingState | null): boolean {
  return rating !== null && rating.state === "ready";
}

/** The published rating of a ready state, or `null` before the first. */
function published(rating: RatingState | null): RatingState["rating"] {
  return rating !== null && rating.state === "ready" ? rating.rating : null;
}

/** The mean of three criteria, or `null` while one is unknown. */
export function mean(gameplay: number | null, art: number | null, tech: number | null): number | null {
  if (gameplay === null || art === null || tech === null) {
    return null;
  }
  return (gameplay + art + tech) / 3;
}

/**
 * The form shows: Interactive mode, the write grant and a known rating.
 * In Passive mode it stays in the view, hidden, so that OverCrow keeps the
 * draft its controls hold.
 */
export function editing(view: View): boolean {
  return view.interactive && canWrite && ready(view.rating);
}

/** The controls take input: the form shows and PlayerVox is reachable. */
export function editable(view: View): boolean {
  return editing(view) && view.rating?.offline !== true;
}

/** The form differs from the published rating. */
export function dirty(view: View): boolean {
  const rating = published(view.rating);
  if (rating === null) {
    return false;
  }
  return (
    view.gameplay !== rating.gameplay ||
    view.art !== rating.art ||
    view.tech !== rating.tech ||
    view.review !== (rating.review ?? "")
  );
}

/**
 * The score beside the badge: the draft's mean while the form shows, the
 * published rating's otherwise; `null` without one.
 */
export function shownScore(view: View): number | null {
  if (editing(view)) {
    const draft = mean(view.gameplay, view.art, view.tech);
    if (draft !== null) {
      return draft;
    }
  }
  const rating = published(view.rating);
  return rating === null ? null : mean(rating.gameplay, rating.art, rating.tech);
}

/** The rounded score, "--" without one: 92.67 shows "93". */
export function scoreText(view: View): string {
  const score = shownScore(view);
  return score === null ? "--" : String(roundHalfAway(score));
}

/** Message key under the score. */
export function caption(view: View): string {
  const rating = published(view.rating);
  if (editing(view) && (rating === null || dirty(view))) {
    return "draft";
  }
  return rating === null ? "unrated" : "published";
}

/** Message keys of a state without a rating: a label and a hint. */
export interface Status {
  label: string;
  hint: string;
}

export function status(rating: RatingState | null): Status {
  if (!canRead) {
    return { label: "unavailable", hint: "no-permission" };
  }
  switch (rating === null ? "loading" : rating.state) {
    case "idle":
      return { label: "waiting", hint: "" };
    case "unsupported":
      return { label: "unsupported", hint: "steam-required" };
    case "unavailable":
      return { label: "unavailable", hint: "retrying" };
    default:
      return { label: "loading", hint: "" };
  }
}

/** Provider text on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** The game's name on PlayerVox, or `""`. */
export function gameName(rating: RatingState | null): string {
  return rating !== null && rating.name !== null ? oneLine(rating.name) : "";
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

/** The badge's accessible name: "Grade S+, 93/100", or "No grade". */
export function badgeName(view: View): string {
  const score = shownScore(view);
  return cutBytes(
    badgeLabel(gradeOf(score), score, { grade: t("grade"), none: t("no-grade") }),
    MAX_LABEL_BYTES,
  );
}

/** A slider's value as text, "--" before OverCrow filled it. */
export function valueText(value: number | null): string {
  return value === null ? "--" : String(value);
}

export function rootClass(view: View): string {
  return view.rating?.offline === true ? "rating offline" : "rating";
}

export function formClass(view: View): string {
  return editing(view) ? "form" : "form hidden";
}

/**
 * The button is active when PlayerVox is reachable, nothing is being sent,
 * and there is something to publish: a first rating, or a change.
 */
export function canPublish(view: View): boolean {
  return editable(view) && view.pending === 0 && (published(view.rating) === null || dirty(view));
}

/** Message key of the button. */
export function buttonLabel(view: View): string {
  if (view.pending > 0) {
    return "saving";
  }
  if (view.saved && !dirty(view)) {
    return "saved";
  }
  return published(view.rating) === null ? "publish" : "update";
}

/** Message key of a refused publication. */
export function errorKey(code: ServiceErrorCode | null): string {
  switch (code) {
    case "invalid_request":
      return "error-invalid";
    case "not_connected":
      return "error-expired";
    case "busy":
      return "error-busy";
    case "stale_context":
      return "error-stale";
    case "permission_denied":
      return "error-forbidden";
    default:
      // `unavailable`, `timeout`, `gesture_required` and the rest.
      return "error-unavailable";
  }
}

/** What the badge shows: redrawn when its grade or the theme changes. */
let drawn = "";
/** The published score shown: a pulse starts when it changes. */
let pulsed = "";

/** Draws the badge of the shown score and pulses it for a new published one. */
function showBadge(): void {
  const grade = gradeOf(shownScore(state));
  const key = `${grade}:${host.theme}`;
  if (key !== drawn) {
    draw("badge", badgeCommands(grade, host.theme));
    drawn = key;
  }
  const rating = published(state.rating);
  const score = rating === null ? null : mean(rating.gameplay, rating.art, rating.tech);
  const shown = score === null ? "" : `${gradeOf(score)}:${roundHalfAway(score)}`;
  if (shown !== "" && shown !== pulsed) {
    const current = state.badgeClass.split(" ")[1] ?? "";
    state.badgeClass = `badge ${nextPulse(current)}`;
  }
  pulsed = shown;
}

/** A value of the form changed: it is no longer the saved one. */
function edited(): void {
  if (dirty(state)) {
    state.saved = false;
  }
  showBadge();
}

/**
 * A slider's value, from the user's drag or from OverCrow filling the
 * form (the published rating, 50 before the first one).
 */
export function scored(key: CriterionKey, value: number): void {
  state[key] = value;
  edited();
}

/** The review's text, from the user's typing or from OverCrow's fill. */
export function reviewed(text: string): void {
  state.review = text;
  edited();
}

let answer: Timer | null = null;

/** OverCrow is sending the form: the button waits for the outcome. */
function sending(): void {
  state.pending += 1;
  state.error = "";
  state.saved = false;
  answer?.cancel();
  answer = timers.after(ANSWER_MS, () => {
    answer = null;
    if (state.pending > 0) {
      state.pending = 0;
      state.error = "error-unavailable";
    }
  });
}

/** The publish button: OverCrow submits the form on the same gesture. */
export function publishing(): void {
  sending();
}

/** Ctrl+Enter in the review submits the form too. */
export function keyed(key: string, ctrl: boolean): void {
  if (key === "Enter" && ctrl) {
    sending();
  }
}

/**
 * The outcome of a publication OverCrow sent: the form's `submit` event,
 * with the failure's code when it was rejected.
 */
export function submitted(outcome: string, error: ServiceErrorPayload | undefined): void {
  state.pending = Math.max(0, state.pending - 1);
  if (state.pending === 0) {
    answer?.cancel();
    answer = null;
  }
  if (outcome === "accepted") {
    // The subscription sends the stored rating; nothing is read again.
    state.saved = true;
    state.error = "";
  } else if (outcome !== "cancelled") {
    state.error = errorKey(error?.code ?? null);
  }
}

/** The state shown once the host's source failed. */
const UNAVAILABLE: RatingState = { state: "unavailable", name: null, offline: false, rating: null };

let subscription: Subscription | null = null;

function show(rating: RatingState): void {
  const before = state.rating;
  if (before !== null && (before.state !== rating.state || before.name !== rating.name)) {
    // Another game, or the rating left: the last outcome is not its.
    state.saved = false;
    state.error = "";
  }
  state.rating = rating;
  showBadge();
}

function subscribe(): void {
  const current = playervox.rating.subscribe((update) => {
    if (update.ok) {
      show(update.value);
      return;
    }
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      show(UNAVAILABLE);
      timers.after(RETRY_MS, subscribe);
    }
  });
  subscription = current;
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
  if (changed.includes("mode") || changed.includes("theme")) {
    // The draft's score shows only with the form; the neutral badge
    // follows the theme, the mark's token does already.
    showBadge();
  }
});

draw("mark", markCommands(16, 18, "var(--color-text-muted)"));
showBadge();
// Without the grant the host would refuse the subscription: say so instead
// of asking.
if (canRead) {
  subscribe();
}
