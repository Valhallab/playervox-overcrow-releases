/**
 * `@overcrow/sdk`: the API of OverCrow widget logic (widget API v1).
 *
 * ```ts
 * import * as overcrow from "@overcrow/sdk";
 * ```
 *
 * The package is bundled into the widget's `logic.js` and runs in the
 * widget VM over its runtime surface 0.1. Every service is checked again by
 * the host: the SDK types help, the host decides.
 *
 * @packageDocumentation
 */

export { SDK_VERSION, RUNTIME_SURFACE } from "./runtime.js";
export { state, initState, type WidgetState } from "./state.js";
export {
  registerView,
  type Expression,
  type Handler,
  type NodeEvent,
  type Scope,
  type ViewTable,
} from "./view.js";
export {
  host,
  hasGrant,
  onHost,
  option,
  type HostData,
  type HostKey,
  type HostListener,
  type MenuValue,
  type Viewport,
  type Widened,
} from "./host.js";
export {
  call,
  subscribe,
  ServiceError,
  type Listener,
  type ServiceParams,
  type ServiceResult,
  type Subscription,
  type SubscriptionUpdate,
} from "./services.js";
export {
  http,
  type BodyType,
  type BodyTypes,
  type FetchOptions,
  type FetchResponse,
  type HttpMethod,
  type HttpServices,
} from "./http.js";
export { timers, type Timer } from "./timers.js";
export { draw } from "./draw.js";
export { onMenu } from "./menu.js";
export { t, type MessageParams } from "./i18n.js";
export { log } from "./log.js";
export {
  delayToNext,
  formatDate,
  formatDuration,
  formatNumber,
  formatTime,
  localTime,
  type ClockOptions,
  type DateOptions,
  type DurationOptions,
  type LocalTime,
  type NumberOptions,
  type TimeOptions,
  type TimeUnit,
} from "./format.js";
export * from "./generated/services.js";
export type * from "./generated/schema.js";
export type { IconName } from "./generated/icons.js";
export * from "./generated/limits.js";
