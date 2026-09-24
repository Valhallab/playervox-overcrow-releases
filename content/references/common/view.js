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
  closed = false;
let artworkHandle = null,
  artworkUrl = null,
  sizeQueued = false,
  lastSize = "",
  elapsedMs = 0,
  startedAt = null,
  loaded = false,
  saving = false,
  entries = [],
  scoreGame = null,
  scorePending = false,
  scoreRequest = 0;
const editor = $("entry");
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
      status.textContent = result?.status ?? text("Saved", "Enregistré");
    } catch (error) {
      if (!closed)
        status.textContent = error.code ?? text("Unavailable", "Indisponible");
    } finally {
      element.disabled = !interactive();
    }
  });
  parent.append(element);
  return element;
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
  } else if (kind === "stopwatch") {
    primary.textContent = duration(
      elapsedMs + (startedAt === null ? 0 : performance.now() - startedAt),
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
  if (kind === "stopwatch") {
    timing();
    button(text("Start / pause", "Démarrer / pause"), () => {
      if (startedAt === null) startedAt = performance.now();
      else {
        elapsedMs += performance.now() - startedAt;
        startedAt = null;
      }
      timing();
    });
    button(text("Reset", "Réinitialiser"), () => {
      elapsedMs = 0;
      startedAt = null;
      timing();
    });
    reportSize();
    return;
  }
  if (kind === "notes" || kind === "journal") {
    primary.textContent = text(
      "Your widget's data",
      "Les données de votre widget",
    );
    $("editor-label").hidden = false;
    $("editor-title").textContent = text("Write here", "Écrivez ici");
    editor.disabled = !loaded || saving || !interactive();
    editor.maxLength = kind === "notes" ? 8000 : 500;
    if (kind === "journal") for (const entry of entries) paragraph(entry);
    if (loaded) {
      const save = button(text("Save", "Enregistrer"), async () => {
        if (saving) return;
        const value = editor.value;
        const next =
          kind === "notes"
            ? value
            : [...entries, value.trim()].filter(Boolean).slice(-20);
        saving = true;
        render();
        try {
          await overcrow.storage.set(kind + ".v1", next);
          if (closed) return;
          if (kind === "journal") {
            entries = next;
            editor.value = "";
          }
        } finally {
          saving = false;
          if (!closed) render();
        }
      });
      save.disabled = saving || !interactive();
    }
    reportSize();
    return;
  }
  if (!frame?.data) {
    primary.textContent =
      kind === "score" && scorePending
        ? text("Loading…", "Chargement…")
        : (frame?.status ?? text("Loading…", "Chargement…"));
    if (
      kind === "score" &&
      !scorePending &&
      !game.fixture &&
      game.selectedActive &&
      Number.isInteger(game.steamAppId) &&
      game.steamAppId > 0
    ) {
      const retry = node("button", text("Retry", "Réessayer"));
      retry.type = "button";
      retry.disabled = !interactive();
      retry.addEventListener("click", () => void refreshScore(true));
      actions.append(retry);
    }
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
if (kind === "notes" || kind === "journal") {
  void overcrow.storage
    .get(kind + ".v1")
    .then((value) => {
      if (closed) return;
      if (kind === "notes") {
        if (
          value !== undefined &&
          (typeof value !== "string" || value.length > 8000)
        )
          throw new Error("invalid_storage_value");
        editor.value = value ?? "";
      } else {
        if (
          value !== undefined &&
          (!Array.isArray(value) ||
            value.length > 20 ||
            value.some((item) => typeof item !== "string" || item.length > 500))
        )
          throw new Error("invalid_storage_value");
        entries = value ?? [];
      }
      loaded = true;
      render();
    })
    .catch((error) => {
      if (!closed) status.textContent = error.code ?? error.message;
    });
}
async function refreshScore(retry = false) {
  if (kind !== "score") return;
  const appId = game.selectedActive ? game.steamAppId : null;
  const key = game.fixture ? "fixture" : (appId ?? "inactive");
  if (scoreGame === key && (!retry || scorePending)) return;
  const request = ++scoreRequest;
  scoreGame = key;
  scorePending = false;
  frame = { status: "unavailable", data: null };
  if (game.fixture) {
    frame = {
      status: "ready",
      data: {
        name: "Preview game",
        score: 84,
        ratingsCount: 12,
        criteria: { gameplay: 88, art: 84, tech: 80 },
      },
    };
  } else if (Number.isInteger(appId) && appId > 0) {
    scorePending = true;
    render();
    try {
      const response = await overcrow.fetch(
        `https://api.playervox.com/api/v1/overcrow/games/steam/${appId}/score`,
      );
      if (!response.ok) throw new Error("unavailable");
      const data = await response.json();
      if (
        data.score !== null &&
        (typeof data.score !== "number" ||
          !Number.isFinite(data.score) ||
          data.score < 0 ||
          data.score > 100)
      )
        throw new Error("invalid_response");
      if (
        typeof data.game?.name !== "string" ||
        !Number.isSafeInteger(data.ratings_count) ||
        data.ratings_count < 0
      )
        throw new Error("invalid_response");
      if (closed || scoreRequest !== request) return;
      frame = {
        status: "ready",
        data: {
          name: data.game.name,
          score: data.score,
          ratingsCount: data.ratings_count,
          criteria: data.criteria ?? {},
        },
      };
    } catch {
      if (!closed && scoreRequest === request)
        frame = { status: "unavailable", data: null };
    } finally {
      if (scoreRequest === request) scorePending = false;
    }
  }
  if (!closed && scoreRequest === request) render();
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
    refreshScore();
    render();
  }),
);
void overcrow.game
  .snapshot()
  .then((value) => {
    if (!closed) {
      game = value;
      refreshScore();
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
    }
    render();
  }),
);
const service = {
  performance: overcrow.telemetry,
  fps: overcrow.fps,
  media: overcrow.media,
}[kind];
if (service)
  stops.push(
    service.onSnapshot((value) => {
      frame = value;
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
