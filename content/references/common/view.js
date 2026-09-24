// MIT License. Copyright (c) 2026 Valhallab SASU.
// This reference uses only the public SDK; the native wrapper owns all chrome.
import overcrow from "./overcrow.js";
import { kind, titles } from "./reference.js";
const $ = (id) => document.getElementById(id),
  primary = $("primary"),
  details = $("details"),
  actions = $("actions"),
  status = $("status");
let locale = "en",
  frame = null,
  game = {},
  options = { details: true, seconds: true, zone: "local" },
  observedAt = performance.now(),
  closed = false;
let artworkHandle = null,
  artworkUrl = null,
  sizeQueued = false,
  lastSize = "",
  lastFollowed = false;
const stops = [];
const text = (en, fr) => (locale === "fr" ? fr : en);
const duration = (milliseconds) => {
  const value = Math.max(0, Math.floor(milliseconds / 1000));
  return (
    `${Math.floor(value / 3600)
      .toString()
      .padStart(2, "0")}:${Math.floor(value / 60) % 60}`.replace(
      /:(\d)$/,
      ":0$1",
    ) + `:${(value % 60).toString().padStart(2, "0")}`
  );
};
const node = (tag, value) => {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
};
const paragraph = (value) => details.append(node("p", value));
const interactive = () => game.overlayMode === "interactive";
function button(label, callback, parent = actions) {
  const element = node("button", label);
  element.type = "button";
  element.disabled = !interactive();
  element.addEventListener("click", async () => {
    element.disabled = true;
    try {
      const result = await callback();
      if (closed) return;
      status.textContent =
        result.status === "cancelled" && game.fixture
          ? text(
              "Native UI is not available in the browser preview.",
              "L’interface native n’est pas disponible dans cet aperçu.",
            )
          : result.status;
    } catch (error) {
      if (!closed)
        status.textContent = error.code ?? text("Unavailable", "Indisponible");
    } finally {
      element.disabled = !interactive();
    }
  });
  parent.append(element);
}
function timing() {
  if (kind === "clock") {
    const settings = {
      hour: "2-digit",
      minute: "2-digit",
      ...(options.seconds ? { second: "2-digit" } : {}),
      ...(options.zone === "utc" ? { timeZone: "UTC" } : {}),
    };
    primary.textContent = new Intl.DateTimeFormat(locale, settings).format(
      new Date(),
    );
  } else if (kind === "stopwatch" && frame?.data) {
    primary.textContent = duration(
      frame.data.elapsedMs +
        (frame.data.running ? Math.max(0, performance.now() - observedAt) : 0),
    );
  }
}
async function artwork(handle) {
  if (handle === artworkHandle) return;
  artworkHandle = handle;
  if (artworkUrl) URL.revokeObjectURL(artworkUrl);
  artworkUrl = null;
  $("artwork").hidden = true;
  if (!handle) return;
  try {
    const blob = await overcrow.assets.read(handle);
    if (closed || artworkHandle !== handle) return;
    artworkUrl = URL.createObjectURL(blob);
    $("artwork").src = artworkUrl;
    $("artwork").hidden = false;
  } catch {
    /* Absent artwork does not hide playable media. */
  }
}
function render() {
  $("title").textContent = titles[locale] ?? titles.en;
  document.documentElement.lang = locale;
  document.body.classList.toggle("passive", !interactive());
  $("fixture").hidden = !game.fixture;
  $("fixture").textContent = text(
    "PREVIEW FIXTURE · NO LIVE DATA",
    "DONNÉES FICTIVES · APERÇU HORS LIGNE",
  );
  details.replaceChildren();
  actions.replaceChildren();
  details.hidden = options.details === false;
  if (kind === "clock") {
    timing();
    paragraph(
      options.zone === "utc"
        ? "UTC"
        : text("Local device clock", "Horloge locale"),
    );
    reportSize();
    return;
  }
  if (kind === "session") {
    primary.textContent =
      game.selectedActive &&
      game.sessionElapsedMs !== null &&
      game.sessionElapsedMs !== undefined
        ? duration(game.sessionElapsedMs)
        : text("No active session", "Aucune session active");
    reportSize();
    return;
  }
  if (!frame?.data) {
    primary.textContent = frame?.status ?? text("Loading…", "Chargement…");
    status.textContent = frame?.retryAfterMs
      ? text(
          `Retry in ${frame.retryAfterMs} ms`,
          `Réessayer dans ${frame.retryAfterMs} ms`,
        )
      : "";
    if (
      ["rating", "reviews", "journal"].includes(kind) &&
      frame?.status === "notConnected"
    )
      button(text("Connect PlayerVox", "Connexion PlayerVox"), () =>
        overcrow.playervox.requestConnect(),
      );
    if (kind === "twitch" && frame?.status === "notConnected")
      button(text("Connect Twitch", "Connexion Twitch"), () =>
        overcrow.twitch.chat.requestConnect(),
      );
    void artwork(null);
    reportSize();
    return;
  }
  const data = frame.data;
  status.textContent =
    frame.status === "stale"
      ? text("Stale measurement", "Mesure ancienne")
      : "";
  if (kind === "performance") {
    primary.textContent =
      data.normalizedCpuPercentHundredths === null
        ? "—"
        : `${(data.normalizedCpuPercentHundredths / 100).toFixed(1)}% CPU`;
    paragraph(
      data.residentBytes === null
        ? text("Memory unavailable", "Mémoire indisponible")
        : `${(data.residentBytes / 1048576).toFixed(0)} MiB`,
    );
    paragraph(
      ["CPU", "GPU"]
        .map((label, index) => {
          const value = index
            ? data.gpuTemperatureMillicelsius
            : data.cpuTemperatureMillicelsius;
          return `${label}: ${value === null ? "—" : (value / 1000).toFixed(1) + " °C"}`;
        })
        .join(" · "),
    );
  } else if (kind === "fps") {
    primary.textContent =
      data.value === null ? "—" : `${data.value.toFixed(1)} FPS`;
    paragraph(
      `${data.stale ? text("Stale", "Ancien") : text("Sample", "Échantillon")} · ${data.sampleAgeMs ?? "—"} ms`,
    );
  } else if (kind === "stopwatch") {
    timing();
    paragraph(
      data.running ? text("Running", "En cours") : text("Paused", "En pause"),
    );
    button(text("Start", "Démarrer"), () => overcrow.stopwatch.start());
    button(text("Pause", "Pause"), () => overcrow.stopwatch.pause());
    button(text("Reset", "Réinitialiser"), () => overcrow.stopwatch.reset());
  } else if (kind === "media") {
    primary.textContent = data.title ?? text("No media title", "Aucun titre");
    paragraph(`${data.artist ?? ""} · ${data.playbackState}`);
    for (const [action, en, fr] of [
      ["previous", "Previous", "Précédent"],
      ["playPause", "Play / pause", "Lecture / pause"],
      ["next", "Next", "Suivant"],
    ])
      if (data.actions[action])
        button(text(en, fr), () => overcrow.media[action]());
    void artwork(data.artworkHandle);
  } else if (kind === "notes") {
    const active = data.notes.find((note) => note.id === data.activeNoteId);
    primary.textContent = active?.title ?? text("No note", "Aucune note");
    for (const note of data.notes)
      button(note.title, () =>
        overcrow.notes.select({
          noteId: note.id,
          expectedRevision: data.documentRevision,
        }),
      );
    if (active) {
      paragraph(active.body);
      for (const item of active.items) {
        const label = document.createElement("label"),
          check = document.createElement("input");
        check.type = "checkbox";
        check.checked = item.checked;
        check.disabled = !interactive();
        check.addEventListener("change", async () => {
          check.disabled = true;
          try {
            const outcome = await overcrow.notes.setChecked({
              noteId: active.id,
              itemId: item.id,
              checked: check.checked,
              expectedRevision: data.documentRevision,
            });
            status.textContent = outcome.status;
            if (outcome.status !== "persisted") check.checked = item.checked;
          } catch (error) {
            check.checked = item.checked;
            status.textContent = error.code ?? "unavailable";
          } finally {
            check.disabled = !interactive();
          }
        });
        label.append(check, document.createTextNode(item.text));
        details.append(label);
      }
      button(text("Edit in OverCrow", "Modifier dans OverCrow"), () =>
        overcrow.notes.requestEdit({
          noteId: active.id,
          expectedRevision: data.documentRevision,
        }),
      );
      button(text("Delete in OverCrow", "Supprimer dans OverCrow"), () =>
        overcrow.notes.requestDelete({
          noteId: active.id,
          expectedRevision: data.documentRevision,
        }),
      );
    }
    button(text("New native note", "Nouvelle note native"), () =>
      overcrow.notes.requestCreate({ expectedRevision: data.documentRevision }),
    );
    paragraph(data.saveState);
  } else if (kind === "score") {
    primary.textContent =
      data.score === null ? "—" : `${data.score.toFixed(1)} / 100`;
    paragraph(
      `${data.name} · ${data.ratingsCount} ${text("ratings", "notes")}`,
    );
    paragraph(
      Object.entries(data.criteria)
        .map(([key, value]) => `${key}: ${value ?? "—"}`)
        .join(" · "),
    );
  } else if (kind === "rating") {
    primary.textContent = data.rating
      ? `${data.rating.averageScore.toFixed(1)} / 100`
      : text("No rating", "Aucune note");
    if (data.rating) {
      paragraph(data.rating.review ?? "");
      paragraph(
        `${data.rating.gameplayScore} · ${data.rating.artScore} · ${data.rating.techScore}`,
      );
    }
    button(text("Edit in OverCrow", "Modifier dans OverCrow"), () =>
      overcrow.playervox.rating.requestEdit({
        expectedRevision: frame.revision,
      }),
    );
    button(text("Connect PlayerVox", "Connexion PlayerVox"), () =>
      overcrow.playervox.requestConnect(),
    );
  } else if (kind === "reviews") {
    primary.textContent = `${data.page} / ${data.totalPages}`;
    for (const review of data.reviews) {
      const article = document.createElement("article");
      article.append(
        node("strong", `${review.displayName} · ${review.averageScore}/100`),
        node(
          "p",
          review.hidden
            ? text("Hidden by moderation", "Masqué par la modération")
            : (review.review ?? ""),
        ),
      );
      if (!review.hidden && review.translated && review.originalReview)
        article.append(node("p", review.originalReview));
      details.append(article);
    }
    if (data.page > 1)
      button(text("Previous", "Précédent"), () =>
        overcrow.playervox.reviews.page({
          page: data.page - 1,
          followedOnly: data.followedOnly,
        }),
      );
    if (data.page < Math.min(data.totalPages, 1000))
      button(text("Next", "Suivant"), () =>
        overcrow.playervox.reviews.page({
          page: data.page + 1,
          followedOnly: data.followedOnly,
        }),
      );
    button(text("Connect PlayerVox", "Connexion PlayerVox"), () =>
      overcrow.playervox.requestConnect(),
    );
  } else if (kind === "journal") {
    primary.textContent = `${data.sessions.length} ${text("sessions", "sessions")}`;
    for (const session of data.sessions) {
      const article = document.createElement("article");
      article.append(
        node(
          "strong",
          `${new Date(session.startedAt).toLocaleDateString(locale)} · ${duration(session.durationMs)}`,
        ),
        node(
          "p",
          `${session.source}${session.interrupted ? " · " + text("Interrupted", "Interrompue") : ""}`,
        ),
      );
      if (session.note) article.append(node("p", session.note));
      button(
        text("Edit native note", "Modifier la note native"),
        () =>
          overcrow.journal.requestEditNote({
            sessionId: session.id,
            expectedRevision: frame.revision,
          }),
        article,
      );
      button(
        text("Delete in OverCrow", "Supprimer dans OverCrow"),
        () =>
          overcrow.journal.requestDelete({
            sessionId: session.id,
            expectedRevision: frame.revision,
          }),
        article,
      );
      details.append(article);
    }
    if (data.previousCursor)
      button(text("Previous", "Précédent"), () =>
        overcrow.journal.page({ cursor: data.previousCursor }),
      );
    if (data.nextCursor)
      button(text("Next", "Suivant"), () =>
        overcrow.journal.page({ cursor: data.nextCursor }),
      );
  } else if (kind === "twitch") {
    primary.textContent =
      data.channelDisplayName ?? text("No channel", "Aucune chaîne");
    paragraph(data.connection);
    for (const message of data.messages) {
      const article = document.createElement("article"),
        name = node("strong", message.displayName);
      if (message.color) name.style.color = message.color;
      article.append(name, node("p", message.text));
      if (message.reply)
        article.append(
          node("p", `↳ ${message.reply.displayName}: ${message.reply.text}`),
        );
      button(
        text("Reply in OverCrow", "Répondre dans OverCrow"),
        () => overcrow.twitch.chat.requestCompose({ replyTo: message.id }),
        article,
      );
      details.append(article);
    }
    button(text("Connect Twitch", "Connexion Twitch"), () =>
      overcrow.twitch.chat.requestConnect(),
    );
    button(text("Choose channel", "Choisir la chaîne"), () =>
      overcrow.twitch.chat.requestChooseChannel(),
    );
    button(text("Compose in OverCrow", "Écrire dans OverCrow"), () =>
      overcrow.twitch.chat.requestCompose(),
    );
  }
  reportSize();
}
function reportSize() {
  if (sizeQueued || closed) return;
  sizeQueued = true;
  requestAnimationFrame(() => {
    sizeQueued = false;
    if (closed) return;
    const content = $("content"),
      width = Math.max(1, Math.min(4096, Math.ceil(content.scrollWidth))),
      height = Math.max(1, Math.min(4096, Math.ceil(content.scrollHeight))),
      key = `${width}:${height}`;
    if (key === lastSize) return;
    lastSize = key;
    void overcrow.presentation.reportSize({ width, height }).catch(() => {});
  });
}
document.body.classList.toggle(
  "compact",
  ["session", "clock", "performance", "fps", "stopwatch", "score"].includes(
    kind,
  ),
);
stops.push(
  overcrow.game.onSnapshot((value) => {
    game = value;
    render();
  }),
);
void overcrow.game
  .snapshot()
  .then((value) => {
    if (!closed) {
      game = value;
      render();
    }
  })
  .catch((error) => {
    status.textContent = error.code;
  });
void overcrow.locale
  .getCurrent()
  .then((value) => {
    if (!closed) {
      locale = value === "fr" ? "fr" : "en";
      render();
    }
  })
  .catch(() => {});
stops.push(
  overcrow.locale.onChanged((value) => {
    locale = value === "fr" ? "fr" : "en";
    render();
  }),
);
stops.push(
  overcrow.presentation.onSnapshot((value) => {
    if (value.data) {
      options = value.data.options;
      if (
        kind === "reviews" &&
        Boolean(options.followedOnly) !== lastFollowed
      ) {
        lastFollowed = Boolean(options.followedOnly);
        void overcrow.playervox.reviews
          .page({ page: 1, followedOnly: lastFollowed })
          .catch((error) => {
            status.textContent = error.code;
          });
      }
    }
    render();
  }),
);
const service = {
  performance: overcrow.telemetry,
  fps: overcrow.fps,
  stopwatch: overcrow.stopwatch,
  media: overcrow.media,
  notes: overcrow.notes,
  score: overcrow.playervox.score,
  rating: overcrow.playervox.rating,
  reviews: overcrow.playervox.reviews,
  journal: overcrow.journal,
  twitch: overcrow.twitch.chat,
}[kind];
if (service)
  stops.push(
    service.onSnapshot((value) => {
      frame = value;
      observedAt = performance.now();
      render();
    }),
  );
const observer = new ResizeObserver(reportSize);
observer.observe($("content"));
const timer = ["clock", "stopwatch"].includes(kind)
  ? setInterval(timing, 250)
  : null;
window.addEventListener(
  "pagehide",
  () => {
    closed = true;
    stops.forEach((stop) => stop());
    observer.disconnect();
    if (timer !== null) clearInterval(timer);
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
  },
  { once: true },
);
