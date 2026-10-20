// Writes the scenarios of Live goals (tests/*.scenario.json) from one
// fictitious Twitch channel: the goals, followers and Hype Train of the
// approved mockups, all invented. Run it after a change, then
// `overcrow-widget test --update` and look at every image.
//
//   node tests/scenarios.mjs
//
// At each connection the widget reads its channel (T1), then at once and
// every minute the goals (T2), the latest follower (T3) and the Hype Train
// (T4), in that order, skipping a route the options hide. Each fixture
// answers one request: a scenario gets enough copies for its minutes.
import { readdirSync, rmSync, writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const API = "https://api.twitch.tv";
const VALIDATE = "https://id.twitch.tv/oauth2/validate";
const CHANNEL = "141981764";
const START = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, "Z");

const urls = {
  user: `${API}/helix/users`,
  goals: `${API}/helix/goals?broadcaster_id=${CHANNEL}`,
  followers: `${API}/helix/channels/followers?broadcaster_id=${CHANNEL}&first=1`,
  hype: `${API}/helix/hypetrain/status?broadcaster_id=${CHANNEL}`,
};

const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const fixture = (url, response) => ({ request: { method: "GET", url, account: "twitch" }, response });
const failure = (url, error) => ({ request: { method: "GET", url, account: "twitch" }, error });
const repeat = (count, make) => Array.from({ length: count }, make);
/** The widget's request of `url`, as a `calls` expectation. */
const fetched = (url, outcome = "ok") => ({ service: "http.fetch", params: { url, method: "GET", as: "text" }, outcome });
const READ = [fetched(urls.goals), fetched(urls.followers), fetched(urls.hype)];
/** The widget's first calls: the account's state, then its channel. */
const SUBSCRIBED = { service: "account.subscribe", params: { id: "twitch" }, outcome: "ok" };
const START_CALLS = [SUBSCRIBED, fetched(urls.user), ...READ];

// The channel of the mockups (tmp/acc-p-mockups, series 2), all invented.
const GOALS = {
  en: [
    { id: "g1", type: "subscription_count", desc: "Karaoke night", current: 37, target: 50, ago: 60 },
    { id: "g2", type: "follower", desc: "", current: 1284, target: 1500, ago: 600 },
    { id: "g3", type: "new_bit", desc: "New mic", current: 3200, target: 10000, ago: 3000 },
  ],
  fr: [
    { id: "g1", type: "subscription_count", desc: "Soirée karaoké", current: 37, target: 50, ago: 60 },
    { id: "g2", type: "follower", desc: "", current: 1284, target: 1500, ago: 600 },
    { id: "g3", type: "new_bit", desc: "Nouveau micro", current: 3200, target: 10000, ago: 3000 },
  ],
};
const NYX = { id: "70000001", name: "NyxArcade", ago: 4 };
const KAI = { id: "70000002", name: "KaiPlays", ago: 0 };

function user() {
  return json(200, { data: [{ id: CHANNEL, login: "novalive", display_name: "NovaLive", type: "", broadcaster_type: "affiliate", description: "", profile_image_url: "", offline_image_url: "", view_count: 0, created_at: "2019-05-01T10:00:00Z" }] });
}
function goals(list) {
  return json(200, {
    data: list.map((g) => ({
      id: g.id, broadcaster_id: CHANNEL, broadcaster_name: "NovaLive", broadcaster_login: "novalive",
      type: g.type, description: g.desc, current_amount: g.current, target_amount: g.target, created_at: iso(START - g.ago * MIN),
    })),
  });
}
/** The total and the latest follower, `at` the time of the read. */
function followers(total, last, at) {
  const data = last === null ? [] : [{ user_id: last.id, user_login: last.name.toLowerCase(), user_name: last.name, followed_at: iso(at - last.ago * MIN) }];
  return json(200, { total, data, pagination: {} });
}
/** A Hype Train with `leftS` seconds left when read at `at`; `null`: none. */
function hype(train, at) {
  const current = train === null ? null : {
    id: "hype-1", broadcaster_user_id: CHANNEL, broadcaster_user_login: "novalive", broadcaster_user_name: "NovaLive",
    level: train.level, total: 4240, progress: train.progress, goal: train.goal, top_contributions: [],
    shared_train_participants: null, started_at: iso(at - 120_000), expires_at: iso(at + train.leftS * 1000),
    type: "regular", is_shared_train: false,
  };
  return json(200, { data: [{ current, all_time_high: { level: 4, total: 9100, achieved_at: "2025-11-02T21:00:00Z" }, shared_all_time_high: null }] });
}
const TRAIN = { level: 2, progress: 1240, goal: 1800, leftS: 222 };

/**
 * The answers of `minutes` minutes of reads (one read at start and one a
 * minute). `goalsAt(n)`… give the answer of the read `n` (0 at start).
 */
function reads({ minutes = 0, list = GOALS.en, total = 1284, last = NYX, train = null, goalsAt, followersAt, hypeAt, skip = [] } = {}) {
  const out = [fixture(urls.user, user())];
  for (let n = 0; n <= minutes; n += 1) {
    const at = START + n * MIN;
    if (!skip.includes("goals")) out.push(fixture(urls.goals, goalsAt ? goalsAt(n) : goals(list)));
    if (!skip.includes("followers")) out.push(fixture(urls.followers, followersAt ? followersAt(n, at) : followers(total, last, at)));
    if (!skip.includes("hype")) out.push(fixture(urls.hype, hypeAt ? hypeAt(n, at) : hype(train, at)));
  }
  return out;
}

const WIDTH = { line: 260, compact: 300, standard: 320, full: 340 };
const L4 = ["line", "compact", "standard", "full"];

/** The options menu's rows and their defaults (manifest). */
const DEFAULTS = {
  layout: "standard", "goal-subs": true, "goal-followers": true, "goal-bits": true, "goal-cheerers": true,
  "show-followers": true, "show-last-follower": true, "show-hype": true, "show-logo": true,
};
/**
 * Steps may say `host.options`: the whole set of options wanted from then
 * on (others at their default). They become the menu rows that change.
 */
function withMenus(steps, initial) {
  let current = { ...DEFAULTS, ...initial };
  return steps.flatMap((step) => {
    if (step.host?.options === undefined) return [step];
    const { options, ...rest } = step.host;
    const next = { ...DEFAULTS, ...options };
    const menus = Object.keys(DEFAULTS)
      .filter((id) => next[id] !== current[id])
      .map((id) => ({ menu: { id, value: next[id] } }));
    current = next;
    return Object.keys(rest).length === 0 ? menus : [...menus, { host: rest }];
  });
}

const written = new Set();
function scenario(name, description, { host = {}, http = [], steps: plan }) {
  const steps = withMenus(plan, host.options ?? {});
  const value = { scenarioVersion: 1, name, description, host: { startAt: START, ...host }, fixtures: { http }, steps };
  writeFileSync(new URL(`${name}.scenario.json`, here), `${JSON.stringify(value, null, 2)}\n`);
  written.add(`${name}.scenario.json`);
}

/** Captures `tag` in each layout at its width, with `options`. */
function layouts(tag, list = L4, options = {}) {
  return list.flatMap((layout) => [
    { host: { options: { ...options, layout }, size: { width: WIDTH[layout], height: 200 } } },
    { expect: { image: `${tag}-${layout}`, fault: "none" } },
  ]);
}
/** The same in French, then back to English. */
function inFrench(tag, list, options = {}) {
  return [{ host: { locale: "fr" } }, ...layouts(`${tag}-fr`, list, options), { host: { locale: "en" } }];
}

// --- render: the four layouts, both languages, both themes, two scales.
for (const locale of ["en", "fr"]) {
  scenario(`render-${locale}`, `The goals of the channel, ${locale === "en" ? "in English" : "in French"}: four layouts, dark and light, at 100 and 150 %.`, {
    host: { locale },
    http: reads({ list: GOALS[locale] }),
    steps: [
      { expect: { state: "running", text: [GOALS[locale][0].desc], fault: "none" } },
      ...["dark", "light"].flatMap((theme) =>
        [1000, 1500].flatMap((scale) => [{ host: { theme, scale } }, ...layouts(`${theme}-${scale / 10}`)]),
      ),
    ],
  });
}

// --- sizes: the narrowest line, a narrow Standard, the widest Full.
scenario("sizes", "One line at 150 and 170 px (ellipsis), Standard at 230 px, Full at 520 and 560 px.", {
  http: reads(),
  steps: [
    { host: { options: { layout: "line" }, size: { width: 150, height: 40 } } },
    { expect: { image: "line-150", fault: "none" } },
    { host: { size: { width: 170, height: 40 } } },
    { expect: { image: "line-170", fault: "none" } },
    { host: { options: { layout: "standard" }, size: { width: 230, height: 120 } } },
    { expect: { image: "standard-230", fault: "none" } },
    { host: { options: { layout: "full" }, size: { width: 520, height: 200 } } },
    { expect: { image: "full-520", fault: "none" } },
    { host: { size: { width: 560, height: 200 } } },
    { expect: { image: "full-560", fault: "none" } },
    { host: { locale: "fr", size: { width: 520, height: 200 } } },
    { expect: { image: "full-520-fr", fault: "none" } },
  ],
});

// --- hype: a train comes in front, then leaves when its countdown ends.
scenario("hype", "A Hype Train at level 2, 03:42 left: in front of the goal, alone in Compact; it leaves at zero without waiting for Twitch.", {
  http: reads({ minutes: 4, train: TRAIN, hypeAt: (n, at) => hype(n === 0 ? TRAIN : { ...TRAIN, leftS: 222 - n * 60 }, at) }),
  steps: [
    { expect: { state: "running", text: ["Hype Train", "03:42 left"], fault: "none" } },
    ...layouts("hype"),
    { host: { scale: 1500 } },
    ...layouts("hype-150"),
    { host: { scale: 1000 } },
    ...inFrench("hype", L4),
    { host: { locale: "fr", scale: 1500 } },
    ...layouts("hype-fr-150"),
    { host: { locale: "en", scale: 1000, options: { layout: "standard" }, size: { width: 320, height: 200 } } },
    { advance: { ms: 3 * MIN } },
    { expect: { text: ["00:42 left"] } },
    { advance: { ms: 43_000 } },
    { expect: { noText: ["Hype Train"], text: ["Karaoke night"], image: "hype-ended-standard", fault: "none" } },
  ],
});

// --- reached: a goal at its target, a new follower lit for 10 s.
const REACHED = { en: [{ ...GOALS.en[0], current: 50 }], fr: [{ ...GOALS.fr[0], current: 50 }] };
scenario("reached", "Karaoke night at 50 / 50: green check and Reached; a new follower lights the followers card.", {
  http: [
    ...reads({ minutes: 1, list: REACHED.en, followersAt: (n, at) => followers(n === 0 ? 1283 : 1284, n === 0 ? NYX : KAI, at) }),
  ],
  steps: [
    { expect: { state: "running", text: ["Reached"], fault: "none" } },
    { advance: { ms: MIN } },
    { expect: { text: ["Latest: KaiPlays"] } },
    ...layouts("reached"),
    ...inFrench("reached", L4),
  ],
});

scenario("new-follower", "KaiPlays follows: the followers card pulses twice and stays lit for 10 s, then calms down.", {
  http: reads({ minutes: 1, followersAt: (n, at) => followers(n === 0 ? 1283 : 1284, n === 0 ? NYX : KAI, at) }),
  steps: [
    { expect: { state: "running", text: ["1,283"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["1,284", "Latest: KaiPlays"], image: "new-standard", fault: "none" } },
    { host: { options: { layout: "full" }, size: { width: 340, height: 200 } } },
    { expect: { image: "new-full", fault: "none" } },
    { advance: { ms: 10_000 } },
    { expect: { image: "after-full", fault: "none" } },
  ],
});

scenario("no-goal", "No active goal: where to create one; the followers still show.", {
  http: reads({ list: [] }),
  steps: [
    { expect: { state: "running", text: ["No active goal"], fault: "none" } },
    ...layouts("no-goal"),
    ...inFrench("no-goal", L4),
  ],
});

scenario("multi-goals", "Three goals: the newest in Standard, all three in Full.", {
  http: reads(),
  steps: [
    { expect: { state: "running", text: ["Karaoke night"], noText: ["New mic"] } },
    ...layouts("multi", ["standard", "full"]),
  ],
});

scenario("empty-description", "A goal without description: its title says its type.", {
  http: reads({ list: [GOALS.en[1]] }),
  steps: [
    { expect: { state: "running", text: ["Followers goal"], fault: "none" } },
    ...layouts("empty-description", ["line", "standard"]),
    ...inFrench("empty-description", ["standard"]),
  ],
});

scenario("long-texts", "A long description and a long follower name: one line each, cut with an ellipsis.", {
  http: reads({
    list: [{ ...GOALS.en[0], desc: "Road to the big charity marathon stream" }],
    last: { id: "70000003", name: "TheVeryLongestNameOnTwitch", ago: 2 },
  }),
  steps: [
    { expect: { state: "running", fault: "none" } },
    ...layouts("long", L4),
    { host: { options: { layout: "standard" }, size: { width: 230, height: 120 } } },
    { expect: { image: "long-standard-230", fault: "none" } },
  ],
});

// --- loading: the skeleton of the first load. The host's network budget
// is full at the first read (`busy`): nothing is answered yet.
scenario("loading", "The first load: the skeleton while nothing is answered yet.", {
  http: [failure(urls.user, "busy")],
  steps: [
    { expect: { state: "running", text: ["Reading your goals…"], fault: "none" } },
    ...layouts("loading", ["line", "compact", "standard"]),
    ...inFrench("loading", ["line", "standard"]),
  ],
});

// --- failures.
scenario("unreachable", "Twitch unreachable (network error, then 503): the values stay, the warning says since when.", {
  http: [
    ...reads({ minutes: 0 }),
    ...repeat(2, () => failure(urls.goals, "transport_failed")),
    ...repeat(3, () => fixture(urls.goals, json(503, {}))),
  ],
  steps: [
    { expect: { state: "running", text: ["Karaoke night"] } },
    { advance: { ms: 2 * MIN } },
    { expect: { text: ["Unreachable · 2 min ago", "Karaoke night", "37"], fault: "none" } },
    { advance: { ms: 3 * MIN } },
    { expect: { text: ["Unreachable · 5 min ago"], fault: "none" } },
    ...layouts("unreachable"),
    { host: { scale: 1500 } },
    ...layouts("unreachable-150", ["compact", "standard", "full"]),
    { host: { scale: 1000 } },
    ...inFrench("unreachable", L4),
    { host: { locale: "fr", scale: 1500 } },
    ...layouts("unreachable-fr-150", ["compact", "standard", "full"]),
  ],
});

scenario("quota", "Twitch limits requests (429): the values stay, Rate limited and since when.", {
  http: [...reads({ minutes: 0 }), ...repeat(2, () => fixture(urls.goals, json(429, { error: "Too Many Requests", status: 429, message: "" })))],
  steps: [
    { expect: { state: "running", text: ["Karaoke night"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Rate limited · 1 min ago"], fault: "none" } },
    { advance: { ms: MIN } },
    { expect: { text: ["Rate limited · 2 min ago"], fault: "none" } },
    ...layouts("quota", ["line", "compact", "standard", "full"]),
    ...inFrench("quota", ["line", "compact", "standard"]),
  ],
});

scenario("empty-unreachable", "Twitch unreachable at the first read: no value yet, said once.", {
  http: [fixture(urls.user, user()), ...repeat(3, () => failure(urls.goals, "timeout"))],
  steps: [
    { expect: { state: "running", text: ["Twitch unreachable. Retrying every minute."], fault: "none" } },
    ...layouts("empty-unreachable", ["line", "standard"]),
    ...inFrench("empty-unreachable", ["line", "standard"]),
  ],
});

scenario("refused", "Twitch refuses the goals while the token is valid: the channel is read again, then Refused by Twitch, values kept.", {
  http: [
    ...reads({ minutes: 0 }),
    fixture(urls.user, user()),
    ...repeat(3, () => fixture(urls.goals, { status: 403, contentType: "application/json", body: "{}" })),
    ...repeat(3, () => fixture(VALIDATE, json(200, { client_id: "x", scopes: [], expires_in: 3600 }))),
  ],
  steps: [
    { expect: { state: "running", text: ["Karaoke night"] } },
    { advance: { ms: MIN } },
    { expect: { noText: ["Refused by Twitch"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Refused by Twitch · 2 min ago", "Karaoke night"], fault: "none" } },
    ...layouts("refused", ["line", "compact", "standard"]),
    ...inFrench("refused", ["compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("refused-150", ["standard"]),
  ],
});

scenario("expired", "Twitch refuses the token itself (validate refused): the connection expires and the host covers the widget.", {
  host: { frame: true },
  http: [
    fixture(urls.user, user()),
    fixture(urls.goals, { status: 401, contentType: "application/json", body: "{}" }),
    fixture(VALIDATE, json(401, { status: 401, message: "invalid access token" })),
  ],
  steps: [
    { expect: { state: "running", image: "expired", fault: "none" } },
    { advance: { ms: 3 * MIN } },
    { host: { locale: "fr" } },
    { expect: { image: "expired-fr", fault: "none" } },
  ],
});

for (const [name, account, description] of [
  ["signed-out", "disconnected", "Twitch not connected (or connected without this widget's permissions): the host's panel, the widget reads nothing."],
  ["pending", "pending", "Twitch connection pending: the host's panel, the widget reads nothing."],
]) {
  scenario(name, description, {
    host: { frame: true, accounts: { twitch: account } },
    steps: [
      { expect: { state: "running", image: name, fault: "none", calls: [SUBSCRIBED] } },
      { advance: { ms: 2 * MIN } },
      { host: { locale: "fr" } },
      { expect: { image: `${name}-fr`, fault: "none", calls: [] } },
    ],
  });
}

// --- options: one scenario each.
const OPTIONS = [
  ["opt-goal-types", "Followers goals only: the subscriber and Bits goals are not shown.", { "goal-subs": false, "goal-bits": false, "goal-cheerers": false }, ["standard", "full"]],
  ["opt-no-follower-count", "No follower count: the latest follower alone.", { "show-followers": false }, ["standard", "full"]],
  ["opt-no-followers", "No followers at all: no followers card, the route not called.", { "show-followers": false, "show-last-follower": false }, ["standard", "full"]],
  ["opt-no-logo", "Twitch logo off: the word Twitch instead (the catalog preview).", { "show-logo": false }, ["compact", "standard", "full"]],
  ["opt-nothing", "Everything off: Nothing to show, and where to choose.", { "goal-subs": false, "goal-followers": false, "goal-bits": false, "goal-cheerers": false, "show-followers": false, "show-last-follower": false }, ["line", "standard"]],
];
for (const [name, description, options, list] of OPTIONS) {
  const skip = [];
  if (options["show-followers"] === false && options["show-last-follower"] === false) skip.push("followers");
  if (name === "opt-nothing") skip.push("goals");
  scenario(name, description, {
    host: { options },
    http: reads({ skip }),
    steps: [
      { expect: { state: "running", fault: "none" } },
      ...layouts(name, list, options),
      ...inFrench(name, list, options),
    ],
  });
}

scenario("opt-no-hype", "Hype Train off: never shown, even while a train runs; the route is not called.", {
  host: { options: { "show-hype": false } },
  http: reads({ skip: ["hype"] }),
  steps: [
    { expect: { state: "running", noText: ["Hype Train"], fault: "none" } },
    ...layouts("opt-no-hype", ["compact", "standard"], { "show-hype": false }),
    ...inFrench("opt-no-hype", ["standard"], { "show-hype": false }),
  ],
});

scenario("routes-follow-options", "Followers and Hype Train switched off: their routes are no longer called; on again, read at once.", {
  http: reads({ minutes: 1, skip: [] }).concat(
    [fixture(urls.goals, goals(GOALS.en)), fixture(urls.goals, goals(GOALS.en)), fixture(urls.followers, followers(1284, NYX, START + 3 * MIN)), fixture(urls.hype, hype(null, START + 3 * MIN))],
  ),
  steps: [
    { expect: { state: "running", calls: START_CALLS } },
    { advance: { ms: MIN } },
    { host: { options: { "show-followers": false, "show-last-follower": false, "show-hype": false } } },
    { advance: { ms: MIN } },
    { expect: { calls: [...READ, fetched(urls.goals)], fault: "none" } },
    { advance: { ms: MIN } },
    { host: { options: {} } },
    { expect: { calls: [fetched(urls.goals), fetched(urls.followers), fetched(urls.hype)], text: ["Latest: NyxArcade"], fault: "none" } },
  ],
});

scenario("cadence", "Ten minutes: the channel once, then each route once a minute, never more.", {
  http: reads({ minutes: 10 }),
  steps: [
    { expect: { state: "running", calls: START_CALLS } },
    { advance: { ms: 10 * MIN } },
    { expect: { fault: "none", text: ["Karaoke night"], calls: repeat(10, () => READ).flat() } },
  ],
});

scenario("hidden", "Hidden for five minutes: nothing is read; shown again, one read at once.", {
  http: reads({ minutes: 1 }),
  steps: [
    { expect: { state: "running", calls: START_CALLS } },
    { host: { visible: false } },
    { advance: { ms: 5 * MIN } },
    { expect: { calls: [] } },
    { host: { visible: true } },
    { expect: { text: ["Karaoke night"], fault: "none", calls: READ } },
  ],
});

// --- the catalog preview: Standard, 320 px, dark, English, 150 %, on the
// stage colour, Twitch logo off (no Twitch mark in marketing), fictional
// figures.
const STAGE = (await import("../../../scripts/compose-previews.mjs")).STAGE_COLOUR;
scenario("preview", "The catalog preview: Standard at 320 px, dark, English, 150 %, Twitch logo off. Fictional channel and figures.", {
  host: { scale: 1500, background: STAGE, size: { width: 320, height: 164 }, options: { "show-logo": false } },
  http: reads(),
  steps: [{ expect: { state: "running", text: ["Karaoke night", "Latest: NyxArcade"], noText: ["Hype Train"], image: "preview", fault: "none" } }],
});

// Old scenario files this script no longer writes.
for (const file of readdirSync(here)) {
  if (file.endsWith(".scenario.json") && !written.has(file)) rmSync(new URL(file, here));
}
