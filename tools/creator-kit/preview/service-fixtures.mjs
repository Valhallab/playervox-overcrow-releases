// MIT License. Copyright (c) 2026 Valhallab SASU.
// Fictional, local-only preview data. No account or device is contacted.
export const CAPABILITIES = Object.freeze([
  "telemetry.read",
  "fps.read",
  "media.read",
  "media.control",
]);
export const READ_CAPABILITIES = Object.freeze({
  telemetry: ["telemetry.read"],
  fps: ["fps.read"],
  media: ["media.read"],
  presentation: [],
});
const ready = (data) => ({ status: "ready", data });
export function serviceFixtures(presentation) {
  const sizing = presentation?.sizing;
  return {
    telemetry: ready({
      normalizedCpuPercentHundredths: 1250,
      residentBytes: 1073741824,
      cpuTemperatureMillicelsius: null,
      gpuTemperatureMillicelsius: null,
    }),
    fps: { status: "unsupported", data: null },
    media: ready({
      title: "Preview track",
      artist: "Fictional artist",
      playbackState: "paused",
      artworkHandle: null,
      actions: { previous: true, playPause: true, next: true },
    }),
    presentation: ready({
      sizingMode: sizing?.defaultMode === "manual" ? "manual" : sizing?.fitToContent === "both" ? "intrinsic" : sizing?.fitToContent === "height" ? "autoHeight" : "manual",
      width: sizing?.preferred.width ?? 320,
      height: sizing?.preferred.height ?? 240,
      options: Object.fromEntries(
        (presentation?.options ?? []).map((option) => [
          option.id,
          option.default,
        ]),
      ),
    }),
  };
}
