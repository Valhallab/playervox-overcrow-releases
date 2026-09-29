import { runtime } from "./runtime.js";

/**
 * Development log. The host shows it only for development installs and
 * drops it in production; the text is cut to `MAX_LOG_BYTES`. Never log
 * user content.
 */
export const log = {
  debug(text: string): void {
    runtime().log("debug", text);
  },
  info(text: string): void {
    runtime().log("info", text);
  },
  warn(text: string): void {
    runtime().log("warn", text);
  },
  error(text: string): void {
    runtime().log("error", text);
  },
};
