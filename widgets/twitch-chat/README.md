# Twitch chat

`com.playervox.overcrow.twitch.chat` — the chat of one public Twitch
channel you choose, over the game. In Interactive mode you pick the
channel, keep favorites, scroll the history, reply and send messages; in
Passive mode the last messages show and fade out. OverCrow holds your
Twitch account, the connection, the channel and the favorites: the widget
shows what OverCrow sends it and asks for the rest. A built-in of OverCrow,
written against the public `@overcrow/sdk` and packaged with
`overcrow-widget` like any creator's widget. MIT.

## What it shows

A header row, always: a chat icon, the channel (`#juniper_plays`, or
"Twitch" without one) and a status dot whose label, also its tooltip, says
the connection in words. In Interactive mode a joined channel adds the
favorite star and the "Change channel" and "Disconnect channel" buttons.

| State | Shows (EN / FR) |
| --- | --- |
| Waiting for OverCrow's first answer | the header alone, a grey dot: "INACTIVE" / "INACTIF" |
| No channel, Interactive mode | the channel selector: a field "Channel name" / "Nom de la chaîne", "Join chat" / "Rejoindre", the favorites under "Favorites" / "Favoris"; dot "DISCONNECTED" / "DÉCONNECTÉ" |
| No channel, Passive mode | "No channel selected" / "Aucune chaîne sélectionnée" |
| Connecting | an amber dot, "CONNECTING" / "CONNEXION EN COURS"; the message field waits: "Waiting for chat…" / "En attente du chat…" |
| Joined | a green dot, "CONNECTED" / "CONNECTÉ"; the history; the field "Send a message…" / "Envoyer un message…" and "Send" / "Envoyer" |
| Joined, nothing yet | Interactive: "No messages yet" / "Aucun message pour le moment"; Passive: "No recent messages" / "Aucun message récent" |
| Reconnecting | an amber dot, "RECONNECTING" / "RECONNEXION"; the history stays, the field waits |
| The join failed | a red dot and its label under the header: "CHANNEL UNAVAILABLE" / "CHAÎNE INDISPONIBLE", "CONNECTION ERROR" / "ERREUR DE CONNEXION", "TWITCH ERROR" / "ERREUR TWITCH", or "Another widget is using Twitch chat" / "Un autre widget utilise le chat Twitch" |
| Scrolled away from the end | a button, "1 new message" / "1 nouveau message", "{n} new messages" / "{n} nouveaux messages" |
| Messages left out of a fast chat | a row, "1 message not shown" / "1 message non affiché", "{n} messages not shown" / "{n} messages non affichés" |
| A channel or favorite change failed | under the header, in Interactive mode: "Twitch is busy. Try again." / "Twitch est occupé. Réessayez.", "Could not save Twitch widget settings." / "Impossible d’enregistrer les réglages du widget Twitch.", "Favorite channel limit reached." / "Nombre maximal de chaînes favorites atteint." |
| OverCrow's chat source failed | "Twitch is temporarily unavailable. Retrying automatically." / "Twitch est temporairement indisponible. Nouvelle tentative automatique."; the widget asks again 5 s later |
| No Twitch account, a sign-in in progress, an expired session | OverCrow's own account panel, over the widget, in both modes (see [Permissions](#permissions)) |
| No permission to read | "Permission needed to read Twitch chat." / "Autorisation nécessaire pour lire le chat Twitch.": the widget asks OverCrow nothing |

The size is the one you set, 420 × 360 px by default, from 160 × 24 px to
900 × 900 px: the history takes what the other rows leave, and a channel
name too long for the header ends with an ellipsis.

## The channel and the favorites

- **Join.** Type a channel in the selector and press Enter or "Join chat".
  A name is accepted as Twitch writes a login: spaces around it and a
  leading `#` are dropped, upper case becomes lower case, and what is left
  is 1 to 25 ASCII letters, digits or `_`. The field takes 26 characters
  (the `#` and 25 more). Anything else leaves "Join chat" off, and Enter
  joins nothing.
- **Favorites.** Each favorite is a chip in the selector: a click joins it.
  Three rows of chips show; more scroll in that height.
  The star of the header adds the current channel to the favorites or
  removes it ("Add current channel to favorites" / "Ajouter la chaîne
  actuelle aux favoris", "Remove current channel from favorites" / "Retirer
  la chaîne actuelle des favoris"); it is yellow for a favorite. OverCrow
  keeps at most 20: beyond, the star of another channel takes no click and
  says "Favorite channel limit reached". Passive mode shows the star of a
  favorite channel, without a button.
- **Change channel** opens the selector over the chat, which stays until
  another channel is joined, and closes it again.
- **Disconnect channel** leaves: OverCrow forgets the channel.

Each of these is one call to OverCrow on your gesture (`twitch.chat.join`,
`twitch.chat.favorite`, `twitch.chat.leave`). The widget stores nothing:
OverCrow remembers the channel and the favorites of this widget, joins the
channel again when the widget starts, and tells the widget the channel,
its state and the favorites through the subscription. What the widget
shows is what OverCrow last said, never what was typed. The selector's
field is OverCrow's to edit: a selector that starts over is a new one,
with an empty field.

The channel and the favorites are this widget's own: another widget
allowed to read Twitch chat has its own, and nothing it does changes
these. OverCrow connects to one chat at a time, the one joined last: a
widget whose channel is not that one keeps its channel and its favorites,
shows "Another widget is using Twitch chat", and gets the chat back when
the other leaves or stops, or when you join from it again.

## The history and the pace of the chat

Each line is the author's name, in bold and in their Twitch colour, then
the message: text and emotes, as tall as the line, each with its name as
accessible label. OverCrow keeps a colour readable on the panel of the
current theme (a very dark name is lightened on a dark panel, a very light
one darkened on a light panel); an author without a colour is grey. A long
message wraps.

- The history keeps the last 200 messages, and fewer when they are long:
  a message has at most 16 runs of text and emotes, and the rows together
  stay within a budget of scene nodes, the oldest leaving first.
- The list follows its end. Scroll up and it stops following: new messages
  are then counted on the "N new messages" button, which returns to the
  latest; so does scrolling back to the end. This is the `list`'s
  `stick-to-end` attribute and its `stick` event.
- **OverCrow sends the chat as deltas, at most one every 100 ms**: the new
  messages to append, messages that changed (they replace the message of
  the same ID where it stands) and the IDs of removed ones, which leave at
  once: moderation is never left out. After subscribing, after a change of
  channel or account and when the widget is shown again, one update
  carries the whole list instead.
- **A chat faster than that is sampled.** OverCrow then leaves messages
  out and says how many: the widget shows "N messages not shown" where
  they would have been, and counts them among the new messages. Two such
  rows in a row are one. Nothing is sent to a hidden widget.

## Replies

A message that answers another shows one line of what it answers above it
("Author: text", cut with an ellipsis), behind a rail. In Interactive mode,
with the permission to send, each message has a reply icon at the end of
its first line, visible under the pointer or with the keyboard on it
("Reply to {name}" / "Répondre à {name}"). It makes that message the target of the next send: "Replying to
{name}" / "Réponse à {name}" shows above the field, with a button to cancel
("Cancel reply" / "Annuler la réponse"). The target goes with the accepted
message, stays when a message is refused, and is dropped when its message
leaves the history.

## The composer

One line, at most 500 characters, and "Send".

- **The form is OverCrow's.** The message field is the host-owned control
  of a `form` bound to the `twitch.chat.send` intent: the view gives it no
  `value`, and the logic cannot write a character in it nor submit it.
  OverCrow tells the logic the text through the field's `input` event, so
  that "Send" is on only when there is something to send.
- **Sending** takes your gesture: Enter in the field or a click on "Send".
  OverCrow sends the text of its own field, with the reply target as the
  form's `target`, and tells the widget the outcome in the form's `submit`
  event. Nothing is sent from an empty field or from spaces, and one
  message is sent at a time: until OverCrow answers, the field still holds
  the message, and Enter or "Send" sends nothing more.
- **OverCrow empties the field once the message is accepted**, and keeps
  it otherwise, for another try.
- **There is no local echo.** A sent message shows in the history when
  OverCrow delivers it, like any other. Meanwhile "sending…" / "envoi…"
  shows beside the field; a refused message leaves "not sent" / "non
  envoyé" there and its reason above the field:

  | Refusal | Message (EN / FR) |
  | --- | --- |
  | Too many messages (OverCrow allows 20 per 30 s) | "Too many messages. Wait a moment, then try again." / "Trop de messages. Attendez un instant, puis réessayez." |
  | The chat does not take this account's messages | "This chat does not accept your messages right now." / "Ce chat n’accepte pas vos messages pour le moment." |
  | Anything else | "Message was not accepted. Try again." / "Le message a été refusé. Réessayez." |
  | The send was abandoned before it left | "Message was not sent. Try again." / "Le message n’a pas été envoyé. Réessayez." |

  Should OverCrow give no answer at all, the widget says "Message was not
  accepted. Try again." after 40 s.
- **The draft is kept by OverCrow** while its form stays in the view: in
  Passive mode and while the widget is hidden between two games (the form
  is hidden, not removed), under the channel selector, and while
  OverCrow's chat source is failing. The form's key is the chat's
  `generation`, which changes with the channel or the account: another
  channel is another form, with an empty field. A draft does not outlive
  OverCrow.

OverCrow's field gives you the caret, the selection, copy, cut and paste
through OverCrow, and input methods (IME). Escape is OverCrow's: it leaves
Interactive mode, and the draft stays.

## Passive mode and the fade

Passive mode shows the last 12 messages younger than the lifetime, without
any control: no selector, no star button, no reply icon, no composer, and
no row for messages left out. Clicks go through to the game.

A message is opaque until two thirds of its lifetime, then fades to nothing
over the last third, and leaves. `receivedAt`, the time OverCrow received
the message, gives its age, also after the widget was hidden. The fade is
stepped: the logic gives a fading row one of 32 opacity classes and a
transition as long as the step (100 ms to 1.6 s, the longest that keeps at
least 16 steps in a fade), so OverCrow draws it as one continuous fade.
One timer drives it: it sleeps until the first message is about to fade,
ticks once per step while one fades, and does not exist when nothing shows.
Interactive mode keeps the whole history, opaque, and runs no timer.

## Menu

| Row | Type | Default |
| --- | --- | --- |
| Message lifetime in Passive (s) / Durée des messages en mode passif (s) | slider `passive-lifetime`, 5 to 120 s | 30 |

## Permissions

- `twitch.chat.read`: join, read and leave the chat of a channel, and keep
  favorite channels. Sensitive.
- `twitch.chat.compose`: send a message, only through the host-bound form.
  Sensitive. Without it the widget shows the chat with its channel
  controls, and no composer nor reply icon.

As sensitive capabilities rule out the network and the clipboard, the
widget declares neither, and no storage: it reaches Twitch only through
OverCrow and keeps nothing.

**The Twitch account is OverCrow's.** The widget never sees the account's
name, a sign-in code or a token. Without a session, during a sign-in and
after a session expired, OverCrow draws its own account panel over the
widget, in both modes, and no input reaches the widget; the sign-in itself
happens there and in your browser. Under the panel the widget only says
"Twitch is disconnected" / "Twitch est déconnecté" or "Twitch connection
pending" / "Connexion Twitch en attente". While OverCrow holds a session it
cannot check and retries, it adds its notice at the bottom of the widget.

## Tests

- `tests/logic.test.mjs`, `tests/refused.test.mjs`,
  `tests/read-only.test.mjs`: the logic on `@overcrow/sdk/testing`
  (`node --test tests/*.test.mjs`): channel names, the deltas (append,
  replace, remove, reset, messages left out), the history's two bounds,
  the unread count, a change of generation, the reply target, the fade's
  levels, steps and single timer, the send cycle and each refusal, the
  channel and favorite calls and their refusals, every status, the retry of
  a failed subscription, the missing grants, the messages of both
  languages.
- Scenarios, played in OverCrow's headless runtime
  (`overcrow-widget test --runtime …`), with their reference images in
  `tests/reference/`. The emotes are synthetic images drawn by
  `tests/assets/generate.mjs`; authors and channels are invented.

  | Scenario | Covers |
  | --- | --- |
  | `states` | Interactive mode: waiting, the selector without and with favorites, connecting, joined and empty, joined, reconnecting and its tooltip; dark English and light French, 100 % and 150 %, 180 px wide |
  | `passive` | Passive mode: waiting, no channel, connecting, joined and empty, the last 12 of 15 messages; light French, 150 %, 180 px wide; clicks and keys reach nothing |
  | `failures` | each failed join, in both modes and languages, with and without history; joined again |
  | `unavailable` | the source failed and came back 5 s later, in both modes and languages; the draft kept |
  | `render` | coloured authors (a very dark and a very light colour), no colour, emotes of three shapes, a wrapped message, a reply, a message of 16 runs, the reply icon and its tooltip; both themes and languages, 100 % and 150 %, 180 px wide, Passive mode |
  | `fade` | the Passive fade in virtual time: opaque, half-way, nearly gone, gone; hidden then shown; a new message; the history in Interactive mode |
  | `lifetime` | the menu row at 120 s, 5 s and 30 s |
  | `burst` | deltas 100 ms apart: messages left out, two such rows merged, a replacement in place, removals, sixty messages in two seconds, a reset; no such row in Passive mode |
  | `unread` | scrolled away, the count (messages left out included, replacements and removals not), the button, scrolling back, a reset |
  | `channel` | an invalid name, 26 characters, Enter and the button, the selector over the chat, a favorite's chip, leaving, each with its call |
  | `favorites` | the star and its calls, its tooltips, the limit of 20, the 20 chips, the star in Passive mode |
  | `channel-refused` | a join, a favorite and a leave refused: busy, not saved, favorites full; English and French |
  | `send` | nothing sent from an empty field or spaces; Enter and the button, with what OverCrow sent; the field emptied once accepted |
  | `reply` | the reply target, cancelled, kept by a refusal, gone with the accepted message, dropped with its message; English and French, 180 px wide |
  | `send-refused` | too fast, a chat that does not take the account's messages, not accepted, then accepted; no answer for 40 s, and nothing more sent meanwhile; English and French |
  | `draft` | a draft through Passive mode, a hidden widget and the selector; another channel empties it |
  | `account` | OverCrow's account panel for a missing, pending and expired session and its offline notice, in both modes, with the wrapper |
  | `frame` | the widget in OverCrow's wrapper |
  | `read-only` | the read grant alone: the chat, the channel controls, nothing that sends |
  | `refused` | no grant: no call |

  A scenario can expect the fields of a submitted form, not its `target`:
  the unit tests cover the reply target the form carries.

## Cost

<!-- COST: filled in by the lot -->
