// Fills the generated regions of the creator documentation (docs/content/),
// so no page keeps a hand-written copy of the contract:
//
//   <!-- generated:NAME -->
//   …
//   <!-- /generated:NAME -->
//
// The tables come from the schema reference that the schema crate generates
// (docs/widget-schema-v1.md), from the SDK types generated from the same
// crate (sdk/src/generated/schema.ts) and from the reference widgets
// (widgets/). The English text is the schema's, reworded for a creator
// where docs/content/i18n/en.json says so; its French translation is the
// catalog docs/content/i18n/fr.json. A description without a translation,
// or a translation or rewording whose description is gone, is an error.
//
//   node scripts/build-docs-content.mjs            rewrite the regions
//   node scripts/build-docs-content.mjs --check    fail when one is stale
//   node scripts/build-docs-content.mjs --missing  print the catalog entries to write
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { children, parseSchemaReference, records } from "./lib/schema-reference.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const content = join(root, "docs", "content");
const LOCALES = ["en", "fr"];

const WORDS = {
  en: {
    capability: "Capability",
    sensitive: "Sensitive",
    service: "Service",
    when: "When it can be called",
    anyTime: "At any time",
    userAction: "Only during a user action",
    onSubmit: "When the user submits the form",
    form: "form",
    whenNote:
      "“Only during a user action” is explained in [Calls that need a user action](services.md#calls-that-need-a-user-action).",
    permission: "Permission",
    yes: "yes",
    no: "no",
    widget: "Widget",
    description: "Description",
    id: "ID",
    authority: "Permissions",
    source: "Source",
    nothing: "none",
    meaning: "Meaning",
    account: "Account",
    withSensitive: "With a sensitive capability",
    field: "Field",
    type: "Type",
    required: "Required",
    syntax: "Syntax",
    element: "Element",
    content: "Content",
    parents: "Parents",
    focus: "Keyboard focus",
    role: "Role",
    events: "Events",
    attribute: "Attribute",
    noAttribute: "No attribute of its own.",
    event: "Event",
    isUserAction: "User action",
    detail: "Detail",
    condition: "When",
    width: "Width",
    height: "Height",
    always: "always",
    property: "Property",
    value: "Value",
    initial: "Initial",
    inherited: "Inherited",
    animatable: "Animatable",
    selector: "Selector",
    token: "Token",
    dark: "Dark",
    light: "Light",
    shape: "Shape",
    accepts: "Accepts",
    kind: "Kind",
    call: "call, answered once",
    subscribe: "subscription",
    confirmed: "the user confirms it first, in a dialog drawn by OverCrow",
    requires: "Requires",
    parameters: "Parameters",
    result: "Result",
    update: "Each update",
    member: "Member",
    code: "Code",
    command: "Command",
    arguments: "Arguments",
    category: "Category",
    fatal: "Fatal",
    restarts: "Restarted",
    limit: "Limit",
    path: "Path",
    rowType: "Row type",
    colon: ": ",
    semicolon: "; ",
    icons: (version, count) => `Lucide ${version}, ${count} icons.`,
    groups: {
      Layout: "Layout",
      Box: "Box",
      Visual: "Appearance",
      Text: "Text",
      Motion: "Motion",
      Interaction: "Interaction",
    },
    tokenTypes: {
      color: "Colours",
      length: "Lengths",
      "font size": "Font sizes",
      "font family": "Font families",
      time: "Durations",
      shadow: "Shadows",
    },
    limitGroups: {
      project: "Project files and package",
      manifest: "Manifest and options menu",
      network: "Network rules",
      listing: "Listing",
      view: "View",
      style: "Style",
      drawing: "Drawing and images",
      logic: "Logic",
      services: "Services",
      data: "Notes, reviews and chat",
      tests: "Reference images",
    },
  },
  fr: {
    capability: "Capability",
    sensitive: "Sensible",
    service: "Service",
    when: "Quand l’appeler",
    anyTime: "À tout moment",
    userAction: "Seulement pendant une action de l’utilisateur",
    onSubmit: "Quand l’utilisateur valide le formulaire",
    form: "formulaire",
    whenNote:
      "« Seulement pendant une action de l’utilisateur » est expliqué dans [Les appels qui demandent une action de l’utilisateur](services.md#les-appels-qui-demandent-une-action-de-lutilisateur).",
    permission: "Permission",
    yes: "oui",
    no: "non",
    widget: "Widget",
    description: "Description",
    id: "ID",
    authority: "Permissions",
    source: "Sources",
    nothing: "aucune",
    meaning: "Signification",
    account: "Compte",
    withSensitive: "Avec une capability sensible",
    field: "Champ",
    type: "Type",
    required: "Obligatoire",
    syntax: "Syntaxe",
    element: "Élément",
    content: "Contenu",
    parents: "Parents",
    focus: "Focus clavier",
    role: "Rôle",
    events: "Événements",
    attribute: "Attribut",
    noAttribute: "Aucun attribut propre.",
    event: "Événement",
    isUserAction: "Action de l’utilisateur",
    detail: "Détail",
    condition: "Quand",
    width: "Largeur",
    height: "Hauteur",
    always: "toujours",
    property: "Propriété",
    value: "Valeur",
    initial: "Valeur initiale",
    inherited: "Héritée",
    animatable: "Animable",
    selector: "Sélecteur",
    token: "Token",
    dark: "Sombre",
    light: "Clair",
    shape: "Forme",
    accepts: "Accepte",
    kind: "Nature",
    call: "appel, à réponse unique",
    subscribe: "abonnement",
    confirmed: "l’utilisateur le confirme d’abord, dans une boîte de dialogue dessinée par OverCrow",
    requires: "Exige",
    parameters: "Paramètres",
    result: "Résultat",
    update: "Chaque mise à jour",
    member: "Membre",
    code: "Code",
    command: "Commande",
    arguments: "Arguments",
    category: "Catégorie",
    fatal: "Fatale",
    restarts: "Relancé",
    limit: "Limite",
    path: "Chemin",
    rowType: "Type de ligne",
    colon: " : ",
    semicolon: " ; ",
    icons: (version, count) => `Lucide ${version}, ${count} icônes.`,
    groups: {
      Layout: "Mise en page",
      Box: "Boîte",
      Visual: "Apparence",
      Text: "Texte",
      Motion: "Mouvement",
      Interaction: "Interaction",
    },
    tokenTypes: {
      color: "Couleurs",
      length: "Longueurs",
      "font size": "Tailles de police",
      "font family": "Familles de police",
      time: "Durées",
      shadow: "Ombres",
    },
    limitGroups: {
      project: "Fichiers du projet et paquet",
      manifest: "Manifeste et menu d’options",
      network: "Règles réseau",
      listing: "Fiche",
      view: "Vue",
      style: "Style",
      drawing: "Dessin et images",
      logic: "Logique",
      services: "Services",
      data: "Notes, avis et chat",
      tests: "Images de référence",
    },
  },
};

// The limits a creator works against, by topic. The others bound the host
// itself (frames between processes, caches, the catalog) and stay in the
// schema reference. A limit of the schema in neither list is an error, so a
// new one is placed deliberately.
const LIMIT_GROUPS = {
  project: [
    "MAX_VIEW_SOURCE_BYTES",
    "MAX_STYLE_SOURCE_BYTES",
    "MAX_LOGIC_BYTES",
    "MAX_LOCALE_ENTRIES",
    "MAX_LOCALE_KEY_BYTES",
    "MAX_LOCALE_VALUE_BYTES",
    "MAX_LOCALE_FILE_BYTES",
    "MAX_MANIFEST_BYTES",
    "MAX_LICENSE_BYTES",
    "MAX_COMPILED_VIEW_BYTES",
    "MAX_PACKAGE_BYTES",
    "MAX_PACKAGE_FILES",
    "MAX_PACKAGE_PATH_BYTES",
    "MAX_ASSET_PATH_SEGMENTS",
  ],
  manifest: [
    "MIN_WIDGET_ID_BYTES",
    "MAX_WIDGET_ID_BYTES",
    "MAX_VERSION_BYTES",
    "MAX_WIDGET_NAME_CHARS",
    "MAX_WIDGET_EDGE_PX",
    "MIN_CONTENT_SCALE",
    "MAX_CONTENT_SCALE",
    "MAX_GAME_EVENTS",
    "MAX_MENU_ROWS",
    "MAX_MENU_DEPTH",
    "MAX_MENU_LABEL_CHARS",
    "MAX_MENU_ID_BYTES",
    "MIN_MENU_CHOICES",
    "MAX_MENU_CHOICES",
    "MAX_MENU_NUMBER",
    "MAX_SLIDER_STEPS",
  ],
  network: [
    "MAX_NETWORK_RULES",
    "MAX_NETWORK_PATH_BYTES",
    "MAX_PATH_PARAMS",
    "MAX_QUERY_PARAMS",
    "MAX_ENUM_VALUES",
    "MAX_ENUM_VALUE_BYTES",
    "MAX_PARAMETER_NAME_BYTES",
    "MAX_SLUG_PARAMETER_BYTES",
    "MAX_STRING_PARAMETER_BYTES",
    "MAX_DNS_LABEL_BYTES",
    "MAX_DNS_NAME_BYTES",
    "MAX_REQUEST_URL_BYTES",
    "MAX_HTTP_REQUEST_BYTES",
    "MAX_HTTP_RESPONSE_BYTES",
    "MAX_HTTP_DECLARED_RESPONSE_BYTES",
    "MAX_HTTP_RESPONSE_BYTES_PER_WIDGET",
    "MAX_HTTP_RESPONSE_BYTES_GLOBAL",
    "MAX_HTTP_CONCURRENT_PER_WIDGET",
    "MAX_HTTP_CONCURRENT_GLOBAL",
    "HTTP_TIMEOUT_MS",
  ],
  listing: [
    "MAX_LISTING_LOCALIZATIONS",
    "MAX_LISTING_NAME_BYTES",
    "MAX_LISTING_DESCRIPTION_BYTES",
    "MAX_AUTHOR_BYTES",
    "MAX_SPDX_LICENSE_BYTES",
    "MAX_CATALOG_URL_BYTES",
    "MAX_PREVIEW_BYTES",
  ],
  view: [
    "MAX_VIEW_ELEMENTS",
    "MAX_COMPONENTS",
    "MAX_COMPONENT_PROPS",
    "MAX_VIEW_EXPRESSIONS",
    "MAX_EXPRESSION_BYTES",
    "MAX_EXPRESSION_DEPTH",
    "MAX_CALL_ARGUMENTS",
    "MAX_SCENE_NODES",
    "MAX_TREE_DEPTH",
    "MAX_CHILDREN",
    "MAX_NODE_TEXT_BYTES",
    "MAX_ATTRIBUTE_TEXT_BYTES",
    "MAX_LABEL_BYTES",
    "MAX_IDENTIFIER_BYTES",
    "MAX_INITIALS_BYTES",
    "MAX_CLASSES_PER_NODE",
    "MAX_FIELD_TEXT_BYTES",
    "MAX_CHART_POINTS",
    "MAX_CHART_SERIES",
    "MAX_KEY_BYTES",
  ],
  style: [
    "MAX_STYLE_RULES",
    "MAX_SELECTORS_PER_RULE",
    "MAX_COMPOUNDS_PER_SELECTOR",
    "MAX_SIMPLE_SELECTORS_PER_COMPOUND",
    "MAX_DECLARATIONS_PER_RULE",
    "MAX_KEYFRAMES",
    "MAX_KEYFRAME_STOPS",
    "MAX_SHADOWS",
    "MAX_SHADOW_BLUR_PX",
    "MAX_GRADIENT_STOPS",
    "MAX_GRID_TRACKS",
    "MAX_GRID_FRACTION",
    "MAX_TRANSITIONS",
    "MAX_ANIMATION_MS",
    "MAX_ACTIVE_ANIMATIONS",
    "ANIMATION_RATE_HZ",
    "MAX_LENGTH_PX",
    "MIN_FONT_SIZE_PX",
    "MAX_FONT_SIZE_PX",
    "MAX_PERCENT",
    "MAX_ANGLE_DEG",
    "MAX_TRANSFORM_FUNCTIONS",
    "MAX_TRANSFORM_SCALE",
    "MAX_EASING_STEPS",
    "MAX_ANIMATION_ITERATIONS",
  ],
  drawing: [
    "MAX_CANVASES",
    "MAX_DRAW_COMMANDS",
    "MAX_PATH_POINTS",
    "MAX_DRAW_STATE_DEPTH",
    "MAX_IMAGE_EDGE_PX",
    "MAX_IMAGE_ENCODED_BYTES",
  ],
  logic: [
    "VM_HEAP_BYTES",
    "VM_MAX_HEAP_BYTES",
    "VM_STACK_BYTES",
    "VM_PROCESS_MEMORY_BYTES",
    "VM_CPU_PERCENT",
    "VM_TURN_BUDGET_MS",
    "VM_JOBS_PER_TURN",
    "VM_MESSAGES_PER_TURN",
    "MAX_VM_MESSAGES_PER_SECOND",
    "MAX_VM_MESSAGE_BURST",
    "MAX_PATCH_BYTES",
    "MAX_PATCH_OPS",
    "MAX_TIMERS",
    "MIN_TIMER_INTERVAL_MS",
    "CLOCK_RESOLUTION_MS",
    "MAX_LOG_BYTES",
  ],
  services: [
    "MAX_SERVICE_CALLS_IN_FLIGHT",
    "MAX_SUBSCRIPTIONS",
    "STORAGE_QUOTA_BYTES",
    "MAX_STORAGE_KEYS",
    "MAX_STORAGE_KEY_BYTES",
    "MAX_STORAGE_VALUE_BYTES",
    "MAX_CLIPBOARD_BYTES",
    "MAX_OBJECT_ID_BYTES",
  ],
  data: [
    "MAX_NOTES",
    "MAX_NOTE_TITLE_BYTES",
    "MAX_NOTE_BODY_BYTES",
    "MAX_NOTE_ITEMS",
    "MAX_NOTE_ITEM_BYTES",
    "MAX_REVIEW_CHARS",
    "MAX_CHAT_MESSAGE_CHARS",
    "MAX_CHAT_FRAGMENTS",
    "MAX_CHAT_FAVORITES",
    "MAX_CHAT_CHANNEL_BYTES",
  ],
  tests: ["PARITY_CHANNEL_TOLERANCE", "PARITY_MAX_DIFFERENT_PIXELS"],
};
const HOST_LIMITS = new Set([
  "MAX_LEDGER_BYTES",
  "MAX_CATALOG_BYTES",
  "MAX_CATALOG_PAYLOAD_BYTES",
  "MAX_CATALOG_TARGETS",
  "MAX_CATALOG_LIFETIME_DAYS",
  "MAX_SEED_LIFETIME_DAYS",
  "MAX_CATALOG_CLOCK_SKEW_MS",
  "MAX_KEY_ID_BYTES",
  "MAX_TRUST_KEYS",
  "MAX_WIDGET_TEXTURE_BYTES",
  "MAX_GLOBAL_TEXTURE_BYTES",
  "MAX_GLYPH_ATLAS_BYTES",
  "VM_EVENT_QUEUE",
  "VM_ADDRESS_SPACE_BYTES",
  "VM_TURN_WATCHDOG_MS",
  "VM_TURNS_IN_FLIGHT",
  "VM_READY_TIMEOUT_MS",
  "MAX_CONTROL_JSON_BYTES",
  "MAX_QUEUED_BYTES",
  "HEARTBEAT_INTERVAL_MS",
  "HEARTBEAT_DEADLINE_MS",
]);

// Services the SDK calls for itself (`timers`, `Subscription.cancel`).
const INTERNAL_SERVICES = new Set(["subscription.cancel", "timer.start", "timer.cancel"]);
// `ServiceError` is documented with the error codes.
const SKIPPED_SHAPES = new Set(["ServiceError"]);

const schemaTypes = readFileSync(join(root, "sdk", "src", "generated", "schema.ts"), "utf8");
const sections = parseSchemaReference(readFileSync(join(root, "docs", "widget-schema-v1.md"), "utf8"));
const i18n = join(content, "i18n");
const catalog = JSON.parse(readFileSync(join(i18n, "fr.json"), "utf8"));
// Descriptions reworded for a creator, where the schema speaks to those who
// implement the host: { "<schema text>": "<page text>" }.
const reworded = JSON.parse(readFileSync(join(i18n, "en.json"), "utf8"));
const serviceErrors = JSON.parse(readFileSync(join(i18n, "service-errors.json"), "utf8"));

/** The string members of `export type NAME = | "a" | "b";`. */
function union(name) {
  const match = schemaTypes.match(new RegExp(`export type ${name} =([^;]*);`));
  if (!match) {
    throw new Error(`schema.ts has no type ${name}`);
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((member) => member[1]);
}

/** `readonly "key": "a" | "b";` members of `export interface NAME`. */
function mapping(name) {
  const match = schemaTypes.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) {
    throw new Error(`schema.ts has no interface ${name}`);
  }
  const entries = new Map();
  for (const line of match[1].matchAll(/readonly "([^"]+)": ([^;]+);/g)) {
    entries.set(line[1], line[2] === "never" ? [] : [...line[2].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  }
  return entries;
}

// What the schema says for its own maintainers and no creator needs: the
// design record it cites, and what the retired Web runtime did.
const clean = (text) =>
  text
    .replace(/ \(ADR \d{4}(?:, [A-Z]\d+)?\)/g, "")
    .replace(/,? as today/g, "")
    .replace(/ Status: fixed\.$/, "")
    .trim();

// The schema writes ranges as `1..=40`; the pages say "1 to 40".
const RANGE = /(`[^`]+`|-?\d+(?:\.\d+)?)\.\.=(`[^`]+`|-?\d+(?:\.\d+)?)/g;
const ranges = (text, locale) => text.replace(RANGE, locale === "fr" ? "de $1 à $2" : "$1 to $2");

const hasWords = (text) => /[A-Za-z]{2,}/.test(text.replace(/`[^`]*`/g, ""));

/**
 * The words of a type cell with its values taken out, and those values:
 * `text ≤ `MAX_LABEL_BYTES`` is `text ≤ {0}`, `integer 1..=40` is
 * `integer {0}`, a union of code spans is one value.
 */
function pattern(text) {
  const values = [];
  const hold = (value) => `{${values.push(value) - 1}}`;
  const shape = text
    .replace(/`[^`]*`(?: \\\| `[^`]*`)*/g, hold)
    .replace(/-?\d+(?:\.\d+)?(?:\.\.=(?:-?\d+(?:\.\d+)?|\{\d+\}))?/g, (number, offset, whole) =>
      // A digit inside a placeholder is not a value.
      whole[offset - 1] === "{" ? number : hold(number),
    );
  return { shape, values };
}

function fill(shape, values) {
  let text = shape;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    text = text.replaceAll(`{${index}}`, values[index]);
  }
  return text;
}

/** Translates the schema's English for one locale and records what it used. */
class Translator {
  constructor(locale, usage) {
    this.locale = locale;
    this.usage = usage;
    this.w = WORDS[locale];
  }

  lookup(table, key) {
    this.usage.used[table].add(key);
    const found = catalog[table][key];
    if (found === undefined) {
      this.usage.missing[table].add(key);
      return key;
    }
    return found;
  }

  /** A description. */
  text(source) {
    const schema = clean(source);
    this.usage.reworded.add(schema);
    const english = reworded[schema] ?? ranges(schema, "en");
    return this.locale === "en" || !hasWords(english) ? english : this.lookup("text", english);
  }

  /** A type, a shape, a value: words around code and numbers. */
  type(source) {
    const english = clean(source).replace("`opaque `#rrggbb``", "opaque `#rrggbb`");
    if (this.locale === "en" || !hasWords(english)) {
      return ranges(english, this.locale);
    }
    const { shape, values } = pattern(english);
    return ranges(fill(this.lookup("patterns", shape), values), this.locale);
  }

  /** `name`: type; `name?`: type. */
  params(source) {
    if (source === "none") {
      return this.w.nothing;
    }
    return source
      .split("; ")
      .map((param) => {
        const match = param.match(/^(`[^`]+`): (.*)$/);
        if (!match) {
          throw new Error(`unexpected parameter "${param}"`);
        }
        return `${match[1]}${this.w.colon}${this.type(match[2])}`;
      })
      .join(this.w.semicolon);
  }

  yesNo(source) {
    if (source !== "yes" && source !== "no") {
      throw new Error(`expected yes or no, got "${source}"`);
    }
    return this.w[source];
  }
}

const code = (text) => `\`${text}\``;
const row = (cells) => `| ${cells.join(" | ")} |`;
const table = (header, rows) =>
  [row(header), row(header.map(() => "---")), ...rows.map(row)].join("\n");
const blocks = (parts) => parts.filter((part) => part !== "").join("\n\n");

/** GitHub's anchor of a heading made of one code span. */
const anchor = (name) => name.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");

// The write intents and the capability each one needs.
const intents = children(sections, "Services > Write intents").map((intent) => {
  const capability = intent.section.intro[0]?.match(/^Capability `([^`]+)`;/)?.[1];
  if (!capability) {
    throw new Error(`write intent ${intent.name} names no capability`);
  }
  return { ...intent, capability };
});

const gestureServices = new Set(union("GestureServiceName"));
const when = (t, service) => (gestureServices.has(service) ? t.w.userAction : t.w.anyTime);
const formCell = (t, intent) => `[${t.w.form} ${code(intent)}](forms.md#${anchor(intent)})`;

function fields(t, path, { name = t.w.field, index = 0 } = {}) {
  return table(
    [name, t.w.type, t.w.required, t.w.meaning],
    records(sections, path, index).map((field) => [
      field.Field,
      t.type(field.Type),
      t.yesNo(field.Required),
      t.text(field.Meaning),
    ]),
  );
}

function capabilities(t) {
  const sensitive = new Set(union("SensitiveCapability"));
  const services = mapping("CapabilityServices");
  const rows = [];
  for (const name of union("Capability")) {
    const flag = sensitive.has(name) ? `**${t.w.yes}**` : t.w.no;
    for (const service of services.get(name) ?? []) {
      rows.push([code(name), flag, code(service), when(t, service)]);
    }
    for (const intent of intents.filter((entry) => entry.capability === name)) {
      rows.push([code(name), flag, formCell(t, intent.name), t.w.onSubmit]);
    }
  }
  return blocks([table([t.w.capability, t.w.sensitive, t.w.service, t.w.when], rows), t.w.whenNote]);
}

function capabilityList(t) {
  return table(
    [t.w.capability, t.w.sensitive, t.w.account, t.w.meaning],
    records(sections, "Permissions > Capabilities").map((entry) => [
      entry.Capability,
      entry.Sensitive === "yes" ? `**${t.w.yes}**` : t.yesNo(entry.Sensitive),
      entry.Account === "none" ? "—" : entry.Account,
      t.text(entry.Meaning),
    ]),
  );
}

function permissions(t) {
  const services = mapping("PermissionServices");
  const rows = [];
  for (const name of union("Permission").filter((entry) => entry !== "capabilities")) {
    for (const service of services.get(name) ?? []) {
      rows.push([code(name), code(service), when(t, service)]);
    }
  }
  return blocks([table([t.w.permission, t.w.service, t.w.when], rows), t.w.whenNote]);
}

function permissionList(t) {
  return table(
    [t.w.permission, t.w.meaning, t.w.withSensitive],
    records(sections, "Permissions").map((entry) => [
      entry.Permission,
      t.text(entry.Meaning),
      t.type(entry["With a sensitive capability"]),
    ]),
  );
}

function parameterConstraints(t) {
  return table(
    [t.w.type, t.w.shape, t.w.accepts],
    records(sections, "Permissions > ParameterConstraint types").map((entry) => [
      entry.Type,
      t.type(entry.Shape),
      t.text(entry.Accepts),
    ]),
  );
}

function menuRowTypes(t) {
  return blocks(
    children(sections, "Wrapper menu > Row types").flatMap((type) => [
      `### ${code(type.name)}`,
      t.text(type.section.intro.join(" ")),
      type.section.tables.length > 0 ? fields(t, type.path) : "",
    ]),
  );
}

const syntax = (t, path, name, column) =>
  table(
    [name, t.w.meaning],
    records(sections, path).map((entry) => [entry[column], t.text(entry.Meaning)]),
  );

function elementList(t) {
  return table(
    [t.w.element, t.w.meaning],
    records(sections, "View > Elements").map((entry) => [
      `[${entry.Element}](elements.md#${anchor(entry.Element.replaceAll("`", ""))})`,
      t.text(entry.Meaning),
    ]),
  );
}

function elements(t) {
  return blocks(
    records(sections, "View > Elements").flatMap((entry) => {
      const name = entry.Element.replaceAll("`", "");
      const own = `View > Elements > ${name} attributes`;
      return [
        `### ${entry.Element}`,
        t.text(entry.Meaning),
        table(
          [t.w.content, t.w.parents, t.w.focus, t.w.role, t.w.events],
          [[t.type(entry.Content), t.type(entry.Parents), t.type(entry.Focus), code(entry.Role), t.type(entry.Events)]],
        ),
        sections.has(own) ? fields(t, own, { name: t.w.attribute }) : t.w.noAttribute,
      ];
    }),
  );
}

function events(t) {
  return table(
    [t.w.event, t.w.isUserAction, t.w.detail, t.w.meaning],
    records(sections, "View > Events").map((entry) => [
      entry.Event,
      entry.Gesture === "yes" ? `**${t.w.yes}**` : t.yesNo(entry.Gesture),
      t.type(entry.Detail),
      t.text(entry.Meaning),
    ]),
  );
}

function defaultSizes(t) {
  return table(
    [t.w.element, t.w.condition, t.w.width, t.w.height],
    records(sections, "Style > Default sizes").map((entry) => [
      entry.Element,
      entry.When === "—" ? t.w.always : entry.When,
      t.type(entry.Width),
      t.type(entry.Height),
    ]),
  );
}

function styleProperties(t) {
  const properties = records(sections, "Style > Properties");
  return blocks(
    [...new Set(properties.map((entry) => entry.Group))].flatMap((group) => {
      const title = t.w.groups[group];
      if (!title) {
        throw new Error(`style property group "${group}" has no title`);
      }
      return [
        `### ${title}`,
        table(
          [t.w.property, t.w.value, t.w.initial, t.w.inherited, t.w.animatable],
          properties
            .filter((entry) => entry.Group === group)
            .map((entry) => [
              entry.Property,
              t.type(entry.Value),
              entry.Initial,
              t.yesNo(entry.Inherited),
              t.yesNo(entry.Animatable),
            ]),
        ),
      ];
    }),
  );
}

function tokens(t) {
  const all = records(sections, "Design tokens");
  return blocks(
    [...new Set(all.map((entry) => entry.Type))].flatMap((type) => {
      const title = t.w.tokenTypes[type];
      if (!title) {
        throw new Error(`token type "${type}" has no title`);
      }
      const group = all.filter((entry) => entry.Type === type);
      const themed = group.some((entry) => entry.Dark !== entry.Light);
      return [
        `### ${title}`,
        themed
          ? table(
              [t.w.token, t.w.dark, t.w.light, t.w.meaning],
              group.map((entry) => [entry.Token, entry.Dark, entry.Light, t.text(entry.Meaning)]),
            )
          : table(
              [t.w.token, t.w.value, t.w.meaning],
              group.map((entry) => [entry.Token, entry.Dark, t.text(entry.Meaning)]),
            ),
      ];
    }),
  );
}

function icons(t) {
  const match = sections.get("Icons")?.intro.join(" ").match(/\(Lucide ([0-9.]+), (\d+) names\)/);
  if (!match) {
    throw new Error("the schema reference does not state the icon set");
  }
  return t.w.icons(match[1], match[2]);
}

/** A shape cell with each named result shape linked to its section. */
function linkShapes(t, text, page) {
  const named = new Set(children(sections, "Services > Result shapes").map((shape) => shape.name));
  return text.replace(/`([A-Z][A-Za-z]+)`/g, (whole, name) =>
    named.has(name) && !SKIPPED_SHAPES.has(name) ? `[${whole}](${page}#${anchor(name)})` : whole,
  );
}

function services(t) {
  return blocks(
    records(sections, "Services")
      .filter((entry) => !INTERNAL_SERVICES.has(entry.Service.replaceAll("`", "")))
      .flatMap((entry) => {
        const name = entry.Service.replaceAll("`", "");
        if (entry.Kind !== "call" && entry.Kind !== "subscribe") {
          throw new Error(`service ${name} has the unknown kind "${entry.Kind}"`);
        }
        const kind = t.w[entry.Kind] + (entry.Confirmation === "yes" ? `${t.w.semicolon}${t.w.confirmed}` : "");
        const shape = linkShapes(t, t.type(entry.Shape), "result-shapes.md");
        const result = t.text(entry.Result);
        const label = entry.Kind === "subscribe" ? t.w.update : t.w.result;
        const item = (title, value) => `- **${title}**${t.w.colon}${value}`;
        return [
          `### ${entry.Service}`,
          [
            item(t.w.kind, kind),
            item(t.w.requires, t.type(entry.Requires)),
            item(t.w.when, when(t, name)),
            item(t.w.parameters, t.params(entry.Parameters)),
            item(label, result),
            ...(clean(entry.Shape) === clean(entry.Result) ? [] : [item(t.w.shape, shape)]),
          ].join("\n"),
        ];
      }),
  );
}

function resultShapes(t) {
  return blocks(
    children(sections, "Services > Result shapes")
      .filter((shape) => !SKIPPED_SHAPES.has(shape.name))
      .flatMap((shape) => {
        const intro = shape.section.intro.join(" ").match(/^(.*?\.) (`\{.*)$/);
        if (!intro) {
          throw new Error(`result shape ${shape.name} has no summary`);
        }
        return [
          `### ${code(shape.name)}`,
          `${t.text(intro[1])} ${t.type(intro[2])}`,
          ...shape.section.tables.map((_, index) =>
            table(
              [t.w.member, t.w.shape, t.w.meaning],
              records(sections, shape.path, index).map((member) => [
                member.Member,
                linkShapes(t, t.type(member.Shape), ""),
                t.text(member.Meaning),
              ]),
            ),
          ),
        ];
      }),
  );
}

function writeIntents(t) {
  return blocks(
    intents.flatMap((intent) => [
      `### ${code(intent.name)}`,
      t.text(intent.section.intro.join(" ")),
      fields(t, intent.path),
    ]),
  );
}

function errorCodes(t) {
  const codes = union("ServiceErrorCode");
  const described = Object.keys(serviceErrors);
  const missing = codes.filter((name) => !described.includes(name));
  const unknown = described.filter((name) => !codes.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `docs/content/i18n/service-errors.json: missing ${missing.join(", ") || "none"}; unknown ${unknown.join(", ") || "none"}`,
    );
  }
  return table(
    [t.w.code, t.w.meaning],
    codes.map((name) => {
      const meaning = serviceErrors[name][t.locale];
      if (typeof meaning !== "string" || meaning.trim() === "") {
        throw new Error(`docs/content/i18n/service-errors.json: ${name} has no ${t.locale} text`);
      }
      return [code(name), meaning];
    }),
  );
}

function drawCommands(t) {
  return table(
    [t.w.command, t.w.arguments, t.w.meaning],
    records(sections, "IPC > Draw commands").map((entry) => [
      entry.Command,
      t.params(entry.Arguments),
      t.text(entry.Meaning),
    ]),
  );
}

const categories = (t, path, column, title) =>
  table(
    [t.w.category, title, t.w.meaning],
    records(sections, path).map((entry) => [entry.Category, t.yesNo(entry[column]), t.text(entry.Meaning)]),
  );

function limits(t) {
  const all = new Map(records(sections, "Limits").map((entry) => [entry.Limit.replaceAll("`", ""), entry]));
  const placed = new Set(Object.values(LIMIT_GROUPS).flat());
  const stray = [...all.keys()].filter((name) => !placed.has(name) && !HOST_LIMITS.has(name));
  const gone = [...placed, ...HOST_LIMITS].filter((name) => !all.has(name));
  if (stray.length > 0 || gone.length > 0) {
    throw new Error(
      `limits: place ${stray.join(", ") || "none"} in LIMIT_GROUPS or HOST_LIMITS; remove ${gone.join(", ") || "none"}`,
    );
  }
  return blocks(
    Object.entries(LIMIT_GROUPS).flatMap(([group, names]) => [
      `### ${t.w.limitGroups[group]}`,
      table(
        [t.w.limit, t.w.value, t.w.meaning],
        names.map((name) => {
          const entry = all.get(name);
          return [entry.Limit, t.type(entry.Value), t.text(entry.Meaning)];
        }),
      ),
    ]),
  );
}

function packageFiles(t) {
  return table(
    [t.w.path, t.w.required, t.w.limit, t.w.meaning],
    records(sections, "Package > Files").map((entry) => [
      entry.Path,
      t.yesNo(entry.Required),
      entry.Limit,
      t.text(entry.Meaning),
    ]),
  );
}

function widgets(t, file) {
  const base = join(root, "widgets");
  const rows = [];
  for (const dir of readdirSync(base).sort()) {
    const project = join(base, dir);
    // Widget API v1 projects only (they have a view.ocml).
    if (!existsSync(join(project, "view.ocml"))) {
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(project, "manifest.json"), "utf8"));
    const listing = JSON.parse(readFileSync(join(project, "listing.json"), "utf8"));
    const text =
      listing.localizations.find((entry) => entry.locale === t.locale) ??
      listing.localizations.find((entry) => entry.locale === listing.defaultLocale);
    const declared = manifest.permissions ?? {};
    const authority = [
      ...(declared.capabilities ?? []),
      ...Object.keys(declared).filter((key) => key !== "capabilities" && declared[key] !== false),
    ];
    const source = `${relative(dirname(file), project).split("\\").join("/")}/`;
    rows.push([
      `**${text.name}**`,
      text.description,
      code(manifest.id),
      authority.map(code).join(", ") || t.w.nothing,
      `[widgets/${dir}/](${source})`,
    ]);
  }
  return table([t.w.widget, t.w.description, t.w.id, t.w.authority, t.w.source], rows);
}

const list = (name) => `${union(name).map(code).join(", ")}.`;

const GENERATORS = {
  // Manifest.
  "manifest-fields": (t) => fields(t, "Manifest > manifest.json"),
  "manifest-name": (t) => fields(t, "Manifest > WidgetName"),
  "manifest-sizing": (t) => fields(t, "Manifest > Sizing"),
  "manifest-dimensions": (t) => fields(t, "Manifest > Dimensions"),
  "manifest-vm": (t) => fields(t, "Manifest > VmRequest"),
  "manifest-permissions": (t) => fields(t, "Manifest > Permissions"),
  "menu-row-fields": (t) => fields(t, "Wrapper menu > Fields of every row"),
  "menu-row-types": menuRowTypes,
  "menu-label": (t) => fields(t, "Wrapper menu > MenuLabel"),
  "menu-choice": (t) => fields(t, "Wrapper menu > MenuChoice"),
  // View.
  constructs: (t) => syntax(t, "View > Template constructs", t.w.syntax, "Syntax"),
  "element-list": elementList,
  elements,
  "common-attributes": (t) => fields(t, "View > Elements > Attributes of every element", { name: t.w.attribute }),
  events,
  "gesture-events": () => list("GestureEventName"),
  "named-keys": () => list("NamedKey"),
  "default-sizes": defaultSizes,
  // Style.
  "style-properties": styleProperties,
  selectors: (t) => syntax(t, "Style > Selectors", t.w.selector, "Selector"),
  "style-values": (t) => syntax(t, "Style > Values", t.w.syntax, "Syntax"),
  tokens,
  icons,
  // Permissions and services.
  permissions,
  "permission-list": permissionList,
  capabilities,
  "capability-list": capabilityList,
  "network-rule-fields": (t) => fields(t, "Permissions > Network rules"),
  "parameter-constraints": parameterConstraints,
  services,
  "result-shapes": resultShapes,
  "write-intents": writeIntents,
  "error-codes": errorCodes,
  "draw-commands": drawCommands,
  "fault-categories": (t) => categories(t, "IPC > Fault categories", "Fatal", t.w.fatal),
  "failure-categories": (t) => categories(t, "IPC > Failure categories", "Restarts", t.w.restarts),
  limits,
  // Package and publication.
  "package-files": packageFiles,
  "listing-fields": (t) => fields(t, "Catalog > Listing"),
  widgets,
};

const newUsage = () => ({
  reworded: new Set(),
  used: { text: new Set(), patterns: new Set() },
  missing: { text: new Set(), patterns: new Set() },
});

/** The file with every generated region rewritten. */
export function render(file, locale, text, usage = newUsage()) {
  const translator = new Translator(locale, usage);
  return text.replace(
    /<!-- generated:([a-z][a-z0-9-]*) -->\n[\s\S]*?<!-- \/generated:([a-z][a-z0-9-]*) -->/g,
    (_whole, name, end) => {
      if (name !== end) {
        throw new Error(`${relative(root, file)}: region ${name} ends as ${end}`);
      }
      const generate = GENERATORS[name];
      if (!generate) {
        throw new Error(`${relative(root, file)}: unknown generated region ${name}`);
      }
      return `<!-- generated:${name} -->\n${generate(translator, file)}\n<!-- /generated:${name} -->`;
    },
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes("--check");
  const listMissing = process.argv.includes("--missing");
  const usage = newUsage();
  let stale = 0;
  for (const locale of LOCALES) {
    const dir = join(content, locale);
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
      const file = join(dir, name);
      const before = readFileSync(file, "utf8");
      const after = render(file, locale, before, usage);
      if (after === before) {
        continue;
      }
      if (check) {
        console.error(`${relative(root, file)}: generated regions are stale`);
        stale += 1;
      } else if (!listMissing) {
        writeFileSync(file, after);
        console.log(`updated ${relative(root, file)}`);
      }
    }
  }
  if (listMissing) {
    console.log(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(usage.missing).map(([name, keys]) => [name, Object.fromEntries([...keys].map((key) => [key, ""]))]),
        ),
        null,
        2,
      ),
    );
    process.exit(0);
  }
  // The French catalog holds exactly the descriptions the pages show.
  let untranslated = 0;
  for (const [name, keys] of Object.entries(usage.missing)) {
    for (const key of keys) {
      console.error(`docs/content/i18n/fr.json: ${name} has no translation of ${JSON.stringify(key)}`);
      untranslated += 1;
    }
  }
  let orphans = 0;
  for (const name of Object.keys(usage.used)) {
    for (const [key, value] of Object.entries(catalog[name] ?? {})) {
      if (!usage.used[name].has(key)) {
        console.error(`docs/content/i18n/fr.json: ${name} translates a description that no page shows: ${JSON.stringify(key)}`);
        orphans += 1;
      } else if (typeof value !== "string" || value.trim() === "") {
        console.error(`docs/content/i18n/fr.json: ${name} has an empty translation of ${JSON.stringify(key)}`);
        untranslated += 1;
      } else if (name === "patterns" && (key.match(/\{\d+\}/g) ?? []).some((slot) => !value.includes(slot))) {
        console.error(`docs/content/i18n/fr.json: the translation of ${JSON.stringify(key)} drops a value`);
        untranslated += 1;
      }
    }
  }
  for (const key of Object.keys(reworded)) {
    if (!usage.reworded.has(key)) {
      console.error(`docs/content/i18n/en.json rewords a description that no page shows: ${JSON.stringify(key)}`);
      orphans += 1;
    }
  }
  if (stale > 0) {
    console.error("run `node scripts/build-docs-content.mjs` and commit the result");
  }
  if (stale > 0 || untranslated > 0 || orphans > 0) {
    process.exit(1);
  }
}
