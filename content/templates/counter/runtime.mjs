import overcrow from "./overcrow.js";

// Subscribe before reading the initial values, as in the native runtime.
export function connectWidget(setLocale) {
  setLocale("en");
  document.body.dataset.mode = "interactive";
  if (overcrow.runtime.role === "unavailable") return;

  overcrow.locale.onChanged(setLocale);
  overcrow.locale
    .getCurrent()
    .then(setLocale)
    .catch(() => setLocale("en"));
  const setMode = (snapshot) => {
    document.body.dataset.mode = snapshot.overlayMode ?? "interactive";
  };
  overcrow.game.onSnapshot(setMode);
  overcrow.game
    .snapshot()
    .then(setMode)
    .catch(() => {});
}
