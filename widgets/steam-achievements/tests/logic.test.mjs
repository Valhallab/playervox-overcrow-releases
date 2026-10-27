// Unit tests of the pure readers of Steam achievements on @overcrow/sdk/testing:
// profile links, the answers of each Steam route, image paths and texts.
// The answers are synthetic: no request reaches Steam.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { installRuntime } from "@overcrow/sdk/testing";

import { loadLogic } from "./load-logic.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const EN = read("../locales/en.json");
const FR = read("../locales/fr.json");
const vm = installRuntime({ host: { messages: EN, grants: ["storage", "network", "account:steam"] }, accounts: { steam: "signed_out" } });
const logic = await loadLogic();

const ID = "76561198000000000";

test("profile links in every form people copy them", () => {
  const id = { kind: "id", steamid: ID };
  const nova = { kind: "vanity", name: "Nova_Player" };
  for (const [input, expected] of [
    [`https://steamcommunity.com/profiles/${ID}/`, id],
    [`steamcommunity.com/profiles/${ID}?l=french`, id],
    [`http://www.steamcommunity.com/profiles/${ID}#top`, id],
    [`  ${ID} `, id],
    ["www.steamcommunity.com/id/Nova_Player/", nova],
    ["HTTPS://STEAMCOMMUNITY.COM/id/Nova_Player", nova],
    ["Nova_Player", nova],
    ["https://store.steampowered.com/app/10", null],
    ["steamcommunity.com/id/", null],
    ["7656119800000000", null],
    ["12345", null],
    ["javascript:alert(1)", null],
    ["steamcommunity.com/id/nova player", null],
    ["steamcommunity.com/id/nóva", null],
    ["steamcommunity.com/profiles/123", null],
    ["x".repeat(300), null],
    ["", null],
  ]) {
    assert.deepEqual(logic.parseProfileInput(input), expected, input);
  }
});

test("the answers of the vanity and summary routes", () => {
  assert.deepEqual(logic.parseVanity({ response: { success: 1, steamid: ID } }), { steamid: ID });
  assert.equal(logic.parseVanity({ response: { success: 42, message: "No match" } }), "notfound");
  assert.equal(logic.parseVanity({ response: { success: 1, steamid: "1" } }), null);
  assert.equal(logic.parseVanity(null), null);

  const player = (extra) => ({ response: { players: [{ steamid: ID, communityvisibilitystate: 3, ...extra }] } });
  assert.deepEqual(logic.parseSummary(player({ gameid: "1091500", gameextrainfo: "Ashen Crown" }), ID), {
    visible: true, appid: 1091500, gameName: "Ashen Crown",
  });
  assert.deepEqual(logic.parseSummary(player({}), ID), { visible: true, appid: null, gameName: null });
  assert.deepEqual(logic.parseSummary(player({ communityvisibilitystate: 1 }), ID), { visible: false, appid: null, gameName: null });
  assert.equal(logic.parseSummary({ response: { players: [] } }, ID), "notfound");
  assert.equal(logic.parseSummary({ response: { players: [{ steamid: "x", communityvisibilitystate: 3 }] } }, ID), null);
  assert.equal(logic.parseSummary(player({ communityvisibilitystate: "3" }), ID), null);
  assert.equal(logic.parseSummary(player({ gameid: "../1" }), ID).appid, null);
  assert.equal(logic.parseSummary([], ID), null);
});

test("recently played games, and the private answer without a count", () => {
  const hash = "a".repeat(40);
  assert.deepEqual(
    logic.parseRecent({ response: { total_count: 2, games: [
      { appid: 10, name: "Courier", img_icon_url: hash },
      { appid: 0, name: "Zero" },
      { appid: 11, name: "Tidewater", img_icon_url: "../x" },
    ] } }),
    { games: [{ appid: 10, name: "Courier", icon: hash }, { appid: 11, name: "Tidewater", icon: "" }], hidden: false },
  );
  assert.deepEqual(logic.parseRecent({ response: { total_count: 0 } }), { games: [], hidden: false });
  assert.deepEqual(logic.parseRecent({ response: {} }), { games: [], hidden: true });
  assert.equal(logic.parseRecent({ response: { total_count: 1, games: {} } }), null);
  assert.equal(logic.parseRecent(null), null);
});

test("player achievements, the schema and the rarity", () => {
  const unlocked = logic.parsePlayerAchievements({ playerstats: { steamID: ID, success: true, achievements: [
    { apiname: "A", achieved: 1, unlocktime: 1700000000 },
    { apiname: "B", achieved: 0, unlocktime: 0 },
    { apiname: "C", achieved: 1 },
  ] } });
  assert.deepEqual([...unlocked], [["A", 1700000000], ["C", 0]]);
  assert.equal(logic.parsePlayerAchievements({ playerstats: { error: "Profile is not public", success: false } }), null);
  // Steam's refusals of the achievements, as it sends them.
  assert.equal(logic.refusal(403, { playerstats: { error: "Profile is not public", success: false } }), "hidden");
  assert.equal(logic.refusal(403, null), "hidden");
  assert.equal(logic.refusal(200, { playerstats: { error: "Profile is not public", success: false } }), "hidden");
  assert.equal(logic.refusal(400, { playerstats: { error: "Requested app has no stats", success: false } }), "unreadable");
  assert.equal(logic.refusal(200, { playerstats: { steamID: "76561198000000000", gameName: "Ashen Crown", success: false } }), "unreadable");
  assert.equal(logic.refusal(200, { playerstats: { steamID: "76561198000000000", success: true, achievements: [] } }), null);
  assert.equal(logic.refusal(500, { playerstats: { error: "Internal error", success: false } }), null);
  assert.equal(logic.refusal(404, null), null);

  const file = `${"b".repeat(40)}.jpg`;
  const schema = logic.parseSchema({ game: { gameName: "Ashen Crown", availableGameStats: { achievements: [
    { name: "A", displayName: "Crown of Ashes", description: "Win", hidden: 0,
      icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/7/${file}`,
      icongray: `http://media.steampowered.com/steamcommunity/public/images/apps/7/${file}` },
    { name: "B", displayName: "Deep Key", hidden: 1, icon: "https://cdn.fastly.steamstatic.com/steamcommunity/public/images/apps/8/x.jpg", icongray: "https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/7/../7/x.jpg" },
  ] } } }, 7);
  assert.deepEqual(schema, [
    { api: "A", name: "Crown of Ashes", desc: "Win", hidden: false, icon: file, iconGray: file },
    { api: "B", name: "Deep Key", desc: "", hidden: true, icon: "", iconGray: "" },
  ]);
  assert.deepEqual(logic.parseSchema({ game: {} }, 7), []);
  assert.deepEqual(logic.parseSchema({ game: { availableGameStats: { stats: [] } } }, 7), []);
  assert.equal(logic.parseSchema({}, 7), null);

  const rarity = logic.parsePercentages({ achievementpercentages: { achievements: [
    { name: "A", percent: 4.2 }, { name: "B", percent: "15.5" }, { name: "C" }, { name: "D", percent: 101 },
  ] } });
  assert.deepEqual([...rarity], [["A", 4.2], ["B", 15.5]]);
});

test("player achievements asked with l: names and descriptions, nothing hidden, no icon", () => {
  assert.deepEqual(logic.namedItem({ apiname: "A1", achieved: 1, unlocktime: 5, name: "Crown of Ashes", description: "Claim the throne" }), {
    api: "A1", name: "Crown of Ashes", desc: "Claim the throne", hidden: false, icon: "", iconGray: "",
  });
  // Without a name, the API name; without a description, none.
  assert.deepEqual(logic.namedItem({ apiname: "A2", achieved: 0, unlocktime: 0 }), { api: "A2", name: "A2", desc: "", hidden: false, icon: "", iconGray: "" });
  assert.equal(logic.namedItem({ apiname: "", name: "x" }), null);
  assert.equal(logic.namedItem({ name: "x" }), null);
  assert.equal(logic.namedItem("x"), null);
});

test("images are asked from the declared hosts only", () => {
  const file = `${"c".repeat(40)}.jpg`;
  // Every form Steam gives: old and current paths on any host, or the file alone.
  assert.equal(logic.iconFile(7, `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/7/${file}`), file);
  assert.equal(logic.iconFile(7, `https://shared.fastly.steamstatic.com/community_assets/images/apps/7/${file}`), file);
  assert.equal(logic.iconFile(7, `https://cdn.akamai.steamstatic.com/community_assets/images/apps/7/A3_DOORS_BW.jpg`), "A3_DOORS_BW.jpg");
  assert.equal(logic.iconFile(7, file), file);
  assert.equal(logic.iconFile(7, "A3_DOORS.jpg"), "A3_DOORS.jpg");
  // Another game, another folder, an encoded slash, another type: nothing.
  assert.equal(logic.iconFile(7, `https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/8/${file}`), "");
  assert.equal(logic.iconFile(7, `https://shared.akamai.steamstatic.com/community_assets/images/apps/8/${file}`), "");
  assert.equal(logic.iconFile(7, `https://shared.akamai.steamstatic.com/community_assets/images/items/7/${file}`), "");
  assert.equal(logic.iconFile(7, "https://x.test/steamcommunity/public/images/apps/7/a%2F.jpg"), "");
  assert.equal(logic.iconFile(7, "https://x.test/community_assets/images/apps/7/../7/a.jpg"), "");
  assert.equal(logic.iconFile(7, "https://x.test/steamcommunity/public/images/apps/7/a.png"), "");
  assert.equal(logic.iconFile(7, "../a.jpg"), "");
  assert.equal(logic.iconFile(7, `${"a".repeat(61)}.jpg`), "");
  // The one path that serves recent games too.
  assert.equal(logic.iconUrl(7, file), `https://shared.akamai.steamstatic.com/community_assets/images/apps/7/${file}`);
  assert.equal(logic.gameIconUrl(7, "d".repeat(40)), `https://shared.akamai.steamstatic.com/community_assets/images/apps/7/${"d".repeat(40)}.jpg`);
  assert.equal(logic.gameIconUrl(7, "zz"), "");
  assert.deepEqual(logic.headerUrls(7), [
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/7/header.jpg",
    "https://cdn.akamai.steamstatic.com/steam/apps/7/header.jpg",
  ]);
});

test("backoff: 1, 2, 4, 8, then 10 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => logic.backoff(n) / 60_000), [1, 2, 4, 8, 10, 10]);
});

test("texts follow the locale and the number format", () => {
  assert.equal(logic.percentOf(12, 40), "30%");
  assert.equal(logic.ago(3 * 60_000), "3 min ago");
  assert.equal(logic.age(5 * 60_000), "5 min ago");
  assert.equal(logic.age(10_000), "just now");
  assert.equal(logic.num(1284), "1,284");
  vm.setHost({ locale: "fr", messages: FR, region: { numberFormat: "fr", dateOrder: "dmy", offsetMinutes: 0 } });
  assert.equal(logic.percentOf(12, 40), "30 %");
  assert.equal(logic.ago(3 * 60_000), "il y a 3 min");
  assert.equal(logic.ago(3 * 1440 * 60_000), "il y a 3 j");
  assert.equal(logic.num(1284), "1\u00a0284");
});

test("the short warning names the cause and the age, in both languages", () => {
  for (const [messages, unreachable, quota] of [
    [EN, "Unreachable · 5 min ago", "Rate limited · 2 min ago"],
    [FR, "Injoignable · il y a 5 min", "Limité · il y a 2 min"],
  ]) {
    vm.setHost({ messages, locale: messages === EN ? "en" : "fr" });
    const now = 1_000_000_000;
    assert.equal(logic.eyebrow({ stale: "unreachable", now, readAt: now - 5 * 60_000, game: null }), unreachable);
    assert.equal(logic.eyebrow({ stale: "quota", now, readAt: now - 2 * 60_000, game: null }), quota);
  }
});

test("every text key the logic and the view use exists in both languages", () => {
  const source = readFileSync(new URL("../logic.ts", import.meta.url), "utf8") + readFileSync(new URL("../view.ocml", import.meta.url), "utf8");
  const keys = new Set([...source.matchAll(/\bt\("([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const key of ["stale-unreachable", "stale-quota", "stale-unreachable-tip", "stale-quota-tip"]) keys.add(key);
  for (const key of keys) {
    assert.ok(key in EN, `en: ${key}`);
    assert.ok(key in FR, `fr: ${key}`);
  }
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(FR).sort());
});

test("tracked achievements: three per game, twenty games, anything else dropped", () => {
  assert.deepEqual([...logic.parseTracked(null)], []);
  assert.deepEqual([...logic.parseTracked({ appid: 7, api: "A" })], []);
  assert.deepEqual([...logic.parseTracked([
    { appid: 7, ids: ["A", "B", "A", "C", "D"] },
    { appid: 0, ids: ["A"] },
    { appid: 8, ids: [] },
    { appid: 9, ids: [1, "", "x".repeat(129), "E"] },
    { appid: "10", ids: ["F"] },
  ])], [[7, ["A", "B", "C"]], [9, ["E"]]]);
  const many = Array.from({ length: 25 }, (_, n) => ({ appid: n + 1, ids: ["A"] }));
  const kept = logic.parseTracked(many);
  assert.equal(kept.size, logic.TRACKED_GAMES);
  assert.equal([...kept.keys()][0], 6, "the most recent twenty");
  assert.equal(logic.MAX_TRACKED, 3);
});

test("the manifest reads only, never a trade route", () => {
  const manifest = read("../manifest.json");
  const allowed = ["/ISteamUser/", "/IPlayerService/", "/ISteamUserStats/"];
  for (const rule of manifest.permissions.network) {
    assert.equal(rule.method, "GET", rule.path);
    if (rule.origin === "https://api.steampowered.com") {
      assert.ok(allowed.some((prefix) => rule.path.startsWith(prefix)), rule.path);
    } else {
      assert.ok(["https://cdn.akamai.steamstatic.com", "https://shared.akamai.steamstatic.com"].includes(rule.origin), rule.origin);
      assert.equal(rule.account, undefined, "no key towards an image host");
    }
    assert.ok(!/IEconService|Trade|Market/i.test(rule.path), rule.path);
  }
  assert.deepEqual(manifest.permissions.accounts, [{ service: "steam", events: ["stats.saved"], local: ["achievements"] }]);
});

test("by name: no accents or case, œ as oe", () => {
  const names = ["Œil du gouffre", "Zéphyr, épreuve 1", "Clé des profondeurs", "étoile", "Abri"];
  assert.deepEqual([...names].sort((a, b) => (logic.sortKey(a) < logic.sortKey(b) ? -1 : 1)), [
    "Abri", "Clé des profondeurs", "étoile", "Œil du gouffre", "Zéphyr, épreuve 1",
  ]);
});

test("a large answer is read in slices, whatever its spacing, the array alone", () => {
  const items = Array.from({ length: 450 }, (_, n) => ({ name: `A_${n}`, displayName: `Name, with }] and "quotes" ${n}`, hidden: 0 }));
  const stats = [{ name: "STAT_1", defaultvalue: 0 }, { name: "STAT_2", defaultvalue: 1 }];
  const value = { game: { gameName: "Big", availableGameStats: { achievements: items, stats } } };
  // Steam pretty-prints its answers with tabs; compact answers read the same.
  for (const text of [JSON.stringify(value), JSON.stringify(value, null, "\t"), JSON.stringify(value, null, 2)]) {
    const reader = new logic.ItemReader(text, "achievements");
    const read = [];
    for (let slice; (slice = reader.step()) !== null; ) read.push(...slice);
    assert.equal(read.length, 450, "the stats after the list are not achievements");
    assert.deepEqual(read[449], items[449]);
    assert.equal(reader.found, true);
  }
  const empty = new logic.ItemReader(JSON.stringify({ game: { availableGameStats: { achievements: [] } } }, null, "\t"), "achievements");
  assert.equal(empty.step(), null);
  assert.equal(empty.found, true);
  const none = new logic.ItemReader(JSON.stringify({ game: {} }), "achievements");
  assert.equal(none.step(), null);
  assert.equal(none.found, false, "no list is not an empty list");
  // A key inside a string is not the list.
  const inside = new logic.ItemReader('{"note":"see \\"achievements\\": [1]","achievements":[{"name":"a"}]}', "achievements");
  assert.deepEqual(inside.step(), [{ name: "a" }]);
  const cut = new logic.ItemReader('{"achievements":[{"name":"a"},{"name":"b"', "achievements");
  assert.throws(() => {
    while (cut.step() !== null);
  });
});

test("the best few, in order, without sorting everything", () => {
  const values = Array.from({ length: 1000 }, (_, n) => (n * 7919) % 1000);
  assert.deepEqual(logic.best(values, 5, (a, b) => a > b), [999, 998, 997, 996, 995]);
  assert.deepEqual(logic.best([3, 1, 2], 0, (a, b) => a < b), []);
  assert.deepEqual(logic.best([3, 1, 2], 5, (a, b) => a < b), [1, 2, 3]);
});
