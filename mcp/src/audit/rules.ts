// The rules of the audit. Each one reads the widget as data and reports
// findings with a severity, where, why, how to fix it, and an example from
// a reference widget. Thresholds come from the documented limits
// (content/reference/limits.json), never from copies.
//
// Severities: high = a real risk or a refusal at review; medium = more
// authority or cost than the widget seems to need; low = advice. Patterns
// the reference widgets use on purpose are not reported: timers left
// running while the widget is hidden (the host does not tick them),
// one-shot retries and watchdogs, slice-by-slice parsing.

import { limit, permissionsTable } from "../content.js";
import {
  callArguments,
  calls,
  enclosing,
  evaluate,
  type FunctionRange,
  functions,
  numericConstants,
  type Token,
} from "./lexer.js";
import { infiniteAnimations, viewFacts, type WidgetProject } from "./project.js";

export type Severity = "high" | "medium" | "low";
export type Area = "security" | "lightness";

export interface ExampleRef {
  widget: string;
  file: string;
  /** A line of that file that starts the example. */
  find: string;
}

export interface Finding {
  rule: string;
  area: Area;
  severity: Severity;
  file: string | null;
  line: number | null;
  message: string;
  fix: string;
  example?: ExampleRef;
}

const GESTURE_EVENTS = new Set(["activate", "contextmenu", "keydown", "input", "change", "submit"]);
const KIB = 1024;

interface Context {
  project: WidgetProject;
  tokens: Token[];
  ranges: FunctionRange[];
  constants: Map<string, number>;
  strings: string[];
  view: ReturnType<typeof viewFacts>;
  findings: Finding[];
  logicFile: string;
}

function add(context: Context, finding: Finding): void {
  context.findings.push(finding);
}

const permissionsOf = (project: WidgetProject): Record<string, unknown> =>
  (project.manifest?.permissions as Record<string, unknown> | undefined) ?? {};

/** True when the logic or the view uses the dotted service name. */
function usesService(context: Context, service: string): boolean {
  const formIntent = /^form (.+)$/.exec(service)?.[1];
  if (formIntent) return context.view.intents.some((intent) => intent.name === formIntent);
  const path = service.split(".");
  if (calls(context.tokens, path).length > 0) return true;
  // `call("x.y")`, `subscribe("x.y", …)` or a member reference passed around.
  if (context.strings.includes(service)) return true;
  const joined = context.tokens
    .map((token) => (token.kind === "identifier" || token.value === "." ? token.value : " "))
    .join("");
  return joined.split(" ").some((chain) => chain === service || chain.startsWith(`${service}.`));
}

// ── Security ─────────────────────────────────────────────────────────────

function unusedAuthority(context: Context): void {
  const permissions = permissionsOf(context.project);
  const table = permissionsTable();
  const capabilities = Array.isArray(permissions.capabilities)
    ? (permissions.capabilities as string[])
    : [];
  for (const capability of capabilities) {
    const services = table.capabilities[capability]?.services ?? [];
    if (services.length > 0 && !services.some((entry) => usesService(context, entry.service))) {
      add(context, {
        rule: "unused-capability",
        area: "security",
        severity: "high",
        file: "manifest.json",
        line: null,
        message: `The manifest asks for the capability ${capability}, but the widget never uses it (${services.map((s) => s.service).join(", ")}).`,
        fix: `Remove ${capability} from permissions.capabilities: every capability needs the user's consent and widens what the widget may reach.`,
      });
    }
  }
  const checks: { key: string; on: boolean; services: string[]; name: string }[] = [
    {
      key: "storage",
      on: permissions.storage === true,
      services: ["storage.get", "storage.set", "storage.remove", "storage.keys"],
      name: "storage",
    },
    {
      key: "clipboardWrite",
      on: permissions.clipboardWrite === true,
      services: ["clipboard.writeText"],
      name: "clipboardWrite",
    },
    {
      key: "network",
      on: Array.isArray(permissions.network) && (permissions.network as unknown[]).length > 0,
      services: ["http.fetch"],
      name: "network",
    },
    {
      key: "gameEvents",
      on: Array.isArray(permissions.gameEvents) && (permissions.gameEvents as unknown[]).length > 0,
      services: ["gameEvents.subscribe"],
      name: "gameEvents",
    },
  ];
  for (const check of checks) {
    if (check.on && !check.services.some((service) => usesService(context, service))) {
      add(context, {
        rule: "unused-permission",
        area: "security",
        severity: "high",
        file: "manifest.json",
        line: null,
        message: `The manifest declares ${check.name}, but the logic never calls ${check.services.join(" or ")}.`,
        fix: `Remove permissions.${check.key}. Declare only what the widget uses: each permission is shown to the user and checked at review.`,
      });
    }
  }
}

interface NetworkRule {
  origin?: unknown;
  method?: unknown;
  path?: unknown;
  pathParams?: Record<string, { type?: unknown; maxLength?: unknown }>;
  queryParams?: Record<string, { type?: unknown; maxLength?: unknown }>;
  maxResponseBytes?: unknown;
}

/** The static start of a route path, before its first `{parameter}`. */
function staticPrefix(path: string): string {
  const index = path.indexOf("{");
  return index < 0 ? path : path.slice(0, index);
}

/** The string or template chunks that mention `text`, with their token index. */
function literalIndexes(context: Context, text: string): number[] {
  const out: number[] = [];
  context.tokens.forEach((token, index) => {
    if ((token.kind === "string" || token.kind === "template") && token.value.includes(text))
      out.push(index);
  });
  return out;
}

function networkRules(context: Context): void {
  const rules = (permissionsOf(context.project).network as NetworkRule[] | undefined) ?? [];
  if (!Array.isArray(rules) || rules.length === 0) return;
  const origins = new Set(rules.map((rule) => String(rule.origin ?? "")));
  const defaultBound = limit("MAX_HTTP_RESPONSE_BYTES");
  rules.forEach((rule, index) => {
    const where = `permissions.network[${index}]`;
    const origin = String(rule.origin ?? "");
    const path = String(rule.path ?? "");
    const method = String(rule.method ?? "GET");
    const route = `${method} ${origin}${path}`;
    const host = origin.replace(/^https:\/\//, "");
    const prefix = staticPrefix(path);
    const usesOrigin = context.strings.some((value) => value.includes(host));
    const usesPath =
      prefix === "/" || context.strings.some((value) => value.includes(prefix.replace(/\/$/, "")));
    if (!usesOrigin || !usesPath) {
      add(context, {
        rule: "unused-route",
        area: "security",
        severity: "medium",
        file: "manifest.json",
        line: null,
        message: `${where} (${route}) does not appear in the logic: no text of the logic names ${usesOrigin ? prefix : host}.`,
        fix: "Remove the routes the widget does not request. If the URL is built elsewhere, keep the route and ignore this finding.",
      });
    }
    if (rule.maxResponseBytes === undefined) {
      add(context, {
        rule: "unbounded-response",
        area: "security",
        severity: "medium",
        file: "manifest.json",
        line: null,
        message: `${where} (${route}) has no maxResponseBytes: responses up to ${defaultBound / KIB / KIB} MiB are accepted.`,
        fix: "Set maxResponseBytes a little above the largest response this route really returns (measure it). A tight bound limits memory and what a compromised server can send.",
        example: {
          widget: "warframe-market",
          file: "manifest.json",
          find: '"path": "/v2/versions"',
        },
      });
    }
    if (method !== "GET") {
      add(context, {
        rule: "sends-data",
        area: "security",
        severity: "low",
        file: "manifest.json",
        line: null,
        message: `${where} uses ${method}: the widget sends data to ${host}.`,
        fix: "Send only what the feature needs, never the user's data without a reason, and say in listing.json what is sent and why.",
      });
    }
    for (const [kind, params] of [
      ["path", rule.pathParams],
      ["query", rule.queryParams],
    ] as const) {
      for (const [name, constraint] of Object.entries(params ?? {})) {
        const maxLength = Number(constraint?.maxLength ?? 0);
        if (constraint?.type === "string" && maxLength > 64) {
          add(context, {
            rule: "broad-parameter",
            area: "security",
            severity: "low",
            file: "manifest.json",
            line: null,
            message: `${where}: the ${kind} parameter ${name} accepts any text up to ${maxLength} characters.`,
            fix: 'Constrain it more tightly: "enum" for a fixed set, "integer" with min and max, or "slug" with a short maxLength.',
            example: { widget: "weather", file: "manifest.json", find: '"units"' },
          });
        }
      }
    }
  });
  if (origins.size > 2) {
    add(context, {
      rule: "many-origins",
      area: "security",
      severity: "low",
      file: "manifest.json",
      line: null,
      message: `The widget reaches ${origins.size} different servers.`,
      fix: "Each server is a party that learns when the user plays. Keep only the ones the feature needs.",
    });
  }
}

/** Brace depth of the token at `index` (0 = top level of the module). */
function depthAt(tokens: readonly Token[], index: number): number {
  let depth = 0;
  for (let i = 0; i < index; i += 1) {
    const value = tokens[i]?.value;
    if (tokens[i]?.kind !== "punctuation") continue;
    if (value === "{") depth += 1;
    else if (value === "}") depth -= 1;
  }
  return depth;
}

function clipboardOutsideGesture(context: Context): void {
  for (const open of calls(context.tokens, ["clipboard", "writeText"])) {
    const line = context.tokens[open]?.line ?? null;
    const owner = enclosing(context.ranges, open);
    const isGestureHandler = (name: string) =>
      [...(context.view.handlers.get(name) ?? [])].some((event) => GESTURE_EVENTS.has(event));
    let confirmed = owner !== undefined && isGestureHandler(owner.name);
    if (!confirmed && owner) {
      // One level up: a gesture handler that calls the owner.
      confirmed = context.ranges.some(
        (range) =>
          isGestureHandler(range.name) &&
          calls(context.tokens.slice(range.start, range.end), [owner.name]).length > 0,
      );
    }
    if (confirmed) continue;
    const topLevel = owner === undefined && depthAt(context.tokens, open) === 0;
    add(context, {
      rule: "clipboard-without-action",
      area: "security",
      severity: topLevel ? "high" : "medium",
      file: context.logicFile,
      line,
      message: topLevel
        ? "clipboard.writeText runs when the widget starts: it would write without the user asking."
        : owner
          ? `clipboard.writeText is in ${owner.name}, which no button or key of the view calls directly.`
          : "clipboard.writeText is in a callback (a timer, a subscription…) that no user action calls.",
      fix: "Write to the clipboard only in the handler of a user action (on:activate of a button): OverCrow refuses it otherwise (gesture_required), and the user must always know what is copied.",
      example: { widget: "warframe-market", file: "logic.ts", find: "export function copy(" },
    });
  }
}

const SCAN_WINDOW = 4096;
const SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "a private key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY(?: BLOCK)?-----/ },
  { name: "a GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: "an AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "a Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: "an API key (sk-…)", pattern: /(^|[^\w-])sk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { name: "a Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "an npm token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "a Twitch or OAuth token", pattern: /\boauth:[a-z0-9]{30}\b/ },
  { name: "credentials in a URL", pattern: /\bhttps?:\/\/[^\s/:@"'`]+:[^\s/@"'`]+@[^\s"'`]+/ },
  {
    name: "a hard-coded secret",
    pattern:
      /\b(?:api[_-]?key|apikey|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password|bearer)\b["']?\s*[:=]\s*["'`][A-Za-z0-9_\-./+=]{16,}["'`]/i,
  },
];

function secrets(context: Context): void {
  for (const file of context.project.files) {
    const name = file.path.split("/").pop() ?? "";
    if (/^\.env(\..+)?$/.test(name) || name === ".npmrc") {
      add(context, {
        rule: "secret-file",
        area: "security",
        severity: "high",
        file: file.path,
        line: null,
        message: `${file.path} usually holds secrets, and it would be published with the sources.`,
        fix: "Delete it from the widget folder and keep secrets out of the widget: a widget is public, and anything in it can be read.",
      });
    }
    if (file.text === null) continue;
    // Long lines (minified code) are read in overlapping windows: the
    // patterns then always run on bounded text.
    const lines = file.text
      .split("\n")
      .map((text) =>
        text.length <= SCAN_WINDOW
          ? [text]
          : Array.from({ length: Math.ceil(text.length / (SCAN_WINDOW - 256)) }, (_, i) =>
              text.slice(i * (SCAN_WINDOW - 256), i * (SCAN_WINDOW - 256) + SCAN_WINDOW),
            ),
      );
    for (const { name: what, pattern } of SECRET_PATTERNS) {
      const index = lines.findIndex((windows) => windows.some((text) => pattern.test(text)));
      if (index < 0) continue;
      add(context, {
        rule: "secret",
        area: "security",
        severity: "high",
        file: file.path,
        line: index + 1,
        message: `${file.path} seems to hold ${what}.`,
        fix: "Remove it, and revoke it at its provider: widget sources and packages are public. A widget cannot keep a secret; use an API that needs none, or one the user's own account authorizes through OverCrow.",
      });
    }
  }
}

function identity(context: Context): void {
  const id = String(context.project.manifest?.id ?? "");
  if (id === "com.playervox" || id.startsWith("com.playervox.")) {
    add(context, {
      rule: "reserved-id",
      area: "security",
      severity: "high",
      file: "manifest.json",
      line: null,
      message: `The ID ${id} is reserved for widgets published by PlayerVox.`,
      fix: "Use a reverse-DNS ID under a domain you control, such as com.yourname.widget, and keep it: the ID is the widget's identity.",
    });
  } else if (/^(com|org|net)\.example(\.|$)/.test(id)) {
    add(context, {
      rule: "example-id",
      area: "security",
      severity: "medium",
      file: "manifest.json",
      line: null,
      message: `The ID ${id} is a placeholder: anyone could claim it.`,
      fix: "Choose a reverse-DNS ID under a domain you control before you submit, and keep it for every version.",
    });
  }
  const files = new Set(context.project.files.map((file) => file.path));
  if (!files.has("LICENSE")) {
    add(context, {
      rule: "license-missing",
      area: "security",
      severity: "medium",
      file: null,
      line: null,
      message: "The widget has no LICENSE file.",
      fix: "Add the license text that matches listing.json spdxLicense (create_widget writes an MIT license).",
    });
  }
}

// ── Lightness ────────────────────────────────────────────────────────────

function timerValue(context: Context, args: Token[][]): number | undefined {
  const first = args[0];
  return first ? evaluate(first, context.constants) : undefined;
}

function fastTimers(context: Context): void {
  const usesNetwork = calls(context.tokens, ["http", "fetch"]).length > 0;
  for (const open of calls(context.tokens, ["timers", "every"])) {
    const value = timerValue(context, callArguments(context.tokens, open));
    const line = context.tokens[open]?.line ?? null;
    if (value === undefined) continue;
    if (value < 1000) {
      add(context, {
        rule: "fast-timer",
        area: "lightness",
        severity: value < 250 ? "medium" : "low",
        file: context.logicFile,
        line,
        message: `A timer runs the logic every ${value} ms (${Math.round(1000 / Math.max(value, 1))} times a second).`,
        fix: 'Let the host do the ticking: <elapsed> counts time without any logic, timers.atEach("second") follows the clock, and style animations run without the logic. Keep a fast timer only while something really moves.',
        example: { widget: "stopwatch", file: "view.ocml", find: "<elapsed" },
      });
    }
    if (usesNetwork && value < 30_000) {
      add(context, {
        rule: "fast-polling",
        area: "lightness",
        severity: "medium",
        file: context.logicFile,
        line,
        message: `A timer repeats every ${value} ms in a widget that uses the network: if it requests the network, it polls a server ${Math.round(60_000 / value)} times a minute.`,
        fix: "Refresh every 30 s or more, back off after a failure (×2 up to ×8), and only while the data is shown.",
        example: {
          widget: "warframe-market",
          file: "logic.ts",
          find: "export function refreshInterval(",
        },
      });
    }
  }
}

/** The `as` of an `http.fetch` call: "json", "text", "bytes", "image" or undefined. */
function fetchAs(tokens: readonly Token[], open: number): string | undefined {
  const options = callArguments(tokens, open)[1] ?? [];
  for (let index = 0; index + 2 < options.length; index += 1) {
    if (
      options[index]?.value === "as" &&
      options[index + 1]?.value === ":" &&
      options[index + 2]?.kind === "string"
    ) {
      return options[index + 2]?.value;
    }
  }
  return undefined;
}

function largeResponses(context: Context): void {
  const rules = (permissionsOf(context.project).network as NetworkRule[] | undefined) ?? [];
  if (!Array.isArray(rules)) return;
  const threshold = 256 * KIB;
  rules.forEach((rule, index) => {
    const bound =
      typeof rule.maxResponseBytes === "number"
        ? rule.maxResponseBytes
        : limit("MAX_HTTP_RESPONSE_BYTES");
    if (bound <= threshold) return;
    const prefix = staticPrefix(String(rule.path ?? "")).replace(/\/$/, "");
    for (const literal of literalIndexes(context, prefix)) {
      // The fetch that requests this route: in the same call, or in the
      // function that the literal is passed to (one level).
      const owner = enclosing(context.ranges, literal);
      const scope = owner ? context.tokens.slice(owner.start, owner.end) : context.tokens;
      let as = calls(scope, ["http", "fetch"])
        .map((open) => fetchAs(scope, open))
        .find((value) => value !== undefined);
      if (as === undefined) {
        // `getText("/v2/items")`: look into the called function.
        for (let back = literal - 1; back >= Math.max(0, literal - 3); back -= 1) {
          const token = context.tokens[back];
          if (token?.value === "(" && context.tokens[back - 1]?.kind === "identifier") {
            const callee = context.ranges.find(
              (range) => range.name === context.tokens[back - 1]?.value,
            );
            if (callee) {
              const body = context.tokens.slice(callee.start, callee.end);
              as = calls(body, ["http", "fetch"])
                .map((open) => fetchAs(body, open))
                .find((value) => value !== undefined);
            }
            break;
          }
        }
      }
      if (as === "json") {
        add(context, {
          rule: "large-response-one-turn",
          area: "lightness",
          severity: "medium",
          file: context.logicFile,
          line: context.tokens[literal]?.line ?? null,
          message: `permissions.network[${index}] allows responses up to ${Math.round(bound / KIB)} KiB, and the logic receives it as JSON: the whole body is parsed in one turn of the logic (${limit("VM_TURN_BUDGET_MS")} ms budget) and held in memory at once.`,
          fix: 'Lower maxResponseBytes if the real responses are small. For large ones, ask for as: "text" and parse it slice by slice over several turns (timers.after between slices), keeping only the fields you show.',
          example: {
            widget: "warframe-market",
            file: "logic.ts",
            find: "export class CatalogScanner",
          },
        });
        return;
      }
    }
  });
}

/** Arrays that live across turns: `state.x` and module-level `let/const x = []`. */
function unboundedLists(context: Context): void {
  const { tokens } = context;
  const moduleArrays = new Set<string>();
  let depth = 0;
  tokens.forEach((token, index) => {
    if (token.value === "{") depth += 1;
    if (token.value === "}") depth -= 1;
    if (depth !== 0 || (token.value !== "let" && token.value !== "const")) return;
    // `const name = [` or `const name: Type[] = [`.
    for (let j = index + 2; j < Math.min(tokens.length - 1, index + 14); j += 1) {
      if (tokens[j]?.value === ";") return;
      if (tokens[j]?.value === "=") {
        if (tokens[j + 1]?.value === "[") moduleArrays.add(tokens[index + 1]?.value ?? "");
        return;
      }
    }
  });
  const reported = new Set<string>();
  tokens.forEach((token, index) => {
    if (
      token.value !== "push" ||
      tokens[index - 1]?.value !== "." ||
      tokens[index + 1]?.value !== "("
    )
      return;
    // The pushed array's name: `state.items.push`, `items.push`.
    const name = tokens[index - 2]?.value ?? "";
    const isState = tokens[index - 3]?.value === "." && tokens[index - 4]?.value === "state";
    if (!isState && !(moduleArrays.has(name) && tokens[index - 3]?.value !== ".")) return;
    if (reported.has(name)) return;
    const bounded = tokens.some(
      (other, j) =>
        other.value === name &&
        tokens[j + 1]?.value === "." &&
        ["length", "slice", "splice", "shift", "pop", "filter"].includes(
          tokens[j + 2]?.value ?? "",
        ),
    );
    if (bounded) return;
    reported.add(name);
    add(context, {
      rule: "unbounded-list",
      area: "lightness",
      severity: "medium",
      file: context.logicFile,
      line: token.line,
      message: `${isState ? "state." : ""}${name} grows with push and is never trimmed: it can grow for as long as the game runs.`,
      fix: `Cap it: drop the oldest entries past a maximum (for example with slice), and show at most what fits. The view has a budget of ${limit("MAX_SCENE_NODES")} nodes.`,
      example: { widget: "twitch-chat", file: "logic.ts", find: "export const HISTORY_MAX" },
    });
  });
}

function redraws(context: Context): void {
  for (const open of calls(context.tokens, ["timers", "every"])) {
    const close = callArguments(context.tokens, open);
    const body = close.flat();
    if (body.some((token, index) => token.value === "draw" && body[index + 1]?.value === "(")) {
      add(context, {
        rule: "redraw-on-timer",
        area: "lightness",
        severity: "low",
        file: context.logicFile,
        line: context.tokens[open]?.line ?? null,
        message: "A timer redraws a canvas each time it fires.",
        fix: "Redraw only when what the canvas shows has changed: compare with the last drawn value first.",
        example: { widget: "playervox-rating", file: "logic.ts", find: 'draw("badge"' },
      });
      return;
    }
  }
}

function images(context: Context): void {
  const preview =
    typeof context.project.listing?.preview === "string"
      ? (context.project.listing.preview as string)
      : null;
  const maxEdge = limit("MAX_IMAGE_EDGE_PX");
  for (const file of context.project.files) {
    if (!file.path.startsWith("assets/") || !/\.(png|jpe?g|webp)$/i.test(file.path)) continue;
    const isPreview = file.path === preview;
    const bound = isPreview ? 256 * KIB : 64 * KIB;
    if (file.bytes > bound) {
      add(context, {
        rule: "heavy-image",
        area: "lightness",
        severity: isPreview ? "high" : "medium",
        file: file.path,
        line: null,
        message: `${file.path} weighs ${Math.round(file.bytes / KIB)} KiB${isPreview ? ": a preview over 256 KiB is refused at admission" : ""}.`,
        fix: isPreview
          ? 'Render the preview at 150 % in a scenario ("scale": 1500), in a 4:3 shape, and save it as an optimized PNG.'
          : "Save the image at the size it is shown (logical pixels × the largest scale you support) and optimize it; prefer an icon or a style for simple shapes.",
        example: { widget: "clock", file: "listing.json", find: '"preview"' },
      });
    }
    if (file.image && (file.image.width > maxEdge || file.image.height > maxEdge)) {
      add(context, {
        rule: "image-too-large",
        area: "lightness",
        severity: "high",
        file: file.path,
        line: null,
        message: `${file.path} is ${file.image.width}×${file.image.height} px: OverCrow refuses images over ${maxEdge} px on a side.`,
        fix: "Resize it to the size it is shown.",
      });
    }
  }
}

function dependencies(context: Context): void {
  const manifest = context.project.packageJson;
  if (!manifest) return;
  const extra: string[] = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const deps = manifest[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const name of Object.keys(deps))
      if (name !== "@overcrow/sdk" && name !== "typescript") extra.push(name);
  }
  if (extra.length > 0) {
    add(context, {
      rule: "extra-dependencies",
      area: "lightness",
      severity: "medium",
      file: "package.json",
      line: null,
      message: `package.json declares ${extra.slice(0, 6).join(", ")}${extra.length > 6 ? "…" : ""}: a widget's logic can import only @overcrow/sdk.`,
      fix: "Remove them. Use the SDK and the host's elements, or copy the few lines you need (with their license).",
    });
  }
}

function heapAndLogic(context: Context): void {
  const vm = context.project.manifest?.vm as { heapMiB?: unknown } | undefined;
  if (typeof vm?.heapMiB === "number" && vm.heapMiB > 16) {
    add(context, {
      rule: "larger-heap",
      area: "lightness",
      severity: "low",
      file: "manifest.json",
      line: null,
      message: `The manifest asks for a ${vm.heapMiB} MiB heap instead of the default 16 MiB.`,
      fix: "Ask for more only after the widget stops with resource_limit under real data; first bound what it keeps in memory.",
    });
  }
  for (const token of context.tokens) {
    if ((token.kind === "string" || token.kind === "template") && token.value.length > 8 * KIB) {
      add(context, {
        rule: "embedded-data",
        area: "lightness",
        severity: "low",
        file: context.logicFile,
        line: token.line,
        message: `The logic embeds a text of ${Math.round(token.value.length / KIB)} KiB: it is held in memory for the widget's whole life.`,
        fix: "Keep only what the widget shows; fetch or compute the rest when needed.",
      });
      return;
    }
  }
}

function animations(context: Context): void {
  for (const [name, line] of infiniteAnimations(context.project.style)) {
    const used = context.view.unconditionalClasses.get(name);
    if (used !== undefined) {
      add(context, {
        rule: "endless-animation",
        area: "lightness",
        severity: "low",
        file: "view.ocml",
        line: used,
        message: `The class ${name} runs an endless animation (style.ocss line ${line}) on an element that is always shown.`,
        fix: "Apply an endless animation only while something is in progress (inside an <if>, or with a class computed from the state).",
        example: { widget: "notes", file: "view.ocml", find: "selector-icon spin" },
      });
    }
  }
}

/** Runs every rule on a read widget. */
export function runRules(project: WidgetProject): Finding[] {
  const tokens = project.tokens;
  const context: Context = {
    project,
    tokens,
    ranges: functions(tokens),
    constants: numericConstants(tokens),
    strings: tokens
      .filter((token) => token.kind === "string" || token.kind === "template")
      .map((token) => token.value),
    view: viewFacts(project.view),
    findings: [],
    logicFile: project.logicPath ?? "logic.ts",
  };
  identity(context);
  secrets(context);
  if (project.manifest) {
    unusedAuthority(context);
    networkRules(context);
    largeResponses(context);
  }
  clipboardOutsideGesture(context);
  fastTimers(context);
  unboundedLists(context);
  redraws(context);
  images(context);
  dependencies(context);
  heapAndLogic(context);
  animations(context);
  return context.findings;
}
