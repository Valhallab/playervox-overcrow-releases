import { runtime } from "./runtime.js";
import type {
  CallServiceName,
  ServiceErrorCode,
  ServiceParamsMap,
  ServiceResultMap,
  SubscribeServiceName,
} from "./generated/schema.js";

/** A failed service call or subscription; `code` says why. */
export class ServiceError extends Error {
  /** The failure code the host (or the VM) answered. */
  readonly code: ServiceErrorCode;

  constructor(code: ServiceErrorCode) {
    super(`service failed: ${code}`);
    this.name = "ServiceError";
    this.code = code;
  }
}

/** Parameters of `service`. */
export type ServiceParams<N extends keyof ServiceParamsMap> = ServiceParamsMap[N];

/** Result, or update, of `service`. */
export type ServiceResult<N extends keyof ServiceResultMap> = ServiceResultMap[N];

/** One update of a subscription: a value, or its final failure. */
export type SubscriptionUpdate<T> =
  | { readonly ok: true; readonly value: T; readonly final: boolean }
  | { readonly ok: false; readonly error: ServiceError; readonly final: true };

/** Receives the updates of a subscription. */
export type Listener<T> = (update: SubscriptionUpdate<T>) => void;

/** A running subscription. */
export interface Subscription {
  /** Stops the updates; the host forgets the subscription. Idempotent. */
  cancel(): void;
}

/** The {@link ServiceError} of a failure payload `{ code }`. */
export function toServiceError(payload: unknown): ServiceError {
  const code = (payload as { code?: unknown } | null)?.code;
  return new ServiceError((typeof code === "string" ? code : "unavailable") as ServiceErrorCode);
}

/**
 * Calls a host service once. Prefer the typed namespaces (`storage.get`,
 * `notes.create`…); `http.fetch` is {@link fetch}.
 *
 * @returns the result value.
 * @throws ServiceError (as a rejection) with the failure code;
 * `TypeError` or `RangeError` (as a rejection) when the VM refuses the call
 * itself (unknown service, too many calls in flight).
 */
export function call<N extends CallServiceName>(
  service: N,
  params?: ServiceParams<N>,
): Promise<ServiceResult<N>> {
  return runtime()
    .call(service, params ?? {})
    .then(
      (value) => value as ServiceResult<N>,
      (payload: unknown) => {
        throw payload instanceof Error ? payload : toServiceError(payload);
      },
    );
}

/**
 * Subscribes to a host service: `listener` receives the current value at
 * once, then every update, until {@link Subscription.cancel}, a failure
 * (the last update) or the end of the VM.
 */
export function subscribe<N extends SubscribeServiceName>(
  service: N,
  params: ServiceParams<N>,
  listener: Listener<ServiceResult<N>>,
): Subscription {
  return runtime().subscribe(service, params, (update) => {
    listener(
      update.error === undefined
        ? { ok: true, value: update.value as ServiceResult<N>, final: update.final }
        : { ok: false, error: toServiceError(update.error), final: true },
    );
  });
}

/**
 * Builds a service namespace from method paths: each method calls the
 * service `<prefix>.<path>`, and subscribes when its last argument is the
 * listener. The generated namespaces (`storage`, `notes`…) are built this
 * way; their types live in the declarations only.
 *
 * @internal
 */
export function group<T>(prefix: string, paths: readonly string[]): T {
  const root: Record<string, unknown> = {};
  for (const path of paths) {
    const names = path.split(".");
    let node = root;
    for (const name of names.slice(0, -1)) {
      node = (node[name] ??= {}) as Record<string, unknown>;
    }
    const service = `${prefix}.${path}`;
    node[names[names.length - 1] as string] = (...args: unknown[]) => {
      const last = args[args.length - 1];
      return typeof last === "function"
        ? subscribe(
            service as SubscribeServiceName,
            (args.length > 1 ? args[0] : {}) as never,
            last as Listener<unknown>,
          )
        : call(service as CallServiceName, args[0] as never);
    };
  }
  return root as T;
}
