# Make your service work with widgets

PlayerVox OverCrow widgets can use a player's account on your service
without ever seeing its secret: OverCrow keeps the key or the sign-in on the
player's computer and adds it only to the requests a widget declared. This
page says what a service needs for that. A widget author declares your
service as described in [Third-party accounts](accounts.md).

## What a service needs

1. **Sign-in.** OAuth 2 with a public client: PKCE (S256) and a redirect to
   `http://127.0.0.1` on any port (RFC 8252, section 7.3), or the device
   code (RFC 8628). No client secret at the exchange or at the refresh.
   Otherwise, **personal tokens** the user creates, with scopes that include
   a read-only option.
2. **Sending the secret.** `Authorization: Bearer`, or a dedicated header.
   A query parameter only when nothing else is possible.
3. **The API.** HTTPS and JSON answers without redirection: no 3xx to
   another host, images included (serve them at a stable address). A 401
   for a refused secret. Never the secret in an answer, even an error.
4. **Tokens.** Short-lived access tokens, rotating refresh tokens, and a
   revocation endpoint (RFC 7009). A published and stable list of the API's
   origins.
5. **Applications.** No low cap on the users of a publisher's public
   application, and no approval reserved for large companies.
6. **The refresh token.** A long or sliding lifetime (renewed at each use),
   so the player rarely has to sign in again.

## What OverCrow does

- It opens your authorization page in the system browser, or shows your
  device code page, on a click of the player, in Interactive mode only.
- It sends the secret only to the origins the widget declared, on the
  routes that name the account, over HTTPS, and refuses redirections.
- It refuses an answer that contains the secret, and never gives the widget
  your token, refresh or revocation endpoints.
- It revokes the tokens when the player signs out, and erases them when the
  widget is uninstalled.
