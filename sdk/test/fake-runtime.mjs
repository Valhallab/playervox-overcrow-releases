// A stand-in for the widget VM's runtime surface 0.1 (the prelude's
// `overcrow` global), with the same semantics: calls return promises that
// the test settles, timers and subscriptions are recorded, and `host` is
// replaced as a whole on each change.

export const HOST = Object.freeze({
  locale: "en",
  messages: { greeting: "Hello {name}", seconds: "Show seconds" },
  theme: "dark",
  region: { numberFormat: "us", dateOrder: "mdy", offsetMinutes: 0 },
  scale: 1000,
  viewport: { width: 320, height: 200 },
  mode: "interactive",
  visible: true,
  options: { seconds: true, size: 3 },
  grants: ["fps.read"],
});

export function installRuntime(host = HOST) {
  const control = {
    calls: [],
    draws: [],
    logs: [],
    timers: new Map(),
    subscriptions: new Map(),
    cancelled: [],
    table: undefined,
    menu: undefined,
    host,
    now: 0,
  };
  let nextCall = 1;
  let nextTimer = 1;
  const surface = {
    state: {},
    get host() {
      return control.host;
    },
    view(table) {
      if (control.table !== undefined) {
        throw new TypeError("the view table is registered once");
      }
      control.table = table;
    },
    call(service, params, body) {
      return new Promise((resolve, reject) => {
        control.calls.push({ id: nextCall++, service, params, body, resolve, reject });
      });
    },
    subscribe(service, params, update) {
      const id = nextCall++;
      control.subscriptions.set(id, { service, params, update });
      return {
        cancel() {
          if (control.subscriptions.delete(id)) {
            control.cancelled.push(id);
          }
        },
      };
    },
    timer(intervalMs, repeat, callback) {
      if (!(intervalMs >= 100)) {
        throw new RangeError("timer interval too short");
      }
      const id = nextTimer++;
      control.timers.set(id, { intervalMs, repeat, callback });
      return id;
    },
    cancelTimer(id) {
      control.timers.delete(id);
    },
    draw(ref, commands) {
      control.draws.push({ ref, commands });
    },
    onMenu(handler) {
      control.menu = handler;
    },
    log(level, text) {
      control.logs.push({ level, text });
    },
  };
  // A due timer, as the VM delivers it: one-shots are forgotten first.
  control.fire = (id) => {
    const timer = control.timers.get(id);
    if (timer === undefined) {
      throw new Error(`no timer ${id}`);
    }
    if (!timer.repeat) {
      control.timers.delete(id);
    }
    timer.callback();
  };
  control.onlyTimer = () => {
    const entries = [...control.timers];
    if (entries.length !== 1) {
      throw new Error(`expected one timer, got ${entries.length}`);
    }
    return { id: entries[0][0], ...entries[0][1] };
  };
  globalThis.overcrow = Object.freeze(surface);
  return control;
}
