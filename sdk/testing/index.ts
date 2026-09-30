/**
 * `@overcrow/sdk/testing`: unit tests of widget logic without OverCrow.
 *
 * {@link installRuntime} installs a stand-in for the widget VM's runtime
 * surface (the `overcrow` global the SDK calls), with the same rules:
 * service calls return promises the test settles, subscriptions receive the
 * updates the test pushes, timers are host timers of at least 100 ms, and
 * `host` is replaced as a whole on each change. Time is virtual: while the
 * runtime is installed, `Date.now()` returns {@link TestRuntime.now}, and
 * {@link TestRuntime.advance} fires the due timers in order.
 *
 * Install it before importing the widget's logic, as the VM does:
 *
 * ```ts
 * import { test } from "node:test";
 * import assert from "node:assert/strict";
 * import { installRuntime } from "@overcrow/sdk/testing";
 *
 * const vm = installRuntime({ now: Date.UTC(2026, 0, 1, 12) });
 * await import("./logic.js");
 * test("the clock ticks each minute", () => {
 *   vm.advance(60_000);
 *   assert.equal(vm.draws.length, 2);
 * });
 * ```
 *
 * It checks logic only. Rendering, the host's permission checks and the
 * gesture rule belong to the headless runtime (`overcrow-widget test`).
 * This module is not part of the widget bundle: widget logic cannot import
 * it.
 */

/** The `overcrow.host` object the VM gives the logic. */
export interface TestHost {
  readonly locale: "en" | "fr";
  readonly messages: Readonly<Record<string, string>>;
  readonly theme: "dark" | "light";
  readonly region: {
    readonly numberFormat: "us" | "fr" | "de";
    readonly dateOrder: "mdy" | "dmy" | "ymd";
    readonly offsetMinutes: number;
    readonly nextChangeAt?: number;
  };
  /** Content scale in thousandths: 1000 is 100 %. */
  readonly scale: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly mode: "passive" | "interactive";
  readonly visible: boolean;
  readonly options: Readonly<Record<string, unknown>>;
  readonly grants: readonly string[];
}

/** The host of a new runtime, unless {@link InstallOptions.host} changes it. */
export const HOST: TestHost = Object.freeze({
  locale: "en",
  messages: Object.freeze({}),
  theme: "dark",
  region: Object.freeze({ numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 }),
  scale: 1000,
  viewport: Object.freeze({ width: 320, height: 200 }),
  mode: "interactive",
  visible: true,
  options: Object.freeze({}),
  grants: Object.freeze([]),
}) as TestHost;

/** One service call of the logic, waiting for the test to settle it. */
export interface TestCall {
  readonly id: number;
  readonly service: string;
  readonly params: unknown;
  readonly body: unknown;
  /** Settled already. */
  readonly settled: boolean;
  /** Answers the call with its result. */
  resolve(value: unknown): void;
  /** Fails the call with a service error code (`unavailable`…). */
  reject(code: string): void;
}

export interface TestSubscription {
  readonly id: number;
  readonly service: string;
  readonly params: unknown;
  readonly cancelled: boolean;
}

export interface TestTimer {
  readonly id: number;
  readonly intervalMs: number;
  readonly repeat: boolean;
  /** Virtual time of the next tick. */
  readonly dueAt: number;
}

export interface InstallOptions {
  /** Changes to {@link HOST}. */
  readonly host?: Partial<TestHost>;
  /** The virtual time, Unix milliseconds; 0 by default. */
  readonly now?: number;
}

/** The runtime a test drives. */
export interface TestRuntime {
  /** The virtual time, Unix milliseconds. */
  readonly now: number;
  readonly host: TestHost;
  /** Every call, in order. */
  readonly calls: readonly TestCall[];
  readonly subscriptions: readonly TestSubscription[];
  /** The running timers, earliest first. */
  readonly timers: readonly TestTimer[];
  /** Every `draw(ref, commands)`, in order. */
  readonly draws: readonly { readonly ref: string; readonly commands: unknown }[];
  readonly logs: readonly { readonly level: string; readonly text: string }[];
  /** The view table the logic registered. */
  readonly table: readonly unknown[] | undefined;
  /** Moves the virtual time by `ms`, firing each due timer in order (a
   * repeating one re-arms). Returns the number of ticks. */
  advance(ms: number): number;
  /** Replaces the host with these changes, as a host message does, then
   * calls the logic's `onHost` listeners with the changed member names. */
  setHost(changes: Partial<TestHost>): void;
  /** Sends the next value of the service's running subscriptions. */
  push(service: string, value: unknown): number;
  /** Ends the service's running subscriptions with a failure code. */
  fail(service: string, code: string): number;
  /** Chooses an `action` row of the wrapper menu. */
  menu(row: string): void;
  /** The last call of `service`. */
  lastCall(service?: string): TestCall | undefined;
  /** Removes the `overcrow` global and gives `Date.now` back. */
  uninstall(): void;
}

/** The runtime refuses shorter timers (`MIN_TIMER_INTERVAL_MS`). */
const MIN_TIMER_INTERVAL_MS = 100;

type Update = (update: unknown) => void;

interface TimerEntry {
  id: number;
  intervalMs: number;
  repeat: boolean;
  dueAt: number;
  order: number;
  callback: () => void;
}

interface SubscriptionEntry {
  id: number;
  service: string;
  params: unknown;
  cancelled: boolean;
  update: Update;
}

/**
 * Installs the runtime surface as the `overcrow` global and puts
 * `Date.now` on virtual time. One runtime at a time.
 */
export function installRuntime(options: InstallOptions = {}): TestRuntime {
  const global = globalThis as { overcrow?: unknown };
  if (global.overcrow !== undefined) {
    throw new Error("a runtime is installed already: uninstall() it first");
  }
  let host: TestHost = Object.freeze({ ...HOST, ...options.host });
  let now = options.now ?? 0;
  let nextId = 1;
  let order = 0;
  let table: unknown[] | undefined;
  let menuHandler: ((row: string) => void) | undefined;
  let hostHandler: ((changed: readonly string[]) => void) | undefined;
  const calls: TestCall[] = [];
  const subscriptions: SubscriptionEntry[] = [];
  const timers = new Map<number, TimerEntry>();
  const draws: { ref: string; commands: unknown }[] = [];
  const logs: { level: string; text: string }[] = [];
  const originalNow = Date.now;

  const surface = Object.freeze({
    state: {},
    get host() {
      return host;
    },
    view(registered: unknown[]) {
      if (table !== undefined) {
        throw new TypeError("the view table is registered once");
      }
      table = registered;
    },
    call(service: string, params: unknown, body: unknown) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = () => {
          if (settled) {
            throw new Error(`call ${service} is settled already`);
          }
          settled = true;
        };
        calls.push({
          id: nextId++,
          service,
          params,
          body,
          get settled() {
            return settled;
          },
          resolve(value) {
            settle();
            resolve(value);
          },
          reject(code) {
            settle();
            reject({ code });
          },
        });
      });
    },
    subscribe(service: string, params: unknown, update: Update) {
      const entry: SubscriptionEntry = { id: nextId++, service, params, cancelled: false, update };
      subscriptions.push(entry);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
    timer(intervalMs: number, repeat: boolean, callback: () => void) {
      if (!(intervalMs >= MIN_TIMER_INTERVAL_MS)) {
        throw new RangeError("timer interval too short");
      }
      const id = nextId++;
      timers.set(id, { id, intervalMs, repeat, dueAt: now + intervalMs, order: order++, callback });
      return id;
    },
    cancelTimer(id: number) {
      timers.delete(id);
    },
    draw(ref: string, commands: unknown) {
      draws.push({ ref, commands });
    },
    onMenu(handler: (row: string) => void) {
      menuHandler = handler;
    },
    onHost(handler: (changed: readonly string[]) => void) {
      hostHandler = handler;
    },
    log(level: string, text: string) {
      logs.push({ level, text });
    },
  });

  const running = (service: string) =>
    subscriptions.filter((entry) => entry.service === service && !entry.cancelled);
  const earliest = () =>
    [...timers.values()].sort((a, b) => a.dueAt - b.dueAt || a.order - b.order)[0];

  global.overcrow = surface;
  Date.now = () => now;

  return {
    get now() {
      return now;
    },
    get host() {
      return host;
    },
    calls,
    get subscriptions() {
      return subscriptions.map(({ id, service, params, cancelled }) => ({
        id,
        service,
        params,
        cancelled,
      }));
    },
    get timers() {
      return [...timers.values()]
        .sort((a, b) => a.dueAt - b.dueAt || a.order - b.order)
        .map(({ id, intervalMs, repeat, dueAt }) => ({ id, intervalMs, repeat, dueAt }));
    },
    draws,
    logs,
    get table() {
      return table;
    },
    advance(ms) {
      if (!(ms >= 0) || !Number.isFinite(ms)) {
        throw new RangeError("advance by a finite, non-negative duration");
      }
      const target = now + ms;
      let ticks = 0;
      for (let next = earliest(); next !== undefined && next.dueAt <= target; next = earliest()) {
        now = next.dueAt;
        if (next.repeat) {
          next.dueAt += next.intervalMs;
          next.order = order++;
        } else {
          timers.delete(next.id);
        }
        ticks += 1;
        next.callback();
      }
      now = target;
      return ticks;
    },
    setHost(changes) {
      host = Object.freeze({ ...host, ...changes });
      hostHandler?.(Object.freeze(Object.keys(changes)));
    },
    push(service, value) {
      const targets = running(service);
      for (const entry of targets) {
        entry.update({ value, final: false });
      }
      return targets.length;
    },
    fail(service, code) {
      const targets = running(service);
      for (const entry of targets) {
        entry.cancelled = true;
        entry.update({ error: { code }, final: true });
      }
      return targets.length;
    },
    menu(row) {
      menuHandler?.(row);
    },
    lastCall(service) {
      return calls.filter((call) => service === undefined || call.service === service).at(-1);
    },
    uninstall() {
      delete global.overcrow;
      Date.now = originalNow;
    },
  };
}
