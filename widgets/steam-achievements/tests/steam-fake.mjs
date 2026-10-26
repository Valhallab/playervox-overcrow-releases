// A synthetic Steam for the engine tests: answers the widget's routes from a
// small in-memory account, and the host's storage from a map. No request
// leaves the test.
export const ID = "76561198000000000";
const API = "https://api.steampowered.com";
export const PNG = "asset:png";

export function achievementsOf(count, prefix = "ACH") {
  return Array.from({ length: count }, (_, index) => ({
    name: `${prefix}_${index}`,
    displayName: `Achievement ${index}`,
    description: `Do thing ${index}`,
    hidden: index === count - 1 ? 1 : 0,
    icon: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/1/${String(index).padStart(40, "a")}.jpg`,
    icongray: `https://steamcdn-a.akamaihd.net/steamcommunity/public/images/apps/1/${String(index).padStart(40, "b")}.jpg`,
  }));
}

export function fakeSteam() {
  const steam = {
    visible: 3,
    /** Game details: `public`, `friends` (Friends Only) or `private`. */
    details: "public",
    playing: null,
    recentHidden: false,
    recent: [],
    vanity: { nova_player: ID },
    games: {},
    /** A failure of every API route: `{ status }` or `{ error }`. */
    fail: null,
    /** Per route: a status for that route only. */
    routeStatus: {},
    /**
     * The manifest's response bounds, applied as the host does: a larger
     * answer fails with `response_body_limit`. `null` turns them off.
     */
    bounds: null,
    images: { fail: new Set() },
    requests: [],
    storage: new Map(),
    refusedWrites: 0,
    handle(url) {
      steam.requests.push(url);
      const parsed = new URL(url);
      const query = Object.fromEntries(parsed.searchParams);
      if (parsed.origin !== API) {
        if (steam.images.fail.has(url)) return { error: "redirect_denied" };
        return { value: { status: 200, asset: `asset:${url.length}` } };
      }
      if (steam.fail !== null) return steam.fail.error ? { error: steam.fail.error } : json(steam.fail.status, {});
      const path = parsed.pathname;
      for (const [route, status] of Object.entries(steam.routeStatus)) {
        if (path.includes(route)) return json(status, status === 400 ? { playerstats: { error: "Requested app has no stats", success: false } } : {});
      }
      if (path === "/ISteamUser/ResolveVanityURL/v1/") {
        const steamid = steam.vanity[query.vanityurl.toLowerCase()];
        return json(200, { response: steamid ? { success: 1, steamid } : { success: 42, message: "No match" } });
      }
      if (path === "/ISteamUser/GetPlayerSummaries/v2/") {
        if (query.steamids !== ID) return json(200, { response: { players: [] } });
        const player = { steamid: ID, communityvisibilitystate: steam.visible };
        // The running game only with a public profile and public game details.
        if (steam.playing !== null && steam.visible === 3 && steam.details === "public") {
          player.gameid = String(steam.playing);
          player.gameextrainfo = steam.games[steam.playing]?.name ?? "Game";
        }
        return json(200, { response: { players: [player] } });
      }
      if (path === "/IPlayerService/GetRecentlyPlayedGames/v1/") {
        if (steam.recentHidden || steam.visible !== 3) return json(200, { response: {} });
        return json(200, { response: { total_count: steam.recent.length, games: steam.recent.map((appid) => ({ appid, name: steam.games[appid].name, img_icon_url: "e".repeat(40) })) } });
      }
      const game = steam.games[query.appid ?? query.gameid];
      if (path === "/ISteamUserStats/GetSchemaForGame/v2/") {
        if (game === undefined) return json(400, {});
        const name = (a) => (query.l === "french" ? `${a.displayName} (fr)` : a.displayName);
        return bounded(steam, "schema", json(200, { game: { gameName: game.name, availableGameStats: game.schema.length === 0 ? {} : { achievements: game.schema.map((a) => ({ ...a, displayName: name(a) })) } } }));
      }
      if (path === "/ISteamUserStats/GetPlayerAchievements/v1/") {
        // Anything but public game details: 403, even to the account's own key.
        if (steam.visible !== 3 || steam.details !== "public") return json(403, { playerstats: { error: "Profile is not public", success: false } });
        // An answer of its own (Steam's other refusals).
        if (game?.answer !== undefined) return json(game.answer.status, game.answer.body);
        // A game the player does not own (and does not borrow): the same 403,
        // with public game details (measured by other projects in 2026).
        if (game?.owned === false) return json(403, { playerstats: { error: "Profile is not public", success: false } });
        if (game === undefined || game.schema.length === 0 || game.noStats === true) return json(400, { playerstats: { error: "Requested app has no stats", success: false } });
        // With `l`, Steam adds each achievement's name and description; as
        // in Steam's answers, `success` closes it.
        const named = (a) => (query.l === undefined ? {} : { name: query.l === "french" ? `${a.displayName} (fr)` : a.displayName, description: a.description });
        return bounded(steam, "player" + (query.l === undefined ? "" : ":l"), json(200, { playerstats: { steamID: ID, gameName: game.name, achievements: game.schema.map((a) => ({ apiname: a.name, achieved: a.name in game.unlocked ? 1 : 0, unlocktime: game.unlocked[a.name] ?? 0, ...named(a) })), success: true } }));
      }
      if (path === "/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/") {
        return bounded(steam, "rarity", json(200, { achievementpercentages: { achievements: (game?.schema ?? []).map((a, index) => ({ name: a.name, percent: 50 - index })) } }));
      }
      return json(404, {});
    },
    count(fragment) {
      return steam.requests.filter((url) => url.includes(fragment)).length;
    },
  };
  return steam;
}

/** The manifest's `maxResponseBytes` of each route, by name. */
export const MANIFEST_BOUNDS = { schema: 3 * 1024 * 1024, player: 3 * 1024 * 1024, "player:l": 3 * 1024 * 1024, rarity: 2 * 1024 * 1024 };

function bounded(steam, route, answer) {
  const bound = steam.bounds?.[route];
  return bound !== undefined && Buffer.byteLength(answer.value.body) > bound ? { error: "response_body_limit" } : answer;
}

// The widget reads answers as text (large ones are parsed in slices).
function json(status, body) {
  return { value: { status, contentType: "application/json", body: JSON.stringify(body) } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Answers every waiting call as the host and Steam would, until none is left. */
export async function settle(vm, steam, { delay = 0 } = {}) {
  for (let round = 0; round < 200; round += 1) {
    await flush();
    const open = vm.calls.filter((call) => !call.settled);
    if (open.length === 0) {
      await flush();
      if (vm.calls.every((call) => call.settled)) return;
      continue;
    }
    for (const call of open) {
      if (call.service === "storage.get") call.resolve(steam.storage.get(call.params.key) ?? null);
      else if (call.service === "storage.set") {
        // The host's quotas: 64 KiB per value, 256 KiB in all (UTF-8 JSON).
        const size = (value) => Buffer.byteLength(JSON.stringify(value));
        const next = new Map(steam.storage);
        next.set(call.params.key, call.params.value);
        const total = [...next].reduce((sum, [key, value]) => sum + Buffer.byteLength(key) + size(value), 0);
        if (size(call.params.value) > 64 * 1024 || total > 256 * 1024) {
          steam.refusedWrites += 1;
          call.reject("quota_exceeded");
          continue;
        }
        steam.storage.set(call.params.key, structuredClone(call.params.value));
        call.resolve(null);
      } else if (call.service === "storage.remove") {
        steam.storage.delete(call.params.key);
        call.resolve(null);
      } else if (call.service === "http.fetch") {
        // A real network takes time: the next request starts later.
        if (delay > 0) vm.advance(delay);
        const answer = steam.handle(call.params.url);
        if (answer.error) call.reject(answer.error);
        else call.resolve(answer.value);
      } else call.reject("unavailable");
    }
  }
  throw new Error("calls never settle");
}

/** Moves the virtual time minute by minute, settling after each tick. */
export async function minutes(vm, steam, count, options = {}) {
  for (let index = 0; index < count; index += 1) {
    vm.advance(60_000);
    await settle(vm, steam, options);
  }
}
