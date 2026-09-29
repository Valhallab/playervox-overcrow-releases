import { runtime } from "./runtime.js";
import type { Capability, Locale, Mode, Region, Theme } from "./generated/schema.js";

/** A stored `wrapper.menu` value: a toggle, a slider or a choice. */
export type MenuValue = boolean | number | string;

/** The content rectangle of the widget, logical px. */
export interface Viewport {
  /** Width, logical px. */
  readonly width: number;
  /** Height, logical px. */
  readonly height: number;
}

/**
 * The host data, always current: each member reads the latest value the
 * host sent (`Init`, then `Snapshot`, `Visibility`, `Locale`, `Theme` and
 * `Region`). After such a change the VM evaluates the view again.
 */
export interface HostData {
  /** Interface language. */
  readonly locale: Locale;
  /** Messages of the active locale, from the package's `locales/`. */
  readonly messages: Readonly<Record<string, string>>;
  /** Colour theme; token values follow it in the host. */
  readonly theme: Theme;
  /** Number and date preferences and the user's UTC offset. */
  readonly region: Region;
  /** Content scale in thousandths (1000 is 100 %). */
  readonly scale: number;
  /** Content rectangle, logical px. */
  readonly viewport: Viewport;
  /** Overlay mode; only `interactive` receives input. */
  readonly mode: Mode;
  /** Whether the widget is shown; a hidden widget gets no timer ticks. */
  readonly visible: boolean;
  /** Stored `wrapper.menu` values by row ID. */
  readonly options: Readonly<Record<string, MenuValue>>;
  /** Capabilities the user granted. */
  readonly grants: readonly Capability[];
}

const read = (name: string): never => runtime().host[name] as never;

/**
 * The host data. Frozen: a widget cannot change it (and the host would
 * ignore it anyway).
 */
export const host: HostData = /* @__PURE__ */ Object.freeze({
  get locale() {
    return read("locale");
  },
  get messages() {
    return read("messages");
  },
  get theme() {
    return read("theme");
  },
  get region() {
    return read("region");
  },
  get scale() {
    return read("scale");
  },
  get viewport() {
    return read("viewport");
  },
  get mode() {
    return read("mode");
  },
  get visible() {
    return read("visible");
  },
  get options() {
    return read("options");
  },
  get grants() {
    return read("grants");
  },
});

/** Whether the user granted `capability`. */
export function hasGrant(capability: Capability): boolean {
  return host.grants.includes(capability);
}

/**
 * The stored value of the menu row `id`, or `fallback` when it is missing
 * or of another type than `fallback`.
 */
export function option<T extends MenuValue>(id: string, fallback: T): Widened<T> {
  const value = host.options[id];
  return (typeof value === typeof fallback ? value : fallback) as Widened<T>;
}

/** The type of a menu value, without its literal: `false` gives `boolean`. */
export type Widened<T extends MenuValue> = T extends boolean
  ? boolean
  : T extends number
    ? number
    : string;
