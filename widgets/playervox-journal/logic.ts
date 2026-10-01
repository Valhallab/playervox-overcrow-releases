// PlayerVox Journal: the finished play sessions of the active game, newest
// first, five per page. OverCrow records the sessions, merges the local
// ones with the PlayerVox journal and owns the deletion's confirmation;
// the widget follows the journal's revision, reads its own page and lays
// it out.
import {
  draw,
  formatDate,
  formatTime,
  hasGrant,
  host,
  initState,
  journal,
  onHost,
  t,
  timers,
  type Color,
  type DrawCommand,
  type JournalPage,
  type JournalSession,
  type JournalState,
  type ServiceError,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

/** What the widget shows in place of, or above, the sessions. */
export type Phase = "loading" | "idle" | "ready" | "failed";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /**
     * `loading` until the first page, `idle` without an active game,
     * `ready` with a page, `failed` without one after a failure.
     */
    phase: Phase;
    /** The page shown; `null` until the first one. */
    page: JournalPage | null;
    /** The journal's own condition, from the host. */
    notice: JournalState["notice"];
    /** Message key of the last failed read or deletion; `""` for none. */
    problem: string;
    /** A read or a deletion is in flight: the controls wait. */
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

const canRead = hasGrant("journal.read");
const canDelete = hasGrant("journal.delete");

const state = initState({
  phase: (canRead ? "loading" : "failed") as Phase,
  page: null as JournalPage | null,
  notice: null as JournalState["notice"],
  problem: canRead ? "" : "no-permission",
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

/** The game's name, when the host has one. */
export function gameName(page: JournalPage | null): string {
  return page === null ? "" : oneLine(page.gameName);
}

/**
 * A session's start in the local time it carries: the date in the user's
 * order, then the 24-hour time ("09/20/2026 · 20:30", FR "20/09/2026 ·
 * 20:30"); `--` for a timestamp outside the calendar.
 */
export function startText(session: JournalSession): string {
  const options = { offsetMinutes: session.offsetMinutes };
  if (!Number.isFinite(session.startedAt) || session.startedAt < 0) {
    return "--";
  }
  return `${formatDate(session.startedAt, options)} · ${formatTime(session.startedAt, options)}`;
}

/** A duration as whole hours and minutes: 2700 s is "0 h 45 min". */
export function durationText(durationMs: number): string {
  const minutes = Math.floor(Math.max(0, Number.isFinite(durationMs) ? durationMs : 0) / 60_000);
  return t("duration", {
    hours: String(Math.floor(minutes / 60)),
    minutes: String(minutes % 60).padStart(2, "0"),
  });
}

/** One session row. */
export interface Row {
  id: string;
  start: string;
  duration: string;
  /** Accessible name: the start and the duration. */
  label: string;
}

export function rows(page: JournalPage | null): Row[] {
  return (page?.items ?? []).map((session) => {
    const start = startText(session);
    const duration = durationText(session.durationMs);
    return {
      id: session.id,
      start,
      duration,
      label: cutBytes(t("session", { date: start, duration }), MAX_LABEL_BYTES),
    };
  });
}

/** The message key of a journal condition. */
export function noticeKey(notice: JournalState["notice"]): string {
  switch (notice) {
    case null:
      return "";
    case "offline":
      return "notice-offline";
    case "storage_unavailable":
      return "notice-storage";
    case "full":
      return "notice-full";
    case "expired":
      return "notice-expired";
    case "busy":
      return "notice-busy";
    default:
      return "notice-unavailable";
  }
}

/**
 * The line above the sessions: the last failed action, else the journal's
 * condition; `""` for none. Without a page, a failed read shows the
 * journal's condition when the host gave one (it says why).
 */
export function message(problem: string, notice: JournalState["notice"]): string {
  if (problem === "read-failed" && notice !== null) {
    return t(noticeKey(notice));
  }
  const key = problem !== "" ? problem : noticeKey(notice);
  return key === "" ? "" : t(key);
}

/** The message key of a refused deletion. */
export function deleteProblem(code: string): string {
  switch (code) {
    case "not_connected":
      return "delete-not-connected";
    case "busy":
      return "notice-busy";
    case "quota_exceeded":
      return "notice-full";
    default:
      return "delete-failed";
  }
}

/** The trash buttons show in Interactive mode, with the grant. */
export function canRemove(interactive: boolean): boolean {
  return interactive && canDelete;
}

/** The footer shows as soon as the journal has more than one page. */
export function paged(page: JournalPage | null): boolean {
  return page !== null && (page.previous !== null || page.next !== null);
}

/** "Page 2", and on the last of several pages "Page 3 · End of the journal". */
export function pageLabel(page: JournalPage): string {
  const number = String(Math.max(1, Math.floor(page.page)));
  return t(page.next === null && page.previous !== null ? "page-end" : "page", { page: number });
}

/** Handle of the page shown; `undefined` for the first page. */
let cursor: string | undefined;
/** The journal revision the page shown was read for. */
let revision: number | null = null;
let reading = false;
let deleting = false;
/** The journal changed during a read: read once more after it. */
let again = false;
let rereads = 0;
let reread: Timer | null = null;
/** Bumped when the journal goes: a read answered after it is dropped. */
let epoch = 0;

function settle(): void {
  state.busy = reading || deleting;
}

/** Reads the page at `target` (the first page without one) and shows it. */
function read(target: string | undefined): void {
  if (reading) {
    again = true;
    return;
  }
  reread?.cancel();
  reread = null;
  reading = true;
  settle();
  const started = epoch;
  journal.page(target === undefined ? {} : { cursor: target }).then(
    (page) => {
      reading = false;
      if (started !== epoch) {
        finish();
        return;
      }
      rereads = 0;
      // The host answers the last page for a page that no longer exists:
      // back on the first one, the widget follows the first page again.
      cursor = page.previous === null ? undefined : target;
      state.page = page;
      state.phase = "ready";
      if (state.problem === "read-failed") {
        state.problem = "";
      }
      finish();
    },
    (error: ServiceError) => {
      reading = false;
      if (started === epoch) {
        failed(error.code, target);
      }
      finish();
    },
  );
}

function finish(): void {
  if (again) {
    again = false;
    read(cursor);
  }
  settle();
}

function failed(code: string, target: string | undefined): void {
  if (code === "invalid_request" && target !== undefined) {
    // The host no longer knows this handle: back to the first page.
    cursor = undefined;
    again = true;
    return;
  }
  if ((code === "busy" || code === "stale_context") && rereads < MAX_REREADS) {
    // The host was busy, or the game or account changed under the read:
    // ask again shortly, from the first page after a change.
    rereads += 1;
    const next = code === "busy" ? target : undefined;
    reread = timers.after(REREAD_MS, () => {
      reread = null;
      read(next);
    });
    return;
  }
  // The page shown stays; the next change of the journal reads again.
  state.problem = "read-failed";
  if (state.page === null) {
    state.phase = "failed";
  }
}

/** Shows the previous or next page; one request at a time. */
export function turn(direction: "previous" | "next"): void {
  const target = state.page?.[direction] ?? null;
  if (!state.interactive || state.busy || target === null) {
    return;
  }
  state.problem = "";
  read(target);
}

/**
 * Deletes a session. The host asks the user to confirm first: declined,
 * nothing changes; accepted, the journal's new revision shows the page
 * without it.
 */
export function remove(session: string): void {
  if (!canRemove(state.interactive) || state.busy) {
    return;
  }
  deleting = true;
  state.problem = "";
  settle();
  journal.delete({ session }).then(
    () => {
      deleting = false;
      read(cursor);
      settle();
    },
    (error: ServiceError) => {
      deleting = false;
      if (error.code !== "cancelled") {
        state.problem = deleteProblem(error.code);
      }
      settle();
    },
  );
}

/** Without a game there is no journal: nothing of the last game stays. */
function clear(phase: Phase, problem: string): void {
  reread?.cancel();
  reread = null;
  epoch += 1;
  again = false;
  rereads = 0;
  cursor = undefined;
  revision = null;
  state.page = null;
  state.notice = null;
  state.problem = problem;
  state.phase = phase;
}

let subscription: Subscription | null = null;

function subscribe(): void {
  const current = journal.subscribe((update) => {
    if (!update.ok) {
      // The subscription ended: the host's journal source failed. Show it
      // and ask again later; hidden, the timer waits until the widget shows.
      if (subscription === current) {
        subscription = null;
        clear("failed", "source-failed");
        timers.after(RETRY_MS, subscribe);
      }
      return;
    }
    const value = update.value;
    if (value === null) {
      clear("idle", "");
      return;
    }
    if (state.phase === "idle" || state.problem === "source-failed") {
      state.phase = "loading";
      state.problem = "";
    }
    state.notice = value.notice;
    // A new revision, or a page still missing after a failure: read the
    // page shown again (its handle stays valid).
    if (value.revision !== revision || state.page === null) {
      revision = value.revision;
      rereads = 0;
      read(cursor);
    }
  });
  subscription = current;
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
});

draw("mark", markCommands(16, 18, "var(--color-text-muted)"));
// Without the grant the host would refuse the subscription: say so
// instead of asking.
if (canRead) {
  subscribe();
}
