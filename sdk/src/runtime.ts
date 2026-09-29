/**
 * The runtime surface the SDK wraps: the frozen global `overcrow` that the
 * OverCrow widget VM installs before `logic.js` runs. SDK 1.x needs the
 * runtime surface 0.1, which the VM reports as `sdk` in its `Ready`
 * message. The SDK is a convenience layer inside the widget, not a security
 * boundary: the host checks everything that leaves the VM.
 *
 * @packageDocumentation
 */

/** Version of this SDK. */
export const SDK_VERSION = "1.0.0";

/** Version of the runtime surface this SDK needs (`Ready.sdk` of the VM). */
export const RUNTIME_SURFACE = "0.1";

/** Host values as the runtime holds them; see {@link HostData}. */
export interface RuntimeHost {
  readonly [key: string]: unknown;
}

/** A settled service answer, as the runtime reports a subscription update. */
export interface RuntimeUpdate {
  readonly value?: unknown;
  readonly error?: unknown;
  readonly final: boolean;
}

/** The runtime surface 0.1. Widgets use the SDK functions instead. */
export interface RuntimeSurface {
  readonly state: Record<string, unknown>;
  readonly host: RuntimeHost;
  view(table: readonly unknown[]): void;
  call(service: string, params: object, body?: string): Promise<unknown>;
  subscribe(
    service: string,
    params: object,
    update: (update: RuntimeUpdate) => void,
  ): { cancel(): void };
  timer(intervalMs: number, repeat: boolean, callback: () => void): number;
  cancelTimer(id: number): void;
  draw(ref: string, commands: readonly unknown[]): void;
  onMenu(handler: (row: string) => void): void;
  onHost(handler: (changed: readonly string[]) => void): void;
  log(level: string, text: string): void;
}

const FUNCTIONS = [
  "view",
  "call",
  "subscribe",
  "timer",
  "cancelTimer",
  "draw",
  "onMenu",
  "onHost",
  "log",
] as const;

let surface: RuntimeSurface | undefined;

/**
 * The runtime surface, checked on first use.
 *
 * @throws Error when the code does not run in an OverCrow widget VM with
 * the runtime surface 0.1.
 */
export function runtime(): RuntimeSurface {
  if (surface !== undefined) {
    return surface;
  }
  const candidate = (globalThis as { overcrow?: unknown }).overcrow as
    | Partial<Record<string, unknown>>
    | undefined;
  const valid =
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate["state"] === "object" &&
    candidate["state"] !== null &&
    typeof candidate["host"] === "object" &&
    FUNCTIONS.every((name) => typeof candidate[name] === "function");
  if (!valid) {
    throw new Error(
      `@overcrow/sdk ${SDK_VERSION} needs the OverCrow widget runtime surface ${RUNTIME_SURFACE}: run this code as a widget's logic.js`,
    );
  }
  surface = candidate as unknown as RuntimeSurface;
  return surface;
}
