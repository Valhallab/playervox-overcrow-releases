// PlayerVox Score: the public PlayerVox community grade of the active Steam
// game. OverCrow fetches the score and follows PlayerVox's live updates (no
// account needed) and grades it; the widget lays it out, draws the badge
// and asks the host for one pulse when a new score shows.
import {
  draw,
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
  type Score,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The latest score; `null` until the host's first answer. */
    score: Score | null;
    showScore: boolean;
    showCriteria: boolean;
    showTitle: boolean;
    showVotes: boolean;
    /** The badge canvas's classes, with its pulse. */
    badgeClass: string;
  }
}

/**
 * After the host ends the subscription with a failure, the widget
 * subscribes again this much later.
 */
export const RETRY_MS = 5_000;

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

const canRead = hasGrant("playervox.score.read");

/** The score shown without the grant, or once the host's source failed. */
const UNAVAILABLE: Score = {
  state: "unavailable",
  name: null,
  score: null,
  grade: "--",
  ratingsCount: 0,
  criteria: { gameplay: null, art: null, tech: null },
};

const state = initState({
  score: canRead ? null : UNAVAILABLE,
  showScore: option("show-score", true),
  showCriteria: option("show-criteria", false),
  showTitle: option("show-title", true),
  showVotes: option("show-votes", true),
  badgeClass: "badge",
});

interface Display {
  showScore: boolean;
  showCriteria: boolean;
  showTitle: boolean;
  showVotes: boolean;
}

/** Every option off: the badge alone, which always stays. */
export function badgeOnly(display: Display): boolean {
  return !display.showScore && !display.showCriteria && !display.showTitle && !display.showVotes;
}

export function rootClass(display: Display): string {
  if (badgeOnly(display)) {
    return "score badge-only";
  }
  return display.showCriteria ? "score with-criteria" : "score";
}

/** The score beside the badge, or the badge centred alone. */
export function hasSide(display: Display): boolean {
  return display.showScore || display.showVotes;
}

export function mainClass(display: Display): string {
  return hasSide(display) ? "main" : "main centred";
}

/** A rated game: the score and its count show instead of a status. */
export function rated(score: Score | null): boolean {
  return score !== null && score.state === "ready" && score.score !== null;
}

/** The game's name once PlayerVox answered, else "Community rating". */
export function title(score: Score | null): string {
  if (score !== null && score.name !== null && score.name.trim() !== "") {
    return oneLine(score.name);
  }
  return t("community");
}

/** Provider text on one line. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** The rounded score: 89.6 shows "90" (its grade stays S). */
export function scoreText(score: Score | null): string {
  return score === null || score.score === null ? "--" : String(roundHalfAway(score.score));
}

/** "1,284 ratings", singular only for exactly one. */
export function votes(score: Score | null): string {
  const count = score === null ? 0 : score.ratingsCount;
  return t(count === 1 ? "votes-one" : "votes-other", {
    count: formatNumber(count, { maximumFractionDigits: 0 }),
  });
}

/** The count's row: under the score, or level with its middle without. */
export function votesClass(showScore: boolean): string {
  return showScore ? "votes" : "votes alone";
}

/** Message keys of a state that shows no score: a label and a hint. */
export interface Status {
  label: string;
  hint: string;
}

export function status(score: Score | null): Status {
  switch (score === null ? "loading" : score.state) {
    case "idle":
      return { label: "waiting", hint: "" };
    case "unsupported":
      return { label: "unsupported", hint: "steam-required" };
    case "loading":
      return { label: "loading", hint: "" };
    case "not_found":
      return { label: "not-found", hint: "on-playervox" };
    case "unavailable":
      return { label: "unavailable", hint: "retrying" };
    default:
      // `no_ratings`, or `ready` without a score.
      return { label: "unrated", hint: "no-votes" };
  }
}

/** Hover text: the game's name once known, else the status. */
export function tooltip(score: Score | null): string {
  const text = rated(score) || score?.state === "no_ratings" ? title(score) : t(status(score).label);
  return cutBytes(text, MAX_LABEL_BYTES);
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

/** The badge's accessible name: "Grade S+, 94/100", or "No grade". */
export function badgeName(score: Score | null): string {
  return cutBytes(
    badgeLabel(score?.grade ?? "--", score?.score ?? null, { grade: t("grade"), none: t("no-grade") }),
    MAX_LABEL_BYTES,
  );
}

/** One criterion row. */
export interface Criterion {
  key: "gameplay" | "art" | "tech";
  name: string;
  /** Rounded value, or "--" when PlayerVox has none. */
  text: string;
  /** Bar value: 0 without one (an empty track). */
  value: number;
  /** The bar's classes, coloured with the value's own grade. */
  bar: string;
  label: string;
}

export function criteria(score: Score | null): Criterion[] {
  const values = score === null ? UNAVAILABLE.criteria : score.criteria;
  return (["gameplay", "art", "tech"] as const).map((key) => {
    const value = values[key];
    const name = t(key);
    const text = value === null ? "--" : String(roundHalfAway(value));
    return {
      key,
      name,
      text,
      value: value ?? 0,
      bar: `bar ${gradeClass(gradeOf(value))}`,
      label: t("criterion", { name, value: text }),
    };
  });
}

/** What the badge shows: a pulse starts when this changes to a score. */
let shown = "";

/** Draws the badge of `score` and pulses it for a new score. */
function showBadge(score: Score | null): void {
  const grade = score?.grade ?? "--";
  draw("badge", badgeCommands(grade, host.theme));
  const key = rated(score) && grade !== "--" ? `${grade}:${scoreText(score)}` : "";
  if (key !== "" && key !== shown) {
    const current = state.badgeClass.split(" ")[1] ?? "";
    state.badgeClass = `badge ${nextPulse(current)}`;
  }
  shown = key;
}

let subscription: Subscription | null = null;
let retry: Timer | null = null;

function subscribe(): void {
  retry = null;
  const current = playervox.score.subscribe((update) => {
    if (update.ok) {
      state.score = update.value;
      showBadge(update.value);
      return;
    }
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.score = UNAVAILABLE;
      showBadge(UNAVAILABLE);
      retry = timers.after(RETRY_MS, subscribe);
    }
  });
  subscription = current;
}

onHost((changed) => {
  if (changed.includes("theme")) {
    // The neutral badge follows the theme; the mark's token does already.
    draw("badge", badgeCommands(state.score?.grade ?? "--", host.theme));
  }
  if (changed.includes("options")) {
    state.showScore = option("show-score", true);
    state.showCriteria = option("show-criteria", false);
    state.showTitle = option("show-title", true);
    state.showVotes = option("show-votes", true);
  }
});

draw("mark", markCommands(16, 18, "var(--color-text-muted)"));
showBadge(state.score);
// Without the grant the host would refuse the subscription: show the score
// as unavailable instead of asking.
if (canRead) {
  subscribe();
}
