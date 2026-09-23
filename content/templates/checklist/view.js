import overcrow from "./overcrow.js";
import { applyLocale, translate } from "./i18n.mjs";
import { KEY, decode, encode } from "./model.mjs";
import { connectWidget } from "./runtime.mjs";

const status = document.querySelector("#status");
const list = document.querySelector("#tasks");
const input = document.querySelector("#task");
const form = document.querySelector("form");
const addButton = form.querySelector("button");

let tasks = [];
let readable = true;
let statusKey = "";

function showStatus(key) {
  statusKey = key;
  status.textContent = key ? translate(key) : "";
}

function loadTasks() {
  try {
    tasks = decode(localStorage.getItem(KEY));
  } catch {
    // Keep unreadable storage intact until its owner can recover it.
    readable = false;
    input.disabled = true;
    addButton.disabled = true;
    showStatus("unreadable");
  }
}

function saveTasks() {
  try {
    localStorage.setItem(KEY, encode(tasks));
    showStatus("saved");
  } catch {
    showStatus("failed");
  }
}

function createTaskRow(task, index) {
  const row = document.createElement("li");
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  const caption = document.createElement("span");
  const removeButton = document.createElement("button");

  checkbox.type = "checkbox";
  checkbox.checked = task.done;
  caption.textContent = task.text;

  checkbox.addEventListener("change", () => {
    tasks[index].done = checkbox.checked;
    saveTasks();
  });

  removeButton.type = "button";
  removeButton.textContent = translate("remove");
  removeButton.setAttribute(
    "aria-label",
    `${translate("remove")} ${task.text}`,
  );

  removeButton.addEventListener("click", () => {
    tasks.splice(index, 1);
    saveTasks();
    renderTasks();
  });

  label.append(checkbox, caption);
  row.append(label, removeButton);
  return row;
}

function renderTasks() {
  list.replaceChildren(...tasks.map(createTaskRow));
}

function addTask(event) {
  event.preventDefault();
  if (!readable) return;

  const text = input.value.trim();
  if (!text) return;

  if (tasks.length >= 100) {
    showStatus("limit");
    return;
  }

  tasks.push({ text, done: false });
  saveTasks();
  renderTasks();

  input.value = "";
  input.focus();
}

function updateLocale(locale) {
  applyLocale(locale);
  showStatus(statusKey);
  renderTasks();
}

loadTasks();

if (readable && overcrow.runtime.role === "unavailable") {
  showStatus("browser");
}

form.addEventListener("submit", addTask);
connectWidget(updateLocale);
