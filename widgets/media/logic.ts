// Media: the track a desktop player is playing, its cover and, in
// Interactive mode, the player's previous / play-pause / next buttons. The
// host picks the player (MPRIS on Linux, the system's current session on
// Windows), decodes the cover into an `asset:` handle and scrolls an
// overflowing title (`text-overflow: marquee`): the widget only lays out.
import {
  hasGrant,
  host,
  initState,
  media,
  onHost,
  option,
  t,
  timers,
  type Media,
  type Subscription,
  type Timer,
} from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    /** The current player, or `null` without one. */
    media: Media | null;
    /** The host's media source failed; it retries on the next subscription. */
    unavailable: boolean;
    /** The buttons take input only in Interactive mode. */
    interactive: boolean;
    showCover: boolean;
    scrollTitle: boolean;
  }
}

/**
 * After the host ends the subscription with a failure (its media source
 * failed), the widget subscribes again this much later; the host restarts
 * its source for the new subscription.
 */
export const RETRY_MS = 5_000;

const canRead = hasGrant("media.read");
const canControl = hasGrant("media.control");

const state = initState({
  media: null as Media | null,
  unavailable: false,
  interactive: host.mode === "interactive",
  showCover: option("show-cover", true),
  scrollTitle: option("scroll-title", true),
});

/** Provider text on one line: line breaks never make a second row. */
export function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** The title, or "Unknown title" without one. */
export function title(current: Media): string {
  const text = current.title === null ? "" : oneLine(current.title);
  return text === "" ? t("unknown-title") : text;
}

/** The artists on one line, or nothing: the row is then left out. */
export function artists(current: Media): string {
  return current.artists
    .map(oneLine)
    .filter((artist) => artist !== "")
    .join(", ");
}

/**
 * The cover's size class: as tall as the title and artist rows, or as one
 * row without artists or without a player (the placeholder).
 */
export function coverClass(current: Media | null, cover: string | null): string {
  const size = current !== null && artists(current) !== "" ? "cover tall" : "cover short";
  return cover === null ? `${size} placeholder` : size;
}

/** The title scrolls when it overflows, or ends with an ellipsis. */
export function titleClass(scroll: boolean): string {
  return scroll ? "title scrolling" : "title";
}

export function rootClass(showCover: boolean): string {
  return showCover ? "media with-cover" : "media";
}

/** One transport button. */
export interface Control {
  key: "previous" | "play-pause" | "next";
  icon: string;
  label: string;
}

/**
 * The buttons the player supports, in the order previous, play/pause,
 * next: an unsupported action has no button. None in Passive mode or
 * without the control grant.
 */
export function controls(current: Media | null, interactive: boolean): Control[] {
  if (!interactive || !canControl || current === null) {
    return [];
  }
  const list: Control[] = [];
  if (current.canPrevious) {
    list.push({ key: "previous", icon: "skip-back", label: t("previous") });
  }
  if (current.canPlayPause) {
    list.push(
      current.playing
        ? { key: "play-pause", icon: "pause", label: t("pause") }
        : { key: "play-pause", icon: "play", label: t("play") },
    );
  }
  if (current.canNext) {
    list.push({ key: "next", icon: "skip-forward", label: t("next") });
  }
  return list;
}

/**
 * Sends a button's action to the player shown. The host refuses it with
 * `stale_context` when another player replaced it meanwhile and with
 * `unsupported` when the player no longer offers the action; the next
 * update shows the player's state either way, so a failure shows nothing.
 */
export function activate(key: Control["key"]): void {
  const current = state.media;
  if (current === null) {
    return;
  }
  const params = { player: current.player };
  const call =
    key === "previous" ? media.previous(params) : key === "next" ? media.next(params) : media.playPause(params);
  call.catch(() => {});
}

let subscription: Subscription | null = null;
let retry: Timer | null = null;

function subscribe(): void {
  retry = null;
  const current = media.subscribe({ cover: state.showCover }, (update) => {
    if (update.ok) {
      state.media = update.value;
      state.unavailable = false;
      return;
    }
    // The subscription ended: the host's source failed. Show it and ask
    // again later; hidden, the timer waits until the widget shows.
    if (subscription === current) {
      subscription = null;
      state.media = null;
      state.unavailable = true;
      retry = timers.after(RETRY_MS, subscribe);
    }
  });
  subscription = current;
}

/** Subscribes again, for the cover option; the host sends the value at once. */
function resubscribe(): void {
  retry?.cancel();
  retry = null;
  subscription?.cancel();
  subscription = null;
  subscribe();
}

onHost((changed) => {
  if (changed.includes("mode")) {
    state.interactive = host.mode === "interactive";
  }
  if (changed.includes("options")) {
    state.scrollTitle = option("scroll-title", true);
    const showCover = option("show-cover", true);
    if (showCover !== state.showCover) {
      state.showCover = showCover;
      // Without the cover the host loads none: the subscription says so.
      if (canRead && !state.unavailable) {
        resubscribe();
      }
    }
  }
});

// Without the grant the host would refuse the subscription: show that no
// media plays instead of asking.
if (canRead) {
  subscribe();
}
