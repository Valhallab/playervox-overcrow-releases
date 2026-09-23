import overcrow from "./overcrow.js";
import { applyLocale, translate } from "./i18n.mjs";
import { connectWidget } from "./runtime.mjs";

const output = document.querySelector("#count");
const status = document.querySelector("#status");
const incrementButton = document.querySelector("#increment");
const resetButton = document.querySelector("#reset");

let count = 0;

function renderCount() {
  output.textContent = String(count);
}

function increment() {
  count += 1;
  renderCount();
}

function reset() {
  count = 0;
  renderCount();
}

function updateLocale(locale) {
  applyLocale(locale);

  status.textContent =
    overcrow.runtime.role === "unavailable" ? translate("browser") : "";
}

incrementButton.addEventListener("click", increment);
resetButton.addEventListener("click", reset);

renderCount();
connectWidget(updateLocale);
