import en from "./locales/en.mjs";
import fr from "./locales/fr.mjs";

const locales = { en, fr };
let messages = en;

export function translate(key) {
  return messages[key] ?? en[key] ?? key;
}

export function applyLocale(locale) {
  const language = Object.hasOwn(locales, locale) ? locale : "en";
  messages = locales[language];
  document.documentElement.lang = language;

  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = translate(element.dataset.i18n);
  }
}
