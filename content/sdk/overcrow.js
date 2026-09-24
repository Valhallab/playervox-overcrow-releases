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

// MIT licensed; see ../LICENSE.
const SERVICE_CAPABILITIES = Object.freeze([
  'telemetry.read', 'fps.read', 'media.read', 'media.control',
]);

// MIT licensed; see ../LICENSE.

function createServiceValidation(ErrorClass, clone) {
  const utf8 = new TextEncoder();
  const invalid = () => { throw new ErrorClass('invalid_response', 'Native service response is invalid'); };
  const object = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
    return value;
  };
  const bool = value => {
    if (typeof value !== 'boolean') invalid();
    return value;
  };
  const integer = (min = 0, max = Number.MAX_SAFE_INTEGER) => value => {
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
    return value;
  };
  const number = (min, max) => value => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid();
    return value;
  };
  const text = (maxBytes, minBytes = 0) => value => {
    if (typeof value !== 'string' || value.length > maxBytes) invalid();
    const length = utf8.encode(value).byteLength;
    if (length < minBytes || length > maxBytes) invalid();
    return value;
  };
  const choice = values => value => {
    if (!values.includes(value)) invalid();
    return value;
  };
  const nullable = check => value => value === null ? null : check(value);
  const shape = fields => value => {
    object(value);
    return Object.fromEntries(Object.entries(fields).map(([key, check]) => [key, check(value[key])]));
  };
  const id = text(128, 1);
  const revision = integer();
  const handle = value => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid();
    return value;
  };
  const checks = {
    telemetry: shape({
      normalizedCpuPercentHundredths: nullable(integer(0, 10000)),
      residentBytes: nullable(integer()),
      cpuTemperatureMillicelsius: nullable(integer(-273150, 1000000)),
      gpuTemperatureMillicelsius: nullable(integer(-273150, 1000000)),
    }),
    fps: shape({value: nullable(number(0, 10000)), sampleAgeMs: nullable(integer()), stale: bool}),
    media: shape({
      title: nullable(text(4096)), artist: nullable(text(4096)),
      playbackState: choice(['playing', 'paused', 'stopped']),
      artworkHandle: nullable(handle), actions: shape({previous: bool, playPause: bool, next: bool}),
    }),
    presentation: shape({sizingMode: choice(['intrinsic', 'autoHeight', 'manual']),
      width: integer(1, 4096), height: integer(1, 4096), options: value => {
        object(value);
        if (Object.keys(value).length > 32) invalid();
        return Object.fromEntries(Object.entries(value).map(([key, item]) => {
          if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) invalid();
          if (typeof item === 'boolean') return [key, item];
          if (typeof item === 'number') return [key, number(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)(item)];
          return [key, text(128)(item)];
        }));
      }}),
  };

  function emptyCapabilities() {
    return Object.fromEntries(SERVICE_CAPABILITIES.map(name => [name, {supported: false, granted: false}]));
  }

  function services(raw) {
    if (raw === undefined) return {contextId: null, revision: 0, capabilities: emptyCapabilities(), snapshots: {}};
    let value;
    try { value = clone(raw); } catch (_) { invalid(); }
    object(value);
    if (value.apiVersion !== 2) invalid();
    const result = {contextId: id(value.contextId), revision: revision(value.revision), capabilities: emptyCapabilities(), snapshots: {}};
    if (/[\u0000-\u001f\u007f-\u009f]/u.test(result.contextId)) invalid();
    object(value.capabilities);
    for (const [name, access] of Object.entries(value.capabilities)) {
      if (!SERVICE_CAPABILITIES.includes(name)) invalid();
      result.capabilities[name] = shape({supported: bool, granted: bool})(access);
      if (access.granted && !access.supported) invalid();
    }
    object(value.snapshots);
    for (const [name, envelope] of Object.entries(value.snapshots)) {
      if (!Object.hasOwn(checks, name)) invalid();
      object(envelope);
      const status = choice(['ready', 'stale', 'unavailable', 'unsupported', 'permissionDenied', 'notConnected', 'rateLimited'])(envelope.status);
      if (status !== 'ready' && status !== 'stale' && envelope.data !== null) invalid();
      const data = envelope.data === null && status !== 'ready' ? null : checks[name](envelope.data);
      const snapshot = {status, data};
      for (const key of ['sampleAgeMs', 'retryAfterMs']) {
        if (Object.hasOwn(envelope, key)) snapshot[key] = integer()(envelope[key]);
      }
      result.snapshots[name] = snapshot;
    }
    return result;
  }

  function actionResult(value) {
    return shape({status: choice(['accepted'])})(value);
  }

  function asset(value) {
    object(value);
    if (value.contentType !== 'image/png' || typeof value.data !== 'string'
        || value.data.length > 699052 || value.data.length % 4 !== 0
        || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data)) invalid();
    let decoded;
    try { decoded = atob(value.data); } catch (_) { invalid(); }
    if (decoded.length < 8 || decoded.length > 512 * 1024) invalid();
    const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => byte === bytes[index])) invalid();
    return new Blob([bytes], {type: 'image/png'});
  }

  return {services, actionResult, asset};
}

// MIT licensed; see ../LICENSE.
function createServiceActions(ErrorClass) {
  const utf8 = new TextEncoder();
  const invalid = () => { throw new ErrorClass('invalid_request', 'Service action parameters are invalid'); };
  const integer = (min, max = Number.MAX_SAFE_INTEGER) => value => {
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
    return value;
  };
  const text = max => value => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max
        || utf8.encode(value).byteLength > max || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) invalid();
    return value;
  };
  const id = max => value => {
    text(max)(value);
    if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid();
    return value;
  };
  const size = integer(1, 4096);
  const definitions = {
    'media.previous': [{}, ['media.control']],
    'media.playPause': [{}, ['media.control']],
    'media.next': [{}, ['media.control']],
    'presentation.reportSize': [{width: size, height: size}, []],
    'assets.read': [{handle: id(128)}, []],
  };

  return (action, parameters) => {
    if (!Object.hasOwn(definitions, action)) invalid();
    const [fields, capabilities] = definitions[action];
    if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)
        || (Object.getPrototypeOf(parameters) !== Object.prototype && Object.getPrototypeOf(parameters) !== null)
        || Object.keys(parameters).some(key => !Object.hasOwn(fields, key))) invalid();
    const checked = Object.fromEntries(Object.entries(fields)
      .map(([key, check]) => [key, check(parameters[key])]).filter(([, value]) => value !== undefined));
    return {parameters: checked, capabilities};
  };
}

// MIT licensed; see ../LICENSE.

function createServices({native, role, ErrorClass, clone}) {
  const validation = createServiceValidation(ErrorClass, clone);
  const validateAction = createServiceActions(ErrorClass);
  const subscribers = new Set();
  let current = null;
  let newestRevision = -1;
  let readPending = null;
  let eventSequence = 0;
  let pendingActions = 0;
  const fail = (code, message) => { throw new ErrorClass(code, message); };
  const nativeErrorCodes = new Set([
    'capability_denied', 'permission_denied', 'not_connected', 'stale_context',
    'unavailable', 'unsupported', 'unsupported_operation', 'rate_limited', 'offline', 'invalid_response',
    'invalid_request', 'role_denied', 'expired', 'refused',
    'storage_unavailable', 'busy', 'browser_unavailable', 'revocation_pending',
    'queue_full', 'forbidden', 'gesture_required', 'native_failure',
  ]);

  async function request(metadata) {
    if (!native) fail('bridge_unavailable', 'OverCrow native bridge is unavailable');
    let response;
    try { response = await native.request(metadata, new ArrayBuffer(0)); }
    catch (_) { fail('native_failure', 'OverCrow native request failed'); }
    if (!response || typeof response !== 'object' || !(response.body instanceof ArrayBuffer)
        || response.body.byteLength !== 0) fail('invalid_response', 'Native service response is invalid');
    let checked;
    try { checked = clone(response.metadata); }
    catch (_) { fail('invalid_response', 'Native service response is invalid'); }
    if (!checked || typeof checked !== 'object' || Array.isArray(checked)) {
      fail('invalid_response', 'Native service response is invalid');
    }
    if (Object.hasOwn(checked, 'error')) {
      const code = typeof checked.error === 'string' ? checked.error : checked.error?.code;
      if (!nativeErrorCodes.has(code)) fail('invalid_response', 'Native service rejection is invalid');
      const error = new ErrorClass(code, `OverCrow service request failed (${code})`);
      const retry = checked.error?.retryAfterMs ?? checked.retryAfterMs;
      if (retry !== undefined) {
        if (!Number.isSafeInteger(retry) || retry < 0) fail('invalid_response', 'Native service retry delay is invalid');
        error.retryAfterMs = retry;
      }
      throw error;
    }
    if ((Object.hasOwn(checked, 'ok') && checked.ok !== true) || !Object.hasOwn(checked, 'value')) {
      fail('invalid_response', 'Native service response is invalid');
    }
    return checked.value;
  }

  function envelope(frame, name) {
    return clone({contextId: frame.contextId, revision: frame.revision,
      ...(frame.snapshots[name] ?? {status: 'unsupported', data: null})});
  }

  function schedule(subscriber, value) {
    if (!subscribers.has(subscriber)) return;
    subscriber.pending = value;
    if (subscriber.queued) return;
    subscriber.queued = true;
    queueMicrotask(() => {
      subscriber.queued = false;
      if (!subscribers.has(subscriber) || !subscriber.pending) return;
      const next = subscriber.pending;
      subscriber.pending = null;
      if (subscriber.last && next.contextId === subscriber.last.contextId
          && next.revision === subscriber.last.revision && next.status === subscriber.last.status) return;
      subscriber.last = {contextId: next.contextId, revision: next.revision, status: next.status};
      // A consumer exception must not stop independent service subscriptions.
      try { subscriber.listener(next); } catch (_) { /* Listener owns its errors. */ }
    });
  }

  function accept(frame) {
    // Keep the watermark after context loss so late private data stays retired.
    if (frame.contextId !== null && frame.revision <= newestRevision) return current;
    if (frame.contextId !== null) newestRevision = frame.revision;
    current = frame;
    for (const subscriber of subscribers) schedule(subscriber, envelope(frame, subscriber.name));
    return frame;
  }

  function receiveSnapshot(snapshot) {
    let frame;
    try { frame = validation.services(snapshot.services); } catch (_) { return; }
    eventSequence += 1;
    accept(frame);
  }

  function readCurrent() {
    if (readPending) return readPending;
    const startedAtEvent = eventSequence;
    readPending = (async () => {
      const snapshot = await request({type: 'gameSnapshot'});
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        fail('invalid_response', 'Native game snapshot is invalid');
      }
      const frame = validation.services(snapshot.services);
      // An old-host initial response cannot erase an event that established v2.
      if (startedAtEvent !== eventSequence && current
          && (frame.contextId === null || current.contextId === null)) return current;
      return accept(frame);
    })();
    const pending = readPending;
    // Attach both handlers so rejected initial reads never become unhandled promises.
    pending.then(() => { if (readPending === pending) readPending = null; },
      () => { if (readPending === pending) readPending = null; });
    return pending;
  }

  function onSnapshot(name, listener) {
    if (typeof listener !== 'function') fail('invalid_listener', 'Listener must be a function');
    if (subscribers.size >= 128) fail('subscription_limit', 'Service subscription limit reached');
    const subscriber = {name, listener, queued: false, pending: null, last: null};
    subscribers.add(subscriber);
    readCurrent().then(frame => schedule(subscriber, envelope(frame, name)), () => {
      if (!subscriber.last && !subscriber.pending) {
        schedule(subscriber, {contextId: null, revision: 0, status: 'unavailable', data: null});
      }
    });
    return () => {
      subscriber.pending = null;
      subscribers.delete(subscriber);
    };
  }

  function requireAccess(frame, capabilities) {
    if (frame.contextId === null) fail('unsupported', 'Native service API is unsupported');
    if (capabilities.length === 0) return;
    if (!capabilities.some(name => frame.capabilities[name].supported)) {
      fail('unsupported', 'Native service capability is unsupported');
    }
    if (!capabilities.some(name => frame.capabilities[name].granted)) {
      fail('permission_denied', 'Native service capability is not granted');
    }
  }

  async function action(name, raw = {}) {
    const {parameters, capabilities} = validateAction(name, raw);
    if (name === 'presentation.reportSize' && role !== 'view') {
      fail('role_denied', 'Content sizing requires a view');
    }
    if (pendingActions >= 32) fail('busy', 'Too many pending service actions');
    pendingActions += 1;
    try {
      const frame = await readCurrent();
      requireAccess(frame, capabilities);
      const result = await request({type: 'serviceAction', action: name, contextId: frame.contextId, parameters});
      if (!current || current.contextId !== frame.contextId) {
        fail('stale_context', 'Native service context changed');
      }
      requireAccess(current, capabilities);
      return name === 'assets.read' ? validation.asset(result) : validation.actionResult(result);
    } finally { pendingActions -= 1; }
  }

  const module = (name, actions = {}) => Object.freeze({
    async snapshot() { return envelope(await readCurrent(), name); },
    onSnapshot(listener) { return onSnapshot(name, listener); },
    ...actions,
  });
  const call = name => parameters => action(name, parameters);
  const noArgs = name => () => action(name);
  const api = {
    host: Object.freeze({async capabilities() { return clone((await readCurrent()).capabilities); }}),
    telemetry: module('telemetry'),
    fps: module('fps'),
    media: module('media', {previous: noArgs('media.previous'), playPause: noArgs('media.playPause'), next: noArgs('media.next')}),
    presentation: module('presentation', {reportSize: call('presentation.reportSize')}),
    assets: Object.freeze({read: handle => action('assets.read', {handle})}),
  };
  return {api, receiveSnapshot};
}

// MIT licensed; see ../LICENSE.
function createIndexedStorage(ErrorClass) {
  let connection = null;
  const failure = error => error instanceof ErrorClass ? error : new ErrorClass(
    error?.name === 'QuotaExceededError' ? 'storage_quota_exceeded' : 'storage_unavailable',
    'Widget storage operation failed',
  );

  function open() {
    if (connection) return connection;
    const opening = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(failure()), 5000);
      const finish = (error, database) => {
        if (settled) { database?.close(); return; }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(database);
      };
      try {
        const request = globalThis.indexedDB.open('overcrow.sdk.storage', 1);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction.abort(); return; }
          request.result.createObjectStore('values');
        };
        request.onerror = () => finish(failure(request.error));
        request.onblocked = () => finish(new ErrorClass('busy', 'Widget storage upgrade is blocked'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            if (connection === opening) connection = null;
            database.close();
          };
          database.onclose = () => { if (connection === opening) connection = null; };
          finish(null, database);
        };
      } catch (error) { finish(failure(error)); }
    });
    connection = opening;
    opening.catch(() => { if (connection === opening) connection = null; });
    return opening;
  }

  return async (operation, key, value) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      let transaction, result = null, reason = null;
      const timer = setTimeout(() => abort(failure()), 5000);
      const finish = error => {
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      };
      const abort = error => {
        reason = error;
        try { transaction?.abort(); } catch (_) { /* A completed transaction cannot be aborted. */ }
        finish(error);
      };
      try {
        transaction = database.transaction('values', operation === 'get' ? 'readonly' : 'readwrite');
        // A successful request is not a successful commit: only oncomplete resolves.
        transaction.oncomplete = () => finish(reason);
        transaction.onabort = () => finish(reason ?? failure(transaction.error));
        const store = transaction.objectStore('values');
        if (operation === 'get') {
          const request = store.openCursor(key);
          request.onsuccess = () => {
            const record = request.result;
            if (record && typeof record.value !== 'string') {
              abort(new ErrorClass('invalid_response', 'Stored widget data is invalid'));
            } else result = record ? record.value : null;
          };
        } else if (operation === 'remove') store.delete(key);
        else {
          // Count and insert share one write transaction across views/controllers.
          const existing = store.getKey(key), count = store.count();
          let completed = 0;
          const write = () => {
            if (++completed !== 2) return;
            if (existing.result === undefined && count.result >= 256) {
              abort(new ErrorClass('storage_quota_exceeded', 'Widget storage contains too many keys'));
              return;
            }
            try { store.put(value, key); } catch (error) { abort(failure(error)); }
          };
          existing.onsuccess = count.onsuccess = write;
        }
      } catch (error) { abort(failure(error)); }
    });
  };
}

// MIT licensed; see ../LICENSE.

function createStorage({native, ErrorClass, clone}) {
  const encoder = new TextEncoder();
  const indexed = createIndexedStorage(ErrorClass);
  let pending = 0;
  const fail = code => { throw new ErrorClass(code, `Widget storage operation failed (${code})`); };
  const policy = () => {
    if (!native) fail('bridge_unavailable');
    const storage = native.storage;
    if (!storage || !['persistent', 'temporary'].includes(storage.mode)
        || !['indexeddb', 'memory'].includes(storage.backend)
        || (storage.backend === 'memory' && storage.mode !== 'temporary')) fail('unsupported');
    return storage;
  };
  const encode = (value, code) => {
    try {
      const text = JSON.stringify(clone(value));
      if (encoder.encode(text).byteLength > 65536) fail(code);
      return text;
    } catch (_) { fail(code); }
  };
  const decode = value => {
    if (value === null) return undefined;
    if (typeof value !== 'string' || encoder.encode(value).byteLength > 65536) fail('invalid_response');
    try { return JSON.parse(encode(JSON.parse(value), 'invalid_response')); }
    catch (_) { fail('invalid_response'); }
  };
  async function memory(operation, key, value) {
    let timer;
    try {
      const response = await Promise.race([
        native.request({type: 'storage', operation, key, ...(operation === 'set' ? {value} : {})}, new ArrayBuffer(0)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new ErrorClass('storage_unavailable', 'Widget storage timed out')), 5000); }),
      ]);
      if (!(response?.body instanceof ArrayBuffer) || response.body.byteLength !== 0) fail('invalid_response');
      const metadata = response.metadata;
      if (metadata?.ok !== true) {
        const code = metadata?.error?.code;
        fail(['storage_quota_exceeded', 'storage_unavailable', 'busy', 'stale_context'].includes(code) ? code : 'invalid_response');
      }
      if (!Object.hasOwn(metadata, 'value') || (operation !== 'get' && metadata.value !== null)) fail('invalid_response');
      return metadata.value;
    } catch (error) {
      if (error instanceof ErrorClass) throw error;
      fail('storage_unavailable');
    } finally { clearTimeout(timer); }
  }
  async function run(operation, key, value) {
    const storage = policy();
    if (typeof key !== 'string' || !key.length || encoder.encode(key).byteLength > 128) fail('invalid_storage_key');
    if (pending >= 32) fail('busy');
    // Snapshot before the first await so caller mutations cannot alter a queued save.
    const encoded = operation === 'set' ? encode(value, 'invalid_storage_value') : undefined;
    pending += 1;
    try {
      const result = await (storage.backend === 'indexeddb' ? indexed : memory)(operation, key, encoded);
      if (operation === 'get') return decode(result);
    } finally { pending -= 1; }
  }
  return Object.freeze({
    async getInfo() { return Object.freeze({mode: policy().mode}); },
    get: key => run('get', key),
    set: (key, value) => run('set', key, value),
    remove: key => run('remove', key),
  });
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_JSON_DEPTH = 64;
const MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const EMPTY_BODY = new ArrayBuffer(0);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class OvercrowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OvercrowError';
    this.code = code;
  }
}

class OvercrowResponse {
  #body;
  #bodyUsed = false;

  constructor(metadata, body) {
    if (!Number.isInteger(metadata.status) || metadata.status < 100 || metadata.status > 599) {
      throw new OvercrowError('invalid_response', 'Native response status is invalid');
    }
    this.status = metadata.status;
    this.ok = metadata.status >= 200 && metadata.status < 300;
    this.contentType = typeof metadata.contentType === 'string' ? metadata.contentType : null;
    this.#body = copyArrayBuffer(body);
    Object.freeze(this);
  }

  get bodyUsed() {
    return this.#bodyUsed;
  }

  #consume() {
    if (this.#bodyUsed) {
      throw new OvercrowError('body_used', 'Response body has already been consumed');
    }
    this.#bodyUsed = true;
    return this.#body.slice(0);
  }

  async arrayBuffer() {
    return this.#consume();
  }

  async text() {
    return decoder.decode(this.#consume());
  }

  async json() {
    return JSON.parse(await this.text());
  }
}

function bridge() {
  const candidate = globalThis.__overcrowNative;
  if (!candidate
      || (candidate.role !== 'controller' && candidate.role !== 'view')
      || typeof candidate.request !== 'function'
      || typeof candidate.subscribe !== 'function') {
    return null;
  }
  return candidate;
}

function copyArrayBuffer(value) {
  if (!(value instanceof ArrayBuffer)) {
    throw new OvercrowError('invalid_response', 'Native response body is not an ArrayBuffer');
  }
  return value.slice(0);
}

function requestBody(value) {
  let body;
  if (value === undefined || value === null) {
    body = EMPTY_BODY.slice(0);
  } else if (value instanceof ArrayBuffer) {
    body = value.slice(0);
  } else if (ArrayBuffer.isView(value)) {
    body = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  } else if (typeof value === 'string') {
    body = encoder.encode(value).buffer;
  } else {
    throw new OvercrowError('invalid_body', 'Body must be a string, ArrayBuffer, or typed array');
  }
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new OvercrowError('request_body_limit', 'Request body exceeds the 2 MiB limit');
  }
  return body;
}

function cloneJson(value, seen = new Set(), depth = 0) {
  if (depth > MAX_JSON_DEPTH) {
    throw new OvercrowError('invalid_message', 'Payload nesting exceeds the JSON depth limit');
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object') {
    throw new OvercrowError('invalid_message', 'Payload must contain cloneable JSON values only');
  }
  if (seen.has(value)) {
    throw new OvercrowError('invalid_message', 'Payload must not contain cycles');
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new OvercrowError('invalid_message', 'Payload must contain plain JSON objects only');
  }
  const keys = Object.keys(value);
  if (Array.isArray(value) && (keys.length !== value.length || keys.some((key, index) => key !== String(index)))) {
    throw new OvercrowError('invalid_message', 'JSON arrays must be dense and contain only indexed values');
  }
  seen.add(value);
  const cloned = Array.isArray(value) ? [] : {};
  for (const key of keys) {
    Object.defineProperty(cloned, key, {
      value: cloneJson(value[key], seen, depth + 1),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  seen.delete(value);
  return cloned;
}

function checkedJson(value) {
  const cloned = cloneJson(value);
  if (encoder.encode(JSON.stringify(cloned)).byteLength > MAX_JSON_BYTES) {
    throw new OvercrowError('message_too_large', 'Payload exceeds the 1 MiB JSON limit');
  }
  return cloned;
}

function checkedSnapshot(value) {
  const snapshot = checkedJson(value);
  const invalid = () => { throw new OvercrowError('invalid_response', 'Native game snapshot is invalid'); };
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) invalid();
  for (const key of ['running', 'selectedActive']) {
    if (Object.hasOwn(snapshot, key) && typeof snapshot[key] !== 'boolean') invalid();
  }
  if (Object.hasOwn(snapshot, 'overlayMode') && !['passive', 'interactive'].includes(snapshot.overlayMode)) invalid();
  for (const key of ['steamAppId', 'sessionElapsedMs', 'cpuPercentHundredths', 'residentBytes', 'cpuTemperatureMillicelsius', 'gpuTemperatureMillicelsius']) {
    if (!Object.hasOwn(snapshot, key) || snapshot[key] === null) continue;
    const number = snapshot[key];
    if (!Number.isSafeInteger(number) || (!key.endsWith('TemperatureMillicelsius') && number < 0)) invalid();
  }
  // Keep missing and extension fields intact for older hosts and replay fixtures.
  return snapshot;
}

async function invoke(metadata, body = EMPTY_BODY) {
  const native = bridge();
  if (!native) {
    throw new OvercrowError('bridge_unavailable', 'OverCrow native bridge is unavailable');
  }
  const checkedMetadata = checkedJson(metadata);
  let response;
  try {
    response = await native.request(checkedMetadata, copyArrayBuffer(body));
  } catch (_) {
    throw new OvercrowError('native_failure', 'OverCrow native request failed');
  }
  if (!response || typeof response !== 'object') {
    throw new OvercrowError('invalid_response', 'Native response is malformed');
  }
  const responseMetadata = checkedJson(response.metadata);
  const responseBody = copyArrayBuffer(response.body);
  if (!responseMetadata || typeof responseMetadata !== 'object' || Array.isArray(responseMetadata)) {
    throw new OvercrowError('invalid_response', 'Native response metadata is malformed');
  }
  if (responseMetadata.ok !== true) {
    const error = responseMetadata.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)
        || typeof error.code !== 'string' || typeof error.message !== 'string') {
      throw new OvercrowError('invalid_response', 'Native rejection is malformed');
    }
    throw new OvercrowError(error.code, error.message);
  }
  return { metadata: responseMetadata, body: responseBody };
}

const nativeAtLoad = bridge();
const role = nativeAtLoad?.role ?? 'unavailable';
const services = createServices({native: nativeAtLoad, role, ErrorClass: OvercrowError, clone: checkedJson});
const relayListeners = new Set();
const visibilityListeners = new Set();
const gameListeners = new Map();
const snapshotListeners = new Set();
const localeListeners = new Set();
const validLocale = value => value === null || (typeof value === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value));

if (nativeAtLoad) {
  nativeAtLoad.subscribe((rawEvent) => {
    let event;
    try {
      event = checkedJson(rawEvent);
    } catch (_) {
      return;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return;
    if (event.type === 'relay'
        && event.source !== role
        && (event.source === 'controller' || event.source === 'view')) {
      for (const listener of [...relayListeners]) listener(event.payload);
    } else if (event.type === 'visibility' && typeof event.visible === 'boolean') {
      for (const listener of [...visibilityListeners]) listener(event.visible);
    } else if (event.type === 'localeChanged' && validLocale(event.locale)) {
      for (const listener of [...localeListeners]) listener(event.locale);
    } else if (event.type === 'gameSnapshot') {
      let snapshot;
      try { snapshot = checkedSnapshot(event.payload); } catch (_) { return; }
      services.receiveSnapshot(snapshot);
      for (const listener of [...snapshotListeners]) listener(checkedJson(snapshot));
    } else if (event.type === 'gameEvent' && typeof event.event === 'string') {
      for (const listener of [...(gameListeners.get(event.event) ?? [])]) listener(event.payload);
    }
  });
}

function listen(collection, listener) {
  if (typeof listener !== 'function') {
    throw new OvercrowError('invalid_listener', 'Listener must be a function');
  }
  collection.add(listener);
  let active = true;
  return () => {
    if (active) collection.delete(listener);
    active = false;
  };
}

export const overcrow = Object.freeze({
  ...services.api,
  storage: createStorage({native: nativeAtLoad, ErrorClass: OvercrowError, clone: checkedJson}),
  async fetch(url, options = {}) {
    if (typeof url !== 'string' || !options || typeof options !== 'object') {
      throw new OvercrowError('invalid_request', 'Fetch URL or options are invalid');
    }
    const method = options.method === undefined ? 'GET' : String(options.method).toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      throw new OvercrowError('invalid_request', 'Fetch method is not supported');
    }
    const response = await invoke(
      { type: 'fetch', method, url },
      requestBody(options.body),
    );
    return new OvercrowResponse(response.metadata, response.body);
  },
  locale: Object.freeze({
    async getCurrent() {
      const response = await invoke({ type: 'locale' });
      if (!validLocale(response.metadata.value)) {
        throw new OvercrowError('invalid_response', 'Native locale is invalid');
      }
      return response.metadata.value;
    },
    onChanged(listener) {
      return listen(localeListeners, listener);
    },
  }),
  game: Object.freeze({
    async snapshot() {
      const response = await invoke({ type: 'gameSnapshot' });
      return checkedSnapshot(response.metadata.value);
    },
    onSnapshot(listener) {
      return listen(snapshotListeners, listener);
    },
    on(event, listener) {
      if (typeof event !== 'string' || event.length === 0) {
        throw new OvercrowError('invalid_event', 'Event ID must be a non-empty string');
      }
      let listeners = gameListeners.get(event);
      if (!listeners) {
        listeners = new Set();
        gameListeners.set(event, listeners);
      }
      const unsubscribe = listen(listeners, listener);
      return () => {
        unsubscribe();
        if (listeners.size === 0) gameListeners.delete(event);
      };
    },
  }),
  runtime: Object.freeze({
    role,
    async send(payload) {
      const checkedPayload = checkedJson(payload);
      const target = role === 'controller' ? 'view' : 'controller';
      await invoke({ type: 'relay', target, payload: checkedPayload });
    },
    onMessage(listener) {
      return listen(relayListeners, listener);
    },
  }),
  lifecycle: Object.freeze({
    onVisibility(listener) {
      return listen(visibilityListeners, listener);
    },
  }),
  surface: Object.freeze({
    async invalidate() {
      await invoke({ type: 'invalidate' });
    },
  }),
  clipboard: Object.freeze({
    async writeText(text) {
      if (typeof text !== 'string') {
        throw new OvercrowError('invalid_request', 'Clipboard text must be a string');
      }
      await invoke({ type: 'clipboardWrite', text });
    },
  }),
});

try {
  Object.defineProperty(globalThis, 'overcrow', {
    value: overcrow,
    configurable: false,
    enumerable: false,
    writable: false,
  });
} catch (_) {
  // Module consumers still receive the named export when a page locked the global first.
}

export default overcrow;
