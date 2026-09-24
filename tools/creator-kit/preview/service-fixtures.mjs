// MIT License. Copyright (c) 2026 Valhallab SASU.
// Fictional, local-only preview data. No account or device is contacted.
export const CAPABILITIES = Object.freeze([
  "telemetry.read",
  "fps.read",
  "stopwatch.read",
  "stopwatch.control",
  "media.read",
  "media.control",
  "notes.read",
  "notes.write",
  "playervox.score.read",
  "playervox.rating.read",
  "playervox.rating.write",
  "playervox.reviews.read",
  "playervox.followed.read",
  "journal.local.read",
  "journal.cloud.read",
  "journal.notes.read",
  "journal.notes.write",
  "journal.delete",
  "twitch.chat.read",
  "twitch.chat.compose",
]);
export const READ_CAPABILITIES = Object.freeze({
  telemetry: ["telemetry.read"],
  fps: ["fps.read"],
  stopwatch: ["stopwatch.read"],
  media: ["media.read"],
  notes: ["notes.read"],
  "playervox.score": ["playervox.score.read"],
  "playervox.rating": ["playervox.rating.read"],
  "playervox.reviews": ["playervox.reviews.read"],
  journal: ["journal.local.read", "journal.cloud.read"],
  "twitch.chat": ["twitch.chat.read"],
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
    stopwatch: ready({ elapsedMs: 0, running: false }),
    media: ready({
      title: "Preview track",
      artist: "Fictional artist",
      playbackState: "paused",
      artworkHandle: null,
      actions: { previous: true, playPause: true, next: true },
    }),
    notes: ready({
      documentRevision: 1,
      activeNoteId: "note-1",
      saveState: "persisted",
      notes: [
        {
          id: "note-1",
          title: "Preview checklist",
          body: "Fictional native note. Your real notes are never read by this preview.",
          items: [{ id: "item-1", text: "Try an SDK action", checked: false }],
        },
      ],
    }),
    "playervox.score": ready({
      name: "Preview game",
      score: 84,
      ratingsCount: 12,
      criteria: { gameplay: 88, art: 84, tech: 80 },
    }),
    "playervox.rating": ready({
      rating: {
        gameplayScore: 80,
        artScore: 90,
        techScore: 85,
        averageScore: 85,
        review: "Fictional personal review.",
      },
    }),
    "playervox.reviews": ready({
      page: 1,
      totalPages: 2,
      ratingsCount: 4,
      followedOnly: false,
      reviews: [
        {
          id: "review-1",
          displayName: "Preview player",
          gameplayScore: 80,
          artScore: 90,
          techScore: 85,
          averageScore: 85,
          review: "Avis fictif.",
          originalReview: "Fictional review.",
          translated: true,
          createdAt: "2026-09-01T12:00:00Z",
          hidden: false,
        },
      ],
    }),
    journal: ready({
      page: 1,
      hasMore: false,
      nextCursor: null,
      previousCursor: null,
      sessions: [
        {
          id: "session-1",
          source: "local",
          startedAt: "2026-09-01T12:00:00Z",
          endedAt: "2026-09-01T12:30:00Z",
          durationMs: 1800000,
          interrupted: false,
          note: "Fictional journal note.",
        },
      ],
    }),
    "twitch.chat": ready({
      connection: "joined",
      channelDisplayName: "Preview channel (offline fixture)",
      messages: [
        {
          id: "message-1",
          displayName: "Preview viewer",
          text: "Fictional chat message — no Twitch connection.",
          color: "#8DA8FF",
          fragments: [
            {
              type: "text",
              text: "Fictional chat message — no Twitch connection.",
            },
          ],
          reply: null,
        },
      ],
    }),
    presentation: ready({
      sizingMode: sizing?.mode ?? "manual",
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
