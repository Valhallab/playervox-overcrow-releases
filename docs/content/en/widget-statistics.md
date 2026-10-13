# Statistics: definitions

The **Statistics** tab of a widget, in the creator space, shows how players
use it: installs, daily active players, errors and the players' rating.
PlayerVox OverCrow sends these figures anonymously. They are trends, not
exact counts: this page says what each figure counts and what it leaves out.

## Where the figures come from

Once a day at most, at a random time, PlayerVox OverCrow sends one anonymous
signal for each widget installed from the catalog: the widget, its version,
the day, the system (Windows or Linux), the version of OverCrow, whether the
widget was shown, installed or uninstalled that day, and its errors (kind,
place in the code, a rounded count).

- **No identifier**: nothing names the player or the computer, and nothing
  links the widgets of one player, each widget being sent apart.
- **No error message**: only the kind of an error and its place in your
  code. A message may hold personal data.
- **On by default**: players can turn **Share anonymous statistics** off in
  PlayerVox OverCrow; nothing is sent after that, and they are no longer
  counted.

The figures are added up as the signals arrive. **Updated** gives the time
of the last one counted.

## The figures

| Figure | What it counts |
| --- | --- |
| Daily active players | The players who showed the widget at least once that day. The tile gives the mean per day over the period. |
| Active installs | Installs minus uninstalls, added up since the first signal, never below zero. |
| Installs · uninstalls | The installs and the uninstalls of the period, and their balance. An update is neither. |
| Errors | The sum of the errors reported over the period. |

Each tile compares its figure with the period just before, of the same
length: green when it moves the good way (fewer errors, more players), amber
the other way, grey when it moves by less than 1 %. **First period** means
there is nothing before to compare with.

## Periods and filters

- **Period**: 7 days, 28 days, 90 days or 12 months. Over 12 months, the
  installs and uninstalls chart adds up each week.
- **Version**: one of your published versions. Active installs show "—"
  with a version: an installation changes version at every update, so that
  figure only makes sense for all versions. **Version adoption** compares
  the versions and does not follow this filter.
- **System**: Windows or Linux. **Where your widget runs** compares the
  systems and does not follow this filter.
- The rating follows no filter.

Every chart has **View as table**, with the same figures day by day.

## Version adoption and where your widget runs

- **Version adoption**: the share of the daily active players on each
  version. The three newest versions keep their colour; the others add up as
  **Older**.
- **Where your widget runs**: the share of active players on Windows and on
  Linux, and on each version of PlayerVox OverCrow (the two most used, then
  **Others**).

## Errors

The errors are grouped by kind and by place in your code: the same kind at
the same line of the same function is one group, whatever the version. The
table shows the 50 most frequent groups of the period, with their versions,
their count and their trend; **Export CSV** saves them.

PlayerVox OverCrow reports where an error happened in the package's
`logic.js`. The creator space traces that position back to your sources
(file, line and function) with a map of your code built with the package and
never published.

- **Being traced**: the position is shown as `logic.js:line:column` until it
  is traced.
- **Not traced**: the version has no map, or the position is not in it; the
  raw position stays.
- **No position in the code**: the widget stopped as a whole (budget
  exceeded, no answer); see its kind.
- **SDK**: the error happened inside `@overcrow/sdk`, called from your code.

| Kind | Meaning |
| --- | --- |
| `Error` | Error thrown |
| `TypeError` | Value of an unexpected type |
| `RangeError` | Value out of range |
| `ReferenceError` | Unknown name |
| `SyntaxError` | Invalid syntax |
| `URIError` | Invalid address encoding |
| `EvalError` | Code evaluation refused |
| `AggregateError` | Several errors at once |
| `InternalError` | Engine limit reached |
| Thrown value | A value that is not an error was thrown |
| Memory or processing budget exceeded | The widget was restarted |
| Stopped responding | The widget was restarted |
| Failed to load | The code or the view could not load |
| Widget process stopped | Without reporting a fault |
| Network request refused | Address not declared in the manifest |
| Other error | Of a kind the creator space does not know yet |

The kind of an error is the built-in type it was created from, never the
`name` your code may give it.

## Player rating

Players rate a widget from 0 to 100 in the PlayerVox OverCrow Control
Center, with their PlayerVox account: one rating per account and per widget,
which they can change or remove.

- **Score**: the mean of the ratings, rounded, with its rank: S+ from 90,
  S from 80, A from 70, B from 60, C from 40, D from 20, then F.
- **From 5 ratings**: below that, the creator space says **Not enough
  ratings yet** and gives the number of ratings; the catalog shows nothing.
- **Spread by rank**: the number of ratings in each rank, shown only in
  the creator space. Nobody sees who rated.
- **Since the latest version**: the points gained or lost since your latest
  version was published, when 5 ratings existed before it.
- The members of your publisher cannot rate its widgets.

Players see the score, the rank and the number of ratings in the catalog
and on the website.

## Trends, not exact counts

- Only the players who share their anonymous statistics are counted.
- PlayerVox OverCrow rounds each error count to a step before sending it,
  and sends at most 10 places in the code per widget and day: the error
  figures give orders of magnitude.
- A day is the player's own date.
- A player who clears PlayerVox OverCrow's data, then installs the widget
  again, counts as two installs.
- Signals that look broken or inflated are set aside before they are
  counted.
