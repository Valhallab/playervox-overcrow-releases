import { host } from "./host.js";

/** Values interpolated into a message. */
export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The message `key` of the active locale (`locales/<locale>.json`), with
 * each `{name}` replaced by `params[name]`. A missing key returns the key;
 * a placeholder without a value stays as written. Numbers are inserted as
 * written by JavaScript; format them first with `formatNumber`.
 *
 * View expressions call it as `t(key, params)`.
 */
export function t(key: string, params?: MessageParams): string {
  const message = host.messages[key];
  if (typeof message !== "string") {
    return key;
  }
  if (params === undefined) {
    return message;
  }
  return message.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    return value === undefined ? placeholder : String(value);
  });
}
