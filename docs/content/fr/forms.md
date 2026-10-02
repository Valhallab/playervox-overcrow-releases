# Formulaires et intents d’écriture

Un widget PlayerVox OverCrow reçoit ses entrées par des contrôles
qu’OverCrow dessine et édite lui-même : boutons, bascules, cases à cocher,
curseurs, listes déroulantes, champs de texte. La logique en est informée
par des événements. Un `form` regroupe des contrôles et les valide ensemble.
Un formulaire lié à un **intent d’écriture** est le moyen, pour un widget,
de laisser l’utilisateur écrire dans ses notes, publier sa note d’un jeu sur
PlayerVox ou envoyer un message de chat, sans que le texte passe jamais par
le code du widget.

Les widgets ne reçoivent d’entrées qu’en mode interactif d’OverCrow. En mode
passif, un clic traverse le widget jusqu’au jeu : masquez ou désactivez ce
qui est inutilisable, comme le font les widgets intégrés avec `host.mode`.

## Contrôles

| Élément | Valeur | Événements |
| --- | --- | --- |
| `button` | aucune | `activate` |
| `toggle`, `checkbox` | `checked` | `change` |
| `slider` | `value`, entre `min` et `max` | `input` pendant le glissement, `change` au relâchement |
| `select` avec des enfants `option` | `value` de l’option choisie | `change` |
| `field` | une ligne de texte | `input` à chaque modification, `change` sur Entrée ou quand le focus quitte le champ, `submit` sur Entrée |
| `textarea` | plusieurs lignes de texte | `input`, `change`, `submit` sur Ctrl+Entrée |

Chacun prend un `label`, son nom accessible, et `disabled`. Leurs attributs
sont décrits dans [Éléments et attributs](elements.md).

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
    <select class="duration" value={minutesValue(state.minutes)} label={t("duration")} disabled={state.running} on:change={setMinutes}>
      <for each={state.durations} as="minutes" key={minutes}>
        <option value={minutesValue(minutes)}>{t("minutes", { count: minutes })}</option>
      </for>
    </select>
```

<!-- source: docs/content/examples/countdown/logic.ts -->
```ts
export function setMinutes(event: { value: unknown }): void {
  const minutes = Number(event.value);
  if (state.durations.includes(minutes)) {
    state.minutes = minutes;
    state.remainingMs = total(minutes);
  }
}
```

La vue lie le contrôle à l’état (`value={…}`, `checked={…}`), et le
gestionnaire y réécrit la nouvelle valeur. Le détail de `input` et de
`change` est `{ value }` : un booléen pour une bascule ou une case à cocher,
un nombre pour un curseur, du texte pour les autres.

<!-- source: docs/content/examples/countdown/view.ocml -->
```xml
    <toggle class="repeat" label={t("repeat")} tooltip={t("repeat")} checked={state.repeat} on:change={setRepeat}/>
```

### Champs de texte

OverCrow édite lui-même le texte d’un `field` ou d’un `textarea` : le point
d’insertion, la sélection, le copier-coller et les méthodes de saisie des
langues qui composent leurs caractères. La logique reçoit une copie du texte
dans chaque événement `input`.

<!-- source: widgets/warframe-market/view.ocml -->
```xml
      <field class="query" label={t("search-field")} value={state.query} placeholder={t("placeholder")} max-length="256" on:input={search}/>
```

<!-- source: widgets/warframe-market/logic.ts -->
```ts
export function search(detail: { value: unknown }): void {
  state.query = typeof detail.value === "string" ? detail.value : "";
  state.results = searchItems(items, lowered, state.query);
  state.detail = null;
  state.loadingOrders = false;
  state.copy = null;
  if (state.error === "orders_unavailable") {
    state.error = null;
  }
  selection += 1;
  saveQuery();
}
```

Lier `value` remplace le contenu du champ : liez-le à l’état qu’écrit votre
gestionnaire `input`, comme ci-dessus, ou omettez-le et contentez-vous
d’écouter. `max-length` limite le texte en octets, et `placeholder` affiche
une indication tant que le champ est vide.

Un champ envoie aussi `keydown` quand vous le demandez, avec la touche et
ses modificateurs, pour des raccourcis comme Échap pour annuler. Les touches
qu’OverCrow se réserve (Tab pour déplacer le focus, ses propres raccourcis,
une composition en cours) ne sont pas transmises.

### Le focus à l’ouverture d’un éditeur

La logique ne peut pas déplacer le focus clavier. Un `field` ou un
`textarea` qui porte `autofocus` le prend de lui-même quand il apparaît
pendant que la logique traite une action de l’utilisateur : un clic sur un
bouton Modifier qui ouvre un éditeur place le point d’insertion dans le
champ, après son texte, comme le ferait un clic dans ce champ.

<!-- source: widgets/notes/view.ocml -->
```xml
        <field class="title-field" name="title" autofocus placeholder={t("title-hint")} label={t("title-hint")} on:input={titleInput(editor.note, event.value)} on:keydown={keyed(editor.note, event.key, event.ctrl)}/>
```

OverCrow ne donne ce focus que si l’élément apparaît pendant une
[action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur),
en mode interactif, dans le widget sur lequel l’utilisateur a agi ; quand
plusieurs de ces éléments apparaissent ensemble, le premier de la vue le
prend. Un élément qui apparaît au démarrage du widget, depuis un minuteur
ou depuis la réponse d’un service (y compris après un `await` dans le
gestionnaire du clic) ne prend pas le focus, pas plus qu’un élément déjà
affiché : `autofocus` est lu quand l’élément apparaît. Donnez-le à un seul
champ d’un éditeur, et pas à un champ qui apparaît pendant que
l’utilisateur saisit, comme une nouvelle ligne d’une liste.

## Formulaires

Un `form` regroupe des contrôles et leur donne un seul événement `submit`.
On le valide par Entrée dans un `field`, par Ctrl+Entrée dans un `field` ou
un `textarea`, ou en activant un bouton doté de l’attribut `submit`.

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
      <form class="selector" on:submit={join}>
        <field class="input channel" max-length="26" autofocus placeholder={t("channel-name")} label={t("channel-name")} on:input={channelTyped(event.value)}/>
        <button class="action" submit disabled={!canJoin(state)}>
          <text class="action-label">{t("join")}</text>
        </button>
      </form>
```

<!-- source: widgets/twitch-chat/logic.ts -->
```ts
export function join(): void {
  const channel = normalizeChannel(state.channelDraft);
  if (channel !== null) {
    joinChannel(channel);
  }
}
```

Ce formulaire n’a pas d’intent : son gestionnaire `submit` lit ce que le
gestionnaire `input` a gardé dans l’état, puis appelle un service. `submit`
est une action de l’utilisateur : le gestionnaire peut donc appeler un
service qui en demande une (`twitch.chat.join` ici).

Un formulaire garde ce que l’utilisateur a saisi tant qu’il reste dans la
vue. Masquez-le avec `display: none` pour garder un brouillon ; retirez-le
de la vue pour l’abandonner. Pour repartir de champs vides, donnez au
formulaire une nouvelle clé dans un `for` : une nouvelle clé, c’est un
nouveau formulaire.

## Les formulaires qui écrivent des données de l’utilisateur

Trois opérations d’un widget écrivent, dans les données de l’utilisateur, un
texte que celui-ci a saisi : enregistrer une note, publier la note d’un jeu
sur PlayerVox avec son avis, et envoyer un message dans un chat Twitch. Ce ne
sont pas des appels de service. C’est un formulaire doté d’un attribut
`intent` qui les envoie :

<!-- source: widgets/twitch-chat/view.ocml -->
```xml
    <form class={composerClass(state)} intent="twitch.chat.send" target={replyTarget(state)} on:submit={submitted(event.outcome, event.error)}>
      <if test={state.reply}>
        <box class="replying">
          <text class="replying-label">{replyingTo(state)}</text>
          <button class="icon-button small" label={t("cancel-reply")} tooltip={t("cancel-reply")} on:activate={cancelReply}>
            <icon name="x"/>
          </button>
        </box>
      </if>
      <if test={state.sendError != ""}>
        <text class="error">{t(state.sendError)}</text>
      </if>
      <box class="compose">
        <field class="input message-field" name="message" max-length="500" placeholder={t(composerHint(state))} label={t("message-label")} disabled={!state.canSend} on:input={drafted(event.value)} on:keydown={keyed(event.key)}/>
        <if test={sendMark(state) != ""}>
          <text class={sendMarkClass(state)}>{t(sendMark(state))}</text>
        </if>
        <button class="action" submit disabled={!canSubmit(state)} on:activate={sendPressed}>
          <text class="action-label">{t("send")}</text>
        </button>
      </box>
    </form>
```

Quand l’utilisateur valide un tel formulaire, **OverCrow lit les valeurs des
contrôles de ce formulaire et les envoie lui-même**. La logique du widget ne
fournit jamais le texte : un widget ne peut donc ni écrire ce que
l’utilisateur n’a pas saisi, ni valider sans lui. Le formulaire ne part que
sur une action de l’utilisateur, en mode interactif, avec la capability
accordée.

Ce que cela change pour la vue et la logique :

- **Les contrôles appartiennent à OverCrow.** Les contrôles `field`,
  `textarea` et `slider` du formulaire ne prennent pas de `value` :
  `overcrow-widget check` le refuse (`view.bound_value`), et OverCrow arrête
  un widget qui en définit un à l’exécution. Leur attribut `name` indique à
  quel champ de l’intent chacun correspond.
- **OverCrow les remplit** là où l’intent le prévoit : le titre, le corps et
  la liste de tâches de la note, la note publiée par l’utilisateur. Un
  remplissage envoie l’événement `input` du contrôle avec la valeur, pour
  que la logique sache ce qui est affiché ; cet événement n’est pas une
  action de l’utilisateur.
- **La logique suit par les événements `input`**, pour afficher un compteur
  ou activer le bouton, et peut désactiver les contrôles.
- **L’issue arrive dans l’événement `submit` du formulaire** :
  `event.outcome` vaut `accepted`, `rejected` (avec le
  [code d’erreur](services.md#erreurs) dans `event.error`) ou `cancelled`.
  Un formulaire sans intent donne `submitted`.

<!-- source: widgets/playervox-rating/view.ocml -->
```xml
      <slider class="criterion-slider" name="gameplay" min="0" max="100" step="1" label={t("gameplay")} disabled={!editable(state)} on:input={scored("gameplay", event.value)}/>
```

<!-- source: widgets/playervox-rating/logic.ts -->
```ts
export function scored(key: CriterionKey, value: number): void {
  state[key] = value;
  edited();
}
```

<!-- source: widgets/playervox-rating/logic.ts -->
```ts
export function submitted(outcome: string, error: ServiceErrorPayload | undefined): void {
  state.pending = Math.max(0, state.pending - 1);
  if (state.pending === 0) {
    answer?.cancel();
    answer = null;
  }
  if (outcome === "accepted") {
    // The subscription sends the stored rating; nothing is read again.
    state.saved = true;
    state.error = "";
  } else if (outcome !== "cancelled") {
    state.error = errorKey(error?.code ?? null);
  }
}
```

Une écriture ne change pas d’elle-même ce que dit un abonnement : après une
note PlayerVox acceptée, `playervox.rating.subscribe` livre la note
enregistrée, et c’est elle que le widget affiche.

### Les intents

<!-- generated:write-intents -->
### `notes.save`

Capability `notes.write` ; attribut `target` obligatoire (l’ID de la note ; l’hôte remplit les contrôles liés à partir de cette note). Entrée dans un `field` du formulaire fait passer le focus à son `field` ou `textarea` suivant et ne valide pas ; Ctrl+Entrée et un bouton `submit` valident.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `title` | texte ≤ 96 octets | oui | `field` ; enregistré sans espaces en début ni en fin, et non vide. |
| `body` | texte ≤ 8 Kio | non | `textarea` ; enregistré tel qu’il est écrit. |
| `item` | liste de `NoteItem` ≤ 64 | non | Un `field` par ligne de la liste de tâches, dans l’ordre, chacun ≤ 256 octets. L’hôte retient avec quelle entrée il a rempli chaque champ : une ligne garde l’ID et la coche de cette entrée quelles que soient les lignes que le widget retire ou déplace, et un champ apparu depuis est une nouvelle entrée, non cochée. Les lignes sont enregistrées sans espaces en début ni en fin ; une ligne vide est abandonnée. Une note enregistrée telle qu’elle est déjà stockée est acceptée sans écriture. |

### `playervox.rating.publish`

Capability `playervox.rating.write` ; attribut `target` refusé.

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `gameplay` | entier de 0 à 100 | oui | `slider` ; rempli à partir de la note de l’utilisateur, 50 avant la première. |
| `art` | entier de 0 à 100 | oui | `slider` ; rempli comme `gameplay`. |
| `tech` | entier de 0 à 100 | oui | `slider` ; rempli comme `gameplay`. |
| `review` | texte ≤ 2000 caractères | non | `textarea` ; rempli à partir de l’avis publié. Un avis inchangé n’est pas renvoyé ; un avis vidé est retiré. |

### `twitch.chat.send`

Capability `twitch.chat.compose` ; attribut `target` facultatif (l’ID du message auquel on répond).

| Champ | Type | Obligatoire | Signification |
| --- | --- | --- | --- |
| `message` | texte ≤ 500 caractères | oui | `field` ; l’hôte le vide après un envoi réussi. |
<!-- /generated:write-intents -->

`target` est l’attribut du formulaire qui désigne l’objet écrit :
l’identifiant de la note pour `notes.save`, l’identifiant du message auquel
on répond pour `twitch.chat.send`.

### Plusieurs lignes d’un même champ

L’intent `notes.save` prend un champ `item` par ligne de la liste de tâches.
La logique décide des lignes du formulaire, avec un `for` ; OverCrow remplit
le champ de chaque ligne à partir de la note enregistrée et retient quelle
entrée de la liste de tâches il y a placée. Une ligne que la logique retire
ou déplace garde son entrée, et une ligne ajoutée depuis est une nouvelle
entrée.

<!-- source: widgets/notes/view.ocml -->
```xml
          <for each={editor.rows} as="row" key={row.key}>
            <box class="row">
              <if test={rowStored(state, editor, row)}>
                <checkbox class="row-check" checked={rowChecked(state, editor, row)} label={rowLabel(row)} on:change={check(editor.note, row.id, event.value)}/>
              </if>
              <else>
                <icon class="row-new" name="circle"/>
              </else>
              <field class="row-field" name="item" placeholder={rowHint(editor, row)} label={t("item-hint")} on:input={rowInput(editor.note, row.key, event.value)} on:keydown={keyed(editor.note, event.key, event.ctrl)}/>
```

Dans ce formulaire, Entrée passe au champ suivant au lieu de valider ;
Ctrl+Entrée ou le bouton `submit` enregistre.

## Confirmations

Deux services suppriment des données de l’utilisateur : `notes.delete` et
`journal.delete`. Ce sont des appels ordinaires qui demandent une action de
l’utilisateur. OverCrow demande ensuite à l’utilisateur de confirmer, dans
une boîte de dialogue qu’il dessine lui-même, hors du widget. L’appel
aboutit quand l’utilisateur confirme et échoue avec `cancelled` quand il
refuse. Ne dessinez pas votre propre « Êtes-vous sûr ? » : seule la
confirmation d’OverCrow compte.

## Points à vérifier pour un formulaire

- Chaque contrôle a un `label`.
- Les boutons qui ne peuvent pas agir sont `disabled`, et rien de ce qui
  demande une entrée ne s’affiche en mode passif.
- Le gestionnaire `submit` traite un refus : `not_connected` quand le compte
  est déconnecté, `busy` quand l’utilisateur envoie trop vite,
  `unavailable`.
- Un formulaire lié à un intent n’a pas de `value` sur ses champs de texte
  ni sur ses curseurs, et chaque contrôle nommé est un champ de l’intent.
- Testez-le avec un scénario : les étapes `text` saisissent du texte dans le
  champ qui a le focus, les étapes `key` appuient sur Entrée, et
  `expect.intents` vérifie exactement ce qu’OverCrow a envoyé. Voir
  [Tester un widget](testing.md#steps).
