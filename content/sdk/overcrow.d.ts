/*!
 * MIT License
 *
 * Copyright (c) 2026 Valhallab SASU
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */


export type OvercrowRole = 'controller' | 'view' | 'unavailable';
export type CloneableJson = null | boolean | number | string | CloneableJson[] | {
  [key: string]: CloneableJson;
};

export interface FetchOptions {
  method?: string;
  body?: string | ArrayBuffer | ArrayBufferView | null;
}

/** Current game context. Fields can be absent before a session is available. */
export type GameSnapshot = {
  readonly running?: boolean;
  readonly selectedActive?: boolean;
  readonly steamAppId?: number | null;
  /** Session duration in milliseconds. */
  readonly sessionElapsedMs?: number | null;
  readonly overlayMode?: 'passive' | 'interactive';
  /** True for fictional browser-preview data. */
  readonly fixture?: boolean;
};

export interface OvercrowResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly contentType: string | null;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export class OvercrowError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export interface OvercrowSdk extends OvercrowServices {
  readonly storage: OvercrowStorage;
  fetch(url: string, options?: FetchOptions): Promise<OvercrowResponse>;
  readonly locale: {
    /** Effective declared runtime locale, or null when localization is not declared. */
    getCurrent(): Promise<string | null>;
    onChanged(listener: (locale: string | null) => void): () => void;
  };
  readonly game: {
    snapshot(): Promise<GameSnapshot>;
    /** Future native snapshots only; subscribe before reading snapshot(). */
    onSnapshot(listener: (snapshot: GameSnapshot) => void): () => void;
    on(event: string, listener: (payload: CloneableJson) => void): () => void;
  };
  readonly runtime: {
    readonly role: OvercrowRole;
    send(payload: CloneableJson): Promise<void>;
    onMessage(listener: (payload: CloneableJson) => void): () => void;
  };
  readonly lifecycle: {
    onVisibility(listener: (visible: boolean) => void): () => void;
  };
  readonly surface: {
    invalidate(): Promise<void>;
  };
  readonly clipboard: {
    writeText(text: string): Promise<void>;
  };
}

export const overcrow: OvercrowSdk;
export default overcrow;

declare global {
  var overcrow: OvercrowSdk;
}

// MIT licensed; see ../LICENSE.
export type Capability = 'telemetry.read' | 'fps.read' | 'media.read' | 'media.control';

export interface CapabilityAccess {
  readonly supported: boolean;
  readonly granted: boolean;
}

export type CapabilityMap = Readonly<Record<Capability, CapabilityAccess>>;
export type ServiceStatus = 'ready' | 'stale' | 'unavailable' | 'unsupported'
  | 'permissionDenied';

export type ServiceSnapshot<T> = {
  /** Opaque native authority; null when the initial subscription read fails. */
  readonly contextId: string | null;
  /** Nonnegative, globally monotonic, JavaScript-safe native revision. */
  readonly revision: number;
  readonly sampleAgeMs?: number;
} & (
  | {readonly status: 'ready'; readonly data: T}
  | {readonly status: 'stale'; readonly data: T | null}
  | {readonly status: Exclude<ServiceStatus, 'ready' | 'stale'>; readonly data: null}
);

export interface SnapshotService<T> {
  snapshot(): Promise<ServiceSnapshot<T>>;
  /** Reads current state immediately, then coalesces changes. Unsubscribe on teardown.
   * Initial read failures deliver unavailable; snapshot() rejects with OvercrowError.
   */
  onSnapshot(listener: (snapshot: ServiceSnapshot<T>) => void): () => void;
}

export interface ActionResult {
  /** accepted means queued; the next media snapshot reports the resulting state. */
  readonly status: 'accepted';
}

export interface TelemetryData {
  /** Hundredths of total-machine CPU capacity, from 0 to 10000. */
  readonly normalizedCpuPercentHundredths: number | null;
  readonly residentBytes: number | null;
  /** Host sensor temperatures, not per-process measurements. */
  readonly cpuTemperatureMillicelsius: number | null;
  readonly gpuTemperatureMillicelsius: number | null;
}
export interface FpsData {
  readonly value: number | null;
  readonly sampleAgeMs: number | null;
  readonly stale: boolean;
}
export interface MediaData {
  readonly title: string | null;
  readonly artist: string | null;
  readonly playbackState: 'playing' | 'paused' | 'stopped';
  /** Opaque handle for assets.read(); never a URL. */
  readonly artworkHandle: string | null;
  readonly actions: {readonly previous: boolean; readonly playPause: boolean; readonly next: boolean};
}
export interface PresentationData {
  readonly sizingMode: 'intrinsic' | 'autoHeight' | 'manual';
  readonly width: number;
  readonly height: number;
  /** Native user preferences; widget code cannot set values. */
  readonly options: Readonly<Record<string, boolean | number | string>>;
}

export interface OvercrowServices {
  readonly host: {capabilities(): Promise<CapabilityMap>};
  readonly telemetry: SnapshotService<TelemetryData>;
  readonly fps: SnapshotService<FpsData>;
  readonly media: SnapshotService<MediaData> & {
    previous(): Promise<ActionResult>;
    playPause(): Promise<ActionResult>;
    next(): Promise<ActionResult>;
  };
  readonly presentation: SnapshotService<PresentationData> & {
    /** View only. Integer logical dimensions 1–4096; native retains geometry authority. */
    reportSize(parameters: {readonly width: number; readonly height: number}): Promise<ActionResult>;
  };
  readonly assets: {
    /** Reads only an opaque handle delivered to this widget. PNG, at most 512 KiB. */
    read(handle: string): Promise<Blob>;
  };
}

// MIT licensed; see ../LICENSE.

export interface StorageInfo {
  /** Effective host policy, not a guarantee against disk failures or user deletion. */
  readonly mode: 'persistent' | 'temporary';
}

export interface OvercrowStorage {
  /** Rejects when the host does not provide a valid storage policy. */
  getInfo(): Promise<StorageInfo>;
  /** Missing keys return undefined. Validate your application's schema after reading. */
  get(key: string): Promise<CloneableJson | undefined>;
  /** Resolves after commit. JSON values up to 64 KiB; up to 256 keys of 128 UTF-8 bytes. */
  set(key: string, value: CloneableJson): Promise<void>;
  /** Removing a missing key succeeds. */
  remove(key: string): Promise<void>;
}
