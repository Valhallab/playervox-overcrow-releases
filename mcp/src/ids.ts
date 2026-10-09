// Widget IDs: the CLI's grammar (at least two dot-separated labels of
// lowercase letters, digits and dashes), the IDs reserved for PlayerVox, and
// the placeholders a creator must replace. The creator space gives each
// publisher a handle: an ID is `<handle>.<name>`, or sits under a reverse
// domain the publisher verified. An ID is final and never reused.

/** The CLI's ID rule (`valid_widget_id`): 3 to 128 bytes, labels of 1 to 63. */
export const WIDGET_ID =
  /^(?=.{3,128}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The two forms, for messages. */
export const ID_FORMS =
  "<handle>.<name>, with your publisher handle in the OverCrow creator space (such as nova.lol-timers), or a reverse domain you can verify (such as gg.nova.lol-timers)";

export function isReservedId(id: string): boolean {
  return id === "com.playervox" || id.startsWith("com.playervox.");
}

/** IDs copied from an example: anyone could claim them. */
export function isPlaceholderId(id: string): boolean {
  return (
    /^(example|yourhandle|yourname)(\.|$)/.test(id) ||
    /^(com|org|net)\.(example|yourhandle|yourname)(\.|$)/.test(id)
  );
}

/** Why `id` cannot be a widget's ID, or undefined when it can. */
export function idProblem(id: string): string | undefined {
  if (!WIDGET_ID.test(id)) {
    return `The ID must be lowercase, with at least two parts separated by dots, made of letters, digits and dashes: ${ID_FORMS}.`;
  }
  if (isReservedId(id)) {
    return `IDs under com.playervox are reserved for widgets published by PlayerVox: use ${ID_FORMS}.`;
  }
  return undefined;
}
