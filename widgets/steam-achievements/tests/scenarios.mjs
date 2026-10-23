// Writes the scenarios of Steam achievements (tests/*.scenario.json) from
// one fictitious Steam account: the games, achievements and images of the
// approved mockups, all invented. Run it after a change, then
// `overcrow-widget test --update` and look at every image.
//
//   node tests/scenarios.mjs
//
// The widget asks Steam in a fixed order; each fixture answers one request.
// A scenario gets enough copies of each answer for the minutes it plays.
import { readFileSync, writeFileSync } from "node:fs";

const here = new URL("./", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("../manifest.json", here), "utf8"));
const API = "https://api.steampowered.com";
const ID = "76561198000000000";
const START = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const MIN = 60_000;
const at = (minutesAgo) => Math.floor((START - minutesAgo * MIN) / 1000);
const ICON_HOST = "https://shared.akamai.steamstatic.com/community_assets/images/apps";
const iconsRouted = manifest.permissions.network.some((rule) => rule.path.startsWith("/community_assets/"));

// The games and achievements of the mockups (tmp/acc-p-mockups, series 2).
const A = (i, en, fr, ic, ago, rarity, descEn, descFr, extra = {}) => ({
  api: `A${i}`, en, fr, ic, ago, rarity, descEn, descFr, hidden: false, icon: true, ...extra,
});
const LISTED = [
  A(1, "Crown of Ashes", "Couronne de cendres", 1, 3, 4.2, "Claim the ashen throne", "Prendre le trône de cendres"),
  A(2, "Warden's Blade", "Lame du veilleur", 2, 64, 31, "Forge the warden's blade", "Forger la lame du veilleur"),
  A(3, "Bulwark", "Rempart", 3, 2900, 57, "Block 100 attacks", "Parer 100 attaques"),
  A(4, "Undying Ember", "Braise éternelle", 4, 4400, 12, "Relight every brazier", "Rallumer tous les braseros"),
  A(9, "First Light", "Première lueur", 8, 5800, 88, "Finish the prologue", "Finir le prologue", { icon: false }),
  A(10, "Eye of the Abyss", "Œil du gouffre", 5, null, 22.4, "Defeat the Warden without taking damage", "Vaincre le Veilleur sans subir de dégâts"),
  A(11, "Deep Key", "Clé des profondeurs", 6, null, 18.9, "Open every sealed door", "Ouvrir toutes les portes scellées"),
  A(12, "The Pale King", "Le Roi pâle", 9, null, 15.1, "Meet the Pale King", "Rencontrer le Roi pâle", { hidden: true }),
  A(13, "Endless Night", "Nuit sans fin", 7, null, 2.7, "Finish the game on Nightmare", "Finir le jeu en mode Cauchemar"),
  A(14, "Flawless Gem", "Joyau parfait", 8, null, 1.3, "Collect every gem in one run", "Réunir toutes les gemmes en une partie"),
  A(15, "Ash Walker", "Marcheur des cendres", 3, null, 9.6, "Cross the wastes without a mount", "Traverser les landes sans monture", { icon: false }),
];
// 29 more to reach 12 / 40: unlocked long ago, or missing, without rarity
// (sorted last), named to sort last by name too.
const FILLER = Array.from({ length: 29 }, (_, n) => ({
  api: `Z${n}`, en: `Zephyr trial ${n + 1}`, fr: `Zéphyr, épreuve ${n + 1}`, ic: (n % 9) + 1,
  ago: n < 7 ? 20_000 + n * 1440 : null, rarity: null, descEn: "A trial of the wastes", descFr: "Une épreuve des landes",
  hidden: false, icon: true,
}));
const ASHEN = { appid: 1_874_000, name: "Ashen Crown", header: "header-ashen", icon: "game-ashen", achievements: [...LISTED, ...FILLER] };
const COURIER = { appid: 1_874_100, name: "Neon Courier", header: "header-courier", icon: "game-courier", achievements: [] };
const ICON_HASH = { "game-ashen": "a1".repeat(20), "game-courier": "c0".repeat(20), "game-tide": "e2".repeat(20) };
const hash = (ic, gray) => `${String(ic).padStart(2, "0")}${gray ? "9" : "0"}`.repeat(10) + "0".repeat(10);

const image = (name) => readFileSync(new URL(`images/${name}.jpg`, here)).toString("base64");
// Steam pretty-prints its answers with tabs: the fixtures do the same.
const json = (status, body) => ({ status, contentType: "application/json", body: JSON.stringify(body, null, "\t") });
const fixture = (url, response, account = true) => {
  const request = { method: "GET", url };
  if (account) request.account = "steam";
  return { request, response };
};
const failure = (url, error, account = true) => {
  const request = { method: "GET", url };
  if (account) request.account = "steam";
  return { request, error };
};
const repeat = (count, make) => Array.from({ length: count }, make);

const urls = {
  summary: `${API}/ISteamUser/GetPlayerSummaries/v2/?steamids=${ID}`,
  recent: `${API}/IPlayerService/GetRecentlyPlayedGames/v1/?steamid=${ID}&count=5`,
  player: (game) => `${API}/ISteamUserStats/GetPlayerAchievements/v1/?steamid=${ID}&appid=${game.appid}`,
  schema: (game, l = "english") => `${API}/ISteamUserStats/GetSchemaForGame/v2/?appid=${game.appid}&l=${l}`,
  rarity: (game) => `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${game.appid}`,
  vanity: (name) => `${API}/ISteamUser/ResolveVanityURL/v1/?vanityurl=${name}`,
  header: (game) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appid}/header.jpg`,
  headerCdn: (game) => `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
  probe: `${API}/ISteamWebAPIUtil/GetSupportedAPIList/v1/`,
};

function summary({ playing = null, visible = 3 } = {}) {
  const player = { steamid: ID, communityvisibilitystate: visible, profilestate: 1, personaname: "Nova" };
  if (playing !== null && visible === 3) Object.assign(player, { gameid: String(playing.appid), gameextrainfo: playing.name });
  return json(200, { response: { players: [player] } });
}
function recent(games, hidden = false) {
  if (hidden) return json(200, { response: {} });
  return json(200, { response: { total_count: games.length, games: games.map((game) => ({ appid: game.appid, name: game.name, playtime_2weeks: 300, playtime_forever: 3000, img_icon_url: ICON_HASH[game.icon] })) } });
}
/** How Steam names an icon: `old` URLs on old hosts, `current` URLs, or the file alone. */
const ICON_FORMS = {
  old: (game, file, gray) => (gray ? `http://media.steampowered.com` : `https://steamcdn-a.akamaihd.net`) + `/steamcommunity/public/images/apps/${game.appid}/${file}`,
  current: (game, file) => `https://shared.fastly.steamstatic.com/community_assets/images/apps/${game.appid}/${file}`,
  file: (_game, file) => file,
};
function schema(game, l, form = "old") {
  const url = (a, gray) => ICON_FORMS[form](game, `${hash(a.ic, gray)}.jpg`, gray);
  const achievements = game.achievements.map((a) => ({
    name: a.api, defaultvalue: 0, displayName: l === "french" ? a.fr : a.en, hidden: a.hidden ? 1 : 0,
    description: a.hidden ? "" : l === "french" ? a.descFr : a.descEn,
    // Old hosts by default: the widget sets each file on its declared path.
    icon: a.icon ? url(a, false) : "",
    icongray: a.icon ? url(a, true) : "",
  }));
  // Steam lists the game's stats after its achievements.
  const stats = [{ name: "STAT_RUNS", defaultvalue: 0, displayName: "Runs" }];
  return json(200, { game: { gameName: game.name, gameVersion: "12", availableGameStats: achievements.length ? { achievements, stats } : { stats } } });
}
function player(game, unlockedNow = {}) {
  const achievements = game.achievements.map((a) => {
    const ago = a.api in unlockedNow ? unlockedNow[a.api] : a.ago;
    return { apiname: a.api, achieved: ago === null ? 0 : 1, unlocktime: ago === null ? 0 : at(ago) };
  });
  return json(200, { playerstats: { steamID: ID, gameName: game.name, achievements, success: true } });
}
function rarity(game) {
  return json(200, { achievementpercentages: { achievements: game.achievements.filter((a) => a.rarity !== null).map((a) => ({ name: a.api, percent: a.rarity })) } });
}
const jpeg = (name) => ({ status: 200, contentType: "image/jpeg", bodyBase64: image(name) });

/** The images the game shows: its header, its icon and its achievements' icons. */
function images(game) {
  const list = [fixture(urls.header(game), jpeg(game.header), false)];
  list.push(fixture(`${ICON_HOST}/${game.appid}/${ICON_HASH[game.icon]}.jpg`, jpeg(game.icon), false));
  if (iconsRouted) {
    // One answer per URL: the widget asks each image once.
    for (const ic of new Set(game.achievements.filter((a) => a.icon).map((a) => a.ic))) {
      list.push(fixture(`${ICON_HOST}/${game.appid}/${hash(ic, false)}.jpg`, jpeg(`ach2-${ic}`), false));
      list.push(fixture(`${ICON_HOST}/${game.appid}/${hash(ic, true)}.jpg`, jpeg(`ach2-${ic}-gray`), false));
    }
  }
  return list;
}

/**
 * The answers of `minutes` minutes of reads of `game` (one read at start and
 * one a minute), in both languages.
 */
function reads(game, { minutes = 1, playing = true, visible = 3, unlockedNow = {}, recentGames = [game], hiddenRecent = false } = {}) {
  const n = minutes + 1;
  return [
    ...repeat(n, () => fixture(urls.summary, summary({ playing: playing ? game : null, visible }))),
    ...repeat(Math.ceil(n / 10) + 1, () => fixture(urls.recent, recent(recentGames, hiddenRecent))),
    fixture(urls.schema(game), schema(game, "english")),
    fixture(urls.schema(game, "french"), schema(game, "french")),
    ...repeat(n, () => fixture(urls.player(game), player(game, unlockedNow))),
    fixture(urls.rarity(game), rarity(game), false),
    ...images(game),
  ];
}

/** The stage colour of catalog previews (scripts/compose-previews.mjs). */
const STAGE = (await import("../../../scripts/compose-previews.mjs")).STAGE_COLOUR;
const WIDTH = { line: 240, compact: 280, standard: 300, full: 340 };
const profile = { profile: { steamid: ID, input: `https://steamcommunity.com/profiles/${ID}` } };

function scenario(name, description, { host = {}, http = [], steps }) {
  const value = {
    scenarioVersion: 1,
    name,
    description,
    host: { startAt: START, storage: { ...profile }, ...host },
    fixtures: { http },
    steps,
  };
  writeFileSync(new URL(`${name}.scenario.json`, here), `${JSON.stringify(value, null, 2)}\n`);
}

/** Captures `tag` in each layout at its width. */
function layouts(tag, list = ["line", "compact", "standard", "full"], extra = {}) {
  return list.flatMap((layout) => [
    { menu: { id: "layout", value: layout } },
    { host: { size: { width: WIDTH[layout], height: 200 } } },
    { expect: { image: `${tag}-${layout}`, fault: "none", ...extra } },
  ]);
}

// --- render: every layout, both languages, both themes, two scales.
scenario("render", "Ashen Crown in game: the four layouts in English and French, dark and light, at 100 and 150 %.", {
  http: reads(ASHEN),
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Crown of Ashes"], fault: "none" } },
    ...["en", "fr"].flatMap((locale) =>
      ["dark", "light"].flatMap((theme) =>
        [1000, 1500].flatMap((scale) => [
          { host: { locale, theme, scale } },
          ...layouts(`${theme}-${locale}-${scale / 10}`),
        ]),
      ),
    ),
  ],
});

// --- sizes: the narrowest line and the two columns of the full layout.
scenario("sizes", "One line at 160 px (ellipsis), Standard at 230 px, Full in two columns at 540 px.", {
  http: reads(ASHEN),
  steps: [
    { menu: { id: "layout", value: "line" } },
    { host: { size: { width: 160, height: 40 } } },
    { expect: { image: "line-160", fault: "none" } },
    { menu: { id: "layout", value: "standard" } },
    { host: { size: { width: 230, height: 120 } } },
    { expect: { image: "standard-230", fault: "none" } },
    { menu: { id: "layout", value: "full" } },
    { host: { size: { width: 540, height: 200 } } },
    { expect: { image: "full-540", fault: "none" } },

  ],
});

// --- unlock: a new achievement pulses twice and says New for 60 s.
scenario("unlock", "Endless Night unlocks in game: New on its card and in the count, gone after a minute.", {
  http: [
    ...repeat(1, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(1, () => fixture(urls.player(ASHEN), player(ASHEN))),
    ...reads(ASHEN, { minutes: 3, unlockedNow: { A13: 0 } }),
  ],
  steps: [
    { expect: { state: "running", text: ["12 / 40"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Endless Night", "New"], image: "standard-new", fault: "none" } },
    { menu: { id: "layout", value: "line" } },
    { expect: { image: "line-new" } },
    { menu: { id: "layout", value: "standard" } },
    { host: { locale: "fr", scale: 1500 } },
    { expect: { image: "standard-new-fr-150" } },
    { host: { locale: "en", scale: 1000 } },
    { advance: { ms: MIN } },
    { expect: { noText: ["New"], image: "standard-after", fault: "none" } },
  ],
});

// --- states of §1.6.
scenario("last-played", "Out of game: the last game played, under a neutral heading.", {
  http: reads(ASHEN, { playing: false }),
  steps: [
    { expect: { state: "running", text: ["Last game played"] } },
    ...layouts("last-played", ["line", "compact", "standard", "full"]),
  ],
});

const DONE = { ...ASHEN, achievements: ASHEN.achievements.map((a) => ({ ...a, ago: a.ago ?? 9000 })) };
scenario("all-done", "Every achievement unlocked: green bar and check.", {
  http: reads(DONE),
  steps: [{ expect: { state: "running", text: ["40 / 40"] } }, ...layouts("all-done")],
});

scenario("no-achievements", "Neon Courier has no achievements: said once, no achievement route called.", {
  http: reads(COURIER),
  steps: [
    { expect: { state: "running", text: ["This game has no Steam achievements."] } },
    ...layouts("no-achievements", ["line", "compact", "standard", "full"]),
  ],
});

scenario("private", "A private profile: amber heading and the last values kept; in Full, the way to make them public.", {
  host: { storage: { ...profile } },
  http: [
    ...reads(ASHEN, { minutes: 0 }),
    ...repeat(3, () => fixture(urls.summary, summary({ visible: 1 }))),
    ...repeat(2, () => fixture(urls.recent, recent([], true))),
  ],
  steps: [
    { expect: { state: "running", text: ["Playing now"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Game details private"], fault: "none" } },
    ...layouts("private"),
    { host: { locale: "fr" } },
    ...layouts("private-fr", ["standard"]),
  ],
});

scenario("not-readable", "Steam answers 403 for the achievements while the host's probe passes: the game stays, a neutral line instead of the bar.", {
  http: [
    ...repeat(2, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(2, () => fixture(urls.recent, recent([ASHEN]))),
    fixture(urls.schema(ASHEN), schema(ASHEN, "english")),
    fixture(urls.schema(ASHEN, "french"), schema(ASHEN, "french")),
    ...repeat(3, () => fixture(urls.player(ASHEN), json(403, {}))),
    ...repeat(6, () => fixture(urls.probe, json(200, { apilist: { interfaces: [] } }))),
    fixture(urls.rarity(ASHEN), rarity(ASHEN), false),
    ...images(ASHEN),
  ],
  steps: [
    { expect: { state: "running", text: ["Steam doesn't show your achievements for this game (borrowed game?)."], fault: "none" } },
    ...layouts("not-readable", ["compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("not-readable-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    ...layouts("not-readable-fr", ["compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("not-readable-fr-150", ["compact", "standard"]),
  ],
});

scenario("nothing", "No game now and none recently: how to start.", {
  http: [...repeat(2, () => fixture(urls.summary, summary())), ...repeat(2, () => fixture(urls.recent, recent([])))],
  steps: [
    { expect: { state: "running", text: ["Play a Steam game: its achievements show up here."] } },
    ...layouts("nothing", ["line", "standard"]),
    { host: { locale: "fr" } },
    ...layouts("nothing-fr", ["line", "standard"]),
  ],
});

scenario("switch-game", "From Ashen Crown to Neon Courier in game: the new game alone, nothing marked New.", {
  http: [
    ...repeat(1, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...reads(ASHEN, { minutes: 0 }).filter((entry) => entry.request.url !== urls.summary),
    ...repeat(3, () => fixture(urls.summary, summary({ playing: COURIER }))),
    ...repeat(2, () => fixture(urls.recent, recent([COURIER, ASHEN]))),
    fixture(urls.schema(COURIER), schema(COURIER, "english")),
    ...images(COURIER),
  ],
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "12 / 40"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Neon Courier", "This game has no Steam achievements."], noText: ["Ashen Crown", "12 / 40", "New"], fault: "none" } },
    ...layouts("switch-game", ["standard"]),
  ],
});

// --- the profile step.
scenario("profile", "No profile yet, in Interactive mode: the last step, at 100 and 150 %.", {
  host: { mode: "interactive", storage: {} },
  steps: [
    { expect: { state: "running", text: ["Your Steam profile", "Continue"] } },
    ...layouts("profile", ["line", "compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("profile-150", ["standard"]),
    { host: { locale: "fr", scale: 1000 } },
    ...layouts("profile-fr", ["line", "compact", "standard"]),
  ],
});

scenario("passive", "No profile yet, in Passive mode: no field, a line to switch mode.", {
  host: { storage: {} },
  steps: [
    { expect: { state: "running", text: ["Switch to Interactive mode to enter your Steam profile."] } },
    ...layouts("passive", ["line", "standard"]),
    { host: { locale: "fr" } },
    ...layouts("passive-fr", ["line", "standard"]),
  ],
});

scenario("profile-invalid", "A store link is not a profile: refused before any request, with an example.", {
  host: { mode: "interactive", storage: {} },
  steps: [
    { pointer: { click: { label: "Link to your Steam profile" } } },
    { text: "store.steampowered.com/app/1874000" },
    { key: { key: "Enter" } },
    { expect: { text: [" This is not a Steam profile link. Example: steamcommunity.com/id/yourname"], calls: [{ service: "account.subscribe", outcome: "ok" }, { service: "storage.get", outcome: "ok" }] } },
    ...layouts("profile-invalid", ["compact", "standard"]),
  ],
});

scenario("profile-notfound", "A custom name Steam does not know: said under the field.", {
  host: { mode: "interactive", storage: {} },
  http: [fixture(urls.vanity("ashen_kn1ght"), json(200, { response: { success: 42, message: "No match" } }))],
  steps: [
    { pointer: { click: { label: "Link to your Steam profile" } } },
    { text: "steamcommunity.com/id/ashen_kn1ght" },
    { pointer: { click: { label: "Continue" } } },
    { expect: { text: [" No Steam profile at this link. Check it and try again."], fault: "none" } },
    ...layouts("profile-notfound", ["standard"]),
    { host: { locale: "fr" } },
    ...layouts("profile-notfound-fr", ["standard"]),
  ],
});

scenario("profile-found", "A custom name resolves: kept, and the achievements show.", {
  host: { mode: "interactive", storage: {} },
  http: [fixture(urls.vanity("nova_player"), json(200, { response: { steamid: ID, success: 1 } })), ...reads(ASHEN)],
  steps: [
    { pointer: { click: { label: "Link to your Steam profile" } } },
    { text: "https://steamcommunity.com/id/nova_player/" },
    { key: { key: "Enter" } },
    { expect: { text: ["Ashen Crown", "12 / 40"], fault: "none" } },
  ],
});

scenario("change-profile", "Change Steam profile…: the current link, and Cancel back to the achievements.", {
  host: { mode: "interactive" },
  http: reads(ASHEN),
  steps: [
    { expect: { state: "running", text: ["12 / 40"] } },
    { menu: { id: "change-profile" } },
    { expect: { text: ["Your Steam profile", "Cancel"] } },
    ...layouts("change-profile", ["compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("change-profile-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    ...layouts("change-profile-fr", ["compact", "standard"]),
    { host: { scale: 1500 } },
    ...layouts("change-profile-fr-150", ["compact", "standard"]),
    { host: { locale: "en", scale: 1000 } },
    { pointer: { click: { text: "Cancel" } } },
    { expect: { text: ["12 / 40"], noText: ["Your Steam profile"], fault: "none" } },
  ],
});

// --- failures: values kept, cause and age said.
scenario("unreachable", "Steam stops answering in game (network, then 503): the values stay, the heading says Unreachable and how old the data is, never Playing now.", {
  http: [
    ...reads(ASHEN, { minutes: 0 }),
    failure(urls.summary, "transport_failed"),
    ...repeat(4, () => failure(urls.summary, "timeout")),
    fixture(urls.summary, json(503, {})),
  ],
  steps: [
    { expect: { state: "running", text: ["Playing now"] } },
    { advance: { ms: MIN } },
    { expect: { noText: ["Playing now"], text: ["Unreachable · 1 min ago"] } },
    { advance: { ms: 4 * MIN } },
    { expect: { text: ["Unreachable · 5 min ago", "12 / 40"], fault: "none" } },
    ...layouts("unreachable"),
    { host: { scale: 1500 } },
    ...layouts("unreachable-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    { expect: { text: ["Injoignable · il y a 5 min"] } },
    ...layouts("unreachable-fr", ["compact", "standard"]),
    { advance: { ms: MIN } },
    { expect: { text: ["Injoignable · il y a 6 min"], fault: "none" } },
  ],
});

scenario("quota", "Steam limits the requests (429): the values stay, Rate limited and the age.", {
  http: [...reads(ASHEN, { minutes: 0 }), ...repeat(3, () => fixture(urls.summary, json(429, {})))],
  steps: [
    { advance: { ms: 2 * MIN } },
    { expect: { text: ["Rate limited · 2 min ago"], fault: "none" } },
    ...layouts("quota", ["line", "standard"]),
    { host: { locale: "fr" } },
    ...layouts("quota-fr", ["line", "compact", "standard"]),
  ],
});

scenario("empty-unreachable", "Steam unreachable at the very first start: no value yet, say so.", {
  host: { storage: { ...profile } },
  http: [failure(urls.summary, "resolve_failed")],
  steps: [
    { expect: { state: "running", text: ["Steam unreachable. Retrying every minute."], fault: "none" } },
    ...layouts("empty-unreachable", ["line", "standard"]),
    { host: { locale: "fr" } },
    ...layouts("empty-unreachable-fr", ["line", "standard"]),
  ],
});

scenario("refused", "Steam refuses the key (403, and the host's probe too): PlayerVox OverCrow's panel covers the widget, nothing else is read.", {
  host: { frame: true },
  http: [fixture(urls.summary, json(403, {})), fixture(urls.probe, json(403, {}))],
  steps: [
    { expect: { state: "running", image: "refused", fault: "none" } },
    { advance: { ms: 3 * MIN } },
    { host: { locale: "fr" } },
    { expect: { image: "refused-fr", fault: "none" } },
  ],
});

scenario("playing-only-when-confirmed", "After Playing now, one failed read: the heading is no longer Playing now.", {
  http: [...reads(ASHEN, { minutes: 0 }), failure(urls.summary, "timeout")],
  steps: [
    { expect: { state: "running", text: ["Playing now"] } },
    { advance: { ms: MIN } },
    { expect: { noText: ["Playing now"], text: ["Unreachable · 1 min ago"], fault: "none" } },
  ],
});

// --- options.
// French only where the option changes a text or an order.
const option = (name, description, values, list, french = false) =>
  scenario(name, description, {
    host: { options: values },
    http: reads(ASHEN),
    steps: [
      { expect: { state: "running" } },
      ...layouts(name, list),
      ...(french ? [{ host: { locale: "fr" } }, ...layouts(`${name}-fr`, list)] : []),
    ],
  });
option("opt-missing-only", "Only missing achievements: 28 missing, the next one in Standard, one list in Full.", { "missing-only": true }, ["line", "compact", "standard", "full"], true);
option("opt-rarest", "Missing achievements, rarest first.", { "missing-only": true, order: "rarest" }, ["full"]);
option("opt-by-name", "Missing achievements by name, in each language's names.", { "missing-only": true, order: "name" }, ["full"], true);
option("opt-no-rarity", "Rarity off: no percentages, the description instead.", { "show-rarity": false }, ["standard", "full"]);
option("opt-reveal-hidden", "Hidden achievements revealed.", { "reveal-hidden": true, "missing-only": true }, ["full"]);
option("opt-rows", "One row per list.", { rows: 1 }, ["full"]);
option("opt-rows-5", "Five rows per list.", { rows: 5 }, ["full"]);
option("opt-no-logo", "Steam logo off: the word Steam in its place.", { "show-logo": false }, ["compact", "standard", "full"]);

// --- tracking.
scenario("track", "Track achievements…: the checklist, one tracked on its own card, three in one card, the others greyed at three, then all unticked.", {
  host: { mode: "interactive" },
  http: reads(ASHEN, { minutes: 2, unlockedNow: {} }),
  steps: [
    { expect: { state: "running" } },
    { menu: { id: "track" } },
    { expect: { text: ["Track achievements", "0 / 3", "Up to 3. They stay at the top of the widget.", "Endless Night"] } },
    ...layouts("picker", ["standard", "full"]),
    { host: { locale: "fr" } },
    ...layouts("picker-fr", ["standard"]),
    { host: { locale: "en" } },
    { pointer: { click: { label: "Endless Night" } } },
    { expect: { text: ["1 / 3"], fault: "none" } },
    { pointer: { click: { text: "Done" } } },
    { expect: { text: ["Tracked achievement", "Endless Night"], noText: ["Track achievements"] } },
    ...layouts("tracked", ["standard", "full"]),
    { menu: { id: "track" } },
    { pointer: { click: { label: "Eye of the Abyss" } } },
    { pointer: { click: { label: "Deep Key" } } },
    { expect: { text: ["3 / 3", "Limit reached: untick one to add another."], noText: ["Up to 3."], fault: "none" } },
    // A greyed row does nothing.
    { pointer: { click: { label: "Flawless Gem" } } },
    { expect: { text: ["3 / 3"], fault: "none" } },
    ...layouts("picker-max", ["standard"]),
    { host: { locale: "fr" } },
    ...layouts("picker-max-fr", ["standard"]),
    { host: { locale: "en" } },
    { pointer: { click: { text: "Done" } } },
    { expect: { text: ["Tracked", "Endless Night", "Eye of the Abyss", "Deep Key"], noText: ["Tracked achievement", "Latest achievement"], fault: "none" } },
    ...layouts("tracked-many", ["compact", "standard", "full"]),
    { host: { locale: "fr" } },
    ...layouts("tracked-many-fr", ["standard"]),
    { host: { locale: "en" } },
    { menu: { id: "track" } },
    { pointer: { click: { label: "Endless Night, tracked" } } },
    { pointer: { click: { label: "Eye of the Abyss, tracked" } } },
    { pointer: { click: { label: "Deep Key, tracked" } } },
    { expect: { text: ["0 / 3"] } },
    { pointer: { click: { text: "Done" } } },
    { expect: { noText: ["Tracked achievement", "Tracked"], text: ["Latest achievement"], fault: "none" } },
  ],
});

scenario("tracked-done", "A tracked achievement unlocks: green check and Unlocked … ago, until it is unticked; with three tracked, it goes last.", {
  host: { storage: { ...profile, tracked: [{ appid: ASHEN.appid, ids: ["A13"] }] } },
  http: [
    ...repeat(1, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(1, () => fixture(urls.player(ASHEN), player(ASHEN))),
    ...reads(ASHEN, { minutes: 3, unlockedNow: { A13: 0 } }),
  ],
  steps: [
    { expect: { state: "running", text: ["Tracked achievement", "Endless Night"] } },
    { advance: { ms: 3 * MIN } },
    { expect: { text: ["Unlocked 3 min ago"], fault: "none" } },
    ...layouts("tracked-done", ["standard"]),
    { host: { locale: "fr" } },
    ...layouts("tracked-done-fr", ["standard"]),
  ],
});

scenario("tracked-many-done", "Three tracked, the first unlocks: checked in green, last of the card, still tracked.", {
  host: { storage: { ...profile, tracked: [{ appid: 1, ids: ["X"] }, { appid: ASHEN.appid, ids: ["A13", "A10", "A11"] }] } },
  http: [
    ...repeat(1, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(1, () => fixture(urls.player(ASHEN), player(ASHEN))),
    ...reads(ASHEN, { minutes: 3, unlockedNow: { A13: 0 } }),
  ],
  steps: [
    { expect: { state: "running", text: ["Tracked", "Endless Night", "Eye of the Abyss", "Deep Key"] } },
    { advance: { ms: 3 * MIN } },
    { expect: { text: ["Unlocked 3 min ago"], fault: "none" } },
    ...layouts("tracked-many-done", ["standard", "full"]),
    { host: { locale: "fr" } },
    ...layouts("tracked-many-done-fr", ["standard"]),
  ],
});

// --- images.
scenario("images", "Image failures never show a hole: an icon refused, a header missing on both hosts (the game's icon instead, the name as title), a redirection refused; old hosts set on the declared one.", {
  http: [
    ...reads(ASHEN).filter((entry) => !entry.request.url.includes("/header.jpg")),
    failure(urls.header(ASHEN), "redirect_denied", false),
    fixture(urls.headerCdn(ASHEN), { status: 404, contentType: "text/html", body: "Not found" }, false),
  ],
  steps: [
    { expect: { state: "running", text: ["Ashen Crown"], fault: "none" } },
    ...layouts("images", ["compact", "standard", "full"]),
  ],
});

// A recent game: Steam serves its icons only under /community_assets/ and
// has no store image without the hash only the store's API names.
const RECENT = { ...ASHEN, appid: 4_078_000, name: "Tidewater Run", icon: "game-tide" };
scenario("recent-game", "A recent game: icons named by current URLs and by file name alone, all shown from the one path that serves them; no store image on either host, the game's icon instead.", {
  http: [
    ...reads(RECENT).filter((entry) => !entry.request.url.includes("/header.jpg") && !entry.request.url.includes("GetSchemaForGame")),
    fixture(urls.schema(RECENT), schema(RECENT, "english", "current")),
    fixture(urls.schema(RECENT, "french"), schema(RECENT, "french", "file")),
    fixture(urls.header(RECENT), { status: 404, contentType: "text/html", body: "Not found" }, false),
    fixture(urls.headerCdn(RECENT), { status: 404, contentType: "text/html", body: "Not found" }, false),
  ],
  steps: [
    { expect: { state: "running", text: ["Tidewater Run"], fault: "none" } },
    ...layouts("recent", ["line", "standard", "full"]),
    { host: { locale: "fr" } },
    { advance: { ms: MIN } },
    ...layouts("recent-fr", ["full"]),
  ],
});

// --- rhythm.
scenario("cadence", "Ten minutes in game: one summary and one achievements read a minute, the schema and the rarity once.", {
  http: reads(ASHEN, { minutes: 10 }),
  steps: [
    { expect: { state: "running" } },
    { advance: { ms: 10 * MIN } },
    { expect: { fault: "none", text: ["12 / 40"] } },
  ],
});

scenario("hidden", "Hidden, nothing is called; shown again after an hour, one read.", {
  http: reads(ASHEN, { minutes: 2 }),
  steps: [
    { expect: { state: "running" } },
    { host: { visible: false } },
    { advance: { ms: 60 * MIN } },
    { host: { visible: true } },
    { expect: { fault: "none", text: ["Playing now", "12 / 40"] } },
  ],
});

// --- catalog preview: Standard, 300 wide, dark, English, 150 %, logo off.
scenario("preview", "The catalog preview: Standard at 300 px, dark, English, 150 %, Steam logo off. Fictional game and figures.", {
  host: { scale: 1500, background: STAGE, size: { width: 300, height: 184 }, options: { "show-logo": false } },
  http: reads(ASHEN),
  steps: [{ expect: { state: "running", text: ["Ashen Crown", "Crown of Ashes"], image: "preview", fault: "none" } }],
});

// --- a very large game: thousands of achievements, within the turn budget.
const HUGE = {
  appid: 1_874_200,
  name: "Endless Archive",
  header: "header-courier",
  icon: "game-tide",
  achievements: Array.from({ length: Number(process.env.HUGE ?? 1500) }, (_, n) => ({
    api: `ARCHIVE_ENTRY_${n}`, en: `Archive entry ${n + 1}`, fr: `Archive, entrée ${n + 1}`, ic: (n % 9) + 1,
    ago: n % 3 === 0 ? 10_000 + n : null, rarity: n % 7 === 0 ? null : (n % 97) + 0.5,
    descEn: `Entry ${n + 1}`, descFr: `Entrée ${n + 1}`,
    hidden: n % 50 === 0, icon: n < 30,
  })),
};
scenario("large-game", "A game of 1,500 achievements: read, sorted and shown in Full without a fault; its list stays in memory when too large to store.", {
  host: { options: { layout: "full" }, size: { width: 340, height: 200 } },
  http: [
    ...repeat(3, () => fixture(urls.summary, summary({ playing: HUGE }))),
    fixture(urls.recent, recent([HUGE])),
    fixture(urls.schema(HUGE), schema(HUGE, "english")),
    ...repeat(3, () => fixture(urls.player(HUGE), player(HUGE))),
    fixture(urls.rarity(HUGE), rarity(HUGE), false),
    ...images(HUGE),
  ],
  steps: [
    { expect: { state: "running", text: ["Reading your achievements…"], fault: "none" } },
    // Slices of 200 achievements, one VM turn each, 100 ms apart.
    { advance: { ms: 30000 } },
    { expect: { text: ["500 / 1,500", "Archive entry 1"], fault: "none" } },
    { advance: { ms: 2 * MIN } },
    { expect: { fault: "none", state: "running", image: "full" } },
  ],
});
