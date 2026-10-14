# Third-party accounts

A widget can use the player's own account on another service (a game's
API, a streaming platform, a site that agreed to work with widgets) without
ever seeing the secret. PlayerVox OverCrow keeps the key or the sign-in in
the system keyring, asks for it in its own panel, and adds it only to the
requests of the network rules that name the account. The widget receives
the answers, never the secret.

There are two ways in:

- **A personal key.** The player creates a key or a personal token at the
  service and pastes it in OverCrow's panel, in Interactive mode only.
- **An OAuth sign-in.** The player clicks "Connect", approves at the
  service in the browser (or enters a code), and that is all. You register a
  **public** client at the service: PKCE, a `http://127.0.0.1` redirect on
  any port or the device code, and no client secret.

A widget never asks for a password, and never for a key in one of its own
fields: every keystroke of a widget field reaches the widget's code, and the
field shows on a stream.

## A personal key

Declare the account in `permissions.accounts`, then name it with `account`
on each route that needs the key:

<!-- source: docs/content/examples/steam-stats/manifest.json -->
```json
    "accounts": [
      {
        "id": "steam",
        "name": "Steam",
        "mode": "key",
        "origins": ["https://api.steampowered.com"],
        "send": { "header": "X-WebAPI-Key" },
        "key": {
          "format": { "charset": "hex", "minLength": 32, "maxLength": 32 },
          "page": "https://steamcommunity.com/dev/apikey"
        },
        "refusedStatus": [401, 403]
      }
    ],
    "network": [
      {
        "origin": "https://api.steampowered.com",
        "method": "GET",
        "path": "/ISteamUser/GetPlayerSummaries/v2/",
        "queryParams": {
          "steamids": { "type": "slug", "maxLength": 17, "required": true }
        },
        "maxResponseBytes": 16384,
```

- `id` names the account: the permission is `account:steam`, and the SDK
  calls use it.
- `name` is the service's name as OverCrow shows it ("Steam account").
- `origins` lists the service's addresses. With an account, every network
  rule of the widget targets one of them.
- `send` says where the key goes: a header (`{ "header": "X-WebAPI-Key" }`,
  or `Authorization` with a `scheme`), or a query parameter
  (`{ "query": "key" }`) when the service accepts nothing else.
- `key.format` lets OverCrow refuse a mistyped key before sending it;
  `key.page` is where the player gets one. OverCrow shows its domain and
  opens it on a click.
- `refusedStatus` is the status by which the service refuses the key (401
  by default). OverCrow then marks the account refused and asks for another
  key; the call fails with `account_refused`.

## An OAuth sign-in

<!-- source: docs/content/examples/quest-log/manifest.json -->
```json
    "accounts": [
      {
        "id": "quests",
        "name": "Quest Log",
        "mode": "oauth",
        "required": false,
        "origins": ["https://api.quests.example", "https://quests.example"],
        "oauth": {
          "clientId": "nova-overcrow-widget",
          "flow": "loopback",
          "authorize": "https://quests.example/oauth/authorize",
          "token": "https://quests.example/oauth/token",
          "revoke": "https://quests.example/oauth/revoke",
          "scopes": [{ "name": "quests:read", "access": "read" }]
```

- `clientId` is your public client at the service. It is not a secret;
  a client secret has no field and would be refused.
- `flow` is `loopback` (the system browser, then a redirect to OverCrow on
  `127.0.0.1`) or `device` (a code the player enters on the service's
  `verify` page).
- `token`, and `device`, `revoke` and `validate` when declared, are on one of
  the account's `origins`: OverCrow sends them the code, the verifier or the
  tokens. No route of the widget may target an endpoint.
- `scopes` are read by default. A `write` scope, like a route that does not
  `GET`, can change the player's account: it is justified, reviewed, and
  shown to the player.
- `scopeParam` names the scopes parameter of OverCrow's requests to
  `device` and `token`, for a service that wants `scopes`;
  `clientIdHeader` sends the client ID in a header too (Twitch: `Client-Id`).
- `required: false` lets the widget work without the account and show its
  own button. With `required` (the default), OverCrow covers the widget's
  content until the account is connected.

A service that refuses a public client (a client secret at the exchange,
an exact redirect port, a cap on unreviewed applications) cannot be used.
[Make your service work with widgets](compatible-services.md) says what a
service needs.

## Confinement

A widget with an account talks only to that service:

- one account per widget, every network rule on one of its `origins`;
- no sensitive capability and no clipboard;
- two rules of the same origin and method that may match the same URL name
  the same account, or none, so the key never goes where the widget did not
  say it would;
- no route on an OAuth endpoint, nor on a route that creates, lists or
  returns keys or tokens: its answer would reach the widget's code;
- the widget's storage is erased when the account leaves the widget.

## In the logic

The widget follows the state of the account with `account.subscribe`:
`signed_out`, `pending`, `connected`, `refused` or `expired`. It never sees
the account's name, its scopes or its secret.
The SDK exports them as `account` (its type is `AccountServices`), with the
`AccountStatus` shape, and `hasGrant` takes an `AccountGrant` such as
`account:steam`.

<!-- source: docs/content/examples/steam-stats/logic.ts -->
```ts
// Read again as soon as the key is saved or replaced.
account.subscribe({ id: "steam" }, (update) => {
  if (update.ok && update.value.state === "connected") {
    void load();
  }
});
```

A call on a route of the account fails with `not_connected` while the
account is not connected, and with `account_refused` when the service has
just refused the secret. OverCrow shows its own panel; the widget waits:

<!-- source: docs/content/examples/steam-stats/logic.ts -->
```ts
  } catch (error) {
    // not_connected until the user saves a key, account_refused when Steam
    // refuses it: OverCrow shows its own panel, the widget only waits.
    const code = error instanceof ServiceError ? error.code : "";
    state.status = code === "not_connected" || code === "account_refused" ? code : "unavailable";
  }
}
```

An account that is not `required` is connected from the widget's own
button, on a user action:

<!-- source: docs/content/examples/quest-log/logic.ts -->
```ts
// Called on a click: OverCrow opens its panel for the account.
export function connect(): void {
  void account.connect({ id: "quests" });
}
```

## Testing

In a [test scenario](testing.md), `host.accounts` gives the state of each
account by ID: `playervox` and `twitch`, and the accounts the manifest
declares (`connected` by default; `connected`, `disconnected`, `pending`,
`refused` or `expired`). An HTTP fixture adds `"account": "steam"` to its
`request` when the request is sent with the account: a fixture answers only
a request sent as it says, so the scenario checks that the key goes where
it should. A fixture whose status is in `refusedStatus` plays a refusal.

In unit tests, `@overcrow/sdk/testing` takes `accounts` at install, and
`setAccount(id, state)` sends a new state to the widget's subscriptions.

## Review

The reviewer checks, for a widget with an account:

- that every origin, those of the OAuth endpoints included, belongs to the
  service, with a link to its documentation;
- that each route that can change the account, and each `write` scope, is
  justified;
- that no route creates, lists or returns keys, tokens or connections (a
  Twitch stream key, extension secrets, Streamlabs socket tokens), and that
  no route touches Steam item trades (`IEconService`);
- that no field of the widget asks for a key, a token or a password;
- the widget with a test account at the service. Never put a key or a
  password in the message for the review.

## Reference

### `permissions.accounts`

<!-- generated:account-fields -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | identifier ≤ 32 bytes | yes | `[a-z][a-z0-9-]` of 2 bytes to 32 bytes, without a final or double `-`; `playervox` and `twitch` are reserved. The permission key is `account:<id>`; a network rule names it in `account`. |
| `name` | text ≤ 32 characters | yes | The service's name as the host shows it, plain text of at most 32 characters; a name that reads as PlayerVox, OverCrow or Valhallab is refused. |
| `mode` | `key` \| `oauth` | yes | `key`: a personal key or token the user pastes in the host's panel. `oauth`: a sign-in with the publisher's public OAuth client. Exactly the object of the mode is present. |
| `origins` | list of `origin` ≤ 4 | yes | Distinct canonical HTTPS origins of the service, as in network rules. Every network rule of the widget targets one of them. |
| `required` | boolean | no | Default `true`: the host covers the content until the account is connected. `false`: the widget works without it and opens the host's panel with `account.connect`. |
| `refusedStatus` | `list of 401 and 403` | no | Distinct statuses, among 401 and 403, by which the service refuses the secret on a route of the account; default `[401]`. Such a response marks the account refused (key) or expired (OAuth) and the call fails with `account_refused`. |
| `send` | `AccountSend` | no | Key mode only, required there: how the host sends the key. |
| `key` | `AccountKey` | no | Key mode only, required there. |
| `oauth` | `AccountOAuth` | no | OAuth mode only, required there. The host always sends `Authorization: Bearer <token>`. |
<!-- /generated:account-fields -->

### `send`

<!-- generated:account-send -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `header` | text ≤ 64 bytes | no | Header that carries the key: an HTTP token, not a header the host sets itself (`Host`, `Cookie`, `Content-*`, `Accept*`, `If-*`, `User-Agent`, `Referer`, `Origin`, `Connection`, `Proxy-*`, `Sec-*`, `X-Forwarded-*`…). Exactly one of `header` and `query`. |
| `scheme` | text ≤ 16 bytes | no | With `header: "Authorization"` only: a word `[A-Za-z][A-Za-z0-9-]*` sent before the key (`<scheme> <key>`). |
| `query` | text ≤ 32 bytes | no | Query parameter that carries the key, a parameter name of the network rules; no route of the account declares it in `queryParams`. Prefer a header. |
<!-- /generated:account-send -->

### `key`

<!-- generated:account-key -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `format` | `KeyFormat` | yes | What a key looks like; the host refuses another one at entry. |
| `page` | text ≤ 512 bytes | yes | The service's page where a user gets a key: `https://` canonical origin, path and optional static query, no fragment or credentials. The host opens it on a click in its panel. |
<!-- /generated:account-key -->

### `key.format`

<!-- generated:key-format -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `charset` | `hex` \| `alnum` \| `base64url` \| `base64` \| `printable` | yes | Characters of a key: `hex` (`0-9a-fA-F`), `alnum` (ASCII letters and digits), `base64url` (`alnum`, `-`, `_`, `=`), `base64` (`alnum`, `+`, `/`, `=`) or `printable` (ASCII `!` to `~`). |
| `minLength` | integer 8 to 512 | yes | Shortest key, 8 bytes to `maxLength`. |
| `maxLength` | integer 8 to 512 | yes | Longest key, `minLength` to 512 bytes. |
<!-- /generated:key-format -->

### `oauth`

<!-- generated:account-oauth -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `clientId` | text ≤ 128 bytes | yes | The publisher's public client at the service: ASCII letters, digits, `-`, `.`, `_` and `~`. There is no client secret. |
| `flow` | `loopback` \| `device` | yes | `loopback`: the system browser and a `http://127.0.0.1:<port>/callback` redirect, PKCE S256. `device`: a code the user enters on the service's page (RFC 8628). |
| `authorize` | text ≤ 512 bytes | no | Authorization endpoint; `loopback` only, required there. Every endpoint is an `https://` canonical origin and path, without query, fragment or credentials. |
| `token` | text ≤ 512 bytes | yes | Token endpoint. `token`, `device`, `revoke` and `validate` are on one of the account's `origins`: the host sends them the code, the verifier or tokens. |
| `device` | text ≤ 512 bytes | no | Device authorization endpoint; `device` only, required there. |
| `verify` | text ≤ 512 bytes | no | The page where the user enters the code; `device` only, required there. The service's `verification_uri` must equal it. |
| `revoke` | text ≤ 512 bytes | no | Revocation endpoint (RFC 7009), called at sign-out. |
| `validate` | text ≤ 512 bytes | no | Token validation endpoint, called with the token at sign-in and hourly while the widget runs; a status of `refusedStatus` marks the account expired. Its body is never read. |
| `scopes` | list of `AccountScope` ≤ 16 | yes | Scopes the host requests, distinct by name. |
| `scopeParam` | `scope` \| `scopes` | no | Name of the scopes parameter of the host's requests to `device` and `token`; default `scope`. The authorization request always uses `scope`. |
| `clientIdHeader` | text ≤ 64 bytes | no | Header that also carries `clientId` on the routes of the account (Twitch: `Client-Id`); the rules of `send.header`, `Authorization` excluded. |
<!-- /generated:account-oauth -->

### `oauth.scopes`

<!-- generated:account-scope -->
| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `name` | text ≤ 128 bytes | yes | ASCII letters, digits, `-`, `.`, `_`, `:` and `/`, nothing a service decodes or splits on; a name whose letters and digits contain `streamkey` in any case (`stream_key`, `stream-key`…) is refused. |
| `access` | `read` \| `write` | yes | Whether the scope can change the user's account; `write` is shown to the user and reviewed. |
<!-- /generated:account-scope -->

### Services

<!-- generated:account-services -->
### `account.subscribe`

- **Kind**: subscription
- **Requires**: a declared, granted account (`id`)
- **When it can be called**: At any time
- **Parameters**: `id`: identifier ≤ 32 bytes
- **Each update**: `{ state }` at once, then at each change: `signed_out`, `pending` (a sign-in step is open), `connected`, `refused` (the service refused the key) or `expired` (the service asks to sign in again). The widget never sees the secret, the account's name or its scopes; with `required`, the host covers the content until the account is connected
- **Shape**: [`AccountStatus`](#accountstatus)

### `account.connect`

- **Kind**: call, answered once
- **Requires**: a declared, granted account (`id`)
- **When it can be called**: Only during a user action
- **Parameters**: `id`: identifier ≤ 32 bytes
- **Result**: `null`; the host shows its account panel for this account, in its current state: the widget's own button for an account that is not `required`
- **Shape**: `null`
<!-- /generated:account-services -->

<!-- generated:account-shapes -->
### `AccountStatus`

State of a third-party account the widget declares. `{ state }`

| Member | Shape | Meaning |
| --- | --- | --- |
| `state` | `signed_out` \| `pending` \| `connected` \| `refused` \| `expired` | State of the account; connection is drawn by the host. |
<!-- /generated:account-shapes -->

### Errors

| Code | Meaning |
| --- | --- |
| `not_connected` | The service needs an account of the user (PlayerVox, Twitch or the one the widget declares) that is not connected. |
| `account_refused` | The service refused the account's key or sign-in on this route. The account is now `refused` or `expired`, and PlayerVox OverCrow asks the user for a new key or to sign in again. |
