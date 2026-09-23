import overcrow from "./overcrow.js";

function updateLocale(locale) {
  document.documentElement.lang = locale;
}

function updateMode(snapshot) {
  document.body.dataset.mode = snapshot.overlayMode ?? "interactive";
}

updateLocale("en");
updateMode({});

if (overcrow.runtime.role !== "unavailable") {
  overcrow.locale.onChanged(updateLocale);
  overcrow.locale.getCurrent().then(updateLocale).catch(console.error);
  overcrow.game.onSnapshot(updateMode);
  overcrow.game.snapshot().then(updateMode).catch(console.error);
}
