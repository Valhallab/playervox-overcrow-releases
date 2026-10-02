// Checks the links of every Markdown file tracked by Git:
//
// - a relative link must name an existing file or directory of the
//   repository, and its `#anchor`, on a Markdown file, one of its headings
//   (GitHub's anchor rules);
// - a link to this repository on GitHub (`…/blob/main/PATH`,
//   `…/tree/main/PATH`) must name an existing path, as a relative one;
// - the retired Web downloads (`…/docs/downloads/…`) may not be linked.
//
// It also checks every address of the documentation website
// (under `overcrow.playervox.com/docs/`) that a tracked text file cites,
// the messages of the CLI included: the address must be a page of
// docs/content/pages.json, in English (`/docs/en/<slug>/`) or in French
// (`/docs/<slug>/`), and its `#anchor` a heading of that page.
//
// Other external URLs are not fetched.
//
//   node scripts/check-links.mjs [REPOSITORY]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_URL = /^https:\/\/github\.com\/Valhallab\/playervox-overcrow-releases\/(?:blob|tree)\/main\/([^#?]*)(#.*)?$/;
const RETIRED = [/\/docs\/downloads\//];

/** GitHub's anchor of a heading text. */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The anchors of a Markdown text, numbered as GitHub numbers duplicates. */
export function anchors(text) {
  const seen = new Map();
  const result = new Set();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    const heading = !fence && line.match(/^#{1,6}\s+(.*?)\s*#*\s*$/);
    if (!heading) {
      continue;
    }
    const base = slug(heading[1]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

/** The links of a Markdown text, outside code, with their line numbers. */
export function links(text) {
  const found = [];
  let fence = false;
  text.split("\n").forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) {
      return;
    }
    const prose = line.replace(/`[^`]*`/g, "");
    for (const match of prose.matchAll(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      found.push({ line: index + 1, target: match[1] });
    }
    for (const match of prose.matchAll(/\bhref="([^"]+)"/g)) {
      found.push({ line: index + 1, target: match[1] });
    }
  });
  return found;
}

/** Problems of the links of `files` (paths relative to `root`). */
export function check(root, files) {
  const problems = [];
  const texts = new Map();
  const read = (path) => {
    if (!texts.has(path)) {
      texts.set(path, readFileSync(path, "utf8"));
    }
    return texts.get(path);
  };
  for (const file of files) {
    const absolute = join(root, file);
    for (const { line, target } of links(read(absolute))) {
      const where = `${file}:${line}`;
      if (RETIRED.some((pattern) => pattern.test(target))) {
        problems.push(`${where}: ${target} is a retired Web download`);
        continue;
      }
      let path;
      let anchor;
      const github = target.match(REPOSITORY_URL);
      if (github) {
        path = resolve(root, decodeURIComponent(github[1]));
        anchor = github[2]?.slice(1);
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
        continue;
      } else {
        const [location, fragment] = target.split("#", 2);
        path = location === "" ? absolute : resolve(dirname(absolute), decodeURIComponent(location));
        anchor = fragment;
      }
      const inside = relative(root, path);
      if (inside.startsWith(`..${sep}`) || inside === "..") {
        problems.push(`${where}: ${target} leaves the repository`);
        continue;
      }
      if (!existsSync(path)) {
        problems.push(`${where}: ${target} does not exist`);
        continue;
      }
      if (anchor && path.endsWith(".md") && statSync(path).isFile()) {
        if (!anchors(read(path)).has(decodeURIComponent(anchor))) {
          problems.push(`${where}: ${target} names no heading of ${normalize(inside)}`);
        }
      }
    }
  }
  return problems;
}

const SITE_URL = /https:\/\/overcrow\.playervox\.com\/docs\/[^\s"'`)<>\]\\]*/g;
const SITE_PATH = /^https:\/\/overcrow\.playervox\.com\/docs\/(en\/)?(?:([a-z0-9]+(?:-[a-z0-9]+)*)\/)?(?:#(.+))?$/;
const TEXT_FILE = /\.(?:md|rs|ts|tsx|js|mjs|json|toml|ya?ml|sh|ocml|ocss)$/;

/**
 * Problems of the documentation website addresses cited by `files`: each
 * must name a page of docs/content/pages.json and, with an anchor, one of
 * its headings in that language.
 */
export function checkSite(root, files) {
  const content = join(root, "docs", "content");
  const pages = JSON.parse(readFileSync(join(content, "pages.json"), "utf8")).pages;
  const headings = new Map();
  const problems = [];
  for (const file of files.filter((name) => TEXT_FILE.test(name))) {
    readFileSync(join(root, file), "utf8")
      .split("\n")
      .forEach((line, index) => {
        for (const match of line.matchAll(SITE_URL)) {
          // Punctuation that ends a sentence is not part of the address.
          const url = match[0].replace(/[.,;:!?]+$/, "");
          const where = `${file}:${index + 1}`;
          if (RETIRED.some((pattern) => pattern.test(url))) {
            problems.push(`${where}: ${url} is a retired Web download`);
            continue;
          }
          const parts = url.match(SITE_PATH);
          const page = parts && pages.find((entry) => entry.slug === (parts[2] ?? ""));
          if (!page) {
            problems.push(`${where}: ${url} is no page of the documentation website`);
            continue;
          }
          if (parts[3] === undefined) {
            continue;
          }
          const source = join(content, parts[1] ? "en" : "fr", page.file);
          if (!headings.has(source)) {
            headings.set(source, anchors(readFileSync(source, "utf8")));
          }
          let anchor;
          try {
            anchor = decodeURIComponent(parts[3]);
          } catch {
            anchor = parts[3];
          }
          if (!headings.get(source).has(anchor)) {
            problems.push(`${where}: ${url} names no heading of ${relative(root, source).split(sep).join("/")}`);
          }
        }
      });
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), ".."));
  const tracked = (...patterns) =>
    execFileSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", ...patterns], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((file) => file && existsSync(join(root, file)) && statSync(join(root, file)).isFile());
  const files = tracked("*.md");
  // The scratch links of the link check's own test are broken on purpose.
  const cited = tracked().filter((file) => file !== "tests/check-links.test.mjs");
  const problems = [...check(root, files), ...checkSite(root, cited)];
  for (const problem of problems) {
    console.error(problem);
  }
  if (problems.length > 0) {
    console.error(`check-links: ${problems.length} broken link(s)`);
    process.exit(1);
  }
  console.log(`check-links: ${files.length} Markdown files and ${cited.length} files citing the website, no broken link`);
}
