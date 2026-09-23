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
  constructor(code: string, message: string);
}

export interface OvercrowSdk {
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
