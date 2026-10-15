# Verified domain

Verifying a domain you own puts the **Verified domain** badge next to your
publisher's name, in the Control Center of PlayerVox OverCrow and on the
website, and lets your
widgets' IDs start with that domain reversed: `gg.nova.lol-timers` for
`nova.gg`.

## Add a domain

In the creator space, **Publisher profile**, **Add a domain**. Write the
domain alone, without `https://` or `www.`: `nova.gg`. A publisher can hold
up to eight domains.

The creator space then gives the DNS record to publish at your DNS host: a
TXT record named `_overcrow.` followed by your domain, whose value is
`overcrow-verify=` followed by a token.

```text
_overcrow.nova.gg.  TXT  "overcrow-verify=3f9c1e7a52d04b8e90a6c2d17f3b5e84"
```

## Verification

**Check now** looks for the record at once (once a minute at most). We
also check on our own every hour for seven days. DNS can take a few minutes
to spread.

| The creator space says | Meaning |
| --- | --- |
| Pending | The record is not found yet; checked every hour for seven days. |
| Verified on a date | The record is found. It is checked again every 30 days. |
| No longer verified | The record disappeared. Put it back, then check now: we also check every hour for seven days. |
| Not verified within 7 days | Add the record, then check now to start again. |

Keep the record in place: if it disappears, the badge goes away. The IDs
of widgets you already created under the domain stay yours.

## Who can claim a domain

- A domain verified once by a publisher is reserved to it, as are the
  domains under and above it: nobody else can claim them.
- A domain reading as PlayerVox, OverCrow or Valhallab is refused; write to
  support if it is yours. IDs under `com.playervox` belong to PlayerVox.
- **Remove** takes a verified domain off your profile, except while widget
  IDs use it. It stays reserved to you.
