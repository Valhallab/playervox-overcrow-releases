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
  player: (game, l = null) => `${API}/ISteamUserStats/GetPlayerAchievements/v1/?steamid=${ID}&appid=${game.appid}` + (l === null ? "" : `&l=${l}`),
  schema: (game, l = "english") => `${API}/ISteamUserStats/GetSchemaForGame/v2/?appid=${game.appid}&l=${l}`,
  rarity: (game) => `${API}/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/?gameid=${game.appid}`,
  vanity: (name) => `${API}/ISteamUser/ResolveVanityURL/v1/?vanityurl=${name}`,
  header: (game) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${game.appid}/header.jpg`,
  headerCdn: (game) => `https://cdn.akamai.steamstatic.com/steam/apps/${game.appid}/header.jpg`,
  probe: `${API}/ISteamWebAPIUtil/GetSupportedAPIList/v1/`,
};

/**
 * GetPlayerSummaries as Steam sends it. A private profile (1) keeps only its
 * public fields. The running game only with a public profile and public game
 * details: Steam's privacy page says Game details also decide whether you
 * are seen in game and which game.
 */
function summary({ playing = null, visible = 3, details = "public" } = {}) {
  const player = { steamid: ID, communityvisibilitystate: visible, profilestate: 1, personaname: "Nova", commentpermission: 1, profileurl: `https://steamcommunity.com/profiles/${ID}/`, personastate: 1 };
  if (visible === 3) Object.assign(player, { lastlogoff: at(30), timecreated: 1_400_000_000, personastateflags: 0 });
  if (playing !== null && visible === 3 && details === "public") Object.assign(player, { gameid: String(playing.appid), gameextrainfo: playing.name });
  return json(200, { response: { players: [player] } });
}
/** GetRecentlyPlayedGames; `{}` when Steam hides the games; playtime 0 when the player keeps it private. */
function recent(games, hidden = false, { playtime = true } = {}) {
  if (hidden) return json(200, { response: {} });
  if (games.length === 0) return json(200, { response: { total_count: 0 } });
  const time = (minutes) => (playtime ? minutes : 0);
  return json(200, { response: { total_count: games.length, games: games.map((game) => ({ appid: game.appid, name: game.name, playtime_2weeks: time(300), playtime_forever: time(3000), img_icon_url: ICON_HASH[game.icon], playtime_windows_forever: time(3000), playtime_mac_forever: 0, playtime_linux_forever: 0, playtime_deck_forever: 0 })) } });
}
/** Steam's refusals of GetPlayerAchievements, as other projects measured them in 2026. */
const NOT_PUBLIC = () => json(403, { playerstats: { error: "Profile is not public", success: false } });
/** The host checks the key after a 403 of an account route: it still works. */
const probes = (count) => repeat(count, () => fixture(urls.probe, json(200, { apilist: { interfaces: [] } })));
const NO_STATS = () => json(400, { playerstats: { error: "Requested app has no stats", success: false } });
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
  // A game without achievements nor stats: `{ "game": {} }`, nothing else.
  if (achievements.length === 0) return json(200, { game: {} });
  return json(200, { game: { gameName: game.name, gameVersion: "12", availableGameStats: { achievements, stats } } });
}
function player(game, unlockedNow = {}, l = null) {
  const achievements = game.achievements.map((a) => {
    const ago = a.api in unlockedNow ? unlockedNow[a.api] : a.ago;
    const item = { apiname: a.api, achieved: ago === null ? 0 : 1, unlocktime: ago === null ? 0 : at(ago) };
    // With `l`, Steam adds the name and description, nothing about hidden ones.
    if (l !== null) Object.assign(item, { name: l === "french" ? a.fr : a.en, description: l === "french" ? a.descFr : a.descEn });
    return item;
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

/** `steam.achievements.local`: what the Steam client of this computer saved. */
const LOCAL = "steam.achievements.local";
/** Nothing on this computer (Steam elsewhere): every scenario's default. */
const NOTHING_HERE = () => ({ error: "unavailable" });
/** This computer's unlocked achievements of `game`, newest first, as the host answers. */
function localPage(game, unlockedNow = {}) {
  const achievements = game.achievements
    .map((a) => {
      const ago = a.api in unlockedNow ? unlockedNow[a.api] : a.ago;
      return ago === null ? null : { name: a.api, unlockedAt: at(ago) * 1000 };
    })
    .filter((item) => item !== null)
    .sort((a, b) => b.unlockedAt - a.unlockedAt || (a.name < b.name ? -1 : 1));
  return { value: { appid: game.appid, total: achievements.length, achievements } };
}

function scenario(name, description, { host = {}, http = [], subscriptions, confirmations, calls = { [LOCAL]: repeat(8, NOTHING_HERE) }, steps }) {
  const fixtures = { calls, http };
  if (subscriptions !== undefined) fixtures.subscriptions = subscriptions;
  if (confirmations !== undefined) fixtures.confirmations = confirmations;
  const value = {
    scenarioVersion: 1,
    name,
    description,
    host: { startAt: START, storage: { ...profile }, ...host },
    fixtures,
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

// --- what Steam hides: said instead of a game, with where to change it.
const RUNE = { appid: 1_874_300, name: "Rune Table", header: "header-courier", icon: "game-tide", achievements: ASHEN.achievements };
/** Steam's answers while the game details are Friends Only, for `minutes` minutes. */
const detailsHidden = (minutes = 11) => [
  ...repeat(minutes + 1, () => fixture(urls.summary, summary({ playing: RUNE, details: "friends" }))),
  ...repeat(2, () => fixture(urls.recent, recent([ASHEN]))),
  fixture(urls.schema(ASHEN), schema(ASHEN, "english")),
  fixture(urls.schema(ASHEN, "french"), schema(ASHEN, "french")),
  ...repeat(2, () => fixture(urls.player(ASHEN), NOT_PUBLIC())),
  ...probes(4),
];
scenario("details-hidden", "Game details Friends Only: Steam names no running game and refuses the achievements of the last one played (403 Profile is not public); said with where to set them Public, no game guessed.", {
  http: detailsHidden(),
  steps: [
    { expect: { state: "running", text: ["Game details hidden", "Steam hides your game details. Set them to Public (Friends Only is not enough)."], noText: ["Ashen Crown", "Rune Table", "Playing now", "Last game played"], fault: "none" } },
    ...layouts("details-hidden"),
    { host: { scale: 1500 } },
    ...layouts("details-hidden-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    { expect: { text: ["Détails de jeu cachés", "Steam cache vos détails de jeu. Réglez-les sur Public (Amis uniquement ne suffit pas)."] } },
    ...layouts("details-hidden-fr"),
    { host: { scale: 1500 } },
    ...layouts("details-hidden-fr-150", ["compact", "standard"]),
    { host: { theme: "light", scale: 1000 } },
    ...layouts("details-hidden-fr-light", ["standard"]),
    // Ten minutes later, asked once again: still hidden, no loop.
    { advance: { ms: 10 * MIN } },
    { expect: { text: ["Détails de jeu cachés"], fault: "none" } },
  ],
});

scenario("details-hidden-after-game", "In game, then the game details go Friends Only: at the next minute the game is no longer shown as running nor guessed; the hidden details are said.", {
  http: [
    ...reads(ASHEN, { minutes: 0 }),
    ...repeat(3, () => fixture(urls.summary, summary({ playing: ASHEN, details: "friends" }))),
    fixture(urls.recent, recent([ASHEN])),
    fixture(urls.player(ASHEN), NOT_PUBLIC()),
    ...probes(2),
  ],
  steps: [
    { expect: { state: "running", text: ["Playing now", "12 / 40"] } },
    { advance: { ms: MIN } },
    { expect: { text: ["Game details hidden"], noText: ["Playing now", "Ashen Crown"], fault: "none" } },
  ],
});

scenario("profile-hidden", "A private profile: Steam keeps only its public fields; said with where to set it Public, nothing else asked.", {
  http: [...repeat(3, () => fixture(urls.summary, summary({ playing: ASHEN, visible: 1 })))],
  steps: [
    { expect: { state: "running", text: ["Profile hidden", "Steam hides your profile. Set it to Public, and your game details too."], fault: "none" } },
    ...layouts("profile-hidden"),
    { host: { locale: "fr" } },
    { expect: { text: ["Profil caché"] } },
    ...layouts("profile-hidden-fr"),
  ],
});

// --- the button to Steam's privacy settings (Interactive mode only).
const OPEN_EN = "Open Steam settings";
const NOTES = ["Allow “Open web pages” in the Control Center.", "Your browser didn't open. Try again."];
scenario("settings-link", "Game details Friends Only, in Interactive mode: under the path, a button opens Steam's privacy settings (in One line, the icon alone). PlayerVox OverCrow asks the first time for steamcommunity.com: declined, nothing said; accepted, the page opens; the next click opens it without asking.", {
  host: { mode: "interactive" },
  http: detailsHidden(1),
  confirmations: ["cancel", "accept"],
  steps: [
    { expect: { state: "running", text: ["Game details hidden", OPEN_EN], fault: "none" } },
    ...layouts("settings-link"),
    { host: { scale: 1500 } },
    ...layouts("settings-link-150"),
    { host: { locale: "fr", scale: 1000 } },
    { expect: { text: ["Ouvrir les réglages Steam"] } },
    ...layouts("settings-link-fr"),
    { host: { scale: 1500 } },
    ...layouts("settings-link-fr-150"),
    { host: { theme: "light", scale: 1000, locale: "en" } },
    ...layouts("settings-link-light", ["standard"]),
    { host: { theme: "dark" } },
    // Declined in the host's panel, then accepted, then without the panel.
    { pointer: { click: { text: OPEN_EN } } },
    { expect: { text: [OPEN_EN], noText: NOTES, fault: "none" } },
    { pointer: { click: { text: OPEN_EN } } },
    { expect: { text: [OPEN_EN], noText: NOTES, fault: "none" } },
    { pointer: { click: { text: OPEN_EN } } },
    { expect: { text: [OPEN_EN], noText: NOTES, fault: "none" } },
  ],
});

scenario("settings-link-profile", "A private profile, in Interactive mode: the same button under the path to My profile and Game details.", {
  host: { mode: "interactive" },
  http: [...repeat(3, () => fixture(urls.summary, summary({ playing: ASHEN, visible: 1 })))],
  steps: [
    { expect: { state: "running", text: ["Profile hidden", OPEN_EN], fault: "none" } },
    ...layouts("settings-link-profile"),
    { host: { locale: "fr" } },
    ...layouts("settings-link-profile-fr"),
  ],
});

scenario("settings-link-refused", "\"Open web pages\" unticked at install: the click is refused by PlayerVox OverCrow, and the button gives way to what to allow, and where (in One line, in its tooltip).", {
  host: { mode: "interactive", grants: ["account:steam", "game.read", "network", "storage"] },
  http: detailsHidden(1),
  steps: [
    { expect: { state: "running", text: [OPEN_EN], fault: "none" } },
    { menu: { id: "layout", value: "standard" } },
    { pointer: { click: { text: OPEN_EN } } },
    { expect: { text: [NOTES[0]], noText: [OPEN_EN], fault: "none" } },
    ...layouts("settings-link-refused", ["line", "compact", "standard", "full"]),
    { host: { locale: "fr" } },
    { expect: { text: ["Autorisez «\u00a0Ouvrir des pages web\u00a0» dans le Centre de contrôle."] } },
    ...layouts("settings-link-refused-fr", ["compact", "standard"]),
  ],
});

scenario("not-readable", "Steam names the running game but refuses its achievements (403 with public details: a game the player does not own): the game stays, a neutral line instead of the bar, no guess.", {
  http: [
    ...repeat(2, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(2, () => fixture(urls.recent, recent([COURIER]))),
    fixture(urls.schema(ASHEN), schema(ASHEN, "english")),
    fixture(urls.schema(ASHEN, "french"), schema(ASHEN, "french")),
    ...repeat(3, () => fixture(urls.player(ASHEN), NOT_PUBLIC())),
    ...probes(6),
    fixture(urls.rarity(ASHEN), rarity(ASHEN), false),
    ...images(ASHEN),
  ],
  steps: [
    { expect: { state: "running", text: ["Playing now", "Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile."], noText: ["borrowed", "no Steam achievements"], fault: "none" } },
    ...layouts("not-readable", ["line", "compact", "standard", "full"]),
    { host: { scale: 1500 } },
    ...layouts("not-readable-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    { expect: { text: ["Steam ne donne pas vos succès pour ce jeu. Vérifiez que vos détails de jeu sont Publics dans votre profil Steam."], noText: ["prêté"] } },
    ...layouts("not-readable-fr", ["line", "compact", "standard", "full"]),
    { host: { scale: 1500 } },
    ...layouts("not-readable-fr-150", ["compact", "standard"]),
  ],
});

// --- the user's number format: the numbers follow it as soon as it changes.
scenario("region", "Numbers follow the host's number format, not the language, as soon as it changes: us 4.2% then fr 4,2% and de 4,2%, without waiting for the next read.", {
  host: { region: { numberFormat: "us" } },
  http: reads(ASHEN),
  steps: [
    { menu: { id: "layout", value: "standard" } },
    { host: { size: { width: WIDTH.standard, height: 200 } } },
    { expect: { state: "running", text: ["3 min ago · 4.2% of players"], fault: "none", image: "region-us" } },
    { host: { region: { numberFormat: "fr" } } },
    { expect: { text: ["3 min ago · 4,2% of players"], noText: ["4.2%"], image: "region-fr" } },
    { host: { region: { numberFormat: "de" } } },
    { expect: { text: ["3 min ago · 4,2% of players"], noText: ["4.2%"] } },
  ],
});

scenario("no-stats", "Steam answers 400 Requested app has no stats although the game lists achievements: the same neutral line, never 'no achievements', no server failure.", {
  http: [
    ...repeat(3, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(2, () => fixture(urls.recent, recent([ASHEN]))),
    fixture(urls.schema(ASHEN), schema(ASHEN, "english")),
    ...repeat(2, () => fixture(urls.player(ASHEN), NO_STATS())),
    fixture(urls.rarity(ASHEN), rarity(ASHEN), false),
    ...images(ASHEN),
  ],
  steps: [
    { expect: { state: "running", text: ["Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile."], noText: ["no Steam achievements", "Unreachable"], fault: "none" } },
    { advance: { ms: 2 * MIN } },
    { expect: { text: ["Playing now", "Steam doesn't share your achievements for this game. Check that your game details are Public in your Steam profile."], noText: ["Unreachable"], fault: "none" } },
  ],
});

scenario("borrowed", "A game borrowed through Steam Families, readable: Steam names it as running and gives its achievements, though it is not among the recent games; shown as any game.", {
  http: [
    ...reads(RUNE, { recentGames: [ASHEN] }),
  ],
  steps: [
    { expect: { state: "running", text: ["Rune Table", "Playing now", "12 / 40"], fault: "none" } },
    ...layouts("borrowed", ["standard"]),
  ],
});

scenario("playtime-private", "Total playtime kept private: Steam lists the recent games with no time; out of game, the last game played as usual.", {
  http: reads(ASHEN, { playing: false }).map((entry) => (entry.request.url === urls.recent ? fixture(urls.recent, recent([ASHEN], false, { playtime: false })) : entry)),
  steps: [{ expect: { state: "running", text: ["Last game played", "12 / 40"], fault: "none" } }],
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
    { expect: { text: [" This is not a Steam profile link. Example: steamcommunity.com/id/yourname"], calls: [{ service: "game.subscribe" }, { service: "account.subscribe", outcome: "ok" }, { service: "storage.get", outcome: "ok" }] } },
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

scenario("retry-after", "Steam limits the requests and says when to try again (429, Retry-After: 300): the profile route is not asked again for 5 minutes, Rate limited meanwhile; then the game as before.", {
  http: [
    ...reads(ASHEN, { minutes: 0 }),
    fixture(urls.summary, { ...json(429, {}), headers: { "retry-after": "300" } }),
    ...repeat(2, () => fixture(urls.summary, summary({ playing: ASHEN }))),
    ...repeat(2, () => fixture(urls.player(ASHEN), player(ASHEN))),
  ],
  steps: [
    { expect: { state: "running", text: ["Playing now"], fault: "none" } },
    { advance: { ms: MIN } },
    { expect: { text: ["Rate limited · 1 min ago"], fault: "none" } },
    // A request within the 5 minutes would read the game again.
    { advance: { ms: 4 * MIN } },
    { expect: { text: ["Rate limited · 5 min ago"], noText: ["Playing now"], fault: "none" } },
    ...layouts("retry-after", ["line", "standard"]),
    { advance: { ms: MIN } },
    { expect: { text: ["Playing now"], fault: "none" } },
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

// --- local Steam events (PlayerVox OverCrow 0.9): the Steam client of this
// computer saved the stats of a game of the followed account.
const EVENTS = "steam.events.subscribe";
const LIVE = { subscriptions: { [EVENTS]: { state: "live", reason: null, events: [] } } };
const saved = (seq, game, atMs) => ({
  publish: { service: EVENTS, value: { state: "live", reason: null, events: [{ seq, type: "stats.saved", at: atMs, data: { appid: game.appid } }] } },
});
/** The reads of `game` at start, then `players` more of its achievements (`unlockedNow` after the first `from`), and `summaries` more summaries. */
function eventReads(game, { summaries, players, from = 0, unlockedNow = { A13: 0 } }) {
  return [
    ...repeat(1 + summaries, () => fixture(urls.summary, summary({ playing: game }))),
    fixture(urls.recent, recent([game])),
    fixture(urls.schema(game), schema(game, "english")),
    fixture(urls.schema(game, "french"), schema(game, "french")),
    ...repeat(1 + players, (_, n) => fixture(urls.player(game), player(game, n > from ? unlockedNow : {}))),
    fixture(urls.rarity(game), rarity(game), false),
    ...images(game),
  ];
}

scenario("event-reads-now", "A save of the game shown: its achievements read at once, Endless Night shown 5 s after the unlock; then the minute.", {
  ...LIVE,
  http: eventReads(ASHEN, { summaries: 1, players: 1 }),
  steps: [
    { expect: { state: "running", text: ["12 / 40"] } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 5_000),
    { expect: { text: ["13 / 40", "Endless Night", "New"], fault: "none" } },
    // The minute's tick reads the summary; the achievements, read 55 s ago, wait.
    { advance: { ms: 56_000 } },
    { expect: { text: ["13 / 40"], fault: "none" } },
  ],
});

scenario("event-follow-ups", "Steam's answer lags behind its client: read at once, again at +10 s, and at +30 s it shows the unlock; then nothing until a minute after.", {
  ...LIVE,
  http: eventReads(ASHEN, { summaries: 2, players: 4, from: 2 }),
  steps: [
    { expect: { state: "running", text: ["12 / 40"] } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 5_000),
    { expect: { text: ["12 / 40"], fault: "none" } },
    { advance: { ms: 10_000 } },
    { expect: { text: ["12 / 40"], fault: "none" } },
    { advance: { ms: 19_000 } },
    { expect: { text: ["12 / 40"], fault: "none" } },
    { advance: { ms: 1_000 } },
    { expect: { text: ["13 / 40", "Endless Night"], fault: "none" } },
    // No third look; the minute reads the achievements a minute after the last look.
    { advance: { ms: 90_000 } },
    { expect: { text: ["13 / 40"], fault: "none" } },
  ],
});

scenario("no-signal-cadence", "Without the local signal (Steam elsewhere, an older Steam): one summary and one achievements read a minute, as before.", {
  subscriptions: { [EVENTS]: { state: "off", reason: "unavailable", events: [] } },
  http: reads(ASHEN, { minutes: 10 }),
  steps: [
    { expect: { state: "running" } },
    { advance: { ms: 10 * MIN } },
    { expect: { fault: "none", text: ["12 / 40"] } },
  ],
});

scenario("event-while-hidden", "A save while hidden: nothing is read; shown again 10 s later, the achievements at once.", {
  ...LIVE,
  http: eventReads(ASHEN, { summaries: 0, players: 1 }),
  steps: [
    { expect: { state: "running", text: ["12 / 40"] } },
    { advance: { ms: 5_000 } },
    { host: { visible: false } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 10_000),
    { advance: { ms: 10_000 } },
    { host: { visible: true } },
    { expect: { text: ["13 / 40", "Endless Night"], fault: "none" } },
  ],
});

// --- the game PlayerVox OverCrow says is running (PlayerVox OverCrow 0.9):
// first, even when Steam's presence names none (Invisible, offline).
const GAME = "game.subscribe";
const hostGame = (game) => ({ steamAppId: game.appid, name: game.name });

scenario("invisible-host-game", "Status Invisible: Steam names no game and the last one played is Neon Courier; the host's game, Ashen Crown, shows as playing with its achievements.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: reads(ASHEN, { playing: false, recentGames: [COURIER, ASHEN] }),
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40"], noText: ["Neon Courier", "Last game played"], fault: "none" } },
    ...layouts("invisible-host-game", ["standard"]),
  ],
});

scenario("host-game-switch", "Status Invisible: the host's game changes from Ashen Crown to Neon Courier; read at once, the new game alone.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: [
    ...reads(ASHEN, { minutes: 0, playing: false, recentGames: [ASHEN] }),
    fixture(urls.summary, summary({ playing: null })),
    fixture(urls.recent, recent([COURIER, ASHEN])),
    fixture(urls.schema(COURIER), schema(COURIER, "english")),
    ...images(COURIER),
  ],
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "12 / 40"] } },
    { advance: { ms: 10_000 } },
    { publish: { service: GAME, value: hostGame(COURIER) } },
    { expect: { text: ["Neon Courier", "Playing now", "This game has no Steam achievements."], noText: ["Ashen Crown", "12 / 40"], fault: "none" } },
    ...layouts("host-game-switch", ["standard"]),
  ],
});

scenario("host-game-out-of-focus", "Status Invisible: the game loses the focus (the host gives no game), then gets it back. The host's last game stays shown, as the last one played, never Steam's lagging recent list; back in the game, playing again, nothing read anew.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: reads(ASHEN, { minutes: 3, playing: false, recentGames: [COURIER, ASHEN] }),
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40"] } },
    // Past the minute: Steam's recent list may be read again.
    { advance: { ms: 70_000 } },
    { publish: { service: GAME, value: null } },
    { expect: { text: ["Ashen Crown", "Last game played", "12 / 40"], noText: ["Neon Courier", "Playing now"], fault: "none" } },
    ...layouts("host-game-out-of-focus", ["standard"]),
    { advance: { ms: 10_000 } },
    { publish: { service: GAME, value: hostGame(ASHEN) } },
    { expect: { text: ["Ashen Crown", "Playing now", "12 / 40"], noText: ["Neon Courier"], fault: "none" } },
  ],
});

scenario("host-game-no-steam-id", "A game outside the Steam store (steamAppId null) and no game Steam names: the last game played, as before.", {
  subscriptions: { [GAME]: { steamAppId: null, name: "Manual game" }, ...LIVE.subscriptions },
  http: reads(ASHEN, { playing: false }),
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Last game played"], noText: ["Manual game", "Playing now"], fault: "none" } },
    ...layouts("host-game-no-steam-id", ["standard"]),
  ],
});

scenario("steam-offline-host-game", "Steam's offline mode: no game named, the host's game shows with the achievements Steam knows; back online, Steam saves the stats and the new achievement shows.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: [
    ...repeat(1, () => fixture(urls.summary, summary({ playing: null }))),
    fixture(urls.recent, recent([COURIER, ASHEN])),
    fixture(urls.schema(ASHEN), schema(ASHEN, "english")),
    fixture(urls.schema(ASHEN, "french"), schema(ASHEN, "french")),
    fixture(urls.player(ASHEN), player(ASHEN)),
    fixture(urls.player(ASHEN), player(ASHEN, { A13: 0 })),
    fixture(urls.rarity(ASHEN), rarity(ASHEN), false),
    ...images(ASHEN),
  ],
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40"], fault: "none" } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 5_000),
    { expect: { text: ["13 / 40", "Endless Night", "New"], fault: "none" } },
  ],
});

// --- the achievements the Steam client of this computer saved
// (`steam.achievements.local`, PlayerVox OverCrow 0.9): there the moment
// they unlock, whatever the game details' privacy.
const atStart = (game, players, { details = "public" } = {}) => [
  ...repeat(2, () => fixture(urls.summary, summary({ playing: null, details }))),
  ...repeat(2, () => fixture(urls.recent, recent([COURIER, game]))),
  fixture(urls.schema(game), schema(game, "english")),
  fixture(urls.schema(game, "french"), schema(game, "french")),
  ...players,
  fixture(urls.rarity(game), rarity(game), false),
  ...images(game),
];

scenario("local-unlock-now", "Status Invisible: Endless Night unlocks; Steam on this computer has it at once while Steam's Web API does not yet: shown at once, New, no Web API read; the Web API still lags at the next minute (shown all the same), then confirms it.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: [
    ...atStart(ASHEN, [...repeat(2, () => fixture(urls.player(ASHEN), player(ASHEN))), fixture(urls.player(ASHEN), player(ASHEN, { A13: 0 }))]),
    fixture(urls.summary, summary({ playing: null })),
  ],
  calls: { [LOCAL]: [localPage(ASHEN), ...repeat(4, () => localPage(ASHEN, { A13: 0 }))] },
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40"], fault: "none" } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 5_000),
    { expect: { text: ["13 / 40", "Endless Night", "New"], fault: "none" } },
    ...layouts("local-unlock-now", ["standard"]),
    // The minute: Steam's Web API does not have it yet; still 13.
    { advance: { ms: 56_000 } },
    { expect: { text: ["13 / 40", "Endless Night"], fault: "none" } },
    // The next: it does, the same 13.
    { advance: { ms: MIN } },
    { expect: { text: ["13 / 40", "Endless Night"], noText: ["New"], fault: "none" } },
  ],
});

scenario("local-details-hidden", "Game details Friends Only and status Invisible: Steam refuses the achievements (403), but this computer has those of the game PlayerVox OverCrow says is running: Ashen Crown shows as usual, named by its list, with its rarity; no hidden-details notice.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: [...atStart(ASHEN, repeat(2, () => fixture(urls.player(ASHEN), NOT_PUBLIC())), { details: "friends" }), ...probes(4)],
  calls: { [LOCAL]: repeat(6, () => localPage(ASHEN)) },
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40", "Crown of Ashes"], noText: ["Game details hidden"], fault: "none" } },
    ...layouts("local-details-hidden"),
    { host: { scale: 1500 } },
    ...layouts("local-details-hidden-150", ["compact", "standard"]),
    { host: { locale: "fr", scale: 1000 } },
    { expect: { text: ["Ashen Crown", "Couronne de cendres"], noText: ["Détails de jeu cachés"] } },
    ...layouts("local-details-hidden-fr"),
    { host: { scale: 1500 } },
    ...layouts("local-details-hidden-fr-150", ["compact", "standard"]),
    { host: { theme: "light", scale: 1000 } },
    ...layouts("local-details-hidden-fr-light", ["standard"]),
  ],
});

scenario("local-steam-offline", "Steam's offline mode: Steam on this computer saves Endless Night, which Steam's Web API will not have until Steam is back online; shown at once, and still shown at the next minutes' reads.", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: [...atStart(ASHEN, repeat(3, () => fixture(urls.player(ASHEN), player(ASHEN)))), ...repeat(2, () => fixture(urls.summary, summary({ playing: null })))],
  calls: { [LOCAL]: [localPage(ASHEN), ...repeat(6, () => localPage(ASHEN, { A13: 0 }))] },
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "12 / 40"], fault: "none" } },
    { advance: { ms: 5_000 } },
    saved(1, ASHEN, START + 5_000),
    { expect: { text: ["13 / 40", "Endless Night", "New"], fault: "none" } },
    { advance: { ms: 2 * MIN } },
    { expect: { text: ["13 / 40", "Endless Night"], fault: "none" } },
  ],
});

scenario("local-unavailable", "Nothing on this computer (Steam elsewhere): exactly as before, the host's game from Steam's Web API (same image as invisible-host-game).", {
  subscriptions: { [GAME]: hostGame(ASHEN), ...LIVE.subscriptions },
  http: reads(ASHEN, { playing: false, recentGames: [COURIER, ASHEN] }),
  calls: { [LOCAL]: repeat(4, NOTHING_HERE) },
  steps: [
    { expect: { state: "running", text: ["Ashen Crown", "Playing now", "12 / 40"], noText: ["Neon Courier", "Last game played"], fault: "none" } },
    ...layouts("local-unavailable", ["standard"]),
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

// --- thousands of achievements: Steam's cap (5,000), and a game from before it.
const lore = (count) => Array.from({ length: count }, (_, n) => ({
  api: `LORE_PAGE_${n}`, en: `Lore page ${n + 1}`, fr: `Page de savoir ${n + 1}`, ic: (n % 9) + 1,
  ago: n % 4 === 0 ? 20_000 + n : null, rarity: n % 11 === 0 ? null : (n % 97) + 0.5,
  descEn: "Find the lore page hidden in the old archive", descFr: "Trouver la page de savoir cachée dans les vieilles archives",
  hidden: n % 100 === 99, icon: true,
}));
// A recent game: no store header on either host, its icon and name instead.
const noHeader = (game) => [
  fixture(urls.header(game), { status: 404, contentType: "text/html", body: "Not found" }, false),
  fixture(urls.headerCdn(game), { status: 404, contentType: "text/html", body: "Not found" }, false),
];
const ARCHIVE = { appid: 1_874_500, name: "Endless Archive", header: "header-courier", icon: "game-tide", achievements: lore(5000) };
// In French, as the mockups are: one list (French) to answer.
const NB = "\u00a0";
scenario("huge-game", "5,000 achievements, Steam's cap, in French: a list of about 2.4 MiB within the schema's 3 MiB bound. The count shows within seconds from the player's achievements, the names once the list is read; the checklist has a search and adds 50 rows at a time. No fault.", {
  host: { locale: "fr", region: { numberFormat: "fr", dateOrder: "dmy" }, options: { layout: "standard" }, size: { width: WIDTH.standard, height: 200 } },
  http: [
    ...repeat(3, () => fixture(urls.summary, summary({ playing: ARCHIVE }))),
    fixture(urls.recent, recent([ARCHIVE])),
    fixture(urls.schema(ARCHIVE, "french"), schema(ARCHIVE, "french")),
    ...repeat(3, () => fixture(urls.player(ARCHIVE), player(ARCHIVE))),
    fixture(urls.rarity(ARCHIVE), rarity(ARCHIVE), false),
    ...images(ARCHIVE).filter((entry) => !entry.request.url.includes("/header.jpg")),
    ...noHeader(ARCHIVE),
  ],
  steps: [
    { advance: { ms: 4000 } },
    { expect: { state: "running", text: ["Endless Archive", `1${NB}250 / 5${NB}000`, "Lecture de vos succès…"], fault: "none", image: "progressive" } },
    { advance: { ms: 40_000 } },
    { expect: { text: [`1${NB}250 / 5${NB}000`, "Page de savoir 1"], noText: ["Lecture de vos succès…"], fault: "none", image: "standard" } },
    { menu: { id: "layout", value: "full" } },
    { host: { size: { width: WIDTH.full, height: 200 } } },
    { expect: { fault: "none", image: "full" } },
    { menu: { id: "layout", value: "standard" } },
    { host: { mode: "interactive", size: { width: WIDTH.standard, height: 200 } } },
    { menu: { id: "track" } },
    { expect: { text: ["Suivre des succès", "0 / 3"], fault: "none", image: "pick" } },
    ...repeat(4, () => ({ pointer: { wheel: { target: { at: [150, 150] }, dx: 0, dy: 100 } } })),
    { expect: { text: ["50 de plus"], fault: "none", image: "pick-more" } },
    { pointer: { click: { text: "50 de plus" } } },
    ...repeat(8, () => ({ pointer: { wheel: { target: { at: [150, 150] }, dx: 0, dy: 100 } } })),
    { expect: { text: ["50 de plus"], fault: "none" } },
    { pointer: { click: { label: "Chercher un succès" } } },
    { text: "savoir 123" },
    { expect: { text: ["Page de savoir 123", "Page de savoir 1239"], noText: ["50 de plus"], fault: "none", image: "pick-search" } },
  ],
});

const VAULT = { appid: 1_874_600, name: "Endless Vault", header: "header-courier", icon: "game-tide", achievements: lore(12_000) };
scenario("huge-game-beyond", "12,000 achievements, a game from before Steam's cap: its list exceeds the schema's bound (the host refuses it), so the names come from the player's achievements asked with l (about 2.4 MiB within 3 MiB), with the generic icon. Never a refusal, no warning, no fault.", {
  host: { options: { layout: "standard" }, size: { width: WIDTH.standard, height: 200 } },
  http: [
    ...repeat(3, () => fixture(urls.summary, summary({ playing: VAULT }))),
    fixture(urls.recent, recent([VAULT])),
    failure(urls.schema(VAULT), "response_body_limit"),
    ...repeat(2, () => fixture(urls.player(VAULT), player(VAULT))),
    fixture(urls.player(VAULT, "english"), player(VAULT, {}, "english")),
    fixture(urls.rarity(VAULT), rarity(VAULT), false),
    fixture(`${ICON_HOST}/${VAULT.appid}/${ICON_HASH[VAULT.icon]}.jpg`, jpeg(VAULT.icon), false),
    ...noHeader(VAULT),
  ],
  steps: [
    { advance: { ms: 10_000 } },
    { expect: { state: "running", text: ["Endless Vault", "3,000 / 12,000"], noText: ["Unreachable"], fault: "none", image: "progressive" } },
    { advance: { ms: 50_000 } },
    { expect: { text: ["3,000 / 12,000", "Lore page 1"], noText: ["Reading your achievements…", "Unreachable"], fault: "none", image: "standard" } },
    { menu: { id: "layout", value: "full" } },
    { host: { size: { width: WIDTH.full, height: 200 } } },
    { expect: { fault: "none", image: "full" } },
    { host: { mode: "interactive" } },
    { menu: { id: "track" } },
    { expect: { text: ["Track achievements"], fault: "none", image: "pick" } },
  ],
});
