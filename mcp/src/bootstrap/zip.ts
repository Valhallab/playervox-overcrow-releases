// A strict reader of a creator tools ZIP, on the model of the CLI's
// `cli/src/zipread.rs`. The archive's SHA-256 is checked against the pin
// before this code sees it; the reader still trusts nothing it declares.
//
// Accepted: one disk, no ZIP64, no encryption, no comment, stored or
// deflated regular files, the central directory right before its end
// record, local headers that agree with it, entries that do not overlap,
// and names made of plain components. Refused besides: links, directories,
// device names Windows reserves, duplicates (case-insensitive) and every
// byte the format does not account for. Each entry is inflated within its
// declared size and checked against its CRC-32.

import { crc32, inflateRawSync } from "node:zlib";

export interface ZipLimits {
  maxEntries: number;
  /** The largest uncompressed entry. */
  maxEntryBytes: number;
  /** The sum of every uncompressed entry. */
  maxTotalBytes: number;
}

export interface ZipEntry {
  name: string;
  size: number;
  /** Unix permission bits when the archive records them, else null. */
  mode: number | null;
  readonly compressed: number;
  readonly deflated: boolean;
  readonly crc32: number;
  readonly dataStart: number;
}

export type ZipErrorKind = "invalid" | "unsafe_name" | "too_large";

export class ZipError extends Error {
  constructor(
    readonly kind: ZipErrorKind,
    readonly rule: string,
  ) {
    super(
      kind === "unsafe_name"
        ? `the archive holds an unsafe file name (${rule})`
        : kind === "too_large"
          ? `the archive exceeds its size bounds (${rule})`
          : `invalid archive: ${rule}`,
    );
    this.name = "ZipError";
  }
}

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const END_BYTES = 22;
const CENTRAL_BYTES = 46;
const LOCAL_BYTES = 30;
/** Encryption (bit 0), strong encryption (bit 6), masked headers (bit 13). */
const ENCRYPTED_FLAGS = 1 | (1 << 6) | (1 << 13);
/** Deflate options (bits 1-2), data descriptor (bit 3), UTF-8 names (bit 11). */
const KNOWN_FLAGS = ENCRYPTED_FLAGS | 0b110 | (1 << 3) | (1 << 11);
const MAX_DIRECTORY_BYTES = 64 * 1024;
const MAX_NAME_BYTES = 255;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const UNIX_HOST = 3;
const FILE_TYPE_MASK = 0o170000;
const REGULAR_FILE = 0o100000;
const DOS_DIRECTORY = 0x10;
const COMPONENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(\..*)?$/i;

/**
 * A safe name: relative, components of letters, digits, `.`, `_`, `+` and
 * `-` that start with a letter or digit, no trailing dot, no name that
 * Windows maps to a device. Directories are implied, never entries.
 */
export function safeName(name: string): boolean {
  if (name.length === 0 || Buffer.byteLength(name) > MAX_NAME_BYTES) return false;
  return name
    .split("/")
    .every(
      (component) =>
        COMPONENT.test(component) && !component.endsWith(".") && !WINDOWS_DEVICE.test(component),
    );
}

/** Reads and checks the whole directory of `archive`. */
export function readEntries(archive: Buffer, limits: ZipLimits): ZipEntry[] {
  const length = archive.length;
  if (length < END_BYTES) throw new ZipError("invalid", "too short");
  const endOffset = length - END_BYTES;
  if (archive.readUInt32LE(endOffset) !== END_SIGNATURE) {
    throw new ZipError("invalid", "no end record at the end");
  }
  if (archive.readUInt16LE(endOffset + 20) !== 0) throw new ZipError("invalid", "archive comment");
  const disk = archive.readUInt16LE(endOffset + 4);
  const directoryDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const totalEntries = archive.readUInt16LE(endOffset + 10);
  const directorySize = archive.readUInt32LE(endOffset + 12);
  const directoryOffset = archive.readUInt32LE(endOffset + 16);
  if (
    diskEntries === U16_MAX ||
    totalEntries === U16_MAX ||
    directorySize === U32_MAX ||
    directoryOffset === U32_MAX
  ) {
    throw new ZipError("invalid", "ZIP64");
  }
  if (endOffset >= 20 && archive.readUInt32LE(endOffset - 20) === ZIP64_LOCATOR_SIGNATURE) {
    throw new ZipError("invalid", "ZIP64");
  }
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries) {
    throw new ZipError("invalid", "several disks");
  }
  if (totalEntries === 0) throw new ZipError("invalid", "no entries");
  if (totalEntries > limits.maxEntries) throw new ZipError("too_large", "too many entries");
  if (directorySize > MAX_DIRECTORY_BYTES) throw new ZipError("too_large", "central directory");
  if (directoryOffset + directorySize !== endOffset) {
    throw new ZipError("invalid", "central directory not before its end record");
  }
  const directory = archive.subarray(directoryOffset, endOffset);

  interface Found {
    localOffset: number;
    entry: ZipEntry;
    flags: number;
    method: number;
    nameBytes: Buffer;
  }
  const found: Found[] = [];
  const seen = new Set<string>();
  let total = 0;
  let cursor = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_BYTES > directory.length) {
      throw new ZipError("invalid", "truncated central directory");
    }
    if (directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError("invalid", "bad central header");
    }
    const madeBy = directory.readUInt16LE(cursor + 4);
    const flags = directory.readUInt16LE(cursor + 8);
    const method = directory.readUInt16LE(cursor + 10);
    const crc = directory.readUInt32LE(cursor + 16);
    const compressed = directory.readUInt32LE(cursor + 20);
    const size = directory.readUInt32LE(cursor + 24);
    const nameLength = directory.readUInt16LE(cursor + 28);
    const extraLength = directory.readUInt16LE(cursor + 30);
    const commentLength = directory.readUInt16LE(cursor + 32);
    const diskStart = directory.readUInt16LE(cursor + 34);
    const externalAttributes = directory.readUInt32LE(cursor + 38);
    const localOffset = directory.readUInt32LE(cursor + 42);
    if ((flags & ENCRYPTED_FLAGS) !== 0) throw new ZipError("invalid", "encrypted entry");
    if ((flags & ~KNOWN_FLAGS) !== 0) throw new ZipError("invalid", "unknown entry flags");
    if (method !== 0 && method !== 8)
      throw new ZipError("invalid", "unsupported compression method");
    if (compressed === U32_MAX || size === U32_MAX || localOffset === U32_MAX) {
      throw new ZipError("invalid", "ZIP64");
    }
    if (diskStart !== 0) throw new ZipError("invalid", "several disks");
    if (method === 0 && compressed !== size)
      throw new ZipError("invalid", "stored entry sizes differ");
    const nameStart = cursor + CENTRAL_BYTES;
    if (nameStart + nameLength > directory.length) {
      throw new ZipError("invalid", "truncated central directory");
    }
    const nameBytes = Buffer.from(directory.subarray(nameStart, nameStart + nameLength));
    const name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nameBytes, {
      stream: false,
    });
    if (!safeName(name)) throw new ZipError("unsafe_name", name.slice(0, 64));
    // Only regular files: no link, no directory, no device.
    let mode: number | null = null;
    if (madeBy >> 8 === UNIX_HOST) {
      const unixMode = externalAttributes >>> 16;
      const type = unixMode & FILE_TYPE_MASK;
      if (type !== 0 && type !== REGULAR_FILE)
        throw new ZipError("unsafe_name", `${name} is not a regular file`);
      mode = unixMode & 0o7777;
    }
    if ((externalAttributes & DOS_DIRECTORY) !== 0) {
      throw new ZipError("unsafe_name", `${name} is a directory`);
    }
    // Case-insensitive file systems would merge two such names.
    const key = name.toLowerCase();
    if (seen.has(key)) throw new ZipError("invalid", "duplicate entry");
    seen.add(key);
    cursor = nameStart + nameLength + extraLength + commentLength;
    if (cursor > directory.length) throw new ZipError("invalid", "truncated central directory");
    if (size > limits.maxEntryBytes) throw new ZipError("too_large", "entry size");
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError("too_large", "total size");
    found.push({
      localOffset,
      flags,
      method,
      nameBytes,
      entry: { name, size, mode, compressed, deflated: method === 8, crc32: crc, dataStart: 0 },
    });
  }
  if (cursor !== directory.length)
    throw new ZipError("invalid", "bytes after the central directory");

  // Local headers repeat the central directory; entries follow one another
  // without overlapping, and nothing lies between them.
  found.sort((a, b) => a.localOffset - b.localOffset);
  let nextFree = 0;
  const checked: ZipEntry[] = [];
  for (const { localOffset, entry, flags, method, nameBytes } of found) {
    if (localOffset !== nextFree) {
      throw new ZipError(
        "invalid",
        localOffset < nextFree ? "overlapping entries" : "bytes between entries",
      );
    }
    if (localOffset + LOCAL_BYTES > directoryOffset) {
      throw new ZipError("invalid", "local header outside the data");
    }
    if (archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      throw new ZipError("invalid", "bad local header");
    }
    const disagree = new ZipError("invalid", "local header disagrees with the directory");
    if (
      archive.readUInt16LE(localOffset + 6) !== flags ||
      archive.readUInt16LE(localOffset + 8) !== method
    ) {
      throw disagree;
    }
    // A data descriptor (bit 3) is not something the publisher writes.
    if ((flags & (1 << 3)) !== 0) throw new ZipError("invalid", "data descriptor");
    if (
      archive.readUInt32LE(localOffset + 14) !== entry.crc32 ||
      archive.readUInt32LE(localOffset + 18) !== entry.compressed ||
      archive.readUInt32LE(localOffset + 22) !== entry.size
    ) {
      throw disagree;
    }
    const nameLength = archive.readUInt16LE(localOffset + 26);
    const extraLength = archive.readUInt16LE(localOffset + 28);
    if (nameLength !== nameBytes.length) throw disagree;
    const localNameEnd = localOffset + LOCAL_BYTES + nameLength;
    if (
      localNameEnd > directoryOffset ||
      !archive.subarray(localOffset + LOCAL_BYTES, localNameEnd).equals(nameBytes)
    ) {
      throw disagree;
    }
    const dataStart = localNameEnd + extraLength;
    const dataEnd = dataStart + entry.compressed;
    if (dataEnd > directoryOffset) throw new ZipError("invalid", "entry data outside the archive");
    nextFree = dataEnd;
    checked.push({ ...entry, dataStart });
  }
  if (nextFree !== directoryOffset)
    throw new ZipError("invalid", "bytes before the central directory");
  return checked;
}

/**
 * The uncompressed bytes of `entry`: exactly its declared size, with its
 * CRC-32. The inflater stops at the declared size, so a bomb never grows.
 */
export function extractEntry(archive: Buffer, entry: ZipEntry): Buffer {
  const raw = archive.subarray(entry.dataStart, entry.dataStart + entry.compressed);
  let data: Buffer;
  if (entry.deflated) {
    try {
      data = inflateRawSync(raw, { maxOutputLength: Math.max(1, entry.size) });
    } catch (error) {
      const tooLarge =
        error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
      throw new ZipError("invalid", tooLarge ? "entry larger than declared" : "corrupt entry data");
    }
  } else {
    data = Buffer.from(raw);
  }
  if (data.length !== entry.size) {
    throw new ZipError(
      "invalid",
      data.length > entry.size ? "entry larger than declared" : "entry smaller than declared",
    );
  }
  if (crc32(data) !== entry.crc32) throw new ZipError("invalid", "CRC-32 mismatch");
  return data;
}
