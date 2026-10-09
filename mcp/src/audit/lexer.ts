// A small tokenizer of TypeScript and JavaScript for the static audit: it
// separates code from comments, strings and template literals so that the
// rules look at what the logic does, not at what its comments say. It never
// evaluates anything. Precision is that of a lexer: the rules that use it
// are worded as findings to check, not as proofs.

export type TokenKind = "identifier" | "number" | "string" | "template" | "regex" | "punctuation";

export interface Token {
  kind: TokenKind;
  /** Identifier name, punctuation, number text, or the string's value (escapes kept). */
  value: string;
  line: number;
  /** Template literals: true for the chunk that ends the literal. */
  end?: boolean;
}

const IDENTIFIER_START = /[A-Za-z_$À-￿]/;
const IDENTIFIER_PART = /[A-Za-z0-9_$À-￿]/;
const PUNCTUATION = [
  "...",
  "===",
  "!==",
  "**=",
  "<<=",
  ">>=",
  ">>>",
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "??",
  "?.",
  "++",
  "--",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
  "&=",
  "|=",
  "^=",
  "**",
  "<<",
  ">>",
];
/** After these, a `/` starts a regular expression rather than a division. */
const REGEX_AFTER_KEYWORDS = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  /** Brace depth at which each open template literal resumes. */
  const templateStack: number[] = [];
  let braceDepth = 0;

  const regexAllowed = (): boolean => {
    const previous = tokens.at(-1);
    if (!previous) return true;
    if (previous.kind === "identifier") return REGEX_AFTER_KEYWORDS.has(previous.value);
    if (previous.kind === "number" || previous.kind === "string" || previous.kind === "regex")
      return false;
    if (previous.kind === "template") return !previous.end;
    return ![")", "]", "}"].includes(previous.value);
  };

  const readTemplateChunk = (): void => {
    // `i` is just after the opening backtick or the closing brace of `${`.
    const startLine = line;
    let value = "";
    while (i < source.length) {
      const char = source[i] as string;
      if (char === "\\") {
        value += source.slice(i, i + 2);
        if (source[i + 1] === "\n") line += 1;
        i += 2;
        continue;
      }
      if (char === "`") {
        i += 1;
        tokens.push({ kind: "template", value, line: startLine, end: true });
        return;
      }
      if (char === "$" && source[i + 1] === "{") {
        i += 2;
        tokens.push({ kind: "template", value, line: startLine, end: false });
        templateStack.push(braceDepth);
        braceDepth += 1;
        return;
      }
      if (char === "\n") line += 1;
      value += char;
      i += 1;
    }
    tokens.push({ kind: "template", value, line: startLine, end: true });
  };

  while (i < source.length) {
    const char = source[i] as string;
    const next = source[i + 1];
    if (char === "\n") {
      line += 1;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (let j = i; j < stop; j += 1) if (source[j] === "\n") line += 1;
      i = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      const startLine = line;
      let value = "";
      i += 1;
      while (i < source.length && source[i] !== char && source[i] !== "\n") {
        if (source[i] === "\\") {
          value += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        value += source[i];
        i += 1;
      }
      i += 1;
      tokens.push({ kind: "string", value, line: startLine });
      continue;
    }
    if (char === "`") {
      i += 1;
      readTemplateChunk();
      continue;
    }
    if (char === "}" && templateStack.length > 0 && templateStack.at(-1) === braceDepth - 1) {
      templateStack.pop();
      braceDepth -= 1;
      i += 1;
      readTemplateChunk();
      continue;
    }
    if (char === "/" && regexAllowed()) {
      const startLine = line;
      let value = "";
      let inClass = false;
      i += 1;
      while (i < source.length && source[i] !== "\n") {
        const c = source[i] as string;
        if (c === "\\") {
          value += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        value += c;
        i += 1;
      }
      i += 1;
      while (i < source.length && /[a-z]/.test(source[i] as string)) i += 1;
      tokens.push({ kind: "regex", value, line: startLine });
      continue;
    }
    if (/[0-9]/.test(char) || (char === "." && /[0-9]/.test(next ?? ""))) {
      let end = i + 1;
      while (end < source.length && /[0-9A-Za-z_.]/.test(source[end] as string)) end += 1;
      tokens.push({ kind: "number", value: source.slice(i, end), line });
      i = end;
      continue;
    }
    if (IDENTIFIER_START.test(char)) {
      let end = i + 1;
      while (end < source.length && IDENTIFIER_PART.test(source[end] as string)) end += 1;
      tokens.push({ kind: "identifier", value: source.slice(i, end), line });
      i = end;
      continue;
    }
    const operator = PUNCTUATION.find((candidate) => source.startsWith(candidate, i));
    const value = operator ?? char;
    if (value === "{") braceDepth += 1;
    if (value === "}") braceDepth = Math.max(0, braceDepth - 1);
    tokens.push({ kind: "punctuation", value, line });
    i += value.length;
  }
  return tokens;
}

/** The numeric value of a literal (`30_000`, `0x10`, `1e3`), or undefined. */
export function numberValue(text: string): number | undefined {
  const value = Number(text.replaceAll("_", ""));
  return Number.isFinite(value) ? value : undefined;
}

/** Index of the token that closes the bracket opened at `open`, or -1. */
export function matching(tokens: readonly Token[], open: number): number {
  const pairs: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const opener = tokens[open]?.value ?? "";
  const closer = pairs[opener];
  if (!closer) return -1;
  let depth = 0;
  for (let index = open; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    if (token.kind !== "punctuation") continue;
    if (token.value === opener) depth += 1;
    else if (token.value === closer) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Indexes of calls of a dotted name: `timers.every(` for
 * `["timers", "every"]`. Returns the index of the opening parenthesis.
 */
export function calls(tokens: readonly Token[], path: readonly string[]): number[] {
  const found: number[] = [];
  outer: for (let index = 0; index + path.length * 2 - 1 < tokens.length; index += 1) {
    for (let part = 0; part < path.length; part += 1) {
      const token = tokens[index + part * 2];
      if (token?.kind !== "identifier" || token.value !== path[part]) continue outer;
      if (part < path.length - 1) {
        const dot = tokens[index + part * 2 + 1];
        if (dot?.value !== "." && dot?.value !== "?.") continue outer;
      }
    }
    // Not the tail of a longer chain (`x.timers.every`).
    const before = tokens[index - 1];
    if (before?.value === "." || before?.value === "?.") continue;
    const open = tokens[index + path.length * 2 - 1];
    if (open?.value === "(") found.push(index + path.length * 2 - 1);
  }
  return found;
}

/** Splits the arguments of the call whose `(` is at `open` into token ranges. */
export function callArguments(tokens: readonly Token[], open: number): Token[][] {
  const close = matching(tokens, open);
  if (close < 0) return [];
  const args: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (let index = open + 1; index < close; index += 1) {
    const token = tokens[index] as Token;
    if (token.kind === "punctuation" && ["(", "[", "{"].includes(token.value)) depth += 1;
    if (token.kind === "punctuation" && [")", "]", "}"].includes(token.value)) depth -= 1;
    if (depth === 0 && token.kind === "punctuation" && token.value === ",") {
      args.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }
  if (current.length > 0) args.push(current);
  return args;
}

/** `const NAME = <number expression>` declarations of a file, evaluated when only literals are multiplied or added. */
export function numericConstants(tokens: readonly Token[]): Map<string, number> {
  const constants = new Map<string, number>();
  for (let index = 0; index + 3 < tokens.length; index += 1) {
    if (tokens[index]?.value !== "const" || tokens[index + 1]?.kind !== "identifier") continue;
    let cursor = index + 2;
    // An optional type annotation: `const X: number = …`.
    if (tokens[cursor]?.value === ":") cursor += 2;
    if (tokens[cursor]?.value !== "=") continue;
    const expression: Token[] = [];
    for (let j = cursor + 1; j < tokens.length; j += 1) {
      const token = tokens[j] as Token;
      if (token.value === ";" || token.line !== (tokens[cursor] as Token).line) break;
      expression.push(token);
    }
    const value = evaluate(expression, constants);
    if (value !== undefined) constants.set((tokens[index + 1] as Token).value, value);
  }
  return constants;
}

/** Evaluates `a * b + c` made of number literals and known constants. */
export function evaluate(
  expression: readonly Token[],
  constants: ReadonlyMap<string, number>,
): number | undefined {
  if (expression.length === 0 || expression.length > 15) return undefined;
  let total = 0;
  let product = 1;
  let expectOperand = true;
  for (const token of expression) {
    if (expectOperand) {
      const value =
        token.kind === "number"
          ? numberValue(token.value)
          : token.kind === "identifier"
            ? constants.get(token.value)
            : undefined;
      if (value === undefined) return undefined;
      product *= value;
      expectOperand = false;
    } else if (token.value === "*") {
      expectOperand = true;
    } else if (token.value === "+") {
      total += product;
      product = 1;
      expectOperand = true;
    } else {
      return undefined;
    }
  }
  return expectOperand ? undefined : total + product;
}

export interface FunctionRange {
  name: string;
  exported: boolean;
  /** Token index of its body's `{` and `}`. */
  start: number;
  end: number;
}

/**
 * Named functions of a file: `function f(`, `export function f(`,
 * `const f = (…) =>`, `const f = function`, and methods `f(…) {`.
 */
export function functions(tokens: readonly Token[]): FunctionRange[] {
  const out: FunctionRange[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    let name: string | undefined;
    let search = index;
    if (token.value === "function" && tokens[index + 1]?.kind === "identifier") {
      name = (tokens[index + 1] as Token).value;
      search = index + 2;
    } else if (
      (token.value === "const" || token.value === "let") &&
      tokens[index + 1]?.kind === "identifier" &&
      tokens[index + 2]?.value === "="
    ) {
      const after = tokens[index + 3];
      if (
        after?.value === "(" ||
        after?.value === "async" ||
        after?.value === "function" ||
        after?.kind === "identifier"
      ) {
        name = (tokens[index + 1] as Token).value;
        search = index + 3;
      }
    }
    if (!name) continue;
    // The body is the first `{` after the parameters (and `=>` for arrows).
    let open = -1;
    for (let j = search; j < Math.min(tokens.length, search + 400); j += 1) {
      const candidate = tokens[j] as Token;
      if (candidate.value === "(") {
        const close = matching(tokens, j);
        if (close < 0) break;
        j = close;
        continue;
      }
      if (candidate.value === ";") break;
      if (candidate.value === "{") {
        open = j;
        break;
      }
    }
    if (open < 0) continue;
    const end = matching(tokens, open);
    if (end < 0) continue;
    const exported = tokens[index - 1]?.value === "export" || tokens[index - 2]?.value === "export";
    out.push({ name, exported, start: open, end });
  }
  return out;
}

/** The innermost named function whose body holds token `index`. */
export function enclosing(
  ranges: readonly FunctionRange[],
  index: number,
): FunctionRange | undefined {
  let best: FunctionRange | undefined;
  for (const range of ranges) {
    if (range.start < index && index < range.end && (!best || range.start > best.start))
      best = range;
  }
  return best;
}
