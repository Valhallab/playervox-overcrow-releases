import { runtime } from "./runtime.js";
import { toServiceError } from "./services.js";
import type { AssetHandle, JsonValue, ServiceParamsMap } from "./generated/schema.js";

/** How `fetch` returns the response body. */
export type BodyType = ServiceParamsMap["http.fetch"]["as"];

/** A method of a declared network rule. */
export type HttpMethod = ServiceParamsMap["http.fetch"]["method"];

/** Options of {@link HttpServices.fetch}. */
export interface FetchOptions<A extends BodyType> {
  /** Method of the matching manifest rule; default `GET`. */
  readonly method?: HttpMethod;
  /** Body decoding: `json`, `text`, `bytes` (an `ArrayBuffer`) or `image` (an asset handle). */
  readonly as: A;
  /**
   * Request body: a string is sent as `text/plain` unless `contentType`
   * says otherwise; any other value is sent as JSON.
   */
  readonly body?: JsonValue;
  /** Media type of the body; `application/json` or `text/plain`. */
  readonly contentType?: ServiceParamsMap["http.fetch"]["contentType"];
}

/** The decoded body of each {@link BodyType}. */
export interface BodyTypes {
  /** The parsed JSON body. */
  readonly json: JsonValue;
  /** The body as UTF-8 text. */
  readonly text: string;
  /** The raw body. */
  readonly bytes: ArrayBuffer;
}

/** The response of {@link HttpServices.fetch}. */
export type FetchResponse<A extends BodyType> = A extends "image"
  ? { readonly status: number; readonly asset: AssetHandle }
  : A extends keyof BodyTypes
    ? {
        readonly status: number;
        readonly contentType: string | null;
        /** Decoded body; `null`, `""` or an empty buffer when the response has none. */
        readonly body: BodyTypes[A];
      }
    : never;

const EMPTY: { readonly [A in keyof BodyTypes]: () => BodyTypes[A] } = {
  json: () => null,
  text: () => "",
  bytes: () => new ArrayBuffer(0),
};

/**
 * `http.fetch`: an HTTPS request through the host broker. Requires the
 * `network` permission and a manifest rule matching the URL and method;
 * redirects, credentials and local addresses are refused. The VM decodes
 * the body as `as` asks; a body that does not decode fails with
 * `encoding_denied`.
 *
 * @throws ServiceError (as a rejection) with the host's failure code.
 *
 * @example
 * ```ts
 * const { status, body } = await http.fetch("https://api.example.com/v1/weather", { as: "json" });
 * ```
 */
function fetch<A extends BodyType>(
  url: string,
  options: FetchOptions<A>,
): Promise<FetchResponse<A>> {
  const { method = "GET", as, body, contentType } = options;
  let text: string | undefined;
  let type = contentType;
  if (body !== undefined) {
    text = typeof body === "string" && type !== "application/json" ? body : JSON.stringify(body);
    type ??= typeof body === "string" ? "text/plain" : "application/json";
  }
  const params = type === undefined ? { url, method, as } : { url, method, as, contentType: type };
  return runtime()
    .call("http.fetch", params, text)
    .then(
      (value) => {
        if (as === "image") {
          return value as FetchResponse<A>;
        }
        const response = value as { status: number; contentType: string | null; body?: unknown };
        return {
          status: response.status,
          contentType: response.contentType,
          body: response.body ?? EMPTY[as as keyof BodyTypes](),
        } as FetchResponse<A>;
      },
      (payload: unknown) => {
        throw payload instanceof Error ? payload : toServiceError(payload);
      },
    );
}

/** The `http.*` services. */
export interface HttpServices {
  /**
   * `http.fetch`: an HTTPS request through the host broker. Requires the
   * `network` permission and a manifest rule matching the URL and method;
   * redirects, credentials and local addresses are refused. The VM decodes
   * the body as `as` asks; a body that does not decode fails with
   * `encoding_denied`.
   *
   * @throws ServiceError (as a rejection) with the host's failure code.
   */
  fetch<A extends BodyType>(url: string, options: FetchOptions<A>): Promise<FetchResponse<A>>;
}

/** The `http.*` services. */
export const http: HttpServices = { fetch };
