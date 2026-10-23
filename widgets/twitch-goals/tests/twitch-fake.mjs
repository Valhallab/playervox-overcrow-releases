// A synthetic Twitch for the engine tests: answers the widget's routes from a
// small in-memory channel. No request leaves the test, no token exists.
export const NOVA = "141981764";
export const OTHER = "500000001";
const API = "https://api.twitch.tv";

export function fakeTwitch() {
  const twitch = {
    /** The account the (fictitious) token belongs to. */
    user: NOVA,
    goals: [],
    total: 1284,
    followers: [],
    /** The running Hype Train, or null. */
    train: null,
    /** A failure of every route: `{ status }` or `{ error }`. */
    fail: null,
    /** Per route path: a status for that route only. */
    routeStatus: {},
    requests: [],
    handle(url) {
      twitch.requests.push(url);
      const parsed = new URL(url);
      if (parsed.origin !== API) throw new Error(`unexpected origin ${url}`);
      if (twitch.fail !== null) return twitch.fail.error ? { error: twitch.fail.error } : json(twitch.fail.status, {});
      const path = parsed.pathname;
      if (path in twitch.routeStatus) return json(twitch.routeStatus[path], {});
      const query = Object.fromEntries(parsed.searchParams);
      if (path === "/helix/users") return json(200, { data: [{ id: twitch.user, login: "novalive", display_name: "NovaLive" }] });
      // Twitch refuses another channel than the token's.
      if (query.broadcaster_id !== twitch.user) return { value: { status: 401, contentType: "", body: "" } };
      if (path === "/helix/goals") return json(200, { data: twitch.goals });
      if (path === "/helix/channels/followers") {
        if (query.first !== "1") throw new Error("followers read with first=1 only");
        return json(200, { total: twitch.total, data: twitch.followers.slice(0, 1), pagination: {} });
      }
      if (path === "/helix/hypetrain/status") return json(200, { data: [{ current: twitch.train, all_time_high: null, shared_all_time_high: null }] });
      return json(404, {});
    },
    count(fragment) {
      return twitch.requests.filter((url) => url.includes(fragment)).length;
    },
  };
  return twitch;
}

export function goal(id, fields = {}) {
  return {
    id, broadcaster_id: NOVA, broadcaster_name: "NovaLive", broadcaster_login: "novalive",
    type: "follower", description: "Road to 1,300", current_amount: 37, target_amount: 50,
    created_at: "2026-01-01T09:00:00Z", ...fields,
  };
}
export function follower(id, name, at) {
  return { user_id: id, user_login: name.toLowerCase(), user_name: name, followed_at: new Date(at).toISOString() };
}
export function train(now, leftS, fields = {}) {
  return {
    id: "train-1", level: 2, total: 1700, progress: 640, goal: 1000,
    started_at: new Date(now - 60_000).toISOString(), expires_at: new Date(now + leftS * 1000).toISOString(),
    type: "regular", is_shared_train: false, top_contributions: [], shared_train_participants: null, ...fields,
  };
}

function json(status, body) {
  return { value: { status, contentType: "application/json", body: JSON.stringify(body) } };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Answers every waiting call as the host and Twitch would, until none is left. */
export async function settle(vm, twitch) {
  for (let round = 0; round < 100; round += 1) {
    await flush();
    const open = vm.calls.filter((call) => !call.settled);
    if (open.length === 0) {
      await flush();
      if (vm.calls.every((call) => call.settled)) return;
      continue;
    }
    for (const call of open) {
      if (call.service === "http.fetch") {
        const answer = twitch.handle(call.params.url);
        if (answer.error) call.reject(answer.error);
        else call.resolve(answer.value);
      } else call.reject("unavailable");
    }
  }
  throw new Error("calls never settle");
}

/** Moves the virtual time tick by tick (20 s), Twitch answering each one. */
export async function seconds(vm, twitch, count) {
  for (let left = count * 1000; left > 0; left -= 20_000) {
    vm.advance(Math.min(20_000, left));
    await settle(vm, twitch);
  }
}

/** Moves tick by tick until Twitch receives a new request of `fragment`. */
export async function nextRead(vm, twitch, fragment) {
  const before = twitch.count(fragment);
  for (let tick = 0; tick < 60 && twitch.count(fragment) === before; tick += 1) await seconds(vm, twitch, 20);
  if (twitch.count(fragment) === before) throw new Error(`${fragment} never read`);
}

/** The same, minute by minute. */
export async function minutes(vm, twitch, count) {
  await seconds(vm, twitch, count * 60);
}
