// Writes ZIP archives the way the release publisher does (Python's zipfile:
// local headers and data, the central directory, its end record), with
// hooks to break any field for the hostile cases.

import { crc32, deflateRawSync } from "node:zlib";

/**
 * entries: [{ name, data: Buffer|string, mode?: number, deflate?: boolean }]
 * edit(index, "local"|"central", header: Buffer) may change a header in place.
 */
export function makeZip(
  entries,
  { edit = () => {}, comment = Buffer.alloc(0), madeBy = 0x031e } = {},
) {
  const parts = [];
  const central = [];
  let offset = 0;
  entries.forEach((entry, index) => {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
    const deflate = entry.deflate ?? true;
    const body = deflate ? deflateRawSync(data, { level: 9 }) : data;
    const name = Buffer.from(entry.name, "utf8");
    const crc = entry.crc ?? crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(0x00210000, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.compressedSize ?? body.length, 18);
    local.writeUInt32LE(entry.size ?? data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    edit(index, "local", local);
    parts.push(local, name, body);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(entry.madeBy ?? madeBy, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.flags ?? 0, 8);
    header.writeUInt16LE(deflate ? 8 : 0, 10);
    header.writeUInt32LE(0x00210000, 12);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.compressedSize ?? body.length, 20);
    header.writeUInt32LE(entry.size ?? data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(entry.externalAttributes ?? ((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(entry.localOffset ?? offset, 42);
    edit(index, "central", header);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  });
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, directory, end, comment]);
}
