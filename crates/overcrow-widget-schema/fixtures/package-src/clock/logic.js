// Conformance fixture. The functions below are the compiled template
// expressions of view.json, in index order; the registration call stands for
// the SDK API that P2.1 defines.
"use strict";
const state = { now: 0, seconds: true };
overcrow.view([
  () => overcrow.format.time(state.now, { seconds: state.seconds }),
  () => false,
]);
