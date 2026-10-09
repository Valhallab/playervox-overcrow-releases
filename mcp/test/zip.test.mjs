import assert from "node:assert/strict";
import { test } from "node:test";
import { extractEntry, readEntries, safeName, ZipError } from "../dist/bootstrap/zip.js";
import { makeZip } from "./support/zip.mjs";

const LIMITS = { maxEntries: 16, maxEntryBytes: 1 << 20, maxTotalBytes: 4 << 20 };
const good = [
  { name: "root/a.txt", data: "hello" },
  { name: "root/bin", data: Buffer.alloc(5000, 7), mode: 0o100755 },
  { name: "root/stored.json", data: "{}", deflate: false },
];

function refused(archive, kind, rule) {
  assert.throws(
    () => {
      const entries = readEntries(archive, LIMITS);
      for (const entry of entries) extractEntry(archive, entry);
    },
    (error) =>
      error instanceof ZipError &&
      error.kind === kind &&
      (rule === undefined || error.rule.includes(rule)),
  );
}

test("a well-formed archive reads back, with Unix modes", () => {
  const archive = makeZip(good);
  const entries = readEntries(archive, LIMITS);
  assert.deepEqual(
    entries.map((entry) => [entry.name, entry.size, entry.mode]),
    [
      ["root/a.txt", 5, 0o644],
      ["root/bin", 5000, 0o755],
      ["root/stored.json", 2, 0o644],
    ],
  );
  assert.equal(extractEntry(archive, entries[0]).toString(), "hello");
  assert.deepEqual(extractEntry(archive, entries[1]), Buffer.alloc(5000, 7));
});

test("unsafe names are refused", () => {
  for (const name of [
    "../evil",
    "root/../../evil",
    "/abs",
    "root\\evil",
    "C:evil",
    "root/./x",
    "root//x",
    "root/x/",
    ".hidden",
    "root/CON",
    "root/nul.txt",
    "root/com1",
    "root/trailing.",
    "root/sp ace",
    "root/\u0001ctl",
  ]) {
    assert.equal(safeName(name), false, name);
    refused(makeZip([{ name, data: "x" }]), "unsafe_name");
  }
  assert.equal(safeName("overcrow-creator-tools-0.6.1-beta.1-linux-x86_64/SHA256SUMS"), true);
});

test("links, directories and duplicates are refused", () => {
  refused(
    makeZip([{ name: "root/link", data: "/etc/passwd", mode: 0o120777 }]),
    "unsafe_name",
    "regular",
  );
  refused(
    makeZip([{ name: "root/dir", data: "", externalAttributes: 0x10 }]),
    "unsafe_name",
    "directory",
  );
  refused(
    makeZip([
      { name: "root/a", data: "1" },
      { name: "root/A", data: "2" },
    ]),
    "invalid",
    "duplicate",
  );
});

test("a size that lies stops the inflater at the declared size (bomb)", () => {
  const bomb = Buffer.alloc(2 << 20, 0);
  const archive = makeZip([{ name: "root/bomb", data: bomb, size: 1024, crc: 0 }]);
  refused(archive, "invalid", "larger than declared");
  refused(makeZip([{ name: "root/big", data: Buffer.alloc((1 << 20) + 1) }]), "too_large");
});

test("a wrong CRC, an unknown method, encryption, a data descriptor are refused", () => {
  refused(makeZip([{ name: "root/a", data: "abc", crc: 1 }]), "invalid", "CRC");
  refused(
    makeZip([{ name: "root/a", data: "abc" }], {
      edit: (_, kind, header) => header.writeUInt16LE(12, kind === "local" ? 8 : 10),
    }),
    "invalid",
  );
  refused(makeZip([{ name: "root/a", data: "abc", flags: 1 }]), "invalid", "encrypted");
  refused(makeZip([{ name: "root/a", data: "abc", flags: 1 << 3 }]), "invalid", "data descriptor");
  refused(makeZip([{ name: "root/a", data: "abc", flags: 1 << 5 }]), "invalid", "unknown");
});

test("comments, trailing bytes, ZIP64 and inconsistent headers are refused", () => {
  refused(makeZip(good, { comment: Buffer.from("hi") }), "invalid");
  refused(Buffer.concat([makeZip(good), Buffer.from("x")]), "invalid");
  const zip64 = makeZip(good);
  zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10);
  refused(zip64, "invalid", "ZIP64");
  refused(
    makeZip(good, {
      edit: (index, kind, header) => index === 0 && kind === "local" && header.writeUInt32LE(4, 22),
    }),
    "invalid",
    "disagrees",
  );
  refused(
    makeZip([
      { name: "root/a", data: "abc" },
      { name: "root/b", data: "def", localOffset: 0 },
    ]),
    "invalid",
  );
});

test("truncated and empty archives are refused", () => {
  const archive = makeZip(good);
  for (const cut of [0, 10, 21, 100, archive.length - 1]) {
    assert.throws(() => readEntries(archive.subarray(0, cut), LIMITS), ZipError);
  }
  assert.throws(() => readEntries(makeZip([]), LIMITS), ZipError);
});

test("bounds: entries and total size", () => {
  refused(
    makeZip(Array.from({ length: 17 }, (_, index) => ({ name: `root/f${index}`, data: "x" }))),
    "too_large",
  );
  const total = { ...LIMITS, maxTotalBytes: 10 };
  assert.throws(
    () =>
      readEntries(
        makeZip([
          { name: "root/a", data: "123456" },
          { name: "root/b", data: "123456" },
        ]),
        total,
      ),
    ZipError,
  );
});

test("a corrupt deflate stream is refused, never thrown as another error", () => {
  const archive = makeZip([{ name: "root/a", data: "hello hello hello" }]);
  const entry = readEntries(archive, LIMITS)[0];
  const broken = Buffer.from(archive);
  broken.fill(0xff, entry.dataStart, entry.dataStart + entry.compressed);
  refused(broken, "invalid");
});
