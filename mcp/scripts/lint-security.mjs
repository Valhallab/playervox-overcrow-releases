// Security rules of the server's own code, checked on src/: each powerful
// API lives in one reviewed module, and nothing else may use it.
//
// - processes: only src/run.ts imports child_process, never with a shell;
// - network: only src/bootstrap/download.ts opens connections;
// - environment: only src/env.ts reads process.env;
// - deletions and file writes: only the tools cache (bootstrap/, session.ts);
// - stdout carries MCP messages only: no console.log;
// - no eval, no Function constructor;
// - the CLI's `doctor` and `dev` (they talk to a running OverCrow) are never called.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src");

const RULES = [
  { name: "child_process outside run.ts", pattern: /from "node:child_process"/, allowed: ["run.ts"] },
  { name: "a shell", pattern: /shell:\s*true|\bexecSync\b|(?<![\w/.)])exec\(|\bexecFile\b/, allowed: [] },
  {
    name: "network modules outside download.ts",
    pattern: /from "node:(https?|net|tls|dgram|http2)"|\bfetch\(|\bWebSocket\b/,
    allowed: ["bootstrap/download.ts"],
  },
  { name: "process.env outside env.ts", pattern: /process\.env\b/, allowed: ["env.ts"] },
  {
    name: "deletions outside the tools cache",
    pattern: /\b(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\(/,
    allowed: ["bootstrap/install.ts", "bootstrap/download.ts", "session.ts"],
  },
  {
    name: "file writes outside the tools cache",
    pattern: /\b(writeFile|writeFileSync|appendFile|createWriteStream|copyFile|rename|mkdtemp)\(/,
    allowed: ["bootstrap/install.ts", "bootstrap/download.ts"],
  },
  { name: "stdout logging", pattern: /console\.(log|info|warn|debug)\(|process\.stdout\.write/, allowed: ["index.ts"] },
  { name: "eval", pattern: /\beval\(|new Function\(/, allowed: [] },
  { name: "the CLI's doctor or dev", pattern: /\["(doctor|dev)"/, allowed: [] },
  { name: "a plain-HTTP address", pattern: /["'`]http:\/\//, allowed: ["bootstrap/download.ts"] },
];

const files = readdirSync(source, { recursive: true })
  .map((path) => String(path).split("\\").join("/"))
  .filter((path) => path.endsWith(".ts"));
const problems = [];
for (const file of files) {
  const lines = readFileSync(join(source, file), "utf8").split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    for (const rule of RULES) {
      if (rule.pattern.test(line) && !rule.allowed.includes(file)) {
        problems.push(`src/${file}:${index + 1}: ${rule.name}: ${line.trim()}`);
      }
    }
  });
}
// index.ts may write to stdout only for --version and --help.
const index = readFileSync(join(source, "index.ts"), "utf8");
if ((index.match(/process\.stdout\.write/g) ?? []).length !== 2) {
  problems.push("src/index.ts: stdout is written outside --version and --help");
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`${problems.length} security rule(s) broken (scripts/lint-security.mjs)`);
  process.exit(1);
}
console.log(`security rules: ${files.length} files of ${relative(root, source)}/ checked`);
