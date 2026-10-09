// A mutation fuzzer of the strict ZIP reader (src/bootstrap/zip.ts): any
// input must read back or be refused with a ZipError, never crash, hang or
// inflate past its declared sizes. Not part of npm test.
//
//   node test/fuzz-zip.mjs [seconds]   (60 s locally at most)

import { randomInt } from "node:crypto";
import { extractEntry, readEntries, ZipError } from "../dist/bootstrap/zip.js";
import { makeZip } from "./support/zip.mjs";

const seconds = Number(process.argv[2] ?? 60);
const limits = { maxEntries: 16, maxEntryBytes: 1 << 20, maxTotalBytes: 4 << 20 };
const seeds = [
  makeZip([
    { name: "root/a.txt", data: "hello hello hello" },
    { name: "root/bin", data: Buffer.alloc(3000, 7), mode: 0o100755 },
    { name: "root/s.json", data: "{}", deflate: false },
  ]),
  makeZip([{ name: "r/x", data: Buffer.alloc(70000, 1) }]),
];

function mutate(input) {
  const bytes = Buffer.from(input);
  for (let count = randomInt(1, 8); count > 0; count -= 1) {
    const kind = randomInt(5);
    const at = randomInt(bytes.length);
    if (kind === 0) bytes[at] = randomInt(256);
    else if (kind === 1) bytes[at] ^= 1 << randomInt(8);
    else if (kind === 2) bytes.writeUInt16LE(randomInt(65536), Math.min(at, bytes.length - 2));
    else if (kind === 3) bytes.writeUInt32LE(randomInt(2 ** 32), Math.min(at, bytes.length - 4));
    else return bytes.subarray(0, at);
  }
  return bytes;
}

const deadline = Date.now() + seconds * 1000;
let runs = 0;
let accepted = 0;
while (Date.now() < deadline) {
  const input = mutate(seeds[randomInt(seeds.length)]);
  runs += 1;
  try {
    for (const entry of readEntries(input, limits)) {
      const data = extractEntry(input, entry);
      if (data.length !== entry.size) throw new Error("size mismatch accepted");
    }
    accepted += 1;
  } catch (error) {
    if (!(error instanceof ZipError)) {
      console.error(`crash after ${runs} runs:`, error);
      console.error(input.toString("base64"));
      process.exit(1);
    }
  }
}
console.log(`fuzz-zip: ${runs} inputs in ${seconds} s, ${accepted} read back, no crash`);
