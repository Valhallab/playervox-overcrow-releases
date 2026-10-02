// Reads the generated schema reference (docs/widget-schema-v1.md) as data:
// its headings, the tables under each of them and the text before each
// table. The creator documentation builds its reference pages from it
// (scripts/build-docs-content.mjs), so they never hold a hand-written copy
// of the contract. The file itself is generated from the schema crate, and
// CI fails when it differs from the crate.

/** Cells of one table line, with `\|` kept as written. */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/**
 * The sections of the reference, keyed by their heading path
 * (`Manifest > Sizing`, code spans of the headings removed).
 *
 * @returns {Map<string, { intro: string[], tables: { header: string[], rows: string[][] }[], text: string[] }>}
 */
export function parseSchemaReference(markdown) {
  const sections = new Map();
  const path = [];
  let section = null;
  let table = null;
  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const heading = line.match(/^(#{2,6}) (.*)$/);
    if (heading) {
      const depth = heading[1].length - 2;
      path.length = depth;
      path[depth] = heading[2].replaceAll("`", "");
      section = { intro: [], tables: [], text: [] };
      sections.set(path.join(" > "), section);
      table = null;
      continue;
    }
    if (!section) {
      continue;
    }
    if (line.startsWith("|")) {
      const row = cells(line);
      if (!table) {
        table = { header: row, rows: [] };
        section.tables.push(table);
      } else if (!row.every((cell) => /^-+$/.test(cell))) {
        table.rows.push(row);
      }
      continue;
    }
    table = null;
    if (line.trim() !== "") {
      (section.tables.length === 0 ? section.intro : section.text).push(line.trim());
    }
  }
  return sections;
}

/** A section's only table as objects keyed by the header cells. */
export function records(sections, path, index = 0) {
  const section = sections.get(path);
  if (!section) {
    throw new Error(`the schema reference has no section "${path}"`);
  }
  const table = section.tables[index];
  if (!table) {
    throw new Error(`the schema reference section "${path}" has no table ${index + 1}`);
  }
  return table.rows.map((row) => {
    if (row.length !== table.header.length) {
      throw new Error(`"${path}": a row has ${row.length} cells for ${table.header.length} columns`);
    }
    return Object.fromEntries(table.header.map((name, column) => [name, row[column]]));
  });
}

/** The sections directly below `path`, in order, with their own name. */
export function children(sections, path) {
  const prefix = `${path} > `;
  return [...sections.keys()]
    .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes(" > "))
    .map((key) => ({ name: key.slice(prefix.length), path: key, section: sections.get(key) }));
}
