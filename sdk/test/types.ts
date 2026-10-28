// Type-level checks of the public API: compiled by `npm run typecheck`,
// never run. Each `@ts-expect-error` must stay an error.
import * as overcrow from "@overcrow/sdk";
import type {
  DrawCommand,
  EventDetailMap,
  IconName,
  JsonValue,
  NodeEvent,
  ServiceResult,
  SubscriptionUpdate,
} from "@overcrow/sdk";

declare module "@overcrow/sdk" {
  interface WidgetState {
    now: number;
  }
}

export async function checks(): Promise<void> {
  const now: number = overcrow.state.now;
  const other: unknown = overcrow.state["undeclared"];
  const typed = overcrow.initState({ count: 1 });
  typed.count += now;
  void other;

  // Services: parameters and results come from the schema.
  const value: JsonValue = await overcrow.storage.get({ key: "k" });
  await overcrow.storage.set({ key: "k", value: { list: [1, "a", null] } });
  // @ts-expect-error missing required parameter
  await overcrow.storage.get({});
  // @ts-expect-error unknown parameter
  await overcrow.notes.select({ note: "n", extra: 1 });
  const keys: readonly string[] = await overcrow.storage.keys();
  const note = await overcrow.notes.create();
  const title: string = note.note.title;
  const page = await overcrow.playervox.reviews.page();
  const grade: "S+" | "S" | "A" | "B" | "C" | "D" | "F" | "--" = page.items[0]!.grade;
  void [value, keys, title, grade];

  overcrow.fps.subscribe((update: SubscriptionUpdate<ServiceResult<"fps.subscribe">>) => {
    if (update.ok) {
      const fps: number | null = update.value.fps;
      void fps;
    } else {
      const code: overcrow.ServiceErrorCode = update.error.code;
      void code;
    }
  });
  overcrow.media.subscribe({ cover: false }, (update) => {
    if (update.ok && update.value !== null) {
      const cover: overcrow.AssetHandle | null = update.value.cover;
      void cover;
    }
  });
  // @ts-expect-error the listener comes last
  overcrow.media.subscribe(() => {}, { cover: false });
  // @ts-expect-error a subscription is not a call
  await overcrow.call("fps.subscribe");

  const response = await overcrow.http.fetch("https://api.example.com/", { as: "text" });
  const text: string = response.body;
  const image = await overcrow.http.fetch("https://cdn.example.com/a.png", { as: "image" });
  const asset: overcrow.AssetHandle = image.asset;
  void [text, asset];

  // Draw commands are typed tuples.
  const commands: DrawCommand[] = [
    ["moveTo", 0, 0],
    ["stroke", "var(--color-accent)", 2],
    ["text", 0, 12, "Hi", 11, "#fff", "start", "ui", "400"],
  ];
  // @ts-expect-error missing argument
  commands.push(["lineTo", 0]);
  // @ts-expect-error unknown colour token
  commands.push(["fill", "var(--color-nope)"]);
  overcrow.draw("spark", commands);

  const icon: IconName = "clock";
  // @ts-expect-error not a Lucide icon
  const unknownIcon: IconName = "not-an-icon";
  void [icon, unknownIcon];

  const activate: EventDetailMap["activate"] = { x: 1, y: 2 };
  const handler: overcrow.Handler = (_state, _scope, event: NodeEvent) => {
    if (event.type === "keydown") {
      const key: string = (event as NodeEvent<"keydown">).detail.key;
      void key;
    }
  };
  void [activate, handler];

  const cap: overcrow.Capability = "notes.write";
  // @ts-expect-error removed capability
  const removed: overcrow.Capability = "playervox.followed.read";
  void [cap, removed, overcrow.hasGrant(cap)];
  const grant: overcrow.AccountGrant = "account:steam";
  // @ts-expect-error not an account grant
  const notGrant: overcrow.AccountGrant = "steam";
  const status: overcrow.AccountStatus = { state: "refused" };
  // @ts-expect-error the widget never sees the account's name
  const named: overcrow.AccountStatus = { state: "connected", name: "me" };
  const refused: overcrow.ServiceErrorCode = "account_refused";
  void [grant, notGrant, status, named, refused, overcrow.hasGrant(grant)];
  overcrow.account.subscribe({ id: "steam" }, (update) => {
    if (update.ok) {
      const state: "signed_out" | "pending" | "connected" | "refused" | "expired" = update.value.state;
      void state;
    }
  });
  void overcrow.account.connect({ id: "steam" });

  void overcrow.links.open({ url: "https://runlog.example/runs/1" });
  // @ts-expect-error the address is a parameter object's member
  void overcrow.links.open("https://runlog.example/runs/1");
  void overcrow.http.fetch("https://api.example.com/v1/x", { as: "json" }).then((response) => {
    const wait: string | undefined = response.headers["retry-after"];
    // @ts-expect-error a header the response never gives a widget
    const cookie = response.headers["set-cookie"];
    void [wait, cookie];
  });
  const moderated: overcrow.ServiceErrorCode = "review_removed_by_moderation";
  void moderated;

  overcrow.gameEvents.warframe.subscribe((update) => {
    if (!update.ok) return;
    const ready: "available" | "unavailable" | "undeclared" = update.value.features.mission;
    const node: string | null = update.value.info.mission?.node.name ?? null;
    for (const event of update.value.events) {
      if (event.type === "mission_ended") {
        const result: "succeeded" | "failed" | "aborted" | null = event.mission.result;
        void result;
      }
      // @ts-expect-error a progress event carries no mission
      if (event.type === "wave_started") void event.mission;
    }
    void [ready, node];
  });
  // @ts-expect-error the former generic game events are gone
  overcrow.gameEvents.subscribe(() => {});

  const seconds: boolean = overcrow.option("seconds", true);
  overcrow.timers.atEach("minute", () => {}).cancel();
  const label: string = overcrow.formatNumber(1234.5) + overcrow.t("key", { n: 1 });
  void [seconds, label];
}
