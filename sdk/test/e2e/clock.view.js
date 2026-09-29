// The expression table of clock.ocml, registered in the calling convention
// of `registerView`, as the widget CLI (P2.2) generates it: one function per
// expression index, the names in scope bound from `scope`, a handler's
// `event` bound to the event detail, called names taken from the logic
// module (`t` from the SDK when the module exports none). The CLI writes
// this module as the bundle entry, after the logic module.
// overcrow-widget-format's tests check it against the compiler's output.
import * as logic from "./clock.js";
import { registerView, t as sdkT } from "@overcrow/sdk";

const { clockDate, clockTime, setSeconds, zoneTime } = logic;
const t = "t" in logic ? logic.t : sdkT;

registerView([
  function (state, scope) {
    return t("clock");
  },
  function (state, scope) {
    return clockTime(state.now, state.seconds);
  },
  function (state, scope) {
    return state.showDate;
  },
  function (state, scope) {
    return clockDate(state.now);
  },
  function (state, scope) {
    return state.zones;
  },
  function (state, scope) {
    const zone = scope.zone;
    return zone.id;
  },
  function (state, scope) {
    const zone = scope.zone;
    return zoneTime(state.now, zone.offset);
  },
  function (state, scope) {
    return t("seconds");
  },
  function (state, scope) {
    return state.seconds;
  },
  function (state, scope, raw) {
    const event = raw.detail;
    return setSeconds(event);
  },
]);
