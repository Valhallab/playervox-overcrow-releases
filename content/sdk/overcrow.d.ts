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

/** Known native fields. Minimal development/older host snapshots omit fields.
 * Missing or null measurements are unavailable, never an implied zero.
 */
export type GameSnapshot = {
  readonly running?: boolean;
  readonly selectedActive?: boolean;
  readonly steamAppId?: number | null;
  /** Session duration in milliseconds. */
  readonly sessionElapsedMs?: number | null;
  readonly overlayMode?: 'passive' | 'interactive';
  /** Process CPU in hundredths of a percent. */
  readonly cpuPercentHundredths?: number | null;
  readonly residentBytes?: number | null;
  readonly cpuTemperatureMillicelsius?: number | null;
  readonly gpuTemperatureMillicelsius?: number | null;
} & {readonly [field: string]: CloneableJson};

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
  readonly retryAfterMs?: number;
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
export type Capability =
  | 'telemetry.read' | 'fps.read' | 'stopwatch.read' | 'stopwatch.control'
  | 'media.read' | 'media.control' | 'notes.read' | 'notes.write'
  | 'playervox.score.read' | 'playervox.rating.read' | 'playervox.rating.write'
  | 'playervox.reviews.read' | 'playervox.followed.read'
  | 'journal.local.read' | 'journal.cloud.read' | 'journal.notes.read'
  | 'journal.notes.write' | 'journal.delete' | 'twitch.chat.read' | 'twitch.chat.compose';

export interface CapabilityAccess {
  readonly supported: boolean;
  readonly granted: boolean;
}

export type CapabilityMap = Readonly<Record<Capability, CapabilityAccess>>;
export type ServiceStatus = 'ready' | 'stale' | 'unavailable' | 'unsupported'
  | 'permissionDenied' | 'notConnected' | 'rateLimited';

export type ServiceSnapshot<T> = {
  /** Opaque native authority; null on older hosts or an unavailable bridge. */
  readonly contextId: string | null;
  /** Nonnegative, globally monotonic, JavaScript-safe native revision. */
  readonly revision: number;
  readonly sampleAgeMs?: number;
  readonly retryAfterMs?: number;
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
  /** accepted means opened/queued, never a durable write or completed publication. */
  readonly status: 'accepted' | 'cancelled' | 'persisted' | 'conflict' | 'failed';
  readonly revision?: number;
}

export interface ExpectedRevision {
  readonly expectedRevision: number;
}
export interface NoteTarget extends ExpectedRevision { readonly noteId: string; }
export interface ChecklistTarget extends NoteTarget {
  readonly itemId: string;
  readonly checked: boolean;
}
export interface SessionTarget extends ExpectedRevision { readonly sessionId: string; }

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
export interface StopwatchData {
  readonly elapsedMs: number;
  readonly running: boolean;
}
export interface MediaData {
  readonly title: string | null;
  readonly artist: string | null;
  readonly playbackState: 'playing' | 'paused' | 'stopped';
  /** Opaque handle for assets.read(); never a URL. */
  readonly artworkHandle: string | null;
  readonly actions: {readonly previous: boolean; readonly playPause: boolean; readonly next: boolean};
}
export interface ChecklistItem {
  readonly id: string;
  readonly text: string;
  readonly checked: boolean;
}
export interface Note {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly items: readonly ChecklistItem[];
}
export interface NotesData {
  /** Use this revision for notes actions, not the envelope revision. */
  readonly documentRevision: number;
  readonly activeNoteId: string | null;
  readonly saveState: 'accepted' | 'saving' | 'persisted' | 'conflict' | 'failed';
  readonly notes: readonly Note[];
}
export interface ScoreData {
  readonly name: string;
  /** All scores use a 0–100 scale. */
  readonly score: number | null;
  readonly ratingsCount: number;
  readonly criteria: {readonly gameplay: number | null; readonly art: number | null; readonly tech: number | null};
}
export interface Rating {
  readonly gameplayScore: number;
  readonly artScore: number;
  readonly techScore: number;
  readonly averageScore: number;
  readonly review: string | null;
}
export interface RatingData { readonly rating: Rating | null; }
export interface Review extends Rating {
  readonly id: string;
  readonly displayName: string;
  readonly originalReview: string | null;
  readonly translated: boolean;
  readonly createdAt: string;
  /** Moderation display flag; callers must preserve its meaning when rendering. */
  readonly hidden: boolean;
}
export interface ReviewsData {
  readonly page: number;
  readonly totalPages: number;
  readonly ratingsCount: number;
  readonly followedOnly: boolean;
  readonly reviews: readonly Review[];
}
export interface JournalSession {
  readonly id: string;
  readonly source: 'local' | 'cloud';
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number;
  readonly interrupted: boolean;
  readonly note: string | null;
}
export interface JournalData {
  readonly page: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly previousCursor: string | null;
  readonly sessions: readonly JournalSession[];
}
export type TwitchFragment = {readonly type: 'text'; readonly text: string}
  | {readonly type: 'emote'; readonly text: string; readonly assetHandle: string};
export interface TwitchMessage {
  readonly id: string;
  readonly displayName: string;
  /** Plain text, never HTML. */
  readonly text: string;
  readonly color: string | null;
  readonly fragments: readonly TwitchFragment[];
  readonly reply: {readonly messageId: string; readonly displayName: string; readonly text: string} | null;
}
export interface TwitchChatData {
  readonly connection: 'inert' | 'disconnected' | 'authorizing' | 'connecting' | 'joined' | 'reconnecting' | 'failed';
  readonly channelDisplayName: string | null;
  readonly messages: readonly TwitchMessage[];
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
  readonly stopwatch: SnapshotService<StopwatchData> & {
    start(): Promise<ActionResult>;
    pause(): Promise<ActionResult>;
    reset(): Promise<ActionResult>;
  };
  readonly media: SnapshotService<MediaData> & {
    previous(): Promise<ActionResult>;
    playPause(): Promise<ActionResult>;
    next(): Promise<ActionResult>;
  };
  readonly notes: SnapshotService<NotesData> & {
    requestCreate(parameters: ExpectedRevision): Promise<ActionResult>;
    requestEdit(parameters: NoteTarget): Promise<ActionResult>;
    requestDelete(parameters: NoteTarget): Promise<ActionResult>;
    select(parameters: NoteTarget): Promise<ActionResult>;
    setChecked(parameters: ChecklistTarget): Promise<ActionResult>;
  };
  readonly playervox: {
    requestConnect(): Promise<ActionResult>;
    readonly score: SnapshotService<ScoreData>;
    readonly rating: SnapshotService<RatingData> & {
      /** Use the current rating snapshot's envelope revision. */
      requestEdit(parameters: ExpectedRevision): Promise<ActionResult>;
    };
    readonly reviews: SnapshotService<ReviewsData> & {
      /** Page 1–1000, up to three reviews. followedOnly requires its own grant. */
      page(parameters: {readonly page: number; readonly followedOnly?: boolean}): Promise<ActionResult>;
    };
  };
  readonly journal: SnapshotService<JournalData> & {
    /** Opaque native cursor, or null for the first five-session page. */
    page(parameters: {readonly cursor: string | null}): Promise<ActionResult>;
    requestEditNote(parameters: SessionTarget): Promise<ActionResult>;
    requestDelete(parameters: SessionTarget): Promise<ActionResult>;
  };
  readonly twitch: {readonly chat: SnapshotService<TwitchChatData> & {
    requestConnect(): Promise<ActionResult>;
    requestChooseChannel(): Promise<ActionResult>;
    /** Opens a native composer. The user enters and confirms all message text there. */
    requestCompose(parameters?: {readonly replyTo?: string}): Promise<ActionResult>;
  }};
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
  /** Older hosts without storage metadata reject with unsupported. */
  getInfo(): Promise<StorageInfo>;
  /** Missing keys return undefined. Validate your application's schema after reading. */
  get(key: string): Promise<CloneableJson | undefined>;
  /** Resolves after commit. JSON values up to 64 KiB; up to 256 keys of 128 UTF-8 bytes. */
  set(key: string, value: CloneableJson): Promise<void>;
  /** Removing a missing key succeeds. */
  remove(key: string): Promise<void>;
}
